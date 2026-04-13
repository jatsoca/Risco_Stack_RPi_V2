import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const RUNTIME_ROOT = path.join(REPO_ROOT, 'runtime');
const DATA_DIR = process.env.RISCO_DATA_DIR || path.join(RUNTIME_ROOT, 'data');
const CONFIG_PATH = process.env.RISCO_CONFIG_FILE || process.env.RISCO_MQTT_HA_CONFIG_FILE || path.join(DATA_DIR, 'config.json');
const DEFAULT_CONFIG_PATH = process.env.RISCO_DEFAULT_CONFIG_FILE || process.env.RISCO_MQTT_HA_DEFAULT_CONFIG || path.join(RUNTIME_ROOT, 'config.default.json');
const PUBLIC_DIR = process.env.RISCO_PUBLIC_DIR || path.join(REPO_ROOT, 'gateway', 'public');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const HOST_IP_SCRIPT = process.env.RISCO_HOST_IP_SCRIPT || path.join(REPO_ROOT, 'scripts', 'set-ip-rpi.sh');

export interface RuntimePaths {
  repoRoot: string;
  runtimeRoot: string;
  dataDir: string;
  configPath: string;
  defaultConfigPath: string;
  publicDir: string;
  usersFile: string;
  hostIpScript: string;
}

export function getRuntimePaths(): RuntimePaths {
  return {
    repoRoot: REPO_ROOT,
    runtimeRoot: RUNTIME_ROOT,
    dataDir: DATA_DIR,
    configPath: CONFIG_PATH,
    defaultConfigPath: DEFAULT_CONFIG_PATH,
    publicDir: PUBLIC_DIR,
    usersFile: USERS_FILE,
    hostIpScript: HOST_IP_SCRIPT,
  };
}

export function ensureRuntimeDirectories() {
  fs.mkdirSync(RUNTIME_ROOT, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
