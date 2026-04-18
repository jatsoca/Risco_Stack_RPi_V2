const msgEl = document.getElementById('bacnet-msg');
const statusEl = document.getElementById('bacnet-status');
const mapBody = document.querySelector('#bacnet-map tbody');
const partBody = document.querySelector('#bacnet-partitions tbody');
const zoneBody = document.querySelector('#bacnet-zones tbody');
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

function setMsg(text, ok = true) {
  msgEl.textContent = text;
  msgEl.style.color = ok ? '#94a3b8' : '#fca5a5';
}

function fillForm(cfg) {
  const b = cfg.bacnet || {};
  document.getElementById('bacnetEnable').checked = !!b.enable;
  document.getElementById('bacnetPort').value = b.port || 47808;
  document.getElementById('bacnetInterface').value = b.interface || '0.0.0.0';
  document.getElementById('bacnetBroadcast').value = b.broadcastAddress || '255.255.255.255';
  document.getElementById('bacnetDeviceId').value = b.deviceId || 432001;
  document.getElementById('bacnetDeviceName').value = b.deviceName || 'Risco Gateway BACnet';
  document.getElementById('bacnetVendorId').value = b.vendorId || 999;
  document.getElementById('bacnetApduTimeout').value = b.apduTimeout || 3000;
  document.getElementById('bacnetAllowWrite').checked = !!b.allowWrite;
}

function gather() {
  return {
    bacnet: {
      enable: document.getElementById('bacnetEnable').checked,
      port: Number(document.getElementById('bacnetPort').value || 47808),
      interface: document.getElementById('bacnetInterface').value,
      broadcastAddress: document.getElementById('bacnetBroadcast').value,
      deviceId: Number(document.getElementById('bacnetDeviceId').value || 432001),
      deviceName: document.getElementById('bacnetDeviceName').value,
      vendorId: Number(document.getElementById('bacnetVendorId').value || 999),
      apduTimeout: Number(document.getElementById('bacnetApduTimeout').value || 3000),
      allowWrite: document.getElementById('bacnetAllowWrite').checked,
    },
  };
}

async function loadConfig() {
  const res = await fetch('/api/config');
  if (handleUnauthorized(res)) return;
  const data = await res.json();
  fillForm(data.config || {});
}

function render(data) {
  const s = data.status || {};
  statusEl.textContent = `Enabled=${!!s.enabled} | Running=${!!s.running} | ${s.interface}:${s.port} | Device ${s.deviceId} ${s.deviceName} | Writes=${s.allowWrite ? 'habilitados' : 'bloqueados'}${s.lastError ? ` | Error: ${s.lastError}` : ''}`;
  mapBody.innerHTML = [
    `<tr><td>Device</td><td>${data.map?.device?.instance}</td><td>${data.map?.device?.name}</td></tr>`,
    `<tr><td>Analog Value</td><td>AV 1-32</td><td>${data.map?.analogValues?.partitions || ''}</td></tr>`,
    `<tr><td>Analog Value</td><td>AV 33-544</td><td>${data.map?.analogValues?.zones || ''}</td></tr>`,
    `<tr><td>Binary Value</td><td>BV 1-32</td><td>${data.map?.binaryValues?.partitions || ''}</td></tr>`,
    `<tr><td>Binary Value</td><td>BV 33-544</td><td>${data.map?.binaryValues?.zones || ''}</td></tr>`,
  ].join('');
  partBody.innerHTML = (data.current?.partitions || []).map((p) => `
    <tr><td>${p.object}</td><td>${p.id}</td><td>${p.value}</td><td>${p.status}</td><td>${p.ready}</td></tr>
  `).join('');
  const filter = (zoneFilter.value || '').toLowerCase();
  zoneBody.innerHTML = (data.current?.zones || [])
    .filter((z) => !filter || `${z.id}`.includes(filter) || (z.label || '').toLowerCase().includes(filter))
    .map((z) => `
      <tr><td>${z.object}</td><td>${z.id}</td><td>${z.value}</td><td>${z.open ? 'Si' : 'No'}</td><td>${z.bypass ? 'Si' : 'No'}</td><td>${z.label || ''}</td></tr>
    `).join('');
}

async function loadStatus() {
  const res = await fetch('/api/protocols/bacnet');
  if (handleUnauthorized(res)) return;
  lastData = await res.json();
  render(lastData);
}

async function save(restart = false) {
  setMsg('Guardando...', true);
  const res = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(gather()),
  });
  if (handleUnauthorized(res)) return;
  if (!res.ok) {
    setMsg('No se pudo guardar BACnet', false);
    return;
  }
  if (restart) {
    await fetch('/api/restart', { method: 'POST' });
    setMsg('Guardado. Reiniciando...', true);
    setTimeout(() => window.location.reload(), 2000);
  } else {
    setMsg('BACnet guardado. Reinicia para aplicar cambios.', true);
  }
}

document.getElementById('save-bacnet')?.addEventListener('click', () => save(false));
document.getElementById('save-restart-bacnet')?.addEventListener('click', () => save(true));
zoneFilter?.addEventListener('input', () => lastData && render(lastData));
logoutBtn?.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
  window.location.href = '/login';
});
window.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  loadStatus();
  setInterval(loadStatus, 5000);
});
