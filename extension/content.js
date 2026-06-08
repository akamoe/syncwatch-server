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
});

// ─── Find the video element (handles late-loading SPAs) ───────────────────────

function findVideo() {
  let best = null;
  let bestArea = 0;
  for (const v of document.querySelectorAll('video')) {
    const r = v.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > bestArea && r.width > 50 && r.height > 50) {
      best = v;
      bestArea = area;
    }
  }
  if (best) return best;
  for (const el of document.querySelectorAll('*')) {
    const sr = el.shadowRoot;
    if (!sr) continue;
    for (const v of sr.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea && r.width > 50 && r.height > 50) {
        best = v;
        bestArea = area;
      }
    }
  }
  return best;
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
