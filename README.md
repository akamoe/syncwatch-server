# SyncWatch

Sync video play/pause/seek between two browsers in real time.
- **Mac (Brave):** Controller — your actions drive playback
- **iPad (Safari):** Receiver — automatically follows your play/pause/seek

---

## Server URL

```
wss://syncwatch-server-l6t7.onrender.com
```

Health check: `https://syncwatch-server-l6t7.onrender.com/health`

---

## Step 1 — Server (Already Deployed)

The server is live on Render's free tier. It auto-deploys from `github.com/akamoe/syncwatch-server` on every push to `main`.

To redeploy or set up from scratch:

1. Push the `server/` folder to a GitHub repo
2. Go to https://render.com → **New +** → **Web Service**
3. Connect your GitHub repo and use these settings:

   | Field | Value |
   |-------|-------|
   | Name | `syncwatch-server` |
   | Runtime | Node |
   | Build Command | `npm install` |
   | Start Command | `node server.js` |
   | Instance Type | **Free** |

4. Click **Deploy**. You'll get a URL like `https://syncwatch-server-l6t7.onrender.com`

Your WebSocket URL: `wss://syncwatch-server-l6t7.onrender.com`

> **Cold start note:** Render's free tier spins down after 15 min of inactivity. It takes ~1 min to wake up when you reconnect. The extension auto-reconnects — just wait a moment.

### Local testing (same Wi-Fi)

```bash
cd server
npm install
node server.js
# URL: ws://YOUR_LOCAL_IP:3000
# Find your IP: ipconfig getifaddr en0
```

---

## Step 2 — Set Up the Mac (Controller)

1. Open Brave → `brave://extensions` → Enable **Developer mode**
2. Click **Load unpacked** → select the `extension/` folder
3. Click the SyncWatch icon in your toolbar → fill in:

   | Field | Value |
   |-------|-------|
   | Server URL | `wss://syncwatch-server-l6t7.onrender.com` |
   | Room ID | Any shared name, e.g. `movie-night` |
   | Role | **Controller** |

4. Click **Save & Connect**
5. Reload your movie tab
6. The extension badge shows how many people are in the room — **amber = 1 (just you), green = 2 (friend connected)**

> **Note:** The extension uses a background service worker to keep the WebSocket alive. If playback stops syncing, click the extension icon — if it shows disconnected, just wait a few seconds for it to auto-reconnect.

> **v3 fix:** If you had v2 installed, remove it and re-load the `extension/` folder. The old version had a bug where controller events were never sent to the server.

---

## Step 3 — Set Up the iPad (Receiver)

No Xcode or Apple account needed. The bookmarklet approach works in any browser on iPad.

1. Click the SyncWatch extension icon on your Mac → copy the **invite link** shown at the bottom of the popup
2. Send the link to your friend (iMessage, WhatsApp, etc.)
3. Your friend opens the link in **Safari on iPad** — it shows a setup page
4. Drag the purple **🎬 SyncWatch** button to the Safari bookmarks bar — or long-press it and tap **Add to Bookmarks**
5. Open the movie website in Safari
6. Tap the **🎬 SyncWatch** bookmark — a badge appears in the top-right corner

Badge states:
- **"Waiting 1/2"** — connected to server, waiting for controller
- **"2 connected"** — fully synced and ready
- **"Reconnecting…"** — lost connection, auto-retrying

> **Important:** If your friend previously saved the bookmarklet and it stopped working after an update, she must **delete the old bookmark and re-drag a fresh one** from the invite page. The server URL and room ID are baked into the bookmarklet code.

---

## How It Works

```
[Mac Brave extension]  →  play/pause/seek + timestamp  →  [Render Server]  →  [iPad Safari bookmarklet]
```

- Only the Controller sends events; the Receiver only listens
- A 2-second seek threshold prevents tiny drift from triggering unnecessary seeks
- A 600ms lock prevents the Receiver's own video events from echoing back
- WebSocket auto-reconnects every 3 seconds on either side if the connection drops
- The extension service worker stays alive using `chrome.alarms` (fires every ~25s) and a port-based keepalive from the content script
- **v3:** Content script runs in all frames (`all_frames: true`) and searches iframes + shadow DOM for video elements
- **v3:** Diagnostic console logging throughout the event chain — open DevTools to trace

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Extension badge shows `!` | Not connected — check Server URL and Room ID in popup, wait a few seconds |
| Video not found | Some sites load video late — wait a few seconds after the movie starts, then try playing |
| iPad badge says "Waiting 1/2" | Controller not connected — check extension on Mac is configured and movie tab is open |
| iPad badge says "Reconnecting…" | Server lost connection — wait, it auto-retries every 3 seconds |
| Bookmarklet does nothing on tap | Delete the old bookmark and re-drag a fresh one from the invite page |
| `ws://` blocked on iPad | Safari requires `wss://` (secure) for remote servers — use the Render URL, not a local one |
| Server slow to connect | Render free tier cold-starts after inactivity — wait ~1 min, the extension will auto-reconnect |
| Playback drifts slightly | Tap the **🎬 SyncWatch** badge on iPad to request a manual sync from the controller |
| Events not reaching receiver (v2 bug) | Update to v3 — remove the old extension, re-load the `extension/` folder, re-save config |

---

## Debugging

Open Brave DevTools (View → Developer → JavaScript Console) on the movie tab. You should see:

```
[SyncWatch] Config loaded: role=controller room=movie-night
[SyncWatch] Video element found at src=... — listening for play/pause/seek
[SyncWatch] ▶ PLAY event at 42.5s — sending to server
```

In the extension's service worker console (brave://extensions → SyncWatch → "Inspect views: service worker"):

```
[SyncWatch BG] Config loaded: role=controller room=movie-night
[SyncWatch BG] room-info: 2 clients in room "movie-night"
[SyncWatch BG] → Relaying video-event to WS: play @ 42.5s
```
