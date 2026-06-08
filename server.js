// SyncWatch — server.js
// WebSocket relay + serves bookmarklet-setup.html at /

const { WebSocketServer } = require('ws');
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// ── HTTP server ──────────────────────────────────────────────────────────────
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' };

const httpServer = http.createServer((req, res) => {
  const serve = (file) => {
    const ext = path.extname(file) || '.html';
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
      res.end(data);
    });
  };

  if (req.url.startsWith('/join')) {
    serve(path.join(__dirname, 'join.html'));
  } else {
    serve(path.join(__dirname, 'bookmarklet-setup.html'));
  }
});

// ── WebSocket server (attaches to the same HTTP server) ──────────────────────
const wss = new WebSocketServer({ server: httpServer });

// rooms: { roomId: Set<WebSocket> }
const rooms = {};

wss.on('connection', (ws, req) => {
  let currentRoom = null;

  console.log(`[+] New connection from ${req.socket.remoteAddress}`);

  function broadcastRoomInfo() {
    if (!currentRoom || !rooms[currentRoom]) return;
    const info = JSON.stringify({ type: 'room-info', count: rooms[currentRoom].size });
    for (const client of rooms[currentRoom]) {
      if (client.readyState === 1) client.send(info);
    }
  }

  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    if (data.type === 'join') {
      currentRoom = data.room;
      ws.role = data.role || 'receiver';
      if (!rooms[currentRoom]) rooms[currentRoom] = new Set();
      rooms[currentRoom].add(ws);
      console.log(`[~] "${ws.role}" joined room "${currentRoom}" (${rooms[currentRoom].size} clients)`);
      broadcastRoomInfo();
      return;
    }

    if (!currentRoom || !rooms[currentRoom]) return;

    if (data.type === 'sync-request') {
      for (const client of rooms[currentRoom]) {
        if (client.role === 'controller' && client.readyState === 1) {
          client.send(JSON.stringify(data));
        }
      }
      return;
    }

    if (ws.role !== 'controller') return;

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
      broadcastRoomInfo();
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
