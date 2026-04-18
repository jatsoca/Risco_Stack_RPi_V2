// Jaime Acosta github: jatsoca
import express from 'express';
import { Server as HttpServer } from 'http';
import { WebSocketServer } from 'ws';
import * as Modbus from 'jsmodbus';
import net from 'net';
import path from 'path';
import fs from 'fs';
import { promises as fsp } from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import {
  ensureRuntimeDirectories,
  getPlatformInfo,
  getRuntimePaths,
  requestManagedRestart,
  scheduleHostIpChange,
} from '../lib/runtime';
import {
  BacnetOptions,
  buildBacnetMapSummary,
  encodePartitionValue,
  encodeZoneValue,
  normalizeBacnetOptions,
  startBacnetServer,
} from '../lib/bacnet';

type PartitionState = { id: number; status: string; ready?: boolean };
type ZoneState = { id: number; open: boolean; bypass: boolean; label: string };
type PanelState = { online: boolean };
export type DebugLogEntry = {
  id: number;
  ts: string;
  level: string;
  source: string;
  message: string;
};

export interface WebDebugTools {
  getLogs: () => DebugLogEntry[];
  getAvailableStrategies: () => string[];
  getPartitionCommandConfig: () => {
    mode?: string;
    strategy?: string;
    probeOrder?: string[];
  };
  previewPartitionCommands: (partitionId: number, mode: 'away' | 'home' | 'disarm') => Array<{
    strategy: string;
    rawCommand: string;
  }>;
  executePartitionCommand: (
    partitionId: number,
    mode: 'away' | 'home' | 'disarm',
    strategy?: string,
  ) => Promise<any>;
  executeRawPartitionCommand: (
    partitionId: number,
    mode: 'away' | 'home' | 'disarm',
    rawCommand: string,
  ) => Promise<any>;
}

export interface WebOptions {
  http_port: number;
  ws_path: string;
}
export interface ModbusOptions {
  enable: boolean;
  port: number;
  host: string;
}

export interface RealtimeState {
  partitions: Map<number, PartitionState>;
  zones: Map<number, ZoneState>;
  panel?: PanelState;
}

type Session = { username: string; exp: number };

const runtimePaths = getRuntimePaths();
const DATA_DIR = runtimePaths.dataDir;
const CONFIG_PATH = runtimePaths.configPath;
const DEFAULT_CONFIG_PATH = runtimePaths.defaultConfigPath;
const USERS_FILE = runtimePaths.usersFile;
const AUTH_COOKIE = 'risco_auth';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const sessions = new Map<string, Session>();

const allowedLogLevels = ['error', 'warn', 'info', 'verbose', 'debug'];
const allowedSocketModes = ['direct', 'proxy'];
const allowedPartitionCommandModes = ['fixed', 'probe'];
const allowedPartitionCommandStrategies = [
  'p_suffix_equals_plain',
];

const SUPPORTED_PANELS = [
  { code: 'RW032', model: 'Agility 4', maxZones: 32, maxPartitions: 3, maxOutputs: 4 },
  { code: 'RW132', model: 'Agility', maxZones: 36, maxPartitions: 3, maxOutputs: 4 },
  { code: 'RW232', model: 'WiComm', maxZones: 36, maxPartitions: 3, maxOutputs: 4 },
  { code: 'RW332', model: 'WiCommPro', maxZones: 36, maxPartitions: 3, maxOutputs: 4 },
  { code: 'RP432', model: 'LightSYS', maxZones: '32/50 segun firmware', maxPartitions: 4, maxOutputs: '14/32 segun firmware' },
  { code: 'RP432MP', model: 'LightSYS Plus', maxZones: 128, maxPartitions: 32, maxOutputs: 262 },
  { code: 'RP512', model: 'ProSYS Plus / GT Plus', maxZones: '64/128 segun firmware', maxPartitions: 32, maxOutputs: 262 },
];

type ProtocolEvent = {
  id: number;
  ts: string;
  type: string;
  message: string;
  detail?: any;
};

const parseCookies = (cookieHeader?: string) => {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    if (parts.length >= 2) {
      const key = parts.shift()?.trim() || '';
      const value = decodeURIComponent(parts.join('=')).trim();
      if (key) list[key] = value;
    }
  });
  return list;
};

const getTokenFromRequest = (req: express.Request | { headers: any }) => {
  const cookieHeader = (req as any).headers?.cookie as string | undefined;
  const cookies = parseCookies(cookieHeader);
  return cookies[AUTH_COOKIE];
};

const setSessionCookie = (res: express.Response, token: string) => {
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`);
};

const clearSessionCookie = (res: express.Response) => {
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
};

const setNoCacheHeaders = (res: express.Response) => {
  res.setHeader('Cache-Control', 'no-store');
};

const validateSession = (token?: string) => {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.exp < Date.now()) {
    sessions.delete(token);
    return null;
  }
  session.exp = Date.now() + SESSION_TTL_MS;
  sessions.set(token, session);
  return session.username;
};

const ensureDir = async (dir: string) => {
  await fsp.mkdir(dir, { recursive: true });
};

const ensureConfigFile = async () => {
  ensureRuntimeDirectories();
  if (!fs.existsSync(CONFIG_PATH)) {
    await ensureDir(path.dirname(CONFIG_PATH));
    await fsp.copyFile(DEFAULT_CONFIG_PATH, CONFIG_PATH);
  }
};

const defaultUsersContent = async () => {
  const hash = await bcrypt.hash('Admin123', 10);
  return { users: [{ username: 'admin', passwordHash: hash }] };
};

const ensureUsersFile = async () => {
  if (!fs.existsSync(USERS_FILE)) {
    await ensureDir(DATA_DIR);
    const payload = await defaultUsersContent();
    await fsp.writeFile(USERS_FILE, JSON.stringify(payload, null, 2));
  }
};

const loadUsers = async (): Promise<{ username: string; passwordHash: string }[]> => {
  await ensureUsersFile();
  const raw = await fsp.readFile(USERS_FILE, 'utf-8');
  const data = JSON.parse(raw);
  return Array.isArray(data.users) ? data.users : [];
};

const saveUsers = async (users: { username: string; passwordHash: string }[]) => {
  await ensureDir(DATA_DIR);
  await fsp.writeFile(USERS_FILE, JSON.stringify({ users }, null, 2));
};

const isHtmlRequest = (req: express.Request) => (req.headers.accept || '').includes('text/html');

const requireAuthJson = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const user = validateSession(getTokenFromRequest(req));
  if (!user) return res.status(401).json({ ok: false, error: 'unauthorized' });
  (req as any).user = user;
  return next();
};

const requireAuthHtml = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const user = validateSession(getTokenFromRequest(req));
  if (!user) {
    if (isHtmlRequest(req)) return res.redirect('/login');
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  (req as any).user = user;
  return next();
};

const maskSensitiveFields = (config: any) => {
  const clone = JSON.parse(JSON.stringify(config));
  if (clone?.panel?.panelPassword !== undefined) clone.panel.panelPassword = '***';
  if (clone?.panel?.panelPassword2 !== undefined) clone.panel.panelPassword2 = '***';
  return clone;
};

const readConfig = async (mask = false) => {
  await ensureConfigFile();
  const raw = await fsp.readFile(CONFIG_PATH, 'utf-8');
  const data = JSON.parse(raw);
  return mask ? maskSensitiveFields(data) : data;
};

const writeConfig = async (config: any) => {
  await ensureDir(path.dirname(CONFIG_PATH));
  await fsp.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
};

const sanitizeLogLevel = (lvl: any) => (allowedLogLevels.includes(lvl) ? lvl : undefined);
const sanitizeSocketMode = (mode: any) => (allowedSocketModes.includes(mode) ? mode : undefined);
const sanitizePartitionCommandMode = (mode: any) => (
  allowedPartitionCommandModes.includes(mode) ? mode : undefined
);
const sanitizePartitionCommandStrategy = (strategy: any) => (
  allowedPartitionCommandStrategies.includes(strategy) ? strategy : undefined
);
const sanitizePartitionCommandProbeOrder = (value: any) => {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const parsed = rawValues
    .map((item) => String(item || '').trim())
    .filter((item, index, arr) => (
      !!sanitizePartitionCommandStrategy(item) && arr.indexOf(item) === index
    ));
  return parsed.length > 0 ? parsed : undefined;
};
const sanitizeString = (value: any) => {
  if (value === undefined || value === null) return undefined;
  return String(value).trim();
};

const toPort = (val: any) => {
  const num = Number(val);
  if (Number.isInteger(num) && num > 0 && num <= 65535) return num;
  return undefined;
};

const isValidIp = (ip: string) => /^(\d{1,3}\.){3}\d{1,3}$/.test(ip);
const isValidCidr = (cidr: any) => {
  const num = Number(cidr);
  return Number.isInteger(num) && num >= 0 && num <= 32;
};

const applyConfigUpdate = (current: any, next: any) => {
  const updated = { ...current };
  updated.panel = { ...current.panel };
  updated.web = { ...current.web };
  updated.modbus = { ...current.modbus };
  updated.bacnet = { ...current.bacnet };
  updated.hostNetwork = { ...current.hostNetwork };

  if (next.panel?.panelIp || next.panelIp) updated.panel.panelIp = next.panel?.panelIp || next.panelIp;
  if (next.panel?.panelPort || next.panelPort) {
    const port = toPort(next.panel?.panelPort ?? next.panelPort);
    if (port) updated.panel.panelPort = port;
  }
  if (next.panel?.panelPassword !== undefined || next.panelPassword !== undefined) {
    const panelPassword = sanitizeString(next.panel?.panelPassword ?? next.panelPassword);
    if (panelPassword) updated.panel.panelPassword = panelPassword;
  }
  if (next.panel?.panelId || next.panelId) updated.panel.panelId = next.panel?.panelId ?? next.panelId;
  if (next.panel?.socketMode !== undefined) {
    const socketMode = sanitizeSocketMode(next.panel.socketMode);
    if (socketMode) updated.panel.socketMode = socketMode;
  }
  if (next.panel?.watchDogInterval !== undefined) {
    const num = Number(next.panel.watchDogInterval);
    if (!Number.isNaN(num) && num > 0) updated.panel.watchDogInterval = num;
  }
  if (next.panel?.commandsLog !== undefined) updated.panel.commandsLog = !!next.panel.commandsLog;
  if (next.panel?.partitionCommandMode !== undefined) {
    const mode = sanitizePartitionCommandMode(next.panel.partitionCommandMode);
    if (mode) updated.panel.partitionCommandMode = mode;
  }
  if (next.panel?.partitionCommandStrategy !== undefined) {
    const strategy = sanitizePartitionCommandStrategy(next.panel.partitionCommandStrategy);
    if (strategy) updated.panel.partitionCommandStrategy = strategy;
  }
  if (next.panel?.partitionCommandProbeOrder !== undefined) {
    const probeOrder = sanitizePartitionCommandProbeOrder(next.panel.partitionCommandProbeOrder);
    if (probeOrder) updated.panel.partitionCommandProbeOrder = probeOrder;
  }

  if (next.web?.http_port !== undefined) {
    const port = toPort(next.web.http_port);
    if (port) updated.web.http_port = port;
  }
  if (next.web?.ws_path) updated.web.ws_path = next.web.ws_path;
  if (next.web?.enable !== undefined) updated.web.enable = !!next.web.enable;

  if (next.modbus?.port !== undefined) {
    const port = toPort(next.modbus.port);
    if (port) updated.modbus.port = port;
  }
  if (next.modbus?.host) updated.modbus.host = next.modbus.host;
  if (next.modbus?.enable !== undefined) updated.modbus.enable = !!next.modbus.enable;

  if (next.bacnet?.enable !== undefined) updated.bacnet.enable = !!next.bacnet.enable;
  if (next.bacnet?.port !== undefined) {
    const port = toPort(next.bacnet.port);
    if (port) updated.bacnet.port = port;
  }
  if (next.bacnet?.interface !== undefined) updated.bacnet.interface = sanitizeString(next.bacnet.interface) || '0.0.0.0';
  if (next.bacnet?.broadcastAddress !== undefined) updated.bacnet.broadcastAddress = sanitizeString(next.bacnet.broadcastAddress) || '255.255.255.255';
  if (next.bacnet?.deviceId !== undefined) {
    const num = Number(next.bacnet.deviceId);
    if (Number.isInteger(num) && num >= 0 && num <= 4194302) updated.bacnet.deviceId = num;
  }
  if (next.bacnet?.deviceName !== undefined) updated.bacnet.deviceName = sanitizeString(next.bacnet.deviceName) || 'Risco Gateway BACnet';
  if (next.bacnet?.vendorId !== undefined) {
    const num = Number(next.bacnet.vendorId);
    if (Number.isInteger(num) && num >= 0) updated.bacnet.vendorId = num;
  }
  if (next.bacnet?.allowWrite !== undefined) updated.bacnet.allowWrite = !!next.bacnet.allowWrite;
  if (next.bacnet?.apduTimeout !== undefined) {
    const num = Number(next.bacnet.apduTimeout);
    if (Number.isInteger(num) && num >= 1000) updated.bacnet.apduTimeout = num;
  }

  if (next.hostNetwork?.interfaceAlias !== undefined) {
    updated.hostNetwork.interfaceAlias = sanitizeString(next.hostNetwork.interfaceAlias) || '';
  }

  if (next.log !== undefined) {
    const lvl = sanitizeLogLevel(next.log);
    if (lvl) updated.log = lvl;
  }
  if (next.logColorize !== undefined) updated.logColorize = !!next.logColorize;
  if (next.heartbeat_interval_ms !== undefined) {
    const num = Number(next.heartbeat_interval_ms);
    if (!Number.isNaN(num) && num >= 0) updated.heartbeat_interval_ms = num;
  }

  return updated;
};

const PARTITION_REGS = 32;
const ZONE_REGS = 512;
const BYTES_PER_REG = 2;

export function startWebServer(
  web: WebOptions,
  modbus: ModbusOptions,
  bacnet: Partial<BacnetOptions> | undefined,
  state: RealtimeState,
  onArm: (partitionId: number, mode: 'away' | 'home' | 'disarm') => Promise<boolean>,
  onBypass?: (zoneId: number) => Promise<boolean>,
  debugTools?: WebDebugTools,
) {
  const app = express();
  const httpServer = new HttpServer(app);
  const panelState: PanelState = state.panel || { online: false };
  const startedAt = new Date();
  let protocolEventSeq = 0;
  const protocolEvents: ProtocolEvent[] = [];
  const counters = {
    armCommands: 0,
    bypassCommands: 0,
    modbusWrites: 0,
    bacnetWhoIs: 0,
    bacnetReads: 0,
    bacnetWrites: 0,
    bacnetErrors: 0,
    partitionUpdates: 0,
    zoneUpdates: 0,
    panelOnlineChanges: 0,
  };

  const pushProtocolEvent = (type: string, message: string, detail?: any) => {
    protocolEvents.push({
      id: ++protocolEventSeq,
      ts: new Date().toISOString(),
      type,
      message,
      detail,
    });
    if (protocolEvents.length > 300) protocolEvents.splice(0, protocolEvents.length - 300);
  };

  const bacnetOptions = normalizeBacnetOptions(bacnet);
  const bacnetServer = startBacnetServer(bacnetOptions, state, {
    onWhoIs: () => {
      counters.bacnetWhoIs++;
      pushProtocolEvent('bacnet', 'Who-Is recibido');
    },
    onRead: () => { counters.bacnetReads++; },
    onWrite: () => {
      counters.bacnetWrites++;
      pushProtocolEvent('bacnet-write', 'WriteProperty recibido');
    },
    onWriteValue: async ({ kind, instance, value }) => {
      if (!panelState.online) {
        pushProtocolEvent('bacnet-write', 'WriteProperty rechazado: panel offline', { kind, instance, value });
        return false;
      }

      if (kind === 'partition-state') {
        if (instance < 1 || instance > PARTITION_REGS) return false;
        let mode: 'away' | 'disarm' | undefined;
        if (value === 0) mode = 'disarm';
        if (value === 1) mode = 'away';
        if (!mode) {
          pushProtocolEvent('bacnet-write', `WriteProperty particion ${instance} valor no controlable`, { value });
          return false;
        }
        counters.armCommands++;
        pushProtocolEvent('bacnet-write', `BACnet write partition=${instance} value=${value}`);
        return onArm(instance, mode);
      }

      if (kind === 'zone-state') {
        const zoneId = instance - PARTITION_REGS;
        if (zoneId < 1 || zoneId > ZONE_REGS || !onBypass) return false;
        if (value !== 0 && value !== 2) {
          pushProtocolEvent('bacnet-write', `WriteProperty zona ${zoneId} valor no controlable`, { value });
          return false;
        }
        const desiredBypass = value === 2;
        const currentBypass = state.zones.get(zoneId)?.bypass ?? false;
        if (desiredBypass === currentBypass) return true;
        counters.bypassCommands++;
        pushProtocolEvent('bacnet-write', `BACnet write zone=${zoneId} bypass=${desiredBypass}`);
        return onBypass(zoneId);
      }

      return false;
    },
    onError: (message) => {
      counters.bacnetErrors++;
      pushProtocolEvent('bacnet-error', message);
    },
  });
  if (bacnetOptions.enable) {
    pushProtocolEvent('bacnet', `BACnet/IP habilitado en ${bacnetOptions.interface}:${bacnetOptions.port}`);
  }

  ensureRuntimeDirectories();
  void ensureConfigFile();
  void ensureUsersFile();

  app.use(express.json());
  app.use((_req, res, next) => {
    setNoCacheHeaders(res);
    next();
  });

  const publicDir = runtimePaths.publicDir;
  console.log(`[WEB] Static dir: ${publicDir}`);

  app.get('/health', (_req, res) => res.json({ ok: true, uptimeSeconds: Math.floor(process.uptime()) }));
  app.get('/api/system/info', requireAuthJson, (_req, res) => {
    res.json({ ok: true, info: getPlatformInfo() });
  });
  app.get('/api/supported-panels', requireAuthJson, (_req, res) => {
    res.json({ ok: true, panels: SUPPORTED_PANELS });
  });
  app.get('/api/diagnostics', requireAuthJson, (_req, res) => {
    const partitions = Array.from(state.partitions.values());
    const zones = Array.from(state.zones.values());
    res.json({
      ok: true,
      startedAt: startedAt.toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      panelOnline: panelState.online,
      counts: {
        partitions: partitions.length,
        zones: zones.length,
        armedPartitions: partitions.filter((p) => p.status === 'armed_home' || p.status === 'armed_away').length,
        readyPartitions: partitions.filter((p) => p.ready === true).length,
        notReadyPartitions: partitions.filter((p) => p.ready === false).length,
        openZones: zones.filter((z) => z.open).length,
        bypassedZones: zones.filter((z) => z.bypass).length,
      },
      counters,
      recentEvents: protocolEvents.slice(-80),
      bacnet: bacnetServer.status(),
      modbus,
    });
  });
  app.get('/api/protocols/modbus', requireAuthJson, (_req, res) => {
    const partitions = Array.from(state.partitions.values()).sort((a, b) => a.id - b.id);
    const zones = Array.from(state.zones.values()).sort((a, b) => a.id - b.id);
    res.json({
      ok: true,
      enabled: modbus.enable,
      host: modbus.host,
      port: modbus.port,
      map: {
        holdingRegisters: [
          { range: '1-32', type: 'partition', values: '0=disarmed, 1=armed, 2=triggered, 3=ready, 4=not ready' },
          { range: '33-544', type: 'zone', values: '0=closed, 1=open, 2=bypass' },
        ],
        discreteInputs: [
          { range: '1-32', type: 'partition alarm', values: '0=normal, 1=alarm' },
          { range: '33-544', type: 'zone open', values: '0=closed, 1=open' },
        ],
      },
      current: {
        partitions: partitions.map((p) => ({ register: p.id, id: p.id, value: encodePartitionHolding(p.status, p.ready), status: p.status, ready: p.ready })),
        zones: zones.map((z) => ({ register: PARTITION_REGS + z.id, id: z.id, value: encodeZoneHolding(z.open, z.bypass), open: z.open, bypass: z.bypass, label: z.label })),
      },
    });
  });
  app.get('/api/protocols/bacnet', requireAuthJson, (_req, res) => {
    const partitions = Array.from(state.partitions.values()).sort((a, b) => a.id - b.id);
    const zones = Array.from(state.zones.values()).sort((a, b) => a.id - b.id);
    res.json({
      ok: true,
      status: bacnetServer.status(),
      map: buildBacnetMapSummary(bacnetOptions, state),
      current: {
        partitions: partitions.map((p) => ({ object: `AV${p.id}`, id: p.id, value: encodePartitionValue(p.status, p.ready), status: p.status, ready: p.ready })),
        zones: zones.map((z) => ({ object: `AV${PARTITION_REGS + z.id}`, id: z.id, value: encodeZoneValue(z.open, z.bypass), open: z.open, bypass: z.bypass, label: z.label })),
      },
    });
  });
  app.get('/api/debug/capabilities', requireAuthJson, (_req, res) => {
    res.json({
      ok: true,
      available: !!debugTools,
      strategies: debugTools?.getAvailableStrategies() || [],
      partitionCommandConfig: debugTools?.getPartitionCommandConfig() || {},
    });
  });
  app.get('/api/debug/logs', requireAuthJson, (_req, res) => {
    res.json({ ok: true, logs: debugTools?.getLogs() || [] });
  });
  app.post('/api/debug/partition/preview', requireAuthJson, (req, res) => {
    if (!debugTools) return res.status(404).json({ ok: false, error: 'debug_not_available' });
    const partitionId = Number(req.body?.partitionId);
    const mode = req.body?.mode as 'away' | 'home' | 'disarm';
    if (!partitionId || !['away', 'home', 'disarm'].includes(mode)) {
      return res.status(400).json({ ok: false, error: 'invalid_payload' });
    }
    res.json({
      ok: true,
      attempts: debugTools.previewPartitionCommands(partitionId, mode),
      partitionCommandConfig: debugTools.getPartitionCommandConfig(),
    });
  });
  app.post('/api/debug/partition/execute', requireAuthJson, async (req, res) => {
    if (!debugTools) return res.status(404).json({ ok: false, error: 'debug_not_available' });
    const partitionId = Number(req.body?.partitionId);
    const mode = req.body?.mode as 'away' | 'home' | 'disarm';
    const strategy = sanitizePartitionCommandStrategy(req.body?.strategy);
    if (!partitionId || !['away', 'home', 'disarm'].includes(mode)) {
      return res.status(400).json({ ok: false, error: 'invalid_payload' });
    }
    try {
      const result = await debugTools.executePartitionCommand(partitionId, mode, strategy);
      res.json({ ok: true, result });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message || 'debug_execute_failed' });
    }
  });
  app.post('/api/debug/partition/raw', requireAuthJson, async (req, res) => {
    if (!debugTools) return res.status(404).json({ ok: false, error: 'debug_not_available' });
    const partitionId = Number(req.body?.partitionId);
    const mode = req.body?.mode as 'away' | 'home' | 'disarm';
    const rawCommand = sanitizeString(req.body?.rawCommand);
    if (!partitionId || !['away', 'home', 'disarm'].includes(mode) || !rawCommand) {
      return res.status(400).json({ ok: false, error: 'invalid_payload' });
    }
    try {
      const result = await debugTools.executeRawPartitionCommand(partitionId, mode, rawCommand);
      res.json({ ok: true, result });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message || 'debug_raw_failed' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ ok: false, error: 'missing_credentials' });
    const users = await loadUsers();
    const user = users.find((u) => u.username === username);
    if (!user) {
      clearSessionCookie(res);
      return res.status(401).json({ ok: false, error: 'invalid_credentials' });
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      clearSessionCookie(res);
      return res.status(401).json({ ok: false, error: 'invalid_credentials' });
    }
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, { username, exp: Date.now() + SESSION_TTL_MS });
    setSessionCookie(res, token);
    return res.json({ ok: true, username });
  });

  app.post('/api/auth/logout', requireAuthJson, (req, res) => {
    const token = getTokenFromRequest(req);
    if (token) sessions.delete(token);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuthJson, (req, res) => {
    res.json({ ok: true, username: (req as any).user });
  });

  app.post('/api/auth/password', requireAuthJson, async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ ok: false, error: 'new_password_too_short' });
    }
    const users = await loadUsers();
    const username = (req as any).user as string;
    const user = users.find((u) => u.username === username);
    if (!user) return res.status(404).json({ ok: false, error: 'user_not_found' });
    const valid = await bcrypt.compare(currentPassword || '', user.passwordHash);
    if (!valid) return res.status(401).json({ ok: false, error: 'invalid_credentials' });
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await saveUsers(users);

    Array.from(sessions.entries()).forEach(([token, s]) => {
      if (s.username === username) sessions.delete(token);
    });
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, { username, exp: Date.now() + SESSION_TTL_MS });
    setSessionCookie(res, token);
    res.json({ ok: true });
  });

  app.get('/api/config', requireAuthJson, async (_req, res) => {
    const cfg = await readConfig(true);
    res.json({ ok: true, config: cfg });
  });

  app.post('/api/config', requireAuthJson, async (req, res) => {
    const cfg = await readConfig(false);
    const updated = applyConfigUpdate(cfg, req.body || {});
    await writeConfig(updated);
    res.json({ ok: true, needsRestart: true });
  });

  app.post('/api/restart', requireAuthJson, async (_req, res) => {
    res.json({ ok: true, restarting: true });
    requestManagedRestart();
  });

  app.post('/api/factory-reset', requireAuthJson, async (_req, res) => {
    if (!fs.existsSync(DEFAULT_CONFIG_PATH)) return res.status(500).json({ ok: false, error: 'default_config_missing' });
    await ensureDir(path.dirname(CONFIG_PATH));
    await fsp.copyFile(DEFAULT_CONFIG_PATH, CONFIG_PATH);
    const payload = await defaultUsersContent();
    await fsp.writeFile(USERS_FILE, JSON.stringify(payload, null, 2));
    sessions.clear();
    res.json({ ok: true, needsRestart: true, restarting: true });
    requestManagedRestart();
  });

  app.post('/api/host/ip', requireAuthJson, async (req, res) => {
    const { ip, cidr, gateway, interfaceAlias } = req.body || {};
    if (!ip || !cidr || !gateway) return res.status(400).json({ ok: false, error: 'missing_fields' });
    if (!isValidIp(ip) || !isValidIp(gateway) || !isValidCidr(cidr)) {
      return res.status(400).json({ ok: false, error: 'invalid_ip' });
    }
    const cfg = await readConfig(false);
    const requestedInterface = sanitizeString(interfaceAlias) || sanitizeString(cfg.hostNetwork?.interfaceAlias);
    if (!scheduleHostIpChange({ ip, cidr: Number(cidr), gateway, interfaceAlias: requestedInterface })) {
      return res.status(501).json({ ok: false, error: 'host_ip_not_supported' });
    }

    res.json({ ok: true, applying: true, restarting: true });
    setTimeout(() => {
      requestManagedRestart();
    }, 750);
  });

  app.get('/snapshot', requireAuthJson, (_req, res) => {
    res.json({
      panelOnline: panelState.online,
      partitions: Array.from(state.partitions.values()),
      zones: Array.from(state.zones.values()),
    });
  });

  app.use(express.static(publicDir, { index: false }));

  const wss = new WebSocketServer({ server: httpServer, path: web.ws_path });
  const broadcast = (msg: any) => {
    const data = JSON.stringify(msg);
    wss.clients.forEach((c) => {
      if (c.readyState === c.OPEN) c.send(data);
    });
  };

  wss.on('connection', (ws, req) => {
    const user = validateSession(getTokenFromRequest(req));
    if (!user) {
      ws.close(1008, 'unauthorized');
      return;
    }
    ws.send(JSON.stringify({
      type: 'snapshot',
      panelOnline: panelState.online,
      partitions: Array.from(state.partitions.values()),
      zones: Array.from(state.zones.values()),
    }));
    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'arm' && msg.partitionId && msg.mode) {
          counters.armCommands++;
          pushProtocolEvent('command', `Web arm command partition=${Number(msg.partitionId)} mode=${msg.mode}`);
          const ok = await onArm(Number(msg.partitionId), msg.mode);
          const message = ok ? '' : (panelState.online ? 'Operacion rechazada' : 'Panel offline');
          ws.send(JSON.stringify({ type: 'ack', action: 'arm', ok, partitionId: Number(msg.partitionId), message }));
        } else if (msg.type === 'bypass' && msg.zoneId && onBypass) {
          counters.bypassCommands++;
          pushProtocolEvent('command', `Web bypass toggle zone=${Number(msg.zoneId)}`);
          const ok = await onBypass(Number(msg.zoneId));
          const message = ok ? '' : (panelState.online ? 'Operacion rechazada' : 'Panel offline');
          ws.send(JSON.stringify({ type: 'ack', action: 'bypass', ok, zoneId: Number(msg.zoneId), message }));
        }
      } catch (e) {
        ws.send(JSON.stringify({ type: 'ack', ok: false, message: (e as Error).message || 'Error' }));
      }
    });
  });

  app.get('/login', (_req, res) => res.sendFile(path.join(publicDir, 'login.html')));
  app.get('/config', requireAuthHtml, (_req, res) => res.sendFile(path.join(publicDir, 'config.html')));
  app.get('/debug', requireAuthHtml, (_req, res) => res.sendFile(path.join(publicDir, 'debug.html')));
  app.get('/diagnostics', requireAuthHtml, (_req, res) => res.sendFile(path.join(publicDir, 'diagnostics.html')));
  app.get('/modbus', requireAuthHtml, (_req, res) => res.sendFile(path.join(publicDir, 'modbus.html')));
  app.get('/bacnet', requireAuthHtml, (_req, res) => res.sendFile(path.join(publicDir, 'bacnet.html')));
  app.get('/', requireAuthHtml, (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  app.get('*', requireAuthHtml, (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

  httpServer.listen(web.http_port, () => {
    console.log(`[WEB] HTTP/WS listening on ${web.http_port}${web.ws_path}`);
  });

  if (modbus.enable) {
    const totalRegs = PARTITION_REGS + ZONE_REGS;
    const holding = Buffer.alloc(totalRegs * BYTES_PER_REG);
    const discrete = Buffer.alloc(Math.ceil((PARTITION_REGS + ZONE_REGS) / 8));

    const bitSet = (buf: Buffer, index: number, value: boolean) => {
      const byte = Math.floor(index / 8);
      const bit = index % 8;
      const cur = buf.readUInt8(byte);
      const next = value ? cur | (1 << bit) : cur & ~(1 << bit);
      buf.writeUInt8(next, byte);
    };

    const writePartition = (p: PartitionState) => {
      if (p.id >= 1 && p.id <= PARTITION_REGS) {
        holding.writeUInt16BE(encodePartitionHolding(p.status, p.ready), (p.id - 1) * BYTES_PER_REG);
        const alarm = p.status === 'triggered';
        bitSet(discrete, p.id - 1, alarm);
      }
    };
    const writeZone = (z: ZoneState) => {
      if (z.id >= 1 && z.id <= ZONE_REGS) {
        const regIdx = PARTITION_REGS + z.id - 1;
        holding.writeUInt16BE(encodeZoneHolding(z.open, z.bypass), regIdx * BYTES_PER_REG);
        bitSet(discrete, regIdx, z.open);
      }
    };

    state.partitions.forEach((p) => writePartition(p));
    state.zones.forEach((z) => writeZone(z));

    const modbusNetServer = net.createServer();
    const modbusServer = new (Modbus as any).ModbusTCPServer(modbusNetServer, { holding, discrete });
    modbusServer.on('connection', () => console.log('[MODBUS] client connected'));

    const handleWriteRegisters = async (startAddress: number, values: number[]) => {
      for (let i = 0; i < values.length; i++) {
        const regIndex = startAddress + i;
        const val = values[i];
        if (regIndex < PARTITION_REGS) {
          const partitionId = regIndex + 1;
          if (val === 0 || val === 1) {
            const mode: 'disarm' | 'home' | 'away' = val === 0 ? 'disarm' : 'away';
            counters.armCommands++;
            pushProtocolEvent('modbus-write', `Modbus write partition=${partitionId} value=${val}`);
            const ok = await onArm(partitionId, mode);
            const current = state.partitions.get(partitionId);
            if (!ok && current) writePartition(current);
          }
        } else if (regIndex < PARTITION_REGS + ZONE_REGS) {
          const zoneId = regIndex - PARTITION_REGS + 1;
          if (val === 0 || val === 2) {
            const desiredBypass = val === 2;
            const current = state.zones.get(zoneId)?.bypass ?? false;
            if (desiredBypass !== current && onBypass) {
              counters.bypassCommands++;
              pushProtocolEvent('modbus-write', `Modbus write zone=${zoneId} bypass=${desiredBypass}`);
              const ok = await onBypass(zoneId);
              const zone = state.zones.get(zoneId);
              if (!ok && zone) writeZone(zone);
            }
          }
        }
      }
    };

    modbusServer.on('postWriteSingleRegister', async (req: any) => {
      counters.modbusWrites++;
      const value = req.body.value;
      await handleWriteRegisters(req.body.address, [value]);
    });
    modbusServer.on('postWriteMultipleRegisters', async (req: any) => {
      counters.modbusWrites++;
      const vals: number[] = [];
      for (let i = 0; i < req.body.values.length; i += 2) {
        vals.push(req.body.values.readUInt16BE(i));
      }
      await handleWriteRegisters(req.body.address, vals);
    });

    modbusNetServer.listen(modbus.port, modbus.host, () => {
      console.log(`[MODBUS] TCP listening on ${modbus.host}:${modbus.port}`);
    });

    return {
      broadcast,
      updatePartition: (p: PartitionState) => {
        state.partitions.set(p.id, p);
        counters.partitionUpdates++;
        pushProtocolEvent('partition', `Partition ${p.id} ${p.status}`, { ready: p.ready });
        writePartition(p);
        broadcast({ type: 'partition', data: p });
      },
      updateZone: (z: ZoneState) => {
        state.zones.set(z.id, z);
        counters.zoneUpdates++;
        pushProtocolEvent('zone', `Zone ${z.id} ${z.open ? 'open' : 'closed'}`, { bypass: z.bypass, label: z.label });
        writeZone(z);
        broadcast({ type: 'zone', data: z });
      },
      updatePanelStatus: (online: boolean) => {
        if (panelState.online !== online) {
          counters.panelOnlineChanges++;
          pushProtocolEvent('panel', `Panel ${online ? 'online' : 'offline'}`);
        }
        panelState.online = online;
        broadcast({ type: 'panel', online });
      },
      pushLog: (entry: DebugLogEntry) => {
        broadcast({ type: 'log', data: entry });
      },
      stop: () => {
        wss.clients.forEach((c) => c.terminate());
        wss.close();
        httpServer.close();
        modbusNetServer.close();
        bacnetServer.stop();
      },
    };
  }

  return {
    broadcast,
    updatePartition: (p: PartitionState) => {
      state.partitions.set(p.id, p);
      counters.partitionUpdates++;
      pushProtocolEvent('partition', `Partition ${p.id} ${p.status}`, { ready: p.ready });
      broadcast({ type: 'partition', data: p });
    },
    updateZone: (z: ZoneState) => {
      state.zones.set(z.id, z);
      counters.zoneUpdates++;
      pushProtocolEvent('zone', `Zone ${z.id} ${z.open ? 'open' : 'closed'}`, { bypass: z.bypass, label: z.label });
      broadcast({ type: 'zone', data: z });
    },
    updatePanelStatus: (online: boolean) => {
      if (panelState.online !== online) {
        counters.panelOnlineChanges++;
        pushProtocolEvent('panel', `Panel ${online ? 'online' : 'offline'}`);
      }
      panelState.online = online;
      broadcast({ type: 'panel', online });
    },
    pushLog: (entry: DebugLogEntry) => {
      broadcast({ type: 'log', data: entry });
    },
    stop: () => {
      wss.clients.forEach((c) => c.terminate());
      wss.close();
      httpServer.close();
      bacnetServer.stop();
    },
  };
}

function encodePartitionHolding(status: string, ready?: boolean): number {
  if (status === 'triggered') return 2;
  if (ready === true) return 3;
  if (ready === false) return 4;
  if (status === 'armed_home' || status === 'armed_away') return 1;
  return 0;
}

function encodeZoneHolding(open: boolean, bypass: boolean): number {
  if (bypass) return 2;
  return open ? 1 : 0;
}
