const wsStatusEl = document.getElementById('debug-ws-status');
const panelStatusEl = document.getElementById('debug-panel-status');
const logoutBtn = document.getElementById('debug-logout-btn');
const debugMeta = document.getElementById('debug-meta');
const debugConfigMeta = document.getElementById('debug-config-meta');
const actionMsg = document.getElementById('debug-action-msg');
const previewTable = document.querySelector('#preview-table tbody');
const resultTable = document.querySelector('#result-table tbody');
const resultSummary = document.getElementById('debug-result-summary');
const logStream = document.getElementById('log-stream');
const logFilter = document.getElementById('log-filter');
const logAutoScroll = document.getElementById('log-autoscroll');
const strategySelect = document.getElementById('debug-strategy');

let ws;
let panelOnline = false;
let reconnectTimer = null;
let reconnectDelayMs = 2000;
let logs = [];

function setBadge(el, text, cls) {
  if (!el) return;
  el.textContent = text;
  el.className = `badge ${cls}`;
}

function setActionMessage(msg, ok = true) {
  if (!actionMsg) return;
  actionMsg.textContent = msg;
  actionMsg.style.color = ok ? '#94a3b8' : '#fca5a5';
}

function handleUnauthorized(status) {
  if (status === 401) {
    window.location.href = '/login';
    return true;
  }
  return false;
}

function getDebugPayload(includeStrategy = true) {
  const partitionId = Number(document.getElementById('debug-partition-id').value);
  const mode = document.getElementById('debug-mode').value;
  const payload = { partitionId, mode };
  if (includeStrategy) {
    const strategy = strategySelect.value;
    if (strategy) payload.strategy = strategy;
  }
  return payload;
}

function renderPreview(attempts = []) {
  previewTable.innerHTML = '';
  attempts.forEach((attempt) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${attempt.strategy}</td><td><code>${attempt.rawCommand}</code></td>`;
    previewTable.appendChild(tr);
  });
}

function renderResult(result) {
  resultTable.innerHTML = '';
  if (!result) {
    resultSummary.textContent = 'Sin pruebas ejecutadas.';
    return;
  }
  const final = result.finalState || {};
  resultSummary.textContent =
    `Resultado=${result.success ? 'OK' : 'FALLO'} | ` +
    `Arm=${!!final.arm} | HomeStay=${!!final.homeStay} | Ready=${!!final.ready} | Open=${!!final.open} | Alarm=${!!final.alarm}`;

  (result.attempts || []).forEach((attempt) => {
    const tr = document.createElement('tr');
    const state = attempt.success
      ? 'OK'
      : attempt.stateConfirmed
        ? 'Estado confirmado'
        : attempt.timeout
          ? 'Timeout'
          : attempt.errorCode || attempt.errorMessage || 'Sin confirmar';
    tr.innerHTML = `
      <td>${attempt.strategy}</td>
      <td><code>${attempt.rawCommand}</code></td>
      <td>${attempt.response || attempt.errorCode || attempt.errorMessage || '-'}</td>
      <td><span class="pill ${attempt.success ? 'closed' : 'warn'}">${state}</span></td>
    `;
    resultTable.appendChild(tr);
  });
}

function formatLogEntry(entry) {
  return `[${entry.ts}] [${entry.level}] [${entry.source}] ${entry.message}`;
}

function renderLogs() {
  const filter = (logFilter.value || '').toLowerCase().trim();
  const visible = logs.filter((entry) => {
    if (!filter) return true;
    return formatLogEntry(entry).toLowerCase().includes(filter);
  });

  logStream.innerHTML = '';
  visible.forEach((entry) => {
    const line = document.createElement('div');
    line.className = `log-line level-${entry.level}`;
    line.textContent = formatLogEntry(entry);
    logStream.appendChild(line);
  });

  if (logAutoScroll.checked) {
    logStream.scrollTop = logStream.scrollHeight;
  }
}

function addLog(entry) {
  logs.push(entry);
  if (logs.length > 500) logs = logs.slice(-500);
  renderLogs();
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connectWS();
  }, reconnectDelayMs);
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, 10000);
}

function connectWS() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws`);

  ws.onopen = () => {
    reconnectDelayMs = 2000;
    setBadge(wsStatusEl, 'WS conectado', 'badge ok');
  };

  ws.onclose = (ev) => {
    setBadge(wsStatusEl, 'WS desconectado', 'badge bad');
    if (ev.code === 1008) {
      handleUnauthorized(401);
      return;
    }
    scheduleReconnect();
  };

  ws.onerror = () => {
    setBadge(wsStatusEl, 'WS error', 'badge bad');
  };

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'snapshot') {
        panelOnline = !!msg.panelOnline;
        setBadge(panelStatusEl, panelOnline ? 'Panel online' : 'Panel offline', panelOnline ? 'badge accent' : 'badge bad');
      } else if (msg.type === 'panel') {
        panelOnline = !!msg.online;
        setBadge(panelStatusEl, panelOnline ? 'Panel online' : 'Panel offline', panelOnline ? 'badge accent' : 'badge bad');
      } else if (msg.type === 'log' && msg.data) {
        addLog(msg.data);
      }
    } catch (error) {
      console.error('[DEBUG UI] WS parse failed', error);
    }
  };
}

async function loadSystemInfo() {
  const res = await fetch('/api/system/info');
  if (handleUnauthorized(res.status)) return;
  if (!res.ok) throw new Error('system_info_failed');
  const { info } = await res.json();
  debugMeta.textContent =
    `Version ${info.appVersion || 'unknown'} | ${info.platform || 'unknown'} | ${info.nodeVersion || 'node'} | ` +
    `modo ${info.serviceMode || 'standalone'} | uptime ${Math.floor(info.uptimeSeconds || 0)} s`;
}

async function loadCapabilities() {
  const res = await fetch('/api/debug/capabilities');
  if (handleUnauthorized(res.status)) return;
  if (!res.ok) throw new Error('debug_capabilities_failed');
  const data = await res.json();
  strategySelect.innerHTML = '<option value="">current_config</option>';
  (data.strategies || []).forEach((strategy) => {
    const opt = document.createElement('option');
    opt.value = strategy;
    opt.textContent = strategy;
    strategySelect.appendChild(opt);
  });
  const cfg = data.partitionCommandConfig || {};
  const probeOrder = Array.isArray(cfg.probeOrder) ? cfg.probeOrder.join(',') : '';
  debugConfigMeta.textContent =
    `Modo actual=${cfg.mode || 'fixed'} | estrategia fija=${cfg.strategy || '-'} | probe=${probeOrder || '-'}`;
}

async function loadLogs() {
  const res = await fetch('/api/debug/logs');
  if (handleUnauthorized(res.status)) return;
  if (!res.ok) throw new Error('debug_logs_failed');
  const data = await res.json();
  logs = data.logs || [];
  renderLogs();
}

async function previewCommands() {
  try {
    setActionMessage('Generando vista previa...', true);
    const res = await fetch('/api/debug/partition/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getDebugPayload(false)),
    });
    if (handleUnauthorized(res.status)) return;
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'preview_failed');
    renderPreview(data.attempts || []);
    setActionMessage('Vista previa generada.', true);
  } catch (error) {
    console.error(error);
    setActionMessage(`No se pudo generar la vista previa: ${error.message}`, false);
  }
}

async function executeStrategyTest() {
  try {
    setActionMessage('Ejecutando prueba por estrategia...', true);
    const res = await fetch('/api/debug/partition/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getDebugPayload(true)),
    });
    if (handleUnauthorized(res.status)) return;
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'execute_failed');
    renderResult(data.result);
    setActionMessage(data.result?.success ? 'Prueba completada con exito.' : 'Prueba completada sin confirmar exito.', data.result?.success);
  } catch (error) {
    console.error(error);
    setActionMessage(`No se pudo ejecutar la prueba: ${error.message}`, false);
  }
}

async function executeRawTest() {
  try {
    const rawCommand = document.getElementById('debug-raw-command').value.trim();
    if (!rawCommand) {
      setActionMessage('Debes escribir una trama manual.', false);
      return;
    }
    setActionMessage('Enviando trama manual...', true);
    const payload = getDebugPayload(false);
    payload.rawCommand = rawCommand;
    const res = await fetch('/api/debug/partition/raw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (handleUnauthorized(res.status)) return;
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'raw_execute_failed');
    renderResult(data.result);
    setActionMessage(data.result?.success ? 'Trama manual confirmada.' : 'Trama manual enviada sin confirmar exito.', data.result?.success);
  } catch (error) {
    console.error(error);
    setActionMessage(`No se pudo enviar la trama manual: ${error.message}`, false);
  }
}

document.getElementById('preview-command-btn')?.addEventListener('click', previewCommands);
document.getElementById('test-strategy-btn')?.addEventListener('click', executeStrategyTest);
document.getElementById('test-raw-btn')?.addEventListener('click', executeRawTest);
document.getElementById('clear-log-view')?.addEventListener('click', () => {
  logs = [];
  renderLogs();
});
logFilter?.addEventListener('input', renderLogs);

if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (_) {
      // ignore
    }
    window.location.href = '/login';
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  setBadge(wsStatusEl, 'WS conectando...', 'badge warn');
  setBadge(panelStatusEl, 'Panel offline', 'badge bad');
  try {
    await Promise.all([loadSystemInfo(), loadCapabilities(), loadLogs()]);
  } catch (error) {
    console.error(error);
    setActionMessage(`Error cargando diagnostico: ${error.message}`, false);
  }
  connectWS();
});
