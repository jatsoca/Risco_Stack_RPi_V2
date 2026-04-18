const metricsEl = document.getElementById('diagnostic-metrics');
const panelsBody = document.querySelector('#supported-panels-table tbody');
const eventsEl = document.getElementById('recent-events');
const logoutBtn = document.getElementById('logout-btn');

function handleUnauthorized(res) {
  if (res && res.status === 401) {
    window.location.href = '/login';
    return true;
  }
  return false;
}

function metric(title, value, hint, cls = '') {
  return `<div class="metric-card ${cls}"><span>${title}</span><strong>${value}</strong><small>${hint || ''}</small></div>`;
}

function setBar(id, value, total) {
  const el = document.getElementById(id);
  if (!el) return;
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  el.style.width = `${pct}%`;
}

async function loadDiagnostics() {
  const res = await fetch('/api/diagnostics');
  if (handleUnauthorized(res)) return;
  const data = await res.json();
  const c = data.counts || {};
  const counters = data.counters || {};
  metricsEl.innerHTML = [
    metric('Panel', data.panelOnline ? 'Online' : 'Offline', 'Estado de comunicacion', data.panelOnline ? 'good-card' : 'bad-card'),
    metric('Uptime', `${data.uptimeSeconds || 0}s`, `Inicio: ${data.startedAt || '-'}`),
    metric('Particiones', c.partitions || 0, `${c.armedPartitions || 0} armadas / ${c.readyPartitions || 0} ready`),
    metric('Zonas', c.zones || 0, `${c.openZones || 0} abiertas / ${c.bypassedZones || 0} bypass`),
    metric('Comandos', counters.armCommands || 0, `${counters.bypassCommands || 0} bypass`),
    metric('Protocolos BMS', `MB ${data.modbus?.enable ? 'ON' : 'OFF'} / BAC ${data.bacnet?.enabled ? 'ON' : 'OFF'}`, `BACnet running: ${data.bacnet?.running ? 'si' : 'no'}`),
  ].join('');

  setBar('bar-open-zones', c.openZones || 0, c.zones || 0);
  setBar('bar-bypass-zones', c.bypassedZones || 0, c.zones || 0);
  setBar('bar-armed-parts', c.armedPartitions || 0, c.partitions || 0);
  setBar('bar-ready-parts', c.readyPartitions || 0, c.partitions || 0);
  document.getElementById('open-zones-value').textContent = c.openZones || 0;
  document.getElementById('bypass-zones-value').textContent = c.bypassedZones || 0;
  document.getElementById('armed-parts-value').textContent = c.armedPartitions || 0;
  document.getElementById('ready-parts-value').textContent = c.readyPartitions || 0;

  eventsEl.innerHTML = (data.recentEvents || []).slice().reverse().map((ev) => (
    `<div class="log-line">[${ev.ts}] [${ev.type}] ${ev.message}</div>`
  )).join('') || '<div class="muted">Sin eventos recientes.</div>';
}

async function loadSupportedPanels() {
  const res = await fetch('/api/supported-panels');
  if (handleUnauthorized(res)) return;
  const data = await res.json();
  panelsBody.innerHTML = (data.panels || []).map((p) => `
    <tr><td>${p.code}</td><td>${p.model}</td><td>${p.maxZones}</td><td>${p.maxPartitions}</td><td>${p.maxOutputs}</td></tr>
  `).join('');
}

logoutBtn?.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
  window.location.href = '/login';
});

window.addEventListener('DOMContentLoaded', () => {
  loadDiagnostics();
  loadSupportedPanels();
  setInterval(loadDiagnostics, 5000);
});
