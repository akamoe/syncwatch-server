// SyncWatch — background.js v3.1
// Bulletproof WebSocket relay with full diagnostic logging.

let ws = null;
let role = null;
let roomId = null;
let serverUrl = null;
let videoTabId = null;
let reconnectTimer = null;
let connectId = 0;
let lastStatusState = 'disconnected';
let lastClientCount = 0;

// ─── Service worker keepalive ─────────────────────────────────────────────────

chrome.alarms.clear('sw-keepalive', () => {
  chrome.alarms.create('sw-keepalive', { periodInMinutes: 0.4 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'sw-keepalive') return;

  if (!serverUrl || !roomId) {
    chrome.storage.local.get(['role', 'roomId', 'serverUrl'], loadConfig);
    return;
  }

  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify({ type: 'ping', room: roomId })); } catch (_) {}
  } else if (!ws || ws.readyState > 1) {
    console.log('[SyncWatch BG] Alarm: reconnecting WS');
    connect();
  }
});

// ─── Port keepalive from content scripts ──────────────────────────────────────

chrome.runtime.onConnect.addListener((port) => {
  console.log('[SyncWatch BG] Port connected: ' + port.name);
  const tabId = port.sender?.tab?.id;
  if (tabId) {
    videoTabId = tabId;
    updateBadge(lastStatusState, lastClientCount);
  }
  port.onDisconnect.addListener(() => {
    console.log('[SyncWatch BG] Port disconnected (tab ' + tabId + ')');
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
  console.log('[SyncWatch BG] Config: role=' + role + ' room=' + roomId + ' url=' + serverUrl);
  connect();
}

chrome.storage.local.get(['role', 'roomId', 'serverUrl'], loadConfig);

chrome.storage.onChanged.addListener((changes) => {
  if (changes.role || changes.roomId || changes.serverUrl) {
    chrome.storage.local.get(['role', 'roomId', 'serverUrl'], loadConfig);
  }
  if (changes.kickTrigger?.newValue) {
    sendKick();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === videoTabId) {
    console.log('[SyncWatch BG] Video tab ' + tabId + ' closed');
    videoTabId = null;
  }
});

// ─── Messaging bridge ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  console.log('[SyncWatch BG] MSG from tab ' + tabId + ': ' + msg.type);

  if (msg.type === 'register-tab') {
    if (tabId) {
      videoTabId = tabId;
      updateBadge(lastStatusState, lastClientCount);
      console.log('[SyncWatch BG] Registered tab ' + tabId + ' as video tab');
      sendResponse({ ok: true });
      return true;
    }
  }

  if (msg.type === 'video-event') {
    if (tabId) videoTabId = tabId;
    console.log('[SyncWatch BG] → WS relay: ' + msg.payload.type + ' @ ' + msg.payload.currentTime + 's (room=' + roomId + ')');
    sendWs({ ...msg.payload, room: roomId });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'sync-state') {
    if (tabId) videoTabId = tabId;
    console.log('[SyncWatch BG] → WS relay: sync-state');
    sendWs({ ...msg.payload, room: roomId });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'kick')  { sendKick();    return; }
  if (msg.type === 'reset') { handleReset(); return; }
  if (msg.type === 'log-event') { handleLogEvent(msg.payload); return; }
  if (msg.type === 'syncwatch-ping') {
    sendResponse({ ok: true });
    return true;
  }
});

// ─── WebSocket connection ─────────────────────────────────────────────────────

function disconnect() {
  clearTimeout(reconnectTimer);
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
}

function connect() {
  const id = ++connectId;
  if (ws && ws.readyState <= 1) {
    console.log('[SyncWatch BG] WS already connected (readyState=' + ws.readyState + ')');
    return;
  }

  if (!serverUrl) {
    console.log('[SyncWatch BG] No serverUrl — cannot connect');
    return;
  }

  console.log('[SyncWatch BG] Connecting to ' + serverUrl + ' as ' + role + '...');

  try {
    ws = new WebSocket(serverUrl);
  } catch (e) {
    console.warn('[SyncWatch BG] Bad server URL:', serverUrl, e.message);
    return;
  }

  ws.onopen = () => {
    if (id !== connectId) return;
    console.log('[SyncWatch BG] WS OPEN — sending join room="' + roomId + '" role="' + role + '"');
    ws.send(JSON.stringify({ type: 'join', room: roomId, role }));
    updateStatus('connecting');
    rediscoverVideoTab();
  };

  ws.onmessage = (event) => {
    if (id !== connectId) return;
    let data;
    try { data = JSON.parse(event.data); } catch { return; }

    if (data.type === 'room-info') {
      updateStatus('connected', data.count);
      console.log('[SyncWatch BG] room-info: ' + data.count + ' clients');
      return;
    }
    if (data.type === 'sync-request' && role === 'controller') {
      console.log('[SyncWatch BG] ← sync-request from receiver');
      requestSyncState();
      return;
    }
    if (role === 'receiver') {
      console.log('[SyncWatch BG] ← WS message: ' + data.type + ' → forwarding to tab ' + videoTabId);
      forwardToVideoTab({ type: 'remote-event', data });
    } else {
      console.log('[SyncWatch BG] ← WS message: ' + data.type + ' (not a receiver, ignoring)');
    }
  };

  ws.onclose = (event) => {
    if (id !== connectId) return;
    if (event?.reason === 'kicked') {
      console.warn('[SyncWatch BG] Kicked from room');
      handleReset();
      return;
    }
    console.warn('[SyncWatch BG] WS CLOSED code=' + event.code + ' reason="' + event.reason + '" — retry in 3s');
    updateStatus('disconnected');
    reconnectTimer = setTimeout(connect, 3000);
  };

  ws.onerror = (e) => {
    console.error('[SyncWatch BG] WS ERROR:', e.message || e);
    if (id === connectId) ws.close();
  };
}

function sendWs(payload) {
  if (!ws || ws.readyState !== 1) {
    console.log('[SyncWatch BG] ✗ sendWs FAILED: WS not ready (readyState=' + (ws ? ws.readyState : 'null') + ')');
    return false;
  }
  try {
    ws.send(JSON.stringify(payload));
    console.log('[SyncWatch BG] ✓ sent to WS');
    return true;
  } catch (e) {
    console.error('[SyncWatch BG] ✗ sendWs error:', e.message);
    return false;
  }
}

function sendKick() { sendWs({ type: 'kick', room: roomId }); }

function handleReset() {
  disconnect();
  role = null; roomId = null; serverUrl = null; videoTabId = null;
  chrome.storage.local.remove(['role', 'roomId', 'serverUrl', 'syncStatus', 'enabled']);
  updateStatus('disconnected');
}

// ─── Relay to content script ──────────────────────────────────────────────────

function forwardToVideoTab(msg) {
  if (!videoTabId) {
    console.log('[SyncWatch BG] ✗ forwardToVideoTab: no videoTabId');
    // Try to rediscover
    rediscoverVideoTab();
    return;
  }
  console.log('[SyncWatch BG] → forwarding to tab ' + videoTabId + ': ' + msg.data?.type);
  chrome.tabs.sendMessage(videoTabId, msg)
    .then(() => console.log('[SyncWatch BG] ✓ tab received'))
    .catch(e => {
      console.error('[SyncWatch BG] ✗ tab forward FAILED:', e.message);
      videoTabId = null;
    });
}

function requestSyncState() {
  if (!videoTabId) {
    console.log('[SyncWatch BG] ✗ requestSyncState: no videoTabId');
    return;
  }
  chrome.tabs.sendMessage(videoTabId, { type: 'sync-request' })
    .catch(e => {
      console.error('[SyncWatch BG] ✗ sync-request FAILED:', e.message);
      videoTabId = null;
    });
}

// ─── Rediscover video tab after SW restart ────────────────────────────────────

function rediscoverVideoTab() {
  if (videoTabId) {
    console.log('[SyncWatch BG] rediscover: already have tab ' + videoTabId);
    return;
  }
  console.log('[SyncWatch BG] rediscover: scanning all tabs...');
  chrome.tabs.query({}, (tabs) => {
    let found = false;
    for (const tab of tabs) {
      if (found) break;
      chrome.tabs.sendMessage(tab.id, { type: 'syncwatch-ping' })
        .then((resp) => {
          if (!found) {
            found = true;
            videoTabId = tab.id;
            updateBadge(lastStatusState, lastClientCount);
            console.log('[SyncWatch BG] Rediscovered tab ' + tab.id);
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
    syncStatus: { state, connected: state === 'connected', roomId, role, clientCount: lastClientCount }
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
    : badge === '1'        ? '#d97706'
    : '#7c3aed';
  const colorOpts = { color };
  if (videoTabId) colorOpts.tabId = videoTabId;
  chrome.action.setBadgeBackgroundColor(colorOpts);
}

// ─── Log event handler (room history) ─────────────────────────────────────────

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
      room = { roomId: targetRoomId, serverUrl: targetServerUrl, role: 'controller', history: [] };
      rooms.unshift(room);
      roomIndex = 0;
    }

    if (!room.history) room.history = [];

    let movieIndex = room.history.findIndex(m => m.url === payload.url);
    let movie;
    if (movieIndex !== -1) {
      movie = room.history.splice(movieIndex, 1)[0];
    } else {
      movie = { url: payload.url, title: payload.title, events: [] };
    }

    if (payload.title && payload.title !== movie.title) movie.title = payload.title;
    movie.lastActive = Date.now();

    const lastEvent = movie.events[movie.events.length - 1];
    if (lastEvent && lastEvent.type === payload.type && Math.abs(lastEvent.time - payload.currentTime) < 1.0) {
      // Skip duplicate
    } else {
      movie.events.push({ type: payload.type, time: payload.currentTime, timestamp: Date.now() });
      if (movie.events.length > 20) movie.events.shift();
    }

    room.history.unshift(movie);
    if (room.history.length > 5) room.history.pop();

    chrome.storage.local.set({ previousRooms: rooms });
  });
}