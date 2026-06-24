# SyncWatch — Server

Tiny Node.js WebSocket relay server for SyncWatch. Handles room management, event forwarding, and serves the iPad invite/join page.

---

## Files

| File | Purpose |
|------|---------|
| `server.js` | WebSocket relay + HTTP server |
| `join.html` | iPad invite page (served at `/join`) |
| `bookmarklet.js` | Bookmarklet builder (loaded by `join.html`) |
| `package.json` | Dependencies (`ws` only) |

---

## How It Works

- **HTTP:** serves `join.html` at `/join` and `bookmarklet.js` at `/bookmarklet.js`
- **WebSocket:** clients join a named room as either `controller` or `receiver`
- Controller events (play, pause, seek) are forwarded to all receivers in the same room
- `room-info` messages are broadcast to all room members whenever someone joins or leaves, so the extension badge can show live counts
- `sync-request` messages from a receiver are forwarded to the controller, which responds with current playback state
- `kick` disconnects all receivers in the room
- `ping` messages are silently dropped (used by the extension keepalive)

---

## Deploy on Render (free)

1. Push this folder to a GitHub repo
2. Go to https://render.com → **New +** → **Web Service**
3. Use these settings:

   | Field | Value |
   |-------|-------|
   | Runtime | Node |
   | Build Command | `npm install` |
   | Start Command | `node server.js` |
   | Instance Type | Free |

4. Your server URL will be `https://your-app.onrender.com`
5. Your WebSocket URL will be `wss://your-app.onrender.com`

> Render's free tier spins down after 15 min of inactivity. The first connection after idle takes ~1 min to wake up. The extension handles this with auto-reconnect.

---

## Deploy on Railway (alternative)

1. Push to GitHub
2. Go to https://railway.app → **New Project** → **Deploy from GitHub**
3. Railway auto-detects Node and uses `npm start`
4. Go to **Settings → Networking → Generate Domain** to get your public URL

Railway does not spin down on inactivity (more reliable than Render free tier).

---

## Local Development

```bash
npm install
node server.js
# Runs on port 3000
# WebSocket URL: ws://localhost:3000
# Join page: http://localhost:3000/join
```

To find your local IP for testing across devices on the same Wi-Fi:
```bash
ipconfig getifaddr en0
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Port the server listens on (Render/Railway set this automatically) |
