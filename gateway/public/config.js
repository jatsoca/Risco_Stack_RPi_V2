const statusMsg = document.getElementById('status-msg');
const passMsg = document.getElementById('pass-msg');
const logoutBtn = document.getElementById('logout-btn');
const platformMsg = document.getElementById('platform-msg');
const serviceMsg = document.getElementById('service-msg');
const saveBtn = document.getElementById('save-btn');
const saveRestartBtn = document.getElementById('save-restart-btn');
const restartBtn = document.getElementById('restart-btn');
const factoryBtn = document.getElementById('factory-btn');
const applyHostIpBtn = document.getElementById('apply-host-ip');
const changePassBtn = document.getElementById('change-pass-btn');

const setStatus = (msg, ok = true) => {
  if (!statusMsg) return;
  statusMsg.textContent = msg;
  statusMsg.style.color = ok ? '#94a3b8' : '#fca5a5';
};
const setPassStatus = (msg, ok = true) => {
  if (!passMsg) return;
  passMsg.textContent = msg;
  passMsg.style.color = ok ? '#94a3b8' : '#fca5a5';
};

const setBusy = (busy) => {
  [saveBtn, saveRestartBtn, restartBtn, factoryBtn, applyHostIpBtn, changePassBtn]
    .filter(Boolean)
    .forEach((el) => { el.disabled = busy; });
};

const handleUnauthorized = (res) => {
  if (res && res.status === 401) {
    window.location.href = '/login';
    return true;
  }
  return false;
};

const fillConfig = (cfg) => {
  document.getElementById('panelIp').value = cfg.panel?.panelIp || '';
  document.getElementById('panelPort').value = cfg.panel?.panelPort || '';
  const maskedPanelPass = cfg.panel?.panelPassword === '***' ? '' : (cfg.panel?.panelPassword || '');
  document.getElementById('panelPassword').value = maskedPanelPass;
  document.getElementById('panelId').value = cfg.panel?.panelId || '';
  document.getElementById('socketMode').value = cfg.panel?.socketMode || 'direct';
  document.getElementById('watchDogInterval').value = cfg.panel?.watchDogInterval || 5000;
  document.getElementById('commandsLog').checked = !!cfg.panel?.commandsLog;
  document.getElementById('partitionCommandMode').value = cfg.panel?.partitionCommandMode || 'fixed';
  document.getElementById('partitionCommandStrategy').value = cfg.panel?.partitionCommandStrategy || 'p_suffix_equals_plain';
  document.getElementById('partitionCommandProbeOrder').value = Array.isArray(cfg.panel?.partitionCommandProbeOrder)
    ? cfg.panel.partitionCommandProbeOrder.join(',')
    : (cfg.panel?.partitionCommandProbeOrder || 'p_suffix_equals_plain');
  document.getElementById('webEnable').checked = cfg.web?.enable !== false;
  document.getElementById('webPort').value = cfg.web?.http_port || '';
  document.getElementById('wsPath').value = cfg.web?.ws_path || '';
  document.getElementById('modbusEnable').checked = cfg.modbus?.enable !== false;
  document.getElementById('modbusHost').value = cfg.modbus?.host || '';
  document.getElementById('modbusPort').value = cfg.modbus?.port || '';
  document.getElementById('logLevel').value = cfg.log || 'info';
  document.getElementById('logColorize').checked = !!cfg.logColorize;
  document.getElementById('heartbeatMs').value = cfg.heartbeat_interval_ms ?? 0;
  document.getElementById('hostInterfaceAlias').value = cfg.hostNetwork?.interfaceAlias || '';
};

const fillSystemInfo = (info) => {
  if (platformMsg) {
    platformMsg.textContent = `Version: ${info.appVersion} | Plataforma: ${info.platform} | Node: ${info.nodeVersion} | Data dir: ${info.dataDir}`;
  }
  if (serviceMsg) {
    const hostIpState = info.hostIpSupported ? 'Cambio de IP del host disponible' : 'Cambio de IP del host no disponible';
    serviceMsg.textContent = `Modo de servicio: ${info.serviceMode} | Supervisado: ${info.supervised ? 'si' : 'no'} | Uptime: ${Math.floor(info.uptimeSeconds || 0)} s | ${hostIpState}`;
  }
  if (applyHostIpBtn && !info.hostIpSupported) {
    applyHostIpBtn.disabled = true;
  }
};

const loadConfig = async () => {
  try {
    const res = await fetch('/api/config');
    if (handleUnauthorized(res)) return;
    if (!res.ok) throw new Error('config_fetch_failed');
    const data = await res.json();
    fillConfig(data.config || {});
    setStatus('Config cargada', true);
  } catch (e) {
    console.error(e);
    setStatus('No se pudo cargar la configuracion', false);
  }
};

const loadSystemInfo = async () => {
  try {
    const res = await fetch('/api/system/info');
    if (handleUnauthorized(res)) return;
    if (!res.ok) throw new Error('system_info_failed');
    const data = await res.json();
    fillSystemInfo(data.info || {});
  } catch (e) {
    console.error(e);
    if (platformMsg) platformMsg.textContent = 'No se pudo obtener informacion del runtime';
  }
};

const gatherConfig = () => ({
  panel: {
    panelIp: document.getElementById('panelIp').value,
    panelPort: Number(document.getElementById('panelPort').value),
    panelPassword: document.getElementById('panelPassword').value,
    panelId: document.getElementById('panelId').value,
    socketMode: document.getElementById('socketMode').value,
    watchDogInterval: Number(document.getElementById('watchDogInterval').value || 5000),
    commandsLog: document.getElementById('commandsLog').checked,
    partitionCommandMode: document.getElementById('partitionCommandMode').value,
    partitionCommandStrategy: document.getElementById('partitionCommandStrategy').value,
    partitionCommandProbeOrder: document.getElementById('partitionCommandProbeOrder').value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  },
  web: {
    enable: document.getElementById('webEnable').checked,
    http_port: Number(document.getElementById('webPort').value),
    ws_path: document.getElementById('wsPath').value,
  },
  modbus: {
    enable: document.getElementById('modbusEnable').checked,
    host: document.getElementById('modbusHost').value,
    port: Number(document.getElementById('modbusPort').value),
  },
  hostNetwork: {
    interfaceAlias: document.getElementById('hostInterfaceAlias').value,
  },
  log: document.getElementById('logLevel').value,
  logColorize: document.getElementById('logColorize').checked,
  heartbeat_interval_ms: Number(document.getElementById('heartbeatMs').value || 0),
});

const saveConfig = async (restartAfter = false) => {
  try {
    setBusy(true);
    setStatus('Guardando...', true);
    const payload = gatherConfig();
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (handleUnauthorized(res)) return;
    if (!res.ok) throw new Error('save_failed');
    setStatus(restartAfter ? 'Guardado. Reiniciando...' : 'Config guardada (reinicia para aplicar).', true);
    if (restartAfter) {
      await restartService();
    }
  } catch (e) {
    console.error(e);
    setStatus('No se pudo guardar la config', false);
  } finally {
    setBusy(false);
  }
};

const applyHostIp = async () => {
  const ip = document.getElementById('hostIp').value;
  const cidr = document.getElementById('hostCidr').value;
  const gateway = document.getElementById('hostGw').value;
  const interfaceAlias = document.getElementById('hostInterfaceAlias').value;
  if (!ip || !cidr || !gateway) {
    setStatus('Completa IP/CIDR/Gateway', false);
    return;
  }
  try {
    setBusy(true);
    setStatus('Aplicando IP del gateway...', true);
    const res = await fetch('/api/host/ip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, cidr, gateway, interfaceAlias }),
    });
    if (handleUnauthorized(res)) return;
    if (res.status === 501) {
      setStatus('Cambio de IP no soportado en este entorno (falta script en host)', false);
      return;
    }
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setStatus(data.error || 'No se pudo aplicar la IP', false);
      return;
    }
    setStatus('IP aplicada. Reiniciando servicio...', true);
    setTimeout(() => window.location.reload(), 1500);
  } catch (e) {
    console.error(e);
    setStatus('No se pudo aplicar la IP del gateway', false);
  } finally {
    setBusy(false);
  }
};

const restartService = async () => {
  try {
    setBusy(true);
    const res = await fetch('/api/restart', { method: 'POST' });
    if (handleUnauthorized(res)) return;
    if (!res.ok) throw new Error('restart_failed');
    setStatus('Reiniciando servicio...', true);
    setTimeout(() => window.location.reload(), 1500);
  } catch (e) {
    console.error(e);
    setStatus('No se pudo reiniciar el servicio', false);
  } finally {
    setBusy(false);
  }
};

const factoryReset = async () => {
  const sure = confirm('Esto restablece config y usuario admin (Admin123). Continuar?');
  if (!sure) return;
  try {
    setBusy(true);
    const res = await fetch('/api/factory-reset', { method: 'POST' });
    if (handleUnauthorized(res)) return;
    if (!res.ok) throw new Error('factory_failed');
    setStatus('Restablecido. Reiniciando...', true);
    setTimeout(() => window.location.href = '/login', 1500);
  } catch (e) {
    console.error(e);
    setStatus('No se pudo restablecer a fabrica', false);
  } finally {
    setBusy(false);
  }
};

const changePassword = async () => {
  const current = document.getElementById('currentPassword').value;
  const next = document.getElementById('newPassword').value;
  const confirm = document.getElementById('confirmPassword').value;
  if (next !== confirm) {
    setPassStatus('Las contrasenas no coinciden', false);
    return;
  }
  try {
    setBusy(true);
    const res = await fetch('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    });
    if (handleUnauthorized(res)) return;
    if (res.status === 401) {
      setPassStatus('Contrasena actual no valida', false);
      return;
    }
    if (!res.ok) throw new Error('pass_failed');
    setPassStatus('Contrasena actualizada', true);
    document.getElementById('currentPassword').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';
  } catch (e) {
    console.error(e);
    setPassStatus('No se pudo actualizar la contrasena', false);
  } finally {
    setBusy(false);
  }
};

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

const form = document.getElementById('config-form');
if (form) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    saveConfig(false);
  });
}

document.getElementById('save-restart-btn')?.addEventListener('click', (e) => {
  e.preventDefault();
  saveConfig(true);
});
document.getElementById('restart-btn')?.addEventListener('click', (e) => {
  e.preventDefault();
  restartService();
});
document.getElementById('factory-btn')?.addEventListener('click', (e) => {
  e.preventDefault();
  factoryReset();
});
document.getElementById('change-pass-btn')?.addEventListener('click', (e) => {
  e.preventDefault();
  changePassword();
});
document.getElementById('apply-host-ip')?.addEventListener('click', (e) => {
  e.preventDefault();
  applyHostIp();
});

window.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  loadSystemInfo();
});
