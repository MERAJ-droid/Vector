import WebSocket from 'ws';
import http from 'http';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as map from 'lib0/map';
import axios from 'axios';

const PORT = 1234;

const docs = new Map<string, WSSharedDoc>();

const messageSync = 0;
const messageAwareness = 1;

class WSSharedDoc extends Y.Doc {
  name: string;
  conns: Map<WebSocket, Set<number>>;
  awareness: awarenessProtocol.Awareness;
  saveTimeout: NodeJS.Timeout | null = null;

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
      
      console.log(`💾 Saving file ${fileId} to database (${content.length} chars)`);
      
      await axios.put(`http://localhost:5000/api/files/${fileId}`, {
        content
      });
      
      console.log(`✅ File ${fileId} saved successfully`);
    } catch (error: any) {
      console.error('❌ Error saving to database:', error.message);
    }
  }
}

const getYDoc = (docname: string): WSSharedDoc => map.setIfUndefined(docs, docname, () => {
  const doc = new WSSharedDoc(docname);
  console.log(`✅ Created new shared Y.Doc for room: "${docname}"`);
  return doc;
});

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

const closeConn = (doc: WSSharedDoc, conn: WebSocket) => {
  if (doc.conns.has(conn)) {
    const controlledIds = doc.conns.get(conn);
    doc.conns.delete(conn);
    awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds!), null);
    if (doc.conns.size === 0) {
      docs.delete(doc.name);
      console.log(`🗑️ Removed empty room: "${doc.name}"`);
    }
  }
  conn.close();
};

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Yjs WebSocket Server\n');
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
  const roomName = (req.url || '').slice(1);
  
  if (!roomName) {
    console.error('❌ No room name provided');
    ws.close();
    return;
  }

  console.log(`🔗 New client connecting to room: "${roomName}"`);
  
  const doc = getYDoc(roomName);
  doc.conns.set(ws, new Set());
  
  const ytext = doc.getText('monaco');
  console.log(`📊 Room "${roomName}" doc state: ${ytext.length} characters`);

  // Broadcast document updates to all clients
  const updateHandler = (update: Uint8Array, origin: any) => {
    if (origin !== ws) {
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
    }
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

  ws.on('close', () => {
    doc.off('update', updateHandler);
    closeConn(doc, ws);
    console.log(`👋 Client disconnected from "${roomName}"`);
  });
  
  ws.on('error', (error) => {
    console.error(`❌ WebSocket error in "${roomName}":`, error);
  });
});

server.listen(PORT, () => {
  console.log(`Yjs WebSocket server running on ws://localhost:${PORT}`);
  console.log(`Using official y-websocket setupWSConnection`);
});

process.on('SIGINT', () => {
  console.log('Shutting down server...');
  wss.clients.forEach((client) => client.close());
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
