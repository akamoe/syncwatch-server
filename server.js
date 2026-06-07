// SyncWatch — server.js
// Tiny WebSocket relay. Forwards controller events to all receivers in the same room.
// Deploy free on Railway, Render, or fly.io.

const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const wss  = new WebSocketServer({ port: PORT });

// rooms: { roomId: Set<WebSocket> }
const rooms = {};

wss.on('connection', (ws, req) => {
  let currentRoom = null;
  let clientRole  = null;

  console.log(`[+] New connection from ${req.socket.remoteAddress}`);

  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return; // ignore malformed messages
    }

    // ── Join a room ────────────────────────────────────────────────────────
    if (data.type === 'join') {
      currentRoom = data.room;
      clientRole  = data.role || 'receiver';

      if (!rooms[currentRoom]) rooms[currentRoom] = new Set();
      rooms[currentRoom].add(ws);

      console.log(`[~] "${clientRole}" joined room "${currentRoom}" (${rooms[currentRoom].size} clients)`);
      return;
    }

    // ── Relay playback events from controller → receivers ─────────────────
    if (!currentRoom || !rooms[currentRoom]) return;

    // Only forward if sender is controller (extra safety check)
    if (clientRole !== 'controller') return;

    for (const client of rooms[currentRoom]) {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    }

    const { type, currentTime } = data;
    console.log(`[→] room="${currentRoom}" ${type} @ ${Number(currentTime).toFixed(2)}s`);
  });

  ws.on('close', () => {
    if (currentRoom && rooms[currentRoom]) {
      rooms[currentRoom].delete(ws);
      console.log(`[-] Client left room "${currentRoom}" (${rooms[currentRoom].size} remaining)`);
      if (rooms[currentRoom].size === 0) delete rooms[currentRoom];
    }
  });

  ws.on('error', (err) => {
    console.error('[!] WebSocket error:', err.message);
  });
});

console.log(`🎬 SyncWatch server running on port ${PORT}`);
