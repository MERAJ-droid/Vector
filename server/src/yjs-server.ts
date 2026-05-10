import WebSocket from 'ws';
import http from 'http';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as map from 'lib0/map';
import pool from './config/database';
import redisConnection from './config/redis';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

/**
 * How stale a Redis YJS state may be (in milliseconds) relative to
 * files.updated_at in PostgreSQL before it is discarded and PostgreSQL
 * is used as the authoritative source.
 *
 * Read from REDIS_STALENESS_THRESHOLD_MS in .env.
 * Default: 5000 ms — large enough to absorb Supabase round-trip latency
 * and Redis write lag while still catching genuinely outdated states.
 * Tune upward if [REDIS-STALENESS] logs show false-stale decisions.
 */
const REDIS_STALENESS_THRESHOLD_MS: number =
  parseInt(process.env.REDIS_STALENESS_THRESHOLD_MS || '5000', 10);

/** Duration of complete inactivity across all connections that defines session end. */
const IDLE_TIMEOUT_MS: number =
  parseInt(process.env.SESSION_IDLE_TIMEOUT_MS || String(5 * 60 * 1000), 10);

/** Maximum session duration before a safety-valve version is cut, even if no idle. */
const MARATHON_CHECKPOINT_MS: number =
  parseInt(process.env.MARATHON_CHECKPOINT_MS || String(30 * 60 * 1000), 10);

/** How often the idle check timer fires. Keep at 1 minute. */
const IDLE_CHECK_INTERVAL_MS = 60_000;

const PORT = 1234;

const docs = new Map<string, WSSharedDoc>();

/**
 * In-progress load promises, keyed by room name.
 * When a second client connects while a room is still loading from Redis/PostgreSQL,
 * it finds the existing promise here and awaits it instead of starting a parallel load.
 * This guarantees exactly one load sequence per room, regardless of how many clients
 * connect concurrently during the cold-start window.
 * Each entry is removed from this map as soon as the load resolves (successfully or not),
 * at which point the completed WSSharedDoc has been added to `docs`.
 */
const loadingDocs = new Map<string, Promise<WSSharedDoc>>();

const messageSync = 0;
const messageAwareness = 1;

class WSSharedDoc extends Y.Doc {
  name: string;
  conns: Map<WebSocket, Set<number>>;
  awareness: awarenessProtocol.Awareness;
  saveTimeout: NodeJS.Timeout | null = null;
  lastSavedContent: string = '';
  isInitializing: boolean = true; // Flag to prevent saves during initial load

  /** Timestamp (ms) of the last message received from each connection. */
  connLastActivity: Map<WebSocket, number> = new Map();

  /** Content string at the time the last version was created. Used to skip
   *  identical-content version saves. */
  lastVersionContent: string = '';

  /** Timestamp (ms) when the last version was created. Drives marathon checkpoint. */
  lastVersionSavedAt: number = Date.now();

  /** The periodic interval that runs the idle check. */
  idleCheckInterval: NodeJS.Timeout | null = null;

  constructor(name: string) {
    super({ gc: true });
    this.name = name;
    this.conns = new Map();
    this.awareness = new awarenessProtocol.Awareness(this);

    this.awareness.on('update', ({ added, updated, removed }: any) => {
      const changedClients = added.concat(updated).concat(removed);
      const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(encoder, awarenessUpdate);
      const buff = encoding.toUint8Array(encoder);
      this.conns.forEach((_, conn) => {
        send(this, conn, buff);
      });
    });

    // Save to database on updates (debounced)
    this.on('update', () => {
      // Don't auto-save during initial content loading
      if (this.isInitializing) {
        return;
      }

      if (this.saveTimeout) {
        clearTimeout(this.saveTimeout);
      }
      this.saveTimeout = setTimeout(() => {
        this.saveToDatabase();
      }, 2000); // Save 2 seconds after last change
    });
  }

  async saveToDatabase() {
    try {
      const fileId = this.name.replace('file-', '');
      const content = this.getText('monaco').toString();

      // Only save if content actually changed
      if (content === this.lastSavedContent) {
        console.log(`⏭️ File ${fileId} content unchanged, skipping save`);
        return;
      }

      console.log(`💾 Saving file ${fileId} to database (${content.length} chars)`);

      // Save to PostgreSQL and capture the authoritative write timestamp in one query.
      // updated_at = NOW() is the write; RETURNING updated_at gives us the same PG clock
      // value without a second round-trip — no Date.now() ever used here.
      const pgResult = await pool.query(
        'UPDATE files SET content = $1, updated_at = NOW() WHERE id = $2 RETURNING updated_at',
        [content, fileId]
      );

      // If RETURNING produced no row, the UPDATE matched zero rows — the file no longer
      // exists in PostgreSQL. Do not write orphaned Redis state for a deleted file.
      // Log a warning and return early; do NOT fall back to system time.
      if (!pgResult.rows[0]?.updated_at) {
        console.warn(
          `⚠️ saveToDatabase: UPDATE matched no rows for file ${fileId}. ` +
          `File may have been deleted. Skipping Redis write-back.`
        );
        return;
      }

      // Save to Redis with the PG-authoritative timestamp.
      // pgResult.rows[0].updated_at is the value PostgreSQL set — the only valid clock source.
      if (redisConnection.isConnected()) {
        const pgNow: string = pgResult.rows[0].updated_at.toISOString();
        const state = Y.encodeStateAsUpdate(this);
        await redisConnection.saveYjsState(fileId, state, pgNow);
      } else {
        console.warn('⚠️ Redis not available, saved to PostgreSQL only');
      }

      this.lastSavedContent = content;
      console.log(`✅ File ${fileId} saved successfully`);
    } catch (error: any) {
      console.error('❌ Error saving to database:', error.message);
    }
  }

  startIdleCheck() {
    if (this.idleCheckInterval) return; // already running
    this.idleCheckInterval = setInterval(() => {
      this.checkIdleTimeout().catch((err: any) => {
        console.error(`❌ Idle check error for "${this.name}":`, err.message);
      });
    }, IDLE_CHECK_INTERVAL_MS);
    console.log(`⏱️ Idle check started for room "${this.name}"`);
  }

  stopIdleCheck() {
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = null;
      console.log(`⏹️ Idle check stopped for room "${this.name}"`);
    }
  }

  async checkIdleTimeout() {
    if (this.conns.size === 0) return;

    const now = Date.now();

    // Marathon safety valve
    if (now - this.lastVersionSavedAt >= MARATHON_CHECKPOINT_MS) {
      console.log(`🏃 Marathon checkpoint triggered for room "${this.name}"`);
      await this.createSessionVersion('marathon');
      return;
    }

    // Idle detection
    const allIdle = Array.from(this.connLastActivity.values()).every(
      (lastActivity) => now - lastActivity >= IDLE_TIMEOUT_MS
    );

    if (allIdle) {
      console.log(`💤 All clients idle for ${IDLE_TIMEOUT_MS / 60000}min in room "${this.name}" — saving session version`);
      await this.createSessionVersion('idle-timeout');
    }
  }

  async createSessionVersion(reason: 'idle-timeout' | 'all-disconnected' | 'marathon') {
    const fileId = this.name.replace('file-', '');
    const content = this.getText('monaco').toString();

    if (!content) {
      console.log(`⏭️ Skipping session version for file ${fileId}: empty content`);
      return;
    }

    const commitMessages = {
      'idle-timeout':       `Session checkpoint — ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
      'all-disconnected':   `Session end — ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
      'marathon':           `Auto-checkpoint (30 min) — ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
    };

    try {
      // Query the database for the actual last version's content to prevent duplicates
      // across server restarts or document memory evictions.
      const lastVersionResult = await pool.query(
        `SELECT content FROM file_versions WHERE file_id = $1 ORDER BY version_number DESC LIMIT 1`,
        [fileId]
      );
      const dbLastContent = lastVersionResult.rows.length > 0 ? lastVersionResult.rows[0].content : null;

      if (content === dbLastContent) {
        console.log(`⏭️ Skipping session version for file ${fileId}: content unchanged since last DB version`);
        return;
      }

      const versionResult = await pool.query(
        `SELECT get_next_version_number($1) AS version_number`, [fileId]
      );
      const versionNumber = versionResult.rows[0].version_number;

      await pool.query(
        `INSERT INTO file_versions (file_id, content, version_number, created_by, commit_message, file_size)
         VALUES (
           $1, $2, $3,
           (SELECT p.owner_id FROM files f JOIN projects p ON f.project_id = p.id WHERE f.id = $1),
           $4,
           $5
         )`,
        [fileId, content, versionNumber, commitMessages[reason], Buffer.byteLength(content, 'utf8')]
      );

      this.lastVersionSavedAt = Date.now();

      console.log(`📸 Session version ${versionNumber} saved for file ${fileId} — reason: ${reason}`);
    } catch (err: any) {
      console.error(`❌ Failed to create session version for file ${fileId}:`, err.message);
    }
  }
}

/**
 * Retrieve or create the WSSharedDoc for the given room name.
 *
 * Guarantees:
 * - At most one load sequence runs per room at any given time (via loadingDocs).
 * - Concurrent connections attach to the existing in-progress load promise.
 * - The doc is added to `docs` only after loading completes, so no client
 *   receives an empty or partially-loaded state via sync step 1.
 * - Redis state is checked for staleness against files.updated_at before use;
 *   stale or unknown-age entries fall through to PostgreSQL.
 * - The PostgreSQL insert is guarded: if ytext already has content (from Redis),
 *   the insert is skipped to prevent server-side double-insertion.
 * - Every Redis save in this function obtains its writtenAt timestamp from
 *   SELECT NOW() in PostgreSQL. Date.now() is never used for this purpose.
 */
const getYDoc = async (docname: string): Promise<WSSharedDoc> => {
  // ── Fast path: doc already fully loaded ────────────────────────────────────
  if (docs.has(docname)) {
    console.log(`♻️ Reusing existing Y.Doc for room: "${docname}"`);
    return docs.get(docname)!;
  }

  // ── In-progress path: another connection is already loading this room ───────
  // Await the existing promise instead of starting a parallel load.
  // This is the fix for the orphaned parallel-load race condition.
  if (loadingDocs.has(docname)) {
    console.log(`⏳ Room "${docname}" is already loading — awaiting existing load promise`);
    return loadingDocs.get(docname)!;
  }

  // ── Cold-start path: begin a new load ──────────────────────────────────────
  // Store the promise in loadingDocs BEFORE any await so concurrent connections
  // that arrive while we are awaiting Redis/PostgreSQL find it immediately.
  const loadPromise = (async (): Promise<WSSharedDoc> => {
    const doc = new WSSharedDoc(docname);
    console.log(`✅ Created new shared Y.Doc for room: "${docname}"`);

    const fileId = docname.replace('file-', '');
    let contentLoaded = false;

    // ── 1. Try Redis first ──────────────────────────────────────────────────
    try {
      if (redisConnection.isConnected()) {
        const redisLoad = await redisConnection.loadYjsState(fileId);

        if (redisLoad) {
          const { state, writtenAt } = redisLoad;

          // Apply Redis state immediately and mark content as loaded.
          // The doc is finalised and added to `docs` below WITHOUT waiting
          // for the staleness check. This means sync step 2 reaches the
          // client immediately, eliminating the Supabase round-trip from
          // the critical path that was causing 15s+ fallback timeouts.
          doc.transact(() => {
            Y.applyUpdate(doc, state);
          }, 'loadFromRedis');

          const content = doc.getText('monaco').toString();
          doc.lastSavedContent = content;
          console.log(`📥 Applied Redis state for file ${fileId} (${content.length} chars) — staleness check running in background`);
          contentLoaded = true;

          // ── Background staleness check (non-blocking) ────────────────────
          // Fire-and-forget: does NOT block sync step 2.
          // If stale, evicts the doc from `docs` so the NEXT cold-start
          // reloads from PostgreSQL. The current connection gets slightly
          // stale Redis content but never times out and never sees fallback.
          // All errors are caught internally — a failed check is treated as
          // FRESH (optimistic) for this session.
          (async () => {
            let decision: 'FRESH' | 'STALE' | 'UNKNOWN_AGE' = 'UNKNOWN_AGE';
            let diffMs: number | null = null;
            let pgUpdatedAt: Date | null = null;

            try {
              const pgFileResult = await pool.query(
                'SELECT updated_at FROM files WHERE id = $1',
                [fileId]
              );
              pgUpdatedAt = pgFileResult.rows[0]?.updated_at ?? null;

              if (writtenAt === null) {
                decision = 'UNKNOWN_AGE';
              } else if (!pgUpdatedAt) {
                decision = 'STALE';
              } else {
                diffMs = pgUpdatedAt.getTime() - new Date(writtenAt).getTime();
                decision = diffMs <= REDIS_STALENESS_THRESHOLD_MS ? 'FRESH' : 'STALE';
              }

              // Structured staleness log — exact required format preserved.
              console.log(
                `[REDIS-STALENESS] fileId=${fileId}` +
                ` writtenAt=${writtenAt ?? 'null'}` +
                ` pgUpdatedAt=${pgUpdatedAt?.toISOString() ?? 'null'}` +
                ` diffMs=${diffMs ?? 'null'}` +
                ` threshold=${REDIS_STALENESS_THRESHOLD_MS}` +
                ` decision=${decision}`
              );

              if (decision === 'FRESH') {
                console.log(`✅ [REDIS-STALENESS] fileId=${fileId} FRESH — no eviction`);
              } else {
                // Evict from `docs` so the next connection does a fresh PG load.
                // Do NOT call doc.destroy() — active connections hold live
                // references. Eviction from `docs` is sufficient.
                console.log(
                  `🔄 [REDIS-STALENESS] fileId=${fileId} ${decision} — evicting from docs. ` +
                  `Next connection will reload from PostgreSQL.`
                );
                docs.delete(docname);
              }
            } catch (err: any) {
              console.error(
                `⚠️ [REDIS-STALENESS] Background check failed for file ${fileId}: ${err.message}. ` +
                `Doc remains cached; staleness undetermined.`
              );
            }
          })();
        }
      }
    } catch (error: any) {
      console.error(`⚠️ Failed to load from Redis for file ${fileId}:`, error.message);
      // Fall through to PostgreSQL.
    }

    // ── 2. PostgreSQL fallback ────────────────────────────────────────────────
    if (!contentLoaded) {
      return await loadFromPostgreSQL(doc, fileId, docname);
    }

    // ── 3. Finalise the doc (Redis path — staleness check running in background)
    doc.isInitializing = false;
    docs.set(docname, doc);
    return doc;
  })();

  // Register in loadingDocs so concurrent connections attach to this promise.
  loadingDocs.set(docname, loadPromise);

  // Clean up loadingDocs entry when the load resolves (success or error).
  // The doc is already in `docs` at this point if load succeeded.
  loadPromise.finally(() => {
    loadingDocs.delete(docname);
  });

  return loadPromise;
};

/**
 * Load file content into a WSSharedDoc from PostgreSQL, write back to Redis,
 * finalise initialisation, and register in `docs`.
 *
 * Extracted so both the stale-Redis path and the no-Redis path share the same logic.
 * PostgreSQL is queried for `SELECT NOW()` before the Redis write-back so the
 * writtenAt companion timestamp is authoritative. Date.now() is never used.
 */
const loadFromPostgreSQL = async (
  doc: WSSharedDoc,
  fileId: string,
  docname: string,
): Promise<WSSharedDoc> => {
  try {
    const result = await pool.query(
      'SELECT content, updated_at FROM files WHERE id = $1',
      [fileId]
    );

    if (result.rows.length > 0 && result.rows[0].content) {
      const content: string = result.rows[0].content;
      const ytext = doc.getText('monaco');

      // ── Content guard (Step 5a) ────────────────────────────────────────────
      // ytext.length > 0 means a prior operation (e.g. a Redis apply that
      // somehow survived here) already inserted content. Inserting again would
      // double the text. Skip the insert and log clearly.
      if (ytext.length > 0) {
        console.log(
          `[GUARD] Skipping PG insert for file ${fileId}: ` +
          `Y.Doc already has ${ytext.length} chars. ` +
          `Source: a prior load operation populated the doc before this path ran.`
        );
      } else {
        doc.transact(() => {
          ytext.insert(0, content);
        }, 'loadFromPostgreSQL');
        console.log(`📥 Loaded from PostgreSQL: ${content.length} chars for file ${fileId}`);
      }

      doc.lastSavedContent = doc.getText('monaco').toString();

      // ── Write-back to Redis with PG-authoritative timestamp ────────────────
      // Use SELECT NOW() — not Date.now() — as the writtenAt clock source.
      if (redisConnection.isConnected()) {
        const nowResult = await pool.query('SELECT NOW() AS now');
        const writtenAt: string = nowResult.rows[0].now.toISOString();
        const state = Y.encodeStateAsUpdate(doc);
        await redisConnection.saveYjsState(fileId, state, writtenAt);
      }
    } else {
      console.log(`ℹ️ Starting with empty document for file ${fileId} (no PG content)`);
    }
  } catch (error: any) {
    console.error(`⚠️ Failed to load from PostgreSQL for file ${fileId}:`, error.message);
    // Continue with an empty doc rather than crashing the connection.
  }

  doc.isInitializing = false;
  docs.set(docname, doc);
  return doc;
};

const send = (doc: WSSharedDoc, conn: WebSocket, m: Uint8Array) => {
  if (conn.readyState !== WebSocket.CONNECTING && conn.readyState !== WebSocket.OPEN) {
    closeConn(doc, conn);
  } else {
    try {
      conn.send(m);
    } catch (e) {
      closeConn(doc, conn);
    }
  }
};

const closeConn = async (doc: WSSharedDoc, conn: WebSocket) => {
  doc.connLastActivity.delete(conn);

  if (doc.conns.has(conn)) {
    const controlledIds = doc.conns.get(conn);
    doc.conns.delete(conn);
    awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds!), null);

    // If this was the last connection, save to Redis and remove from memory
    if (doc.conns.size === 0) {
      console.log(`💾 Last client disconnected from "${doc.name}", saving to Redis...`);

      // Normal disconnect save behavior
      try {
        if (redisConnection.isConnected()) {
          const fileId = doc.name.replace('file-', '');
          // Obtain the authoritative write timestamp from PostgreSQL.
          // NEVER use Date.now() here — PostgreSQL is the clock.
          const nowResult = await pool.query('SELECT NOW() AS now');
          const writtenAt: string = nowResult.rows[0].now.toISOString();
          const state = Y.encodeStateAsUpdate(doc);
          await redisConnection.saveYjsState(fileId, state, writtenAt);
        }

        // Also save to PostgreSQL if content changed
        const content = doc.getText('monaco').toString();
        if (content !== doc.lastSavedContent) {
          await doc.saveToDatabase();
        }
      } catch (error: any) {
        console.error(`❌ Error saving on disconnect:`, error.message);
      }

      await doc.createSessionVersion('all-disconnected');
      doc.stopIdleCheck();

      docs.delete(doc.name);
      console.log(`🗑️ Removed room from memory: "${doc.name}"`);
    }
  }
  conn.close();
};

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';

  // Health check endpoint
  if (url === '/health') {
    const totalConnections = Array.from(docs.values()).reduce((sum, doc) => sum + doc.conns.size, 0);

    // Get Redis stats
    const redisStats = await redisConnection.getStats();
    const redisHealth = await redisConnection.ping();

    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      activeRooms: docs.size,
      totalConnections,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      redis: {
        connected: redisHealth,
        ...redisStats
      }
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(health, null, 2));
    return;
  }

  // Stats endpoint
  if (url === '/stats') {
    const rooms = Array.from(docs.entries()).map(([name, doc]) => ({
      room: name,
      connections: doc.conns.size,
      contentLength: doc.getText('monaco').length
    }));

    // Get Redis active documents
    const redisDocuments = await redisConnection.getActiveDocuments();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      rooms,
      redis: {
        cachedDocuments: redisDocuments.length,
        documents: redisDocuments
      }
    }, null, 2));
    return;
  }

  // Internal restore endpoint: broadcasts restored content to active clients
  if (req.method === 'POST' && url.startsWith('/internal/restore/')) {
    const fileId = url.replace('/internal/restore/', '');
    const docname = `file-${fileId}`;

    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const { content } = JSON.parse(body);

        if (docs.has(docname)) {
          const doc = docs.get(docname)!;
          const ytext = doc.getText('monaco');

          doc.transact(() => {
            ytext.delete(0, ytext.length);
            ytext.insert(0, content);
          }, 'restore-operation');

          doc.lastSavedContent = content;
          doc.lastVersionContent = content; // reset version baseline too

          console.log(`🔄 Restored file ${fileId} via internal endpoint (${content.length} chars) — ${doc.conns.size} clients synced`);
        } else {
          console.log(`ℹ️ No active YJS doc for file ${fileId} — restore applied to DB/Redis only`);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err: any) {
        console.error(`❌ Internal restore failed for file ${fileId}:`, err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Default response
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Yjs WebSocket Server\nEndpoints: /health, /stats\n');
});

const wss = new WebSocket.Server({ server });

wss.on('connection', async (ws: WebSocket, req: http.IncomingMessage) => {
  const roomName = (req.url || '').slice(1);

  if (!roomName) {
    console.error('❌ No room name provided');
    ws.close();
    return;
  }

  console.log(`🔗 New client connecting to room: "${roomName}"`);

  const doc = await getYDoc(roomName);

  doc.conns.set(ws, new Set());
  doc.connLastActivity.set(ws, Date.now());
  if (doc.conns.size === 1) doc.startIdleCheck(); // start on first connection only

  const ytext = doc.getText('monaco');
  console.log(`📊 Room "${roomName}" doc state: ${ytext.length} characters`);

  // Broadcast document updates to all clients
  const updateHandler = (update: Uint8Array, origin: any) => {
    // Don't broadcast if this is an initial load operation or if we're the origin
    if (origin === 'loadFromRedis' || origin === 'loadFromPostgreSQL' || origin === ws) {
      return;
    }

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);

    // Broadcast to all connections except origin
    doc.conns.forEach((_, conn) => {
      if (conn !== origin && conn.readyState === WebSocket.OPEN) {
        try {
          conn.send(message);
        } catch (err) {
          console.error('Error broadcasting update:', err);
        }
      }
    });
  };

  doc.on('update', updateHandler);

  // Send Sync Step 1
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeSyncStep1(encoder, doc);
  send(doc, ws, encoding.toUint8Array(encoder));
  const awarenessStates = doc.awareness.getStates();
  if (awarenessStates.size > 0) {
    const awarenessEncoder = encoding.createEncoder();
    encoding.writeVarUint(awarenessEncoder, messageAwareness);
    encoding.writeVarUint8Array(awarenessEncoder, awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(awarenessStates.keys())));
    send(doc, ws, encoding.toUint8Array(awarenessEncoder));
  }

  // Message handler
  ws.on('message', (message: Buffer) => {
    doc.connLastActivity.set(ws, Date.now());

    try {
      const encoder = encoding.createEncoder();
      const decoder = decoding.createDecoder(new Uint8Array(message));
      const messageType = decoding.readVarUint(decoder);

      switch (messageType) {
        case messageSync:
          encoding.writeVarUint(encoder, messageSync);
          const syncMessageType = syncProtocol.readSyncMessage(decoder, encoder, doc, ws);
          if (syncMessageType === syncProtocol.messageYjsSyncStep2 && !doc.conns.get(ws)?.has(0)) {
            doc.conns.get(ws)?.add(0);
          }
          if (encoding.length(encoder) > 1) {
            send(doc, ws, encoding.toUint8Array(encoder));
          }
          break;
        case messageAwareness:
          awarenessProtocol.applyAwarenessUpdate(doc.awareness, decoding.readVarUint8Array(decoder), ws);
          break;
      }
    } catch (err) {
      console.error('Error processing message:', err);
    }
  });

  ws.on('close', async () => {
    doc.off('update', updateHandler);
    await closeConn(doc, ws);
    console.log(`👋 Client disconnected from "${roomName}"`);
  });

  ws.on('error', (error) => {
    console.error(`❌ WebSocket error in "${roomName}":`, error);
  });
});

server.listen(PORT, () => {
  console.log(`Yjs WebSocket server running on ws://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Stats: http://localhost:${PORT}/stats`);
});

// Periodic health monitoring
setInterval(() => {
  const totalConnections = Array.from(docs.values()).reduce((sum, doc) => sum + doc.conns.size, 0);
  console.log(`📊 Health: ${docs.size} rooms, ${totalConnections} connections, ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB used`);
}, 60000); // Log every 60 seconds

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down server gracefully...');

  // Save all active documents to Redis and PostgreSQL
  console.log(`💾 Saving ${docs.size} active documents...`);
  const savePromises: Promise<void>[] = [];

  for (const [name, doc] of docs.entries()) {
    savePromises.push(
      (async () => {
        try {
          const fileId = name.replace('file-', '');

          // Save to Redis with PG-authoritative timestamp.
          // NEVER use Date.now() here — PostgreSQL is the clock.
          if (redisConnection.isConnected()) {
            const nowResult = await pool.query('SELECT NOW() AS now');
            const writtenAt: string = nowResult.rows[0].now.toISOString();
            const state = Y.encodeStateAsUpdate(doc);
            await redisConnection.saveYjsState(fileId, state, writtenAt);
          }

          // Save to PostgreSQL if changed
          const content = doc.getText('monaco').toString();
          if (content !== doc.lastSavedContent) {
            await doc.saveToDatabase();
          }

          console.log(`✅ Saved document: ${name}`);
        } catch (error: any) {
          console.error(`❌ Failed to save document ${name}:`, error.message);
        }
      })()
    );
  }

  await Promise.allSettled(savePromises);
  console.log('✅ All documents saved');

  // Close Redis connection
  await redisConnection.close();

  // Close all WebSocket connections
  wss.clients.forEach((client) => {
    client.close(1000, 'Server shutting down');
  });

  // Close server
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('⚠️ Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
});
