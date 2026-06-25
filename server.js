// SyncWatch — server.js
// WebSocket relay + serves bookmarklet-setup.html at /
// v3: added /health endpoint, rate event support, connection logging

const { WebSocketServer } = require('ws');
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// ── HTTP server ──────────────────────────────────────────────────────────────
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' };

const httpServer = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];

  // Health check endpoint for Render / uptime monitoring
  if (urlPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', rooms: Object.keys(rooms).length, uptime: process.uptime() }));
    return;
  }

  const serve = (file) => {
    const ext = path.extname(file) || '.html';
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
      res.end(data);
    });
  };

  if (urlPath === '/bookmarklet.js') {
    serve(path.join(__dirname, 'bookmarklet.js'));
  } else if (urlPath.startsWith('/join')) {
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

  // Heartbeat: mark as alive on each pong
  ws._isAlive = true;
  ws.on('pong', () => { ws._isAlive = true; });

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

    if (data.type === 'ping') return; // keepalive — do not broadcast

    if (data.type === 'sync-request') {
      for (const client of rooms[currentRoom]) {
        if (client.role === 'controller' && client.readyState === 1) {
          client.send(JSON.stringify(data));
        }
      }
      return;
    }

    if (data.type === 'kick') {
      console.log(`[kick] Room "${currentRoom}" — kicking all receivers`);
      for (const client of rooms[currentRoom]) {
        if (client !== ws && client.readyState === 1) {
          client.close(1000, 'kicked');
        }
      }
      return;
    }

    if (ws.role !== 'controller') return;

    // Broadcast all controller events (play, pause, seek, rate, sync-state) to receivers
    let sent = 0;
    for (const client of rooms[currentRoom]) {
      if (client !== ws && client.readyState === 1) {
        client.send(JSON.stringify(data));
        sent++;
      }
    }

    const { type, currentTime } = data;
    console.log(`[→] room="${currentRoom}" ${type} @ ${Number(currentTime).toFixed(2)}s → sent to ${sent} receiver(s)`);
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

// ── Heartbeat: detect dead connections every 30s ──────────────────────────────
// Safari iOS can silently drop WebSockets without sending a close frame.
// Without this, the server thinks the receiver is still connected (stale "2 clients" badge)
// but events never reach anyone. This ping/pong check forces cleanup.
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.readyState !== 1) return;
    if (ws._isAlive === false) {
      console.log('[heartbeat] terminating dead connection');
      ws.terminate();
      return;
    }
    ws._isAlive = false;
    ws.ping(() => {});
  });
}, 30000);


