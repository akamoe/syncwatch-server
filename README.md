# SyncWatch

**Watch movies with a friend in perfect sync — play, pause, and seek stay locked across two devices in real time.**

| Device | Role | How |
|--------|------|-----|
| Mac (Brave / Chrome) | **Controller** | Chrome extension — your play/pause/seek drives everything |
| Any device (Safari, Firefox, etc.) | **Receiver** | Bookmarklet — one tap activates sync, no install needed |

A lightweight WebSocket relay server (deployable free on Render) sits in between and broadcasts events instantly.

---

## Architecture

```
┌─────────────────────────┐        ┌──────────────────┐        ┌──────────────────────────┐
│  Mac — Brave/Chrome     │        │  Render Server   │        │  Friend — Safari/any     │
│                         │        │                  │        │                          │
│  Chrome Extension       │─ wss ─▶│  WebSocket relay │─ wss ─▶│  Bookmarklet             │
│  (content.js detects    │        │  (Node.js)       │        │  (JS injected into page) │
│   play/pause in iframe) │        │                  │        │                          │
└─────────────────────────┘        └──────────────────┘        └──────────────────────────┘
```

- The **extension** runs a content script in **every frame** (including video player iframes) to capture play/pause/seek events
- The **server** is a pure relay — it knows roles (controller/receiver) and rooms, nothing else
- The **bookmarklet** searches the page and same-origin iframes for the video element and applies incoming events

---

## Step 1 — Deploy the Server

The server is a small Node.js WebSocket relay. Deploy it once on Render's free tier.

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → **New +** → **Web Service**
3. Connect your repo and use these settings:

   | Field | Value |
   |-------|-------|
   | Runtime | `Node` |
   | Build Command | `npm install` |
   | Start Command | `node server.js` |
   | Instance Type | **Free** |

4. Click **Deploy**. You'll get a URL like `https://syncwatch-server-xxxx.onrender.com`

Your WebSocket URL will be: `wss://syncwatch-server-xxxx.onrender.com`

> **Cold start note:** Render's free tier sleeps after 15 min of inactivity. It takes ~60 seconds to wake up. The extension and bookmarklet both auto-reconnect — just wait a moment.

### Local testing (same Wi-Fi network)

```bash
npm install
node server.js
# Server runs at ws://YOUR_LOCAL_IP:3000
# Find your IP: ipconfig getifaddr en0  (macOS)
```

---

## Step 2 — Set Up the Extension (Controller — Mac)

1. Open Brave or Chrome → go to `brave://extensions` or `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `extension/` folder from this repo
4. Click the 🎬 **SyncWatch** icon in your toolbar and fill in:

   | Field | Value |
   |-------|-------|
   | Server URL | `wss://your-server.onrender.com` |
   | Room ID | Any shared name, e.g. `movie-night` |
   | My Role | **Controller (Mac — I control playback)** |

5. Click **Save & Connect**
6. Open your movie tab — the extension badge shows room status:
   - `!` — not connected (check Server URL and Room ID)
   - `1` (amber) — connected, waiting for your friend to join
   - `2` (green) — friend is connected, fully synced

> **How it detects your video:** The extension injects a content script into every frame on the page (including embedded video player iframes used by most streaming sites). It listens for `play`, `pause`, and `seeked` events on the largest visible video element (≥100×100 px) and sends them to the server.

---

## Step 3 — Set Up the Bookmarklet (Receiver — Friend's Device)

No install, no account, works on any browser (Safari, Chrome, Firefox).

1. In the SyncWatch popup on your Mac, click **Share Setup Link** — it copies a link to your clipboard
2. Send the link to your friend (iMessage, WhatsApp, etc.)
3. Your friend opens the link in their browser — it shows a setup page
4. **Drag** the purple **🎬 SyncWatch** button into the browser's bookmarks bar
   - On **Safari iOS**: tap the Share icon → Add Bookmark, then edit the URL and paste the code
   - On **Safari Mac**: drag the button to the bookmarks bar directly
5. Your friend opens the movie website, navigates to the correct episode/film
6. Your friend taps/clicks the **🎬 SyncWatch** bookmark — a badge appears in the top-right corner:
   - Purple / **"Waiting 1/2"** — connected to server, waiting for you (the controller)
   - Green / **"Paused (2 connected)"** — both sides connected, ready to sync

> **Autoplay policy:** When you hit play, the friend's browser may block the video from playing automatically (browser security restriction). If that happens, a full-screen **"Tap to Play"** overlay appears — your friend taps it once and playback starts in sync.

> **Updating the bookmarklet:** If you change your Server URL or Room ID, your friend must **delete the old bookmark** and re-drag a fresh one from the invite page. The server address and room ID are baked into the bookmarklet at install time.

---

## How Sync Works

1. You hit **play** on your Mac
2. `content.js` (running inside the streaming site's video iframe) captures the event and sends `{ type: "play", currentTime: 42.3 }` to `background.js`
3. `background.js` forwards it over WebSocket to the Render server
4. The server sees the sender has role `controller` and broadcasts to all other clients in the same room
5. The friend's bookmarklet receives the message, finds the video element (searching the page and any same-origin iframes), seeks if the timestamp is off by more than 2 seconds, then calls `video.play()`

**Seek threshold:** 2 seconds — small drift is ignored; only meaningful gaps trigger a seek  
**Sync lock:** 600 ms after applying a remote event, the receiver ignores its own triggered events to prevent feedback loops  
**Auto-reconnect:** Both sides retry every 3 seconds if the WebSocket drops  
**Service worker keepalive:** The extension uses `chrome.alarms` (every ~25s) and a port-based heartbeat from the content script to keep the background service worker alive in MV3

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Extension badge shows `!` | Not connected — check Server URL (`wss://...`) and Room ID in the popup |
| Badge stuck on `1` (amber) | Friend hasn't tapped the bookmarklet yet, or their WebSocket failed — have them tap again |
| Badge shows green but play/pause does nothing | Reload the extension at `brave://extensions`, then **reload the movie tab** |
| Video not found / no events sent | The extension needs to be **reloaded** after install — go to `brave://extensions` and click the reload icon |
| Friend sees "Tap to Play" overlay | Normal — browser blocked autoplay. Friend just taps it once |
| Bookmarklet does nothing on tap | The bookmarklet URL may be stale — delete it and re-drag a fresh one from the invite link |
| Friend badge shows "Reconnecting…" | Server connection dropped — auto-retries every 3 seconds; wait a moment |
| `ws://` URL blocked | Safari and most browsers require `wss://` (secure WebSocket) for remote servers — always use the Render `wss://` URL |
| Render slow to connect | Free tier cold-starts after inactivity — wait ~60 seconds, both sides auto-reconnect |
| Playback drifts | Tap the **🎬 SyncWatch** badge on the receiver device to request a manual re-sync from the controller |

---

## File Structure

```
server/
├── server.js              # Node.js WebSocket relay server
├── bookmarklet.js         # Bookmarklet builder (loaded by join.html)
├── bookmarklet-setup.html # Landing page served at /
├── join.html              # Invite/setup page — generates the bookmarklet drag button
├── package.json
└── extension/
    ├── manifest.json      # MV3 — all_frames:true so content script runs inside video iframes
    ├── background.js      # Service worker — owns the WebSocket, relays to content script
    ├── content.js         # Injected into every frame — detects video events (controller) or applies them (receiver)
    ├── popup.html/js      # Extension popup UI — configure server URL, room ID, role
    └── icon.png
```

---

## Roles Explained

| Role | Set on | What it does |
|------|--------|--------------|
| **Controller** | Mac extension | Captures video events and sends them to the server |
| **Receiver** | Friend's bookmarklet | Listens for events from the server and applies them to the local video |

Only one controller per room is expected. Multiple receivers are supported (invite multiple friends).
