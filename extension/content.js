// SyncWatch — content.js
// Detects video events on the page and applies remote sync actions relayed from background.js.
// v3: fixes enabled-flag bug, deep video discovery (iframes + shadow DOM), diagnostic logging

let role = null;
let roomId = null;
let serverUrl = null;
let isSyncing = false;
let video = null;
let listenersAttached = false;

// ─── Bootstrap ───────────────────────────────────────────────────────────────

function loadConfig(cfg) {
  role = cfg.role || null;
  roomId = cfg.roomId || null;
  serverUrl = cfg.serverUrl || null;

  // FIX: removed cfg.enabled !== true check — the Save button in popup.js
  // never sets enabled=true, so controllers never attached video listeners.
  // Now we activate as long as role+roomId+serverUrl are present.
  if (!role || !roomId || !serverUrl) {
    console.log('[SyncWatch] Missing config — not activating. role=' + role + ' room=' + roomId + ' url=' + serverUrl);
    role = null;
    roomId = null;
    serverUrl = null;
    video = null;
    return;
  }

  console.log('[SyncWatch] Config loaded: role=' + role + ' room=' + roomId);
  chrome.runtime.sendMessage({ type: 'register-tab' }).catch(() => {});

  if (role === 'controller') {
    attachVideoListeners();
  }
}

chrome.storage.local.get(['role', 'roomId', 'serverUrl', 'enabled'], loadConfig);

chrome.storage.onChanged.addListener((changes) => {
  if (changes.role || changes.roomId || changes.serverUrl || changes.enabled) {
    chrome.storage.local.get(['role', 'roomId', 'serverUrl', 'enabled'], loadConfig);
  }
});

// ─── Port-based keepalive ────────────────────────────────────────────────────
// Keeps the MV3 service worker alive as long as this tab is open.
// Without this, the SW can be killed ~30s after last interaction.

let swPort = null;

function connectPort() {
  if (swPort) return;
  try {
    swPort = chrome.runtime.connect({ name: 'syncwatch-tab-' + Date.now() });
    swPort.onDisconnect.addListener(() => {
      swPort = null;
      // Reconnect on disconnect (handles SW restart)
      setTimeout(connectPort, 1000);
    });
  } catch (e) {
    swPort = null;
    setTimeout(connectPort, 3000);
  }
}

connectPort();

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'reset') {
    role = null;
    roomId = null;
    video = null;
  }

  if (msg.type === 'remote-event' && role === 'receiver') {
    applyEvent(msg.data);
  }

  if (msg.type === 'sync-request' && role === 'controller') {
    respondSyncState();
  }

  if (msg.type === 'syncwatch-ping') {
    // Respond to background script's rediscovery ping
    // The promise resolution is the response itself
  }
});

// ─── Find the video element (handles late-loading SPAs, iframes, shadow DOM) ──

function findVideo() {
  // 1. Direct video on the page
  let v = document.querySelector('video');
  if (v) return v;

  // 2. Search through all iframes (same-origin only — cross-origin is blocked by browser security)
  try {
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        v = iframe.contentDocument?.querySelector('video');
        if (v) return v;
      } catch (e) {
        // cross-origin iframe — can't access contentDocument
      }
    }
  } catch (e) {}

  // 3. Search shadow DOM hosts
  try {
    const els = document.querySelectorAll('*');
    for (const el of els) {
      if (el.shadowRoot) {
        v = el.shadowRoot.querySelector('video');
        if (v) return v;
      }
    }
  } catch (e) {}

  return null;
}

function waitForVideo(cb) {
  const v = findVideo();
  if (v) return cb(v);

  let found = false;
  const obs = new MutationObserver(() => {
    if (found) return;
    const v2 = findVideo();
    if (v2) {
      found = true;
      obs.disconnect();
      cb(v2);
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });

  // Give up after 30 seconds
  setTimeout(() => {
    if (!found) {
      obs.disconnect();
      console.log('[SyncWatch] No video found after 30s of waiting');
    }
  }, 30000);
}

// ─── Controller: send events ──────────────────────────────────────────────────

function attachVideoListeners() {
  if (role !== 'controller') return;
  if (listenersAttached) {
    console.log('[SyncWatch] Listeners already attached, skipping');
    return;
  }

  waitForVideo((v) => {
    video = v;
    listenersAttached = true;
    console.log('[SyncWatch] Video element found at src=' + v.currentSrc + ' ready=' + v.readyState + ' — listening for play/pause/seek');

    v.addEventListener('play', () => {
      if (isSyncing) return;
      console.log('[SyncWatch] ▶ PLAY event at ' + v.currentTime + 's — sending to server');
      sendVideoEvent({ type: 'play', currentTime: v.currentTime });
      logEvent('play', v.currentTime);
    });

    v.addEventListener('pause', () => {
      if (isSyncing) return;
      console.log('[SyncWatch] ⏸ PAUSE event at ' + v.currentTime + 's — sending to server');
      sendVideoEvent({ type: 'pause', currentTime: v.currentTime });
      logEvent('pause', v.currentTime);
    });

    v.addEventListener('seeked', () => {
      if (isSyncing) return;
      console.log('[SyncWatch] 🔍 SEEKED to ' + v.currentTime + 's — sending to server');
      sendVideoEvent({ type: 'seek', currentTime: v.currentTime });
      logEvent('seek', v.currentTime);
    });

    // Also listen for ratechange (speed changes)
    v.addEventListener('ratechange', () => {
      if (isSyncing) return;
      console.log('[SyncWatch] ⏩ RATE changed to ' + v.playbackRate + 'x — sending to server');
      sendVideoEvent({ type: 'rate', currentTime: v.currentTime, rate: v.playbackRate });
    });
  });
}

function sendVideoEvent(payload) {
  chrome.runtime.sendMessage({ type: 'video-event', payload }).catch(() => {});
}

function respondSyncState() {
  waitForVideo((v) => {
    video = v;
    chrome.runtime
      .sendMessage({
        type: 'sync-state',
        payload: { type: 'sync-state', playing: !v.paused, currentTime: v.currentTime },
      })
      .catch(() => {});
  });
}

// ─── Receiver: apply remote events ───────────────────────────────────────────

function applyEvent(data) {
  waitForVideo((v) => {
    video = v;
    isSyncing = true;

    const SEEK_THRESHOLD = 2;

    console.log('[SyncWatch] ← Applying remote event: type=' + data.type + ' currentTime=' + data.currentTime);

    if (data.type === 'play') {
      if (Math.abs(v.currentTime - data.currentTime) > SEEK_THRESHOLD) {
        v.currentTime = data.currentTime;
      }
      v.play().catch((e) => console.log('[SyncWatch] play() failed:', e.message));
      logEvent('play', data.currentTime);
    } else if (data.type === 'pause') {
      if (Math.abs(v.currentTime - data.currentTime) > SEEK_THRESHOLD) {
        v.currentTime = data.currentTime;
      }
      v.pause();
      logEvent('pause', data.currentTime);
    } else if (data.type === 'seek') {
      v.currentTime = data.currentTime;
      logEvent('seek', data.currentTime);
    } else if (data.type === 'rate') {
      if (data.rate) v.playbackRate = data.rate;
      logEvent('rate', data.currentTime);
    } else if (data.type === 'sync-state') {
      if (Math.abs(v.currentTime - data.currentTime) > SEEK_THRESHOLD) {
        v.currentTime = data.currentTime;
      }
      if (data.playing) {
        v.play().catch(() => {});
      } else {
        v.pause();
      }
    }

    setTimeout(() => {
      isSyncing = false;
    }, 600);
  });
}

function logEvent(type, currentTime) {
  if (!roomId || !serverUrl) return;
  chrome.runtime.sendMessage({
    type: 'log-event',
    payload: {
      type: type,
      currentTime: currentTime,
      url: window.location.href,
      title: document.title,
      roomId: roomId,
      serverUrl: serverUrl
    }
  }).catch(() => {});
}
