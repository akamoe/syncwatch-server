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
const toggleRow      = document.getElementById('toggleRow'); // FIX: was missing, caused ReferenceError crashing renderConnection()
const previousRoomsList = document.getElementById('previousRoomsList');
const newRoomCard    = document.getElementById('newRoomCard');
const newRoomHeader  = document.getElementById('newRoomHeader');
const syncToggle     = document.getElementById('syncToggle');
const toggleLabel    = document.getElementById('toggleLabel');

// ── Load saved config + connection status ─────────────────────────────────────
(async () => {
  try {
    const cfg = await chrome.storage.local.get(['serverUrl', 'roomId', 'role', 'syncStatus', 'previousRooms', 'enabled']);
    if (cfg.serverUrl) serverUrlInput.value = cfg.serverUrl;
    if (cfg.roomId)    roomIdInput.value    = cfg.roomId;
    if (cfg.role)      roleSelect.value     = cfg.role;
    // FIX: read 'enabled' from storage directly (background.js never stores it inside syncStatus)
    const isEnabled = cfg.enabled === true;
    syncToggle.checked = isEnabled;
    toggleLabel.textContent = isEnabled ? 'Syncing' : 'Paused';
    if (cfg.syncStatus) renderConnection(cfg.syncStatus);
    renderPreviousRooms(cfg.previousRooms || [], cfg.roomId, cfg.serverUrl);
    
    // Auto-expand "New Room" form if not connected to any room
    if (!cfg.roomId || !cfg.serverUrl) {
      newRoomCard.classList.add('expanded');
    }
  } catch (err) {
    console.error('Failed to load configuration:', err);
  }
})();

// ── Toggle "New Room" accordion form ──────────────────────────────────────────
newRoomHeader.addEventListener('click', () => {
  const isExpanded = newRoomCard.classList.contains('expanded');
  
  // Collapse all room cards in the list
  document.querySelectorAll('.room-card').forEach(c => c.classList.remove('expanded'));
  
  if (isExpanded) {
    newRoomCard.classList.remove('expanded');
  } else {
    newRoomCard.classList.add('expanded');
  }
});

// ── Toggle sync on/off ───────────────────────────────────────────────────────
syncToggle.addEventListener('change', () => {
  const enabled = syncToggle.checked;
  chrome.storage.local.set({ enabled });
  toggleLabel.textContent = enabled ? 'Syncing' : 'Paused';
});

// ── Listen for live status updates from background.js ─────────────────────────
chrome.storage.onChanged.addListener(async (changes) => {
  if (changes.syncStatus) renderConnection(changes.syncStatus.newValue);
  if (changes.enabled) {
    syncToggle.checked = changes.enabled.newValue;
    toggleLabel.textContent = changes.enabled.newValue === true ? 'Syncing' : 'Paused';
  }
  if (changes.previousRooms || changes.roomId || changes.serverUrl) {
    try {
      const cfg = await chrome.storage.local.get(['previousRooms', 'roomId', 'serverUrl']);
      renderPreviousRooms(cfg.previousRooms || [], cfg.roomId, cfg.serverUrl);
    } catch (err) {
      console.error(err);
    }
  }
});

function renderConnection(status) {
  if (!status || !status.roomId) { connPanel.style.display = 'none'; return; }

  connPanel.style.display = 'block';
  connRoom.textContent = 'Room: ' + status.roomId;
  // FIX: toggleRow is now properly declared; safely show it
  if (toggleRow) toggleRow.style.display = 'flex';
  // FIX: 'enabled' is NOT stored inside syncStatus by background.js — read from the toggle directly
  // (toggleLabel is already kept in sync by the storage.onChanged listener below)

  const state = status.state || (status.connected ? 'connected' : 'disconnected');

  if (state === 'connected') {
    connDot.className = 'dot green';
    connText.textContent = 'Connected';
    const count = status.clientCount;
    if (count > 1) {
      connClients.textContent = count + ' people in room';
    } else {
      connClients.textContent = 'Waiting for others to join…';
    }
  } else if (state === 'connecting') {
    connDot.className = 'dot yellow';
    connText.textContent = 'Joining room…';
    connClients.textContent = 'Waiting for server…';
  } else {
    connDot.className = 'dot red';
    connText.textContent = 'Disconnected';
    connClients.textContent = 'Reconnecting…';
  }

  actionRow.style.display = status.role === 'controller' ? 'flex' : 'none';
}

resetBtn.addEventListener('click', async () => {
  chrome.runtime.sendMessage({ type: 'reset' }).catch(() => {});
  try {
    await chrome.storage.local.remove(['role', 'roomId', 'serverUrl', 'syncStatus', 'enabled']);
    serverUrlInput.value = '';
    roomIdInput.value = '';
    syncToggle.checked = false;
    toggleLabel.textContent = 'Paused';
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tabs[0]?.id) {
      await chrome.tabs.sendMessage(tabs[0].id, { type: 'reset' }).catch(() => {});
    }
    setStatus('Room reset', 'ok');
    newRoomCard.classList.add('expanded');
  } catch (err) {
    console.error(err);
    setStatus('Failed to reset room', 'err');
  }
});

kickBtn.addEventListener('click', () => {
  chrome.storage.local.set({ kickTrigger: Date.now() }, () => {
    chrome.runtime.sendMessage({ type: 'kick' }).catch(() => {});
    setStatus('Kicked all receivers', 'ok');
  });
});

// ── Save ──────────────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', async () => {
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

  try {
    const res = await chrome.storage.local.get(['previousRooms']);
    const rooms = res.previousRooms || [];
    const filtered = rooms.filter(r => !(r.serverUrl === serverUrl && r.roomId === roomId));
    const existingRoom = rooms.find(r => r.serverUrl === serverUrl && r.roomId === roomId) || { serverUrl, roomId, role, history: [] };
    existingRoom.role = role;
    const updated = [existingRoom, ...filtered].slice(0, 10);

    // Save previousRooms and active credentials atomically in a single storage write
    // FIX: also set enabled=true so both content.js and background.js activate immediately
    await chrome.storage.local.set({
      previousRooms: updated,
      serverUrl,
      roomId,
      role,
      enabled: true
    });

    setStatus('✓ Saved! Connecting…', 'ok');
    renderPreviousRooms(updated, roomId, serverUrl);
    
    // Collapse new room form after saving
    newRoomCard.classList.remove('expanded');
  } catch (err) {
    console.error(err);
    setStatus('Failed to save connection', 'err');
  }
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

// ── Previous Rooms List Functions ──────────────────────────────────────────────
function renderPreviousRooms(rooms, activeRoomId, activeServerUrl) {
  previousRoomsList.innerHTML = '';
  if (rooms.length === 0) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'no-rooms';
    emptyEl.textContent = 'No previous rooms';
    previousRoomsList.appendChild(emptyEl);
    return;
  }

  rooms.forEach((room) => {
    const card = document.createElement('div');
    card.className = 'room-card';

    // Automatically expand the active room
    if (room.roomId === activeRoomId && room.serverUrl === activeServerUrl) {
      card.classList.add('expanded');
    }

    // Header
    const header = document.createElement('div');
    header.className = 'room-card-header';
    header.addEventListener('click', (e) => {
      if (e.target.closest('.room-delete-btn')) return;
      
      connectToRoom(room);

      const isExpanded = card.classList.contains('expanded');
      document.querySelectorAll('.room-card').forEach(c => c.classList.remove('expanded'));
      if (!isExpanded) {
        card.classList.add('expanded');
      }
    });

    const info = document.createElement('div');
    info.className = 'room-card-info';

    const title = document.createElement('div');
    title.className = 'room-card-title';
    title.textContent = room.roomId;

    const subtitle = document.createElement('div');
    subtitle.className = 'room-card-subtitle';
    const cleanServer = room.serverUrl.replace(/^wss?:\/\//, '');
    subtitle.textContent = cleanServer;

    info.appendChild(title);
    info.appendChild(subtitle);

    const actions = document.createElement('div');
    actions.className = 'room-card-actions';

    const badge = document.createElement('span');
    badge.className = `badge ${room.role}`;
    badge.textContent = room.role === 'controller' ? 'Ctrl' : 'Recv';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'room-delete-btn';
    deleteBtn.title = 'Delete from history';
    deleteBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
    deleteBtn.addEventListener('click', () => {
      deleteRoom(room);
    });

    actions.appendChild(badge);
    actions.appendChild(deleteBtn);

    header.appendChild(info);
    header.appendChild(actions);
    card.appendChild(header);

    // Details (Movie History)
    const details = document.createElement('div');
    details.className = 'room-card-details';
    details.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    const histTitle = document.createElement('div');
    histTitle.className = 'history-title';
    histTitle.textContent = 'Recently Watched';
    details.appendChild(histTitle);

    const histList = document.createElement('div');
    histList.className = 'history-list';

    if (!room.history || room.history.length === 0) {
      const noHist = document.createElement('div');
      noHist.className = 'no-history';
      noHist.textContent = 'No movies watched yet';
      histList.appendChild(noHist);
    } else {
      room.history.forEach((movie) => {
        const movieCard = document.createElement('div');
        movieCard.className = 'movie-card';

        // Movie Header (visible card top containing Title and Link)
        const movieHeader = document.createElement('div');
        movieHeader.className = 'movie-card-header';

        const movieTitle = document.createElement('div');
        movieTitle.className = 'movie-title';
        movieTitle.textContent = getMovieNameFromUrl(movie.url, movie.title);

        const movieLinkBtn = document.createElement('a');
        movieLinkBtn.className = 'movie-link-btn';
        movieLinkBtn.href = movie.url;
        movieLinkBtn.target = '_blank';
        movieLinkBtn.title = 'Open video page';
        movieLinkBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>`;
        movieLinkBtn.addEventListener('click', (e) => {
          e.stopPropagation();
        });

        const movieDeleteBtn = document.createElement('button');
        movieDeleteBtn.className = 'movie-delete-btn';
        movieDeleteBtn.title = 'Delete movie from history';
        movieDeleteBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;
        movieDeleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteMovie(room, movie.url);
        });

        const movieActions = document.createElement('div');
        movieActions.className = 'movie-card-actions';
        movieActions.appendChild(movieLinkBtn);
        movieActions.appendChild(movieDeleteBtn);

        movieHeader.appendChild(movieTitle);
        movieHeader.appendChild(movieActions);
        movieCard.appendChild(movieHeader);

        // Movie Details (collapsible centered content containing only the last pause/position)
        const movieDetails = document.createElement('div');
        movieDetails.className = 'movie-card-details';

        const lastPauseEvent = [...movie.events].reverse().find(ev => ev.type === 'pause');
        const lastEvent = movie.events[movie.events.length - 1];
        
        if (lastPauseEvent) {
          movieDetails.textContent = `Last paused at ${formatTime(lastPauseEvent.time)}`;
        } else if (lastEvent) {
          movieDetails.textContent = `Last position: ${formatTime(lastEvent.time)}`;
        } else {
          movieDetails.textContent = 'No position logged';
        }

        movieCard.appendChild(movieDetails);

        // Accordion click listener to expand/collapse movie details
        movieCard.addEventListener('click', (e) => {
          if (e.target.closest('.movie-link-btn') || e.target.closest('.movie-delete-btn')) return;
          
          const isExpanded = movieCard.classList.contains('expanded');
          card.querySelectorAll('.movie-card').forEach(mc => mc.classList.remove('expanded'));
          if (!isExpanded) {
            movieCard.classList.add('expanded');
          }
        });

        histList.appendChild(movieCard);
      });
    }

    details.appendChild(histList);
    card.appendChild(details);

    previousRoomsList.appendChild(card);
  });
}

async function connectToRoom(room) {
  const serverUrl = room.serverUrl;
  const roomId = room.roomId;
  const role = room.role;

  serverUrlInput.value = serverUrl;
  roomIdInput.value = roomId;
  roleSelect.value = role;

  try {
    // Only update the active credentials — do NOT reorder previousRooms.
    // Reordering caused rooms to shuffle positions so each room's "Recently
    // Watched" history appeared to belong to a different card.
    // The onChanged listener will re-render with the correct active room highlighted.
    await chrome.storage.local.set({ serverUrl, roomId, role });

    setStatus('✓ Connected!', 'ok');

    // Collapse new room form when connecting to previous room
    newRoomCard.classList.remove('expanded');
  } catch (err) {
    console.error(err);
    setStatus('Failed to connect to room', 'err');
  }
}

async function deleteRoom(room) {
  try {
    const res = await chrome.storage.local.get(['previousRooms', 'roomId', 'serverUrl']);
    const rooms = res.previousRooms || [];
    const updated = rooms.filter(r => !(r.serverUrl === room.serverUrl && r.roomId === room.roomId));
    await chrome.storage.local.set({ previousRooms: updated });
    renderPreviousRooms(updated, res.roomId, res.serverUrl);
  } catch (err) {
    console.error(err);
  }
}

function getMovieNameFromUrl(urlStr, docTitle) {
  try {
    const url = new URL(urlStr);
    
    if ((url.hostname.includes('youtube.com') || url.hostname.includes('youtu.be')) && docTitle) {
      return docTitle.replace(/ - YouTube$/, '').trim();
    }
    
    let path = url.pathname;
    if (path.endsWith('/')) path = path.slice(0, -1);
    let segment = path.split('/').pop();
    
    if (segment && isNaN(segment) && segment.length > 3) {
      let cleaned = decodeURIComponent(segment)
        .replace(/[-_]+/g, ' ')
        .replace(/\.(mp4|mkv|avi|webm|mov|flv)$/i, '')
        .trim();
      
      cleaned = cleaned.replace(/\b\w/g, c => c.toUpperCase());
      if (cleaned.length > 3) return cleaned;
    }
  } catch (e) {}
  
  if (docTitle) {
    let cleaned = docTitle.replace(/^[▶🎬\s]+/, '').trim();
    cleaned = cleaned
      .replace(/ - Netflix$/i, '')
      .replace(/ \| Prime Video$/i, '')
      .replace(/ - HBO Max$/i, '')
      .replace(/ - Disney\+$/i, '');
    if (cleaned) return cleaned;
  }
  
  try {
    return new URL(urlStr).hostname;
  } catch (e) {
    return 'Unknown Movie';
  }
}

function formatTime(secs) {
  if (isNaN(secs) || secs === null || secs === undefined) return '0:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Export / Import JSON Backup functions ──────────────────────────────────────
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFileInput = document.getElementById('importFile');

exportBtn.addEventListener('click', async () => {
  try {
    const res = await chrome.storage.local.get(['previousRooms']);
    const rooms = res.previousRooms || [];
    const jsonString = JSON.stringify(rooms, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `syncwatch-rooms-history.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('✓ Exported successfully!', 'ok');
  } catch (err) {
    console.error(err);
    setStatus('Failed to export history', 'err');
  }
});

importBtn.addEventListener('click', () => {
  importFileInput.click();
});

importFileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const rooms = JSON.parse(event.target.result);
      if (!Array.isArray(rooms)) {
        setStatus('Invalid JSON: Must be an array of rooms', 'err');
        return;
      }
      
      for (const room of rooms) {
        if (!room.roomId || !room.serverUrl) {
          setStatus('Invalid JSON: Rooms must have roomId and serverUrl', 'err');
          return;
        }
      }

      await chrome.storage.local.set({ previousRooms: rooms });
      setStatus('✓ Imported successfully!', 'ok');
      
      const cfg = await chrome.storage.local.get(['roomId', 'serverUrl']);
      renderPreviousRooms(rooms, cfg.roomId, cfg.serverUrl);
    } catch (err) {
      console.error(err);
      setStatus('Failed to parse JSON file', 'err');
    }
  };
  reader.readAsText(file);
});

async function deleteMovie(room, movieUrl) {
  try {
    const res = await chrome.storage.local.get(['previousRooms', 'roomId', 'serverUrl']);
    const rooms = res.previousRooms || [];
    const roomIndex = rooms.findIndex(r => r.roomId === room.roomId && r.serverUrl === room.serverUrl);
    if (roomIndex === -1) return;

    const targetRoom = rooms[roomIndex];
    if (targetRoom.history) {
      targetRoom.history = targetRoom.history.filter(m => m.url !== movieUrl);
    }

    await chrome.storage.local.set({ previousRooms: rooms });
    renderPreviousRooms(rooms, res.roomId, res.serverUrl);
  } catch (err) {
    console.error(err);
  }
}
