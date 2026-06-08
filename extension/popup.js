// SyncWatch — popup.js

const serverUrlInput = document.getElementById('serverUrl');
const roomIdInput    = document.getElementById('roomId');
const roleSelect     = document.getElementById('role');
const saveBtn        = document.getElementById('saveBtn');
const shareBtn       = document.getElementById('shareBtn');
const shareSetupBtn  = document.getElementById('shareSetupBtn');
const resetBtn       = document.getElementById('resetBtn');
const kickBtn        = document.getElementById('kickBtn');
const statusEl       = document.getElementById('status');
const connPanel      = document.getElementById('connPanel');
const connDot        = document.getElementById('connDot');
const connText       = document.getElementById('connText');
const connRoom       = document.getElementById('connRoom');
const connClients    = document.getElementById('connClients');
const actionRow      = document.getElementById('actionRow');

// ── Load saved config + connection status ─────────────────────────────────────
chrome.storage.local.get(['serverUrl', 'roomId', 'role', 'syncStatus'], (cfg) => {
  if (cfg.serverUrl) serverUrlInput.value = cfg.serverUrl;
  if (cfg.roomId)    roomIdInput.value    = cfg.roomId;
  if (cfg.role)      roleSelect.value     = cfg.role;
  if (cfg.syncStatus) renderConnection(cfg.syncStatus);
});

// ── Listen for live status updates from background.js ─────────────────────────
chrome.storage.onChanged.addListener((changes) => {
  if (changes.syncStatus) renderConnection(changes.syncStatus.newValue);
});

function renderConnection(status) {
  if (!status || !status.roomId) { connPanel.style.display = 'none'; return; }

  connPanel.style.display = 'block';
  connRoom.textContent = 'Room: ' + status.roomId;

  if (status.connected) {
    connDot.className = 'dot green';
    connText.textContent = 'Connected';
    const count = status.clientCount;
    if (count > 1) {
      connClients.textContent = count + ' people in room';
    } else {
      connClients.textContent = 'Waiting for others to join…';
    }
  } else {
    connDot.className = 'dot red';
    connText.textContent = 'Disconnected';
    connClients.textContent = 'Reconnecting…';
  }

  actionRow.style.display = status.role === 'controller' ? 'flex' : 'none';
}

resetBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'reset' }).catch(() => {});
  chrome.storage.local.remove(['role', 'roomId', 'serverUrl', 'syncStatus'], () => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'reset' }).catch(() => {});
      }
    });
    setStatus('Room reset', 'ok');
  });
});

kickBtn.addEventListener('click', () => {
  chrome.storage.local.set({ kickTrigger: Date.now() }, () => {
    chrome.runtime.sendMessage({ type: 'kick' }).catch(() => {});
    setStatus('Kicked all receivers', 'ok');
  });
});

// ── Save ──────────────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', () => {
  const serverUrl = serverUrlInput.value.trim();
  const roomId    = roomIdInput.value.trim();
  const role      = roleSelect.value;

  if (!serverUrl || !roomId) {
    setStatus('Please fill in all fields.', 'err');
    return;
  }

  if (!serverUrl.startsWith('ws://') && !serverUrl.startsWith('wss://')) {
    setStatus('Server URL must start with ws:// or wss://', 'err');
    return;
  }

  chrome.storage.local.set({ serverUrl, roomId, role }, () => {
    setStatus('✓ Saved! Connecting…', 'ok');
  });
});

// ── Share invite ──────────────────────────────────────────────────────────────
shareBtn.addEventListener('click', () => {
  const serverUrl = serverUrlInput.value.trim();
  const roomId    = roomIdInput.value.trim();
  if (!serverUrl || !roomId) {
    setStatus('Save your config first', 'err');
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabUrl = tabs[0]?.url || '';
    const domain = serverUrl.replace(/^wss?:\/\//, '').replace(/:\d+$/, '');
    const joinLink = `https://${domain}/join?room=${encodeURIComponent(roomId)}&server=${encodeURIComponent(serverUrl)}&url=${encodeURIComponent(tabUrl)}`;
    const text = `🎬 Watch with me!\n\nOpen this on your iPad and tap the bookmark:\n${joinLink}`;

    navigator.clipboard.writeText(text).then(() => {
      shareBtn.textContent = '✓ Copied to clipboard!';
      shareBtn.classList.add('copied');
      setTimeout(() => {
        shareBtn.textContent = 'Share Invite';
        shareBtn.classList.remove('copied');
      }, 3000);
    }).catch(() => {
      setStatus('Could not copy to clipboard', 'err');
    });
  });
});

shareSetupBtn.addEventListener('click', () => {
  const serverUrl = serverUrlInput.value.trim();
  const roomId    = roomIdInput.value.trim();
  if (!serverUrl || !roomId) {
    setStatus('Save your config first', 'err');
    return;
  }

  const domain = serverUrl.replace(/^wss?:\/\//, '').replace(/:\d+$/, '');
  const setupLink = `https://${domain}/join?room=${encodeURIComponent(roomId)}&server=${encodeURIComponent(serverUrl)}`;
  const text = `🎬 SyncWatch Setup!\n\nOpen this on your iPad to set up the bookmarklet first:\n${setupLink}`;

  navigator.clipboard.writeText(text).then(() => {
    shareSetupBtn.textContent = '✓ Copied setup link!';
    shareSetupBtn.classList.add('copied');
    setTimeout(() => {
      shareSetupBtn.textContent = 'Share Setup Link';
      shareSetupBtn.classList.remove('copied');
    }, 3000);
  }).catch(() => {
    setStatus('Could not copy to clipboard', 'err');
  });
});

function setStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = type;
}
