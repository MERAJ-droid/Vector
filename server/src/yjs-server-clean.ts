import WebSocket from 'ws';
import http from 'http';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const PORT = 1234;

interface Room {
  name: string;
  doc: Y.Doc;
  clients: Set<WebSocket>;
}

const rooms = new Map<string, Room>();

function getRoom(roomName: string): Room {
  if (!rooms.has(roomName)) {
    const doc = new Y.Doc();
    const room: Room = {
      name: roomName,
      doc,
      clients: new Set(),
    };
    rooms.set(roomName, room);
    console.log(`✅ Created new room: ${roomName}`);
  }
  return rooms.get(roomName)!;
}

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
  
  const room = getRoom(roomName);
  room.clients.add(ws);
  
  console.log(`👥 Room "${roomName}" now has ${room.clients.size} client(s)`);

  // Send sync step 1 to new client
  const encoderSync = encoding.createEncoder();
  encoding.writeVarUint(encoderSync, syncProtocol.messageYjsSyncStep1);
  syncProtocol.writeSyncStep1(encoderSync, room.doc);
  ws.send(encoding.toUint8Array(encoderSync));
  console.log(`📤 Sent SyncStep1 to new client`);

  ws.on('message', (message: Buffer) => {
    const uint8Message = new Uint8Array(message);
    const decoder = decoding.createDecoder(uint8Message);
    const encoder = encoding.createEncoder();
    const messageType = decoding.readVarUint(decoder);

    switch (messageType) {
      case syncProtocol.messageYjsSyncStep1:
        // Client sent sync step 1, respond with step 2
        encoding.writeVarUint(encoder, syncProtocol.messageYjsSyncStep2);
        syncProtocol.readSyncStep1(decoder, encoder, room.doc);
        const syncStep2 = encoding.toUint8Array(encoder);
        ws.send(syncStep2);
        console.log(`📤 Sent SyncStep2 response`);
        break;

      case syncProtocol.messageYjsSyncStep2:
        // Client sent sync step 2, apply it
        syncProtocol.readSyncStep2(decoder, room.doc, null);
        console.log(`✅ Applied SyncStep2 from client`);
        break;

      case syncProtocol.messageYjsUpdate:
        // Client sent an update, apply and broadcast
        syncProtocol.readUpdate(decoder, room.doc, null);
        
        // Broadcast update to all OTHER clients in the room
        room.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(uint8Message);
          }
        });
        
        console.log(`📝 Applied and broadcasted update to ${room.clients.size - 1} other client(s)`);
        break;

      default:
        console.warn(`⚠️ Unknown message type: ${messageType}`);
    }
  });

  ws.on('close', () => {
    room.clients.delete(ws);
    console.log(`👋 Client disconnected from room: "${roomName}"`);
    console.log(`� Room "${roomName}" now has ${room.clients.size} client(s)`);
    
    // Clean up empty rooms
    if (room.clients.size === 0) {
      rooms.delete(roomName);
      console.log(`🗑️ Removed empty room: "${roomName}"`);
    }
  });

  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
  });
});

server.listen(PORT, () => {
  console.log(`✅ Yjs WebSocket server running on ws://localhost:${PORT}`);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server...');
  wss.clients.forEach((client) => client.close());
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
