// SyncWatch — content.js
// Detects video events on the page and applies remote sync actions relayed from background.js.

let role = null;
let roomId = null;
let isSyncing = false;
let video = null;

// ─── Bootstrap ───────────────────────────────────────────────────────────────

function loadConfig(cfg) {
  role = cfg.role || null;
  roomId = cfg.roomId || null;

  if (!role || !roomId || !cfg.serverUrl) {
    role = null;
    roomId = null;
    video = null;
    return;
  }

  chrome.runtime.sendMessage({ type: 'register-tab' }).catch(() => {});

  if (role === 'controller') {
    attachVideoListeners();
  }
}

chrome.storage.local.get(['role', 'roomId', 'serverUrl'], loadConfig);

chrome.storage.onChanged.addListener((changes) => {
  if (changes.role || changes.roomId || changes.serverUrl) {
    chrome.storage.local.get(['role', 'roomId', 'serverUrl'], loadConfig);
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

// ─── Find the video element (handles late-loading SPAs) ───────────────────────

function findVideo() {
  return document.querySelector('video');
}

function waitForVideo(cb) {
  const v = findVideo();
  if (v) return cb(v);
  const obs = new MutationObserver(() => {
    const v2 = findVideo();
    if (v2) {
      obs.disconnect();
      cb(v2);
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
}

// ─── Controller: send events ──────────────────────────────────────────────────

function attachVideoListeners() {
  if (role !== 'controller') return;

  waitForVideo((v) => {
    video = v;
    console.log('[SyncWatch] Video element found, listening…');

    v.addEventListener('play', () => {
      if (isSyncing) return;
      sendVideoEvent({ type: 'play', currentTime: v.currentTime });
    });

    v.addEventListener('pause', () => {
      if (isSyncing) return;
      sendVideoEvent({ type: 'pause', currentTime: v.currentTime });
    });

    v.addEventListener('seeked', () => {
      if (isSyncing) return;
      sendVideoEvent({ type: 'seek', currentTime: v.currentTime });
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

    if (data.type === 'play') {
      if (Math.abs(v.currentTime - data.currentTime) > SEEK_THRESHOLD) {
        v.currentTime = data.currentTime;
      }
      v.play().catch(() => {});
    } else if (data.type === 'pause') {
      if (Math.abs(v.currentTime - data.currentTime) > SEEK_THRESHOLD) {
        v.currentTime = data.currentTime;
      }
      v.pause();
    } else if (data.type === 'seek') {
      v.currentTime = data.currentTime;
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
