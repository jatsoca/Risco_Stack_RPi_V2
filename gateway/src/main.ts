#!/usr/bin/env node

const fs = require('fs');
import { ensureRuntimeDirectories, getRuntimePaths, startGateway } from './lib';

function maskConfig(raw: any) {
  const clone = JSON.parse(JSON.stringify(raw));
  if (clone?.panel?.panelPassword !== undefined) clone.panel.panelPassword = '***';
  if (clone?.panel?.panelPassword2 !== undefined) clone.panel.panelPassword2 = '***';
  return clone;
}

try {
  ensureRuntimeDirectories();
  const runtimePaths = getRuntimePaths();

  if (!fs.existsSync(runtimePaths.configPath)) {
    if (!fs.existsSync(runtimePaths.defaultConfigPath)) {
      console.error('No config found and no default config available');
      process.exit(1);
    }
    fs.copyFileSync(runtimePaths.defaultConfigPath, runtimePaths.configPath);
    console.log(`Config not found. Copied defaults to ${runtimePaths.configPath}`);
  }

  console.log('Loading config from: ' + runtimePaths.configPath);
  const config = require(runtimePaths.configPath);
  const allowedLogs = ['error', 'warn', 'info', 'verbose', 'debug'];
  if (config.log && !allowedLogs.includes(config.log)) {
    console.warn(`Invalid log level "${config.log}", falling back to "info"`);
    config.log = 'info';
  }
  console.debug('Config (masked): ' + JSON.stringify(maskConfig(config), null, 2));
  startGateway(config);
} catch (e) {
  console.error('Startup error', e);
  process.exit(1);
}
