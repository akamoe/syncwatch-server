// SyncWatch — content.js v3.2
// Bulletproof: logs every step, handles SPA navigation, retries on failure.

let role = null;
let roomId = null;
let serverUrl = null;
let enabled = true; // mirrors chrome.storage 'enabled' flag
let isSyncing = false;
let video = null;
let listenersAttached = false;
let pollTimer = null;

// ─── Bootstrap ───────────────────────────────────────────────────────────────

function loadConfig(cfg) {
  const newRole = cfg.role || null;
  const newRoom = cfg.roomId || null;
  const newUrl = cfg.serverUrl || null;

  if (!newRole || !newRoom || !newUrl) {
    console.log('[SyncWatch] No config — not activating');
    role = null; roomId = null; serverUrl = null; video = null;
    return;
  }

  role = newRole;
  roomId = newRoom;
  serverUrl = newUrl;
  enabled = cfg.enabled !== false; // default true if unset

  console.log('[SyncWatch] Config loaded: role=' + role + ' room=' + roomId + ' enabled=' + enabled);
  chrome.runtime.sendMessage({ type: 'register-tab' })
    .catch(e => console.log('[SyncWatch] register-tab failed:', e.message));

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

let swPort = null;

function connectPort() {
  if (swPort) return;
  try {
    swPort = chrome.runtime.connect({ name: 'syncwatch-tab-' + Date.now() });
    swPort.onDisconnect.addListener(() => {
      swPort = null;
      setTimeout(connectPort, 1000);
    });
  } catch (e) {
    swPort = null;
    setTimeout(connectPort, 3000);
  }
}

connectPort();

// ─── Message handler ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'reset') {
    role = null; roomId = null; video = null;
    listenersAttached = false;
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'remote-event' && role === 'receiver') {
    console.log('[SyncWatch] Received remote-event:', msg.data.type, '@', msg.data.currentTime, 's');
    applyEvent(msg.data);
    return true;
  }

  if (msg.type === 'sync-request' && role === 'controller') {
    console.log('[SyncWatch] Sync request from receiver');
    respondSyncState();
    return true;
  }

  if (msg.type === 'syncwatch-ping') {
    sendResponse({ ok: true, hasVideo: !!findVideo() });
    return true;
  }
});

// ─── Find the video element ──────────────────────────────────────────────────

function findVideo() {
  // 1. Direct on page
  let v = document.querySelector('video');
  if (v) return v;

  // 2. Same-origin iframes
  try {
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        v = iframe.contentDocument?.querySelector('video');
        if (v) return v;
      } catch (e) {}
    }
  } catch (e) {}

  // 3. Shadow DOM
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
  setTimeout(() => {
    if (!found) obs.disconnect();
  }, 30000);
}

// ─── Controller: attach listeners to video element ───────────────────────────

function attachVideoListeners() {
  if (role !== 'controller') return;

  // Poll for video every 2s — handles SPA navigation, late-loading, etc.
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    const v = findVideo();
    if (!v) return;

    if (video === v) return; // same element, already attached

    // Remove old listeners from previous element (guards against SPA element reuse)
    if (video && video !== v) {
      video.removeEventListener('play', onVideoPlay);
      video.removeEventListener('pause', onVideoPause);
      video.removeEventListener('seeked', onVideoSeek);
      video.removeEventListener('ratechange', onVideoRate);
    }

    video = v;
    listenersAttached = true;
    console.log('[SyncWatch] Video found! src=' + (v.currentSrc || '?') + ' ready=' + v.readyState + ' — attaching listeners');

    v.addEventListener('play', onVideoPlay);
    v.addEventListener('pause', onVideoPause);
    v.addEventListener('seeked', onVideoSeek);
    v.addEventListener('ratechange', onVideoRate);
  }, 2000);

  // Also try immediately
  waitForVideo((v) => {
    if (video === v) return;
    if (video) {
      video.removeEventListener('play', onVideoPlay);
      video.removeEventListener('pause', onVideoPause);
      video.removeEventListener('seeked', onVideoSeek);
      video.removeEventListener('ratechange', onVideoRate);
    }
    video = v;
    listenersAttached = true;
    console.log('[SyncWatch] Video found immediately! src=' + (v.currentSrc || '?') + ' — attaching listeners');
    v.addEventListener('play', onVideoPlay);
    v.addEventListener('pause', onVideoPause);
    v.addEventListener('seeked', onVideoSeek);
    v.addEventListener('ratechange', onVideoRate);
  });
}

function onVideoPlay() {
  if (isSyncing || !video) return;
  console.log('[SyncWatch] ▶ PLAY @ ' + video.currentTime.toFixed(2) + 's → sending');
  sendVideoEvent({ type: 'play', currentTime: video.currentTime });
}

function onVideoPause() {
  if (isSyncing || !video) return;
  console.log('[SyncWatch] ⏸ PAUSE @ ' + video.currentTime.toFixed(2) + 's → sending');
  sendVideoEvent({ type: 'pause', currentTime: video.currentTime });
}

function onVideoSeek() {
  if (isSyncing || !video) return;
  console.log('[SyncWatch] 🔍 SEEK @ ' + video.currentTime.toFixed(2) + 's → sending');
  sendVideoEvent({ type: 'seek', currentTime: video.currentTime });
}

function onVideoRate() {
  if (isSyncing || !video) return;
  console.log('[SyncWatch] ⏩ RATE ' + video.playbackRate + 'x @ ' + video.currentTime.toFixed(2) + 's → sending');
  sendVideoEvent({ type: 'rate', currentTime: video.currentTime, rate: video.playbackRate });
}

function sendVideoEvent(payload) {
  if (!enabled) {
    console.log('[SyncWatch] Sync paused — not sending: ' + payload.type);
    return;
  }
  console.log('[SyncWatch] → sendMessage video-event:', payload.type);
  chrome.runtime.sendMessage({ type: 'video-event', payload })
    .then(() => console.log('[SyncWatch] ✓ background acknowledged'))
    .catch(e => console.log('[SyncWatch] ✗ sendMessage FAILED:', e.message));
}

function respondSyncState() {
  if (!video) {
    const v = findVideo();
    if (v) video = v;
  }
  if (!video) return;
  chrome.runtime.sendMessage({
    type: 'sync-state',
    payload: { type: 'sync-state', playing: !video.paused, currentTime: video.currentTime },
  })
    .catch(e => console.log('[SyncWatch] sync-state FAILED:', e.message));
}

// ─── Receiver: apply remote events ───────────────────────────────────────────

function applyEvent(data) {
  console.log('[SyncWatch] applyEvent called:', data.type, '@', data.currentTime, 's');
  waitForVideo((v) => {
    video = v;
    isSyncing = true;
    const THRESH = 2;

    console.log('[SyncWatch] Applying:', data.type, '@', data.currentTime, 'to video @', v.currentTime);

    if (data.type === 'play') {
      if (Math.abs(v.currentTime - data.currentTime) > THRESH) v.currentTime = data.currentTime;
      v.play().catch(e => console.log('[SyncWatch] play() failed:', e.message));
    } else if (data.type === 'pause') {
      if (Math.abs(v.currentTime - data.currentTime) > THRESH) v.currentTime = data.currentTime;
      v.pause();
    } else if (data.type === 'seek') {
      v.currentTime = data.currentTime;
    } else if (data.type === 'rate') {
      if (data.rate) v.playbackRate = data.rate;
    } else if (data.type === 'sync-state') {
      if (Math.abs(v.currentTime - data.currentTime) > THRESH) v.currentTime = data.currentTime;
      if (data.playing) v.play().catch(() => {}); else v.pause();
    }

    setTimeout(() => { isSyncing = false; }, 600);
  });
}