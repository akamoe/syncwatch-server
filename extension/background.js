// SyncWatch — background.js
// Service worker: owns the WebSocket connection (CSP-safe) and relays messages to content scripts.

let ws = null;
let role = null;
let roomId = null;
let serverUrl = null;
let videoTabId = null;
let reconnectTimer = null;
let connectId = 0;
let lastStatusState = 'disconnected';
let lastClientCount = 0;

// ─── Config bootstrap ─────────────────────────────────────────────────────────

function loadConfig(cfg) {
  disconnect();
  if (!cfg.role || !cfg.roomId || !cfg.serverUrl) {
    role = null;
    roomId = null;
    serverUrl = null;
    updateStatus('disconnected');
    return;
  }
  role = cfg.role;
  roomId = cfg.roomId;
  serverUrl = cfg.serverUrl;
  connect();
}

chrome.storage.local.get(['role', 'roomId', 'serverUrl'], loadConfig);

chrome.storage.onChanged.addListener((changes) => {
  if (changes.role || changes.roomId || changes.serverUrl) {
    chrome.storage.local.get(['role', 'roomId', 'serverUrl'], loadConfig);
  }
  if (changes.kickTrigger && changes.kickTrigger.newValue) {
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
    if (tabId) {
      videoTabId = tabId;
      updateBadge(lastStatusState, lastClientCount);
    }
    return;
  }

  if (msg.type === 'video-event') {
    if (tabId) videoTabId = tabId;
    sendWs({ ...msg.payload, room: roomId });
    return;
  }

  if (msg.type === 'sync-state') {
    if (tabId) videoTabId = tabId;
    sendWs({ ...msg.payload, room: roomId });
    return;
  }

  if (msg.type === 'kick') {
    sendKick();
    return;
  }

  if (msg.type === 'reset') {
    handleReset();
    return;
  }
});

// ─── WebSocket connection ─────────────────────────────────────────────────────

function disconnect() {
  clearTimeout(reconnectTimer);
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
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
    updateStatus('connecting');
  };

  ws.onmessage = (event) => {
    if (id !== connectId) return;
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    if (data.type === 'room-info') {
      updateStatus('connected', data.count);
      return;
    }

    if (data.type === 'sync-request' && role === 'controller') {
      requestSyncState();
      return;
    }

    if (role === 'receiver') {
      forwardToVideoTab({ type: 'remote-event', data });
    }
  };

  ws.onclose = (event) => {
    if (id !== connectId) return;
    if (event && event.reason === 'kicked') {
      console.warn('[SyncWatch] Kicked from room.');
      handleReset();
      return;
    }
    console.warn('[SyncWatch] Disconnected. Retrying in 3s…');
    updateStatus('disconnected');
    reconnectTimer = setTimeout(connect, 3000);
  };

  ws.onerror = () => {
    if (id === connectId) ws.close();
  };
}

function sendWs(payload) {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify(payload));
}

function sendKick() {
  sendWs({ type: 'kick', room: roomId });
}

function handleReset() {
  disconnect();
  role = null;
  roomId = null;
  serverUrl = null;
  videoTabId = null;
  chrome.storage.local.remove(['role', 'roomId', 'serverUrl', 'syncStatus']);
  updateStatus('disconnected');
}

// ─── Relay to content script ──────────────────────────────────────────────────

function forwardToVideoTab(msg) {
  if (!videoTabId) return;
  chrome.tabs.sendMessage(videoTabId, msg).catch(() => {
    videoTabId = null;
  });
}

function requestSyncState() {
  const send = (tabId) => {
    chrome.tabs.sendMessage(tabId, { type: 'sync-request' }).catch(() => {
      if (tabId === videoTabId) videoTabId = null;
    });
  };

  if (videoTabId) {
    send(videoTabId);
    return;
  }

  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      videoTabId = tabs[0].id;
      send(videoTabId);
    }
  });
}

// ─── Status + badge ───────────────────────────────────────────────────────────

function updateStatus(state, clientCount) {
  lastStatusState = state;
  lastClientCount = clientCount || 0;

  const status = {
    connected: state === 'connected',
    roomId,
    role,
    clientCount: lastClientCount,
  };
  chrome.storage.local.set({ syncStatus: status });
  updateBadge(state, lastClientCount);
}

function updateBadge(state, clientCount) {
  const connected = state === 'connected';
  const badge = !connected ? '!' : String(clientCount || '~');
  const badgeOpts = { text: badge };
  if (videoTabId) badgeOpts.tabId = videoTabId;
  chrome.action.setBadgeText(badgeOpts);

  const colors = { '!': '#dc2626', '?': '#d97706' };
  let color = colors[badge];
  if (!color && /^[2-9]/.test(badge)) color = '#4ade80';
  if (!color && /^1$/.test(badge)) color = '#d97706';
  const colorOpts = { color: color || '#7c3aed' };
  if (videoTabId) colorOpts.tabId = videoTabId;
  chrome.action.setBadgeBackgroundColor(colorOpts);
}
