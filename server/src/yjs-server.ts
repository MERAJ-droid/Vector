import WebSocket from 'ws';
import http from 'http';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import { encoding, decoding } from 'lib0';

const PORT = 1234;

// Awareness message type constant
const MESSAGE_AWARENESS = 1;

// Store Yjs documents by room name
const docs = new Map<string, WSSharedDoc>();

interface WSSharedDoc {
  name: string;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  conns: Map<WebSocket, Set<number>>;
}

const getYDoc = (docname: string): WSSharedDoc => {
  let doc = docs.get(docname);
  if (!doc) {
    const ydoc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(ydoc);
    doc = {
      name: docname,
      doc: ydoc,
      awareness,
      conns: new Map(),
    };
    docs.set(docname, doc);
    console.log(`📄 Created new Yjs document: ${docname}`);
  }
  return doc;
};

const messageListener = (conn: WebSocket, doc: WSSharedDoc, message: Uint8Array) => {
  try {
    const encoder = encoding.createEncoder();
    const decoder = decoding.createDecoder(message);
    const messageType = decoding.readVarUint(decoder);

    switch (messageType) {
      case syncProtocol.messageYjsSyncStep1:
        encoding.writeVarUint(encoder, syncProtocol.messageYjsSyncStep2);
        syncProtocol.readSyncStep1(decoder, encoder, doc.doc);
        send(doc, conn, encoding.toUint8Array(encoder));
        break;
      case syncProtocol.messageYjsSyncStep2:
        syncProtocol.readSyncStep2(decoder, doc.doc, 'server');
        break;
      case syncProtocol.messageYjsUpdate:
        syncProtocol.readUpdate(decoder, doc.doc, 'server');
        break;
      case MESSAGE_AWARENESS:
        awarenessProtocol.applyAwarenessUpdate(
          doc.awareness,
          decoding.readVarUint8Array(decoder),
          conn
        );
        break;
    }
  } catch (err) {
    console.error('Error handling message:', err);
  }
};

const closeConn = (doc: WSSharedDoc, conn: WebSocket) => {
  if (doc.conns.has(conn)) {
    const controlledIds = doc.conns.get(conn);
    doc.conns.delete(conn);
    awarenessProtocol.removeAwarenessStates(
      doc.awareness,
      Array.from(controlledIds || []),
      null
    );
    if (doc.conns.size === 0) {
      // Clean up document if no connections
      docs.delete(doc.name);
      console.log(`🗑️  Removed Yjs document: ${doc.name}`);
    }
  }
  conn.close();
};

const send = (doc: WSSharedDoc, conn: WebSocket, m: Uint8Array) => {
  if (conn.readyState !== WebSocket.CONNECTING && conn.readyState !== WebSocket.OPEN) {
    closeConn(doc, conn);
  }
  try {
    conn.send(m, (err) => {
      if (err) {
        closeConn(doc, conn);
      }
    });
  } catch (e) {
    closeConn(doc, conn);
  }
};

const setupWSConnection = (conn: WebSocket, req: http.IncomingMessage) => {
  conn.binaryType = 'arraybuffer';
  const docName = req.url?.slice(1) || 'default';
  console.log(`\n🔗 New connection request`);
  console.log(`   URL: ${req.url}`);
  console.log(`   Parsed room name: "${docName}"`);
  console.log(`   Client IP: ${req.socket.remoteAddress}`);
  
  const doc = getYDoc(docName);

  doc.conns.set(conn, new Set());
  console.log(`👥 Room "${docName}" now has ${doc.conns.size} connection(s)`);

  // Send sync step 1
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, syncProtocol.messageYjsSyncStep1);
  syncProtocol.writeSyncStep1(encoder, doc.doc);
  send(doc, conn, encoding.toUint8Array(encoder));

  // Send awareness states
  const awarenessStates = doc.awareness.getStates();
  if (awarenessStates.size > 0) {
    const encoder2 = encoding.createEncoder();
    encoding.writeVarUint(encoder2, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder2,
      awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(awarenessStates.keys()))
    );
    send(doc, conn, encoding.toUint8Array(encoder2));
  }

  // Broadcast awareness and document updates
  doc.awareness.on('update', (update: any, origin: any) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(doc.awareness, update.added.concat(update.updated).concat(update.removed)));
    const buff = encoding.toUint8Array(encoder);
    doc.conns.forEach((_, c) => {
      send(doc, c, buff);
    });
  });

  doc.doc.on('update', (update: Uint8Array, origin: any) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, syncProtocol.messageYjsUpdate);
    encoding.writeVarUint8Array(encoder, update);
    const message = encoding.toUint8Array(encoder);
    doc.conns.forEach((_, c) => {
      send(doc, c, message);
    });
  });

  // Handle incoming messages
  conn.on('message', (message: ArrayBuffer) => {
    messageListener(conn, doc, new Uint8Array(message));
  });

  conn.on('close', () => {
    console.log(`🔌 Connection closed for room: ${doc.name}`);
    closeConn(doc, conn);
    console.log(`👥 Room "${doc.name}" now has ${doc.conns.size} connection(s)`);
  });
};

// Create HTTP server for WebSocket
const server = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain' });
  response.end('Yjs WebSocket Server');
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

wss.on('connection', setupWSConnection);

server.listen(PORT, () => {
  console.log(`✅ Yjs WebSocket server running on ws://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down Yjs WebSocket server...');
  wss.close(() => {
    server.close(() => {
      console.log('✅ Yjs server closed');
      process.exit(0);
    });
  });
});
