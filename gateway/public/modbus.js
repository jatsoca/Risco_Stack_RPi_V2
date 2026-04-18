const statusEl = document.getElementById('modbus-status');
const mapBody = document.querySelector('#modbus-map tbody');
const partBody = document.querySelector('#modbus-partitions tbody');
const zoneBody = document.querySelector('#modbus-zones tbody');
const zoneFilter = document.getElementById('zone-filter');
const logoutBtn = document.getElementById('logout-btn');
let lastData = null;

function handleUnauthorized(res) {
  if (res && res.status === 401) {
    window.location.href = '/login';
    return true;
  }
  return false;
}

function pill(text, ok) {
  return `<span class="pill ${ok ? 'closed' : 'open'}">${text}</span>`;
}

function render(data) {
  statusEl.textContent = `Estado: ${data.enabled ? 'habilitado' : 'deshabilitado'} | Host ${data.host}:${data.port}`;
  mapBody.innerHTML = [
    ...(data.map?.holdingRegisters || []).map((m) => `<tr><td>Holding Register</td><td>${m.range}</td><td>${m.values}</td></tr>`),
    ...(data.map?.discreteInputs || []).map((m) => `<tr><td>Discrete Input</td><td>${m.range}</td><td>${m.values}</td></tr>`),
  ].join('');
  partBody.innerHTML = (data.current?.partitions || []).map((p) => `
    <tr><td>${p.register}</td><td>${p.id}</td><td>${p.value}</td><td>${p.status}</td><td>${p.ready}</td></tr>
  `).join('');
  const filter = (zoneFilter.value || '').toLowerCase();
  zoneBody.innerHTML = (data.current?.zones || [])
    .filter((z) => !filter || `${z.id}`.includes(filter) || (z.label || '').toLowerCase().includes(filter))
    .map((z) => `
      <tr><td>${z.register}</td><td>${z.id}</td><td>${z.value}</td><td>${pill(z.open ? 'Si' : 'No', !z.open)}</td><td>${pill(z.bypass ? 'Si' : 'No', !z.bypass)}</td><td>${z.label || ''}</td></tr>
    `).join('');
}

async function load() {
  const res = await fetch('/api/protocols/modbus');
  if (handleUnauthorized(res)) return;
  lastData = await res.json();
  render(lastData);
}

zoneFilter?.addEventListener('input', () => lastData && render(lastData));
logoutBtn?.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
  window.location.href = '/login';
});
window.addEventListener('DOMContentLoaded', () => {
  load();
  setInterval(load, 5000);
});
