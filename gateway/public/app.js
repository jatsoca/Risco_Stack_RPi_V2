const wsStatusEl = document.getElementById('ws-status');
const panelOnlineEl = document.getElementById('panel-online');
const partitionTable = document.querySelector('#partitions tbody');
const zoneTable = document.querySelector('#zones tbody');
const zoneFilter = document.getElementById('zone-filter');
const zonesCount = document.getElementById('zones-count');
const partitionInput = document.getElementById('partition-id');
const armButtons = document.querySelectorAll('.arm-btn');
const toastContainer = document.getElementById('toast-container');
const logoutBtn = document.getElementById('logout-btn');
const gatewayMeta = document.getElementById('gateway-meta');

let snapshot = { partitions: [], zones: [] };
let ws;
let panelOnline = false;
let reconnectTimer = null;
let reconnectDelayMs = 1500;

function setBadge(el, text, cls) {
  if (!el) return;
  el.textContent = text;
  el.className = `badge ${cls}`;
}

function isWsReady() {
  return !!ws && ws.readyState === WebSocket.OPEN;
}

function updateControlsState() {
  const ready = isWsReady() && panelOnline;
  armButtons.forEach((btn) => {
    btn.disabled = !ready;
  });
  const zoneButtons = document.querySelectorAll('.zone-bypass-btn');
  zoneButtons.forEach((btn) => {
    btn.disabled = !ready;
  });
}

function handleUnauthorized(status) {
  if (status === 401) {
    window.location.href = '/login';
    return true;
  }
  return false;
}

async function loadSnapshot() {
  try {
    const res = await fetch('/snapshot');
    if (res.status === 401) {
      handleUnauthorized(res.status);
      return;
    }
    if (!res.ok) throw new Error('snapshot fetch failed');
    snapshot = await res.json();
    panelOnline = !!snapshot.panelOnline;
    renderPanelStatus();
    renderPartitions();
    renderZones();
  } catch (e) {
    console.error('[UI] Error loading snapshot', e);
  }
}

async function loadSystemInfo() {
  try {
    const res = await fetch('/api/system/info');
    if (res.status === 401) {
      handleUnauthorized(res.status);
      return;
    }
    if (!res.ok) throw new Error('system info failed');
    const data = await res.json();
    const info = data.info || {};
    if (gatewayMeta) {
      const hostIpState = info.hostIpSupported ? 'IP host: disponible' : 'IP host: no disponible';
      gatewayMeta.textContent = `Version ${info.appVersion || '?'} | Node ${info.nodeVersion || '?'} | ${hostIpState} | Uptime ${info.uptimeSeconds || 0}s`;
    }
  } catch (e) {
    console.error('[UI] Error loading system info', e);
    if (gatewayMeta) gatewayMeta.textContent = 'No se pudo cargar el diagnostico del gateway';
  }
}

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${proto}//${location.host}${window.WS_PATH || '/ws'}`;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  ws = new WebSocket(wsUrl);
  ws.onopen = () => {
    reconnectDelayMs = 1500;
    setBadge(wsStatusEl, 'WS conectado', 'badge ok');
    updateControlsState();
  };
  ws.onclose = (ev) => {
    setBadge(wsStatusEl, 'WS desconectado', 'badge bad');
    updateControlsState();
    if (ev.code === 1008) handleUnauthorized(401);
    if (ev.code !== 1008) scheduleReconnect();
  };
  ws.onerror = (ev) => {
    console.error('[UI] WS error', ev);
    setBadge(wsStatusEl, 'WS error', 'badge bad');
    updateControlsState();
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'snapshot') {
      panelOnline = !!msg.panelOnline;
      snapshot.partitions = msg.partitions;
      snapshot.zones = msg.zones;
      renderPanelStatus();
      renderPartitions();
      renderZones();
    } else if (msg.type === 'partition') {
      upsert(snapshot.partitions, msg.data, 'id');
      renderPartitions();
    } else if (msg.type === 'zone') {
      upsert(snapshot.zones, msg.data, 'id');
      renderZones();
    } else if (msg.type === 'panel') {
      panelOnline = !!msg.online;
      renderPanelStatus();
      updateControlsState();
    } else if (msg.type === 'ack') {
      const ok = !!msg.ok;
      const msgText = msg.message || (ok ? 'Accion ejecutada' : 'Accion rechazada');
      const title = msg.action === 'bypass' ? 'Bypass' : 'Armado';
      showToast(`${title}: ${msgText}`, ok ? 'ok' : 'bad');
    }
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  setBadge(wsStatusEl, `WS reconectando en ${Math.round(reconnectDelayMs / 1000)}s`, 'badge warn');
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWS();
  }, reconnectDelayMs);
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, 10000);
}

function upsert(arr, item, key) {
  const idx = arr.findIndex((x) => x[key] === item[key]);
  if (idx >= 0) arr[idx] = item; else arr.push(item);
}

function renderPartitions() {
  partitionTable.innerHTML = '';
  snapshot.partitions
    .sort((a, b) => a.id - b.id)
    .forEach((p) => {
      const tr = document.createElement('tr');
      let badgeCls = 'pill';
      switch (p.status) {
        case 'disarmed':
          badgeCls = 'pill closed';
          break;
        case 'armed_home':
          badgeCls = 'pill warn';
          break;
        case 'armed_away':
          badgeCls = 'pill open';
          break;
        case 'triggered':
          badgeCls = 'pill alarm';
          break;
        default:
          badgeCls = 'pill';
      }
      const readyBadge = p.ready === undefined ? '' :
        `<span class="pill ${p.ready ? 'closed' : 'warn'}" style="margin-left:6px">${p.ready ? 'Ready' : 'NotReady'}</span>`;
      tr.innerHTML = `<td>${p.id}</td><td><span class="${badgeCls}">${p.status}</span>${readyBadge}</td>`;
      partitionTable.appendChild(tr);
    });
  updateControlsState();
}

function renderZones() {
  const text = zoneFilter.value.toLowerCase().trim();
  const filtered = snapshot.zones.filter((z) => {
    if (!text) return true;
    return `${z.id}`.includes(text) || (z.label || '').toLowerCase().includes(text);
  }).sort((a, b) => a.id - b.id);
  zoneTable.innerHTML = '';
  filtered.forEach((z) => {
    const openCls = z.open ? 'pill open' : 'pill closed';
    const bypassCls = z.bypass ? 'pill bypass' : 'pill closed';
    const tr = document.createElement('tr');
    const btn = document.createElement('button');
    btn.textContent = z.bypass ? 'Quitar bypass' : 'Aplicar bypass';
    btn.className = 'arm-btn zone-bypass-btn';
    btn.disabled = !isWsReady() || !panelOnline;
    btn.addEventListener('click', () => {
      if (!isWsReady()) return;
      ws.send(JSON.stringify({ type: 'bypass', zoneId: z.id }));
    });
    tr.innerHTML = `<td>${z.id}</td><td>${z.label || ''}</td>
      <td><span class="${openCls}">${z.open ? 'Abierta' : 'Cerrada'}</span></td>
      <td><span class="${bypassCls}">${z.bypass ? 'Bypass' : 'Normal'}</span></td>
      <td class="btn-cell"></td>`;
    tr.querySelector('.btn-cell').appendChild(btn);
    zoneTable.appendChild(tr);
  });
  zonesCount.textContent = `${filtered.length} zonas mostradas / ${snapshot.zones.length} total`;
  updateControlsState();
}

function renderPanelStatus() {
  if (panelOnline) setBadge(panelOnlineEl, 'Panel online', 'badge accent');
  else setBadge(panelOnlineEl, 'Panel offline', 'badge bad');
  updateControlsState();
}

armButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!isWsReady()) return;
    const partitionId = Number(partitionInput.value);
    const mode = btn.dataset.mode;
    ws.send(JSON.stringify({ type: 'arm', partitionId, mode }));
  });
});

zoneFilter.addEventListener('input', renderZones);

if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (_) { /* ignore */ }
    window.location.href = '/login';
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  setBadge(wsStatusEl, 'WS conectando...', 'badge warn');
  setBadge(panelOnlineEl, 'Panel offline', 'badge bad');
  updateControlsState();
  await loadSnapshot();
  await loadSystemInfo();
  connectWS();
});

function showToast(text, variant = 'ok') {
  if (!toastContainer) return;
  const el = document.createElement('div');
  el.className = `toast ${variant}`;
  el.textContent = text;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.classList.add('hide');
    setTimeout(() => el.remove(), 300);
  }, 2500);
}

