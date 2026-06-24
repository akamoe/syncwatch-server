// SyncWatch — background.js
// Service worker: owns the WebSocket connection and relays messages to content scripts.

let ws = null;
let role = null;
let roomId = null;
let serverUrl = null;
let videoTabId = null;
let reconnectTimer = null;
let connectId = 0;
let lastStatusState = 'disconnected';
let lastClientCount = 0;
let enabled = false;

// ─── Service worker keepalive ─────────────────────────────────────────────────
// MV3 service workers die after ~30s of inactivity. chrome.alarms keeps us alive.
// FIX: clear existing alarm before creating — alarms survive SW restarts, so
// calling create() on each SW boot would stack duplicate alarms without this.

chrome.alarms.clear('sw-keepalive', () => {
  chrome.alarms.create('sw-keepalive', { periodInMinutes: 0.4 }); // ~every 25s
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'sw-keepalive') return;

  if (!serverUrl || !roomId) {
    // SW was killed and restarted — reload config from storage
    chrome.storage.local.get(['role', 'roomId', 'serverUrl', 'enabled'], loadConfig);
    return;
  }

  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify({ type: 'ping', room: roomId })); } catch (_) {}
  } else if (!ws || ws.readyState > 1) {
    connect();
  }
});

// ─── Port keepalive from content scripts ──────────────────────────────────────

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name?.startsWith('syncwatch-tab-')) return;
  const tabId = port.sender?.tab?.id;
  if (tabId) {
    videoTabId = tabId;
    updateBadge(lastStatusState, lastClientCount);
    console.log(`[SyncWatch] Tab ${tabId} connected via port`);
  }
  port.onDisconnect.addListener(() => {
    console.log('[SyncWatch] Tab port disconnected');
  });
});

// ─── Config bootstrap ─────────────────────────────────────────────────────────

function loadConfig(cfg) {
  disconnect();
  if (!cfg.role || !cfg.roomId || !cfg.serverUrl) {
    role = null; roomId = null; serverUrl = null;
    updateStatus('disabled');
    return;
  }
  role      = cfg.role;
  roomId    = cfg.roomId;
  serverUrl = cfg.serverUrl;
  enabled   = cfg.enabled !== false; // FIX: default to enabled (was === true, which blocked when missing)
  console.log('[SyncWatch BG] Config loaded: role=' + role + ' room=' + roomId + ' url=' + serverUrl + ' enabled=' + enabled);
  if (!enabled) {
    updateStatus('disabled');
    return;
  }
  connect();
}

chrome.storage.local.get(['role', 'roomId', 'serverUrl', 'enabled'], loadConfig);

chrome.storage.onChanged.addListener((changes) => {
  if (changes.role || changes.roomId || changes.serverUrl || changes.enabled) {
    chrome.storage.local.get(['role', 'roomId', 'serverUrl', 'enabled'], loadConfig);
  }
  if (changes.kickTrigger?.newValue) {
    sendKick();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === videoTabId) videoTabId = null;
});

// ─── Messaging bridge ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab?.id;

  if (msg.type === 'register-tab') {
    if (tabId) { videoTabId = tabId; updateBadge(lastStatusState, lastClientCount); }
    console.log('[SyncWatch BG] Tab registered: ' + tabId);
    return;
  }
  if (msg.type === 'video-event') {
    if (tabId) videoTabId = tabId;
    console.log('[SyncWatch BG] → Relaying video-event to WS: ' + msg.payload.type + ' @ ' + msg.payload.currentTime + 's');
    sendWs({ ...msg.payload, room: roomId });
    return;
  }
  if (msg.type === 'sync-state') {
    if (tabId) videoTabId = tabId;
    console.log('[SyncWatch BG] → Relaying sync-state to WS');
    sendWs({ ...msg.payload, room: roomId });
    return;
  }
  if (msg.type === 'kick')  { sendKick();    return; }
  if (msg.type === 'reset') { handleReset(); return; }
  if (msg.type === 'log-event') {
    handleLogEvent(msg.payload);
    return;
  }

  if (msg.type === 'syncwatch-ping') return;
});

// ─── WebSocket connection ─────────────────────────────────────────────────────

function disconnect() {
  clearTimeout(reconnectTimer);
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
}

function connect() {
  const id = ++connectId;
  if (ws && ws.readyState <= 1) return;

  try {
    ws = new WebSocket(serverUrl);
  } catch (e) {
    console.warn('[SyncWatch] Bad server URL:', serverUrl);
    return;
  }

  ws.onopen = () => {
    if (id !== connectId) return;
    console.log(`[SyncWatch] Connected as ${role} in room "${roomId}"`);
    ws.send(JSON.stringify({ type: 'join', room: roomId, role }));
    // FIX: don't call updateStatus('connected') here — wait for room-info from server.
    // Calling 'connecting' here is also wrong since we're already open.
    // Just update badge to show we're live but waiting for room-info.
    updateStatus('connecting');
    rediscoverVideoTab();
  };

  ws.onmessage = (event) => {
    if (id !== connectId) return;
    let data;
    try { data = JSON.parse(event.data); } catch { return; }

    if (data.type === 'room-info') {
      updateStatus('connected', data.count);
      console.log('[SyncWatch BG] room-info: ' + data.count + ' clients in room "' + roomId + '"');
      return;
    }
    if (data.type === 'sync-request' && role === 'controller') {
      console.log('[SyncWatch BG] sync-request received from receiver');
      requestSyncState();
      return;
    }
    if (role === 'receiver') {
      console.log('[SyncWatch BG] ← Received from server: ' + data.type + ' — forwarding to video tab ' + videoTabId);
      forwardToVideoTab({ type: 'remote-event', data });
    }
  };

  ws.onclose = (event) => {
    if (id !== connectId) return;
    if (event?.reason === 'kicked') {
      console.warn('[SyncWatch] Kicked from room.');
      handleReset();
      return;
    }
    console.warn('[SyncWatch] Disconnected. Retrying in 3s…');
    updateStatus('disconnected');
    reconnectTimer = setTimeout(connect, 3000);
  };

  ws.onerror = () => { if (id === connectId) ws.close(); };
}

function sendWs(payload) {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify(payload));
}

function sendKick()   { sendWs({ type: 'kick', room: roomId }); }

function handleReset() {
  disconnect();
  role = null; roomId = null; serverUrl = null; videoTabId = null; enabled = false;
  chrome.storage.local.remove(['role', 'roomId', 'serverUrl', 'syncStatus', 'enabled']);
  updateStatus('disconnected');
}

// ─── Relay to content script ──────────────────────────────────────────────────

function forwardToVideoTab(msg) {
  if (!videoTabId) return;
  chrome.tabs.sendMessage(videoTabId, msg).catch(() => { videoTabId = null; });
}

function requestSyncState() {
  if (!videoTabId) return;
  chrome.tabs.sendMessage(videoTabId, { type: 'sync-request' }).catch(() => { videoTabId = null; });
}

// ─── Rediscover video tab after SW restart ────────────────────────────────────
// FIX: stop as soon as we find the first responding tab to avoid race overwrites.

function rediscoverVideoTab() {
  if (videoTabId) return; // already known
  chrome.tabs.query({}, (tabs) => {
    let found = false;
    for (const tab of tabs) {
      if (found) break;
      chrome.tabs.sendMessage(tab.id, { type: 'syncwatch-ping' })
        .then(() => {
          if (!found) {
            found = true;
            videoTabId = tab.id;
            updateBadge(lastStatusState, lastClientCount);
            console.log(`[SyncWatch] Rediscovered video tab ${tab.id}`);
          }
        })
        .catch(() => {});
    }
  });
}

// ─── Status + badge ───────────────────────────────────────────────────────────

function updateStatus(state, clientCount) {
  lastStatusState  = state;
  lastClientCount  = clientCount || 0;
  chrome.storage.local.set({
    syncStatus: { state, connected: state === 'connected', roomId, role, clientCount: lastClientCount, enabled }
  });
  updateBadge(state, lastClientCount);
}

function updateBadge(state, clientCount) {
  const connected = state === 'connected';
  const badge     = !connected ? '!' : String(clientCount || '~');
  const badgeOpts = { text: badge };
  if (videoTabId) badgeOpts.tabId = videoTabId;
  chrome.action.setBadgeText(badgeOpts);

  let color = badge === '!' ? '#dc2626'
    : /^[2-9]/.test(badge) ? '#4ade80'
    : badge === '1'         ? '#d97706'
    : '#7c3aed';
  const colorOpts = { color };
  if (videoTabId) colorOpts.tabId = videoTabId;
  chrome.action.setBadgeBackgroundColor(colorOpts);
}

function handleLogEvent(payload) {
  const targetRoomId = payload.roomId;
  const targetServerUrl = payload.serverUrl;
  if (!targetRoomId || !targetServerUrl) return;

  chrome.storage.local.get(['previousRooms'], (res) => {
    const rooms = res.previousRooms || [];
    let roomIndex = rooms.findIndex(r => r.roomId === targetRoomId && r.serverUrl === targetServerUrl);
    
    let room;
    if (roomIndex !== -1) {
      room = rooms[roomIndex];
    } else {
      room = {
        roomId: targetRoomId,
        serverUrl: targetServerUrl,
        role: 'controller',
        history: []
      };
      rooms.unshift(room);
      roomIndex = 0;
    }

    if (!room.history) room.history = [];

    let movieIndex = room.history.findIndex(m => m.url === payload.url);
    let movie;

    if (movieIndex !== -1) {
      movie = room.history.splice(movieIndex, 1)[0];
    } else {
      movie = {
        url: payload.url,
        title: payload.title,
        events: []
      };
    }

    if (payload.title && payload.title !== movie.title) {
      movie.title = payload.title;
    }

    movie.lastActive = Date.now();

    const lastEvent = movie.events[movie.events.length - 1];
    if (lastEvent && lastEvent.type === payload.type && Math.abs(lastEvent.time - payload.currentTime) < 1.0) {
      // Skip duplicate
    } else {
      movie.events.push({
        type: payload.type,
        time: payload.currentTime,
        timestamp: Date.now()
      });

      if (movie.events.length > 20) {
        movie.events.shift();
      }
    }

    room.history.unshift(movie);

    if (room.history.length > 5) {
      room.history.pop();
    }

    chrome.storage.local.set({ previousRooms: rooms });
  });
}
