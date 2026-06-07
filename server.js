// SyncWatch — server.js
// WebSocket relay + serves bookmarklet-setup.html at /

const { WebSocketServer } = require('ws');
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// ── HTTP server (serves bookmarklet-setup.html at /) ─────────────────────────
const httpServer = http.createServer((req, res) => {
  const filePath = path.join(__dirname, 'bookmarklet-setup.html');
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
});

// ── WebSocket server (attaches to the same HTTP server) ──────────────────────
const wss = new WebSocketServer({ server: httpServer });

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
      return;
    }

    if (data.type === 'join') {
      currentRoom = data.room;
      clientRole  = data.role || 'receiver';
      if (!rooms[currentRoom]) rooms[currentRoom] = new Set();
      rooms[currentRoom].add(ws);
      console.log(`[~] "${clientRole}" joined room "${currentRoom}" (${rooms[currentRoom].size} clients)`);
      return;
    }

    if (!currentRoom || !rooms[currentRoom]) return;
    if (clientRole !== 'controller') return;

    for (const client of rooms[currentRoom]) {
      if (client !== ws && client.readyState === 1) {
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

httpServer.listen(PORT, () => {
  console.log(`🎬 SyncWatch running on port ${PORT}`);
});
