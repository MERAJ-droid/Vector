import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Redis Configuration for Yjs Document Persistence
 * 
 * Production-grade setup with:
 * - Automatic reconnection
 * - Connection pooling
 * - Error handling
 * - Health monitoring
 */

/**
 * Return type for loadYjsState.
 * writtenAt is the ISO timestamp stored alongside the binary state at write time,
 * obtained from SELECT NOW() in PostgreSQL. It is null for legacy Redis entries
 * that pre-date this change and therefore have no companion timestamp key.
 * The caller must treat a null writtenAt as UNKNOWN_AGE and fall through to
 * PostgreSQL rather than trusting a potentially stale state.
 */
export interface RedisYjsLoad {
  state: Uint8Array;
  writtenAt: string | null;
}

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB || '0'),
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    console.log(`🔄 Redis reconnection attempt #${times} in ${delay}ms`);
    return delay;
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
};

class RedisConnection {
  private client: Redis;
  private isReady: boolean = false;

  constructor() {
    this.client = new Redis(redisConfig);
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on('connect', () => {
      console.log('🔗 Redis connection established');
    });

    this.client.on('ready', () => {
      this.isReady = true;
      console.log('✅ Redis is ready');
    });

    this.client.on('error', (err) => {
      console.error('❌ Redis error:', err.message);
    });

    this.client.on('close', () => {
      this.isReady = false;
      console.log('🔌 Redis connection closed');
    });

    this.client.on('reconnecting', () => {
      console.log('🔄 Redis reconnecting...');
    });
  }

  /**
   * Get the Redis client instance
   */
  getClient(): Redis {
    return this.client;
  }

  /**
   * Check if Redis is connected and ready
   */
  isConnected(): boolean {
    return this.isReady && this.client.status === 'ready';
  }

  /**
   * Save Yjs document state to Redis alongside a timestamp companion key.
   *
   * @param fileId    - The file ID
   * @param state     - Binary Yjs state (Uint8Array)
   * @param writtenAt - ISO timestamp string obtained from `SELECT NOW()` in PostgreSQL
   *                    immediately before this call. NEVER pass Date.now() or a JS Date
   *                    here — PostgreSQL is the authoritative clock for staleness checks.
   * @param ttl       - Time to live in seconds (default: 24 hours). Applied to BOTH keys
   *                    so they expire together.
   *
   * Both the binary state and the written_at companion are written in a single
   * Redis pipeline so they are stored atomically — there is no window where one
   * exists without the other.
   */
  async saveYjsState(
    fileId: string,
    state: Uint8Array,
    writtenAt: string,
    ttl: number = 86400,
  ): Promise<boolean> {
    try {
      const stateKey    = `yjs:file-${fileId}:state`;
      const writtenAtKey = `yjs:file-${fileId}:written_at`;
      const buffer = Buffer.from(state);

      // Pipeline: both keys written atomically in one round-trip.
      const pipeline = this.client.pipeline();
      pipeline.setex(stateKey,     ttl, buffer);
      pipeline.setex(writtenAtKey, ttl, writtenAt);
      await pipeline.exec();

      console.log(
        `💾 Saved Yjs state to Redis for file ${fileId} ` +
        `(${buffer.length} bytes, writtenAt=${writtenAt})`
      );
      return true;
    } catch (error: any) {
      console.error(`❌ Failed to save Yjs state to Redis:`, error.message);
      return false;
    }
  }

  /**
   * Load Yjs document state and its companion timestamp from Redis.
   *
   * Returns { state, writtenAt } when the binary state is present.
   * writtenAt is the ISO timestamp stored by saveYjsState, or null if the
   * entry was written before this change (legacy entry with no companion key).
   * The caller must treat writtenAt === null as UNKNOWN_AGE and fall through
   * to PostgreSQL rather than trusting the potentially stale state.
   *
   * Returns null when no binary state is found for the file.
   *
   * Both keys are fetched in a single pipeline round-trip.
   */
  async loadYjsState(fileId: string): Promise<RedisYjsLoad | null> {
    try {
      const stateKey     = `yjs:file-${fileId}:state`;
      const writtenAtKey = `yjs:file-${fileId}:written_at`;

      // Fetch both keys in one pipeline round-trip.
      const pipeline = this.client.pipeline();
      pipeline.getBuffer(stateKey);
      pipeline.get(writtenAtKey);
      const results = await pipeline.exec();

      // results[i] is [error, value] per ioredis pipeline convention.
      const stateError     = results?.[0]?.[0];
      const writtenAtError = results?.[1]?.[0];
      const stateBuffer    = results?.[0]?.[1] as Buffer | null;
      const writtenAtRaw   = results?.[1]?.[1] as string | null;

      if (stateError) throw stateError;
      if (writtenAtError) {
        // Non-fatal: we can still use the state, just with unknown age.
        console.warn(
          `⚠️ Could not fetch written_at for file ${fileId}: ${writtenAtError.message}. ` +
          `Treating as UNKNOWN_AGE (will fall through to PostgreSQL).`
        );
      }

      if (!stateBuffer) {
        console.log(`ℹ️ No Redis state found for file ${fileId}`);
        return null;
      }

      const writtenAt = writtenAtRaw ?? null;
      console.log(
        `📥 Loaded Yjs state from Redis for file ${fileId} ` +
        `(${stateBuffer.length} bytes, writtenAt=${writtenAt ?? 'UNKNOWN_AGE'})`
      );
      return { state: new Uint8Array(stateBuffer), writtenAt };
    } catch (error: any) {
      console.error(`❌ Failed to load Yjs state from Redis:`, error.message);
      return null;
    }
  }

  /**
   * Delete Yjs document state from Redis
   * @param fileId - The file ID
   */
  async deleteYjsState(fileId: string): Promise<boolean> {
    try {
      const key = `yjs:file-${fileId}:state`;
      await this.client.del(key);
      console.log(`🗑️ Deleted Yjs state from Redis for file ${fileId}`);
      return true;
    } catch (error: any) {
      console.error(`❌ Failed to delete Yjs state from Redis:`, error.message);
      return false;
    }
  }

  /**
   * Get all active Yjs document keys
   */
  async getActiveDocuments(): Promise<string[]> {
    try {
      const keys = await this.client.keys('yjs:file-*:state');
      return keys.map(key => key.replace('yjs:file-', '').replace(':state', ''));
    } catch (error: any) {
      console.error(`❌ Failed to get active documents:`, error.message);
      return [];
    }
  }

  /**
   * Get Redis stats for monitoring
   */
  async getStats(): Promise<{ keys: number; memory: string; uptime: number } | null> {
    try {
      const info = await this.client.info('stats');
      const memory = await this.client.info('memory');
      const server = await this.client.info('server');
      
      // Parse info strings
      const keysMatch = info.match(/# Keyspace\r\ndb0:keys=(\d+)/);
      const memoryMatch = memory.match(/used_memory_human:(.+?)\r\n/);
      const uptimeMatch = server.match(/uptime_in_seconds:(\d+)/);
      
      return {
        keys: keysMatch ? parseInt(keysMatch[1]) : 0,
        memory: memoryMatch ? memoryMatch[1] : 'unknown',
        uptime: uptimeMatch ? parseInt(uptimeMatch[1]) : 0,
      };
    } catch (error: any) {
      console.error(`❌ Failed to get Redis stats:`, error.message);
      return null;
    }
  }

  /**
   * Gracefully close Redis connection
   */
  async close(): Promise<void> {
    console.log('🛑 Closing Redis connection...');
    await this.client.quit();
  }

  /**
   * Ping Redis to check connectivity
   */
  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      return false;
    }
  }
}

// Singleton instance
const redisConnection = new RedisConnection();

export default redisConnection;
export { RedisConnection };
