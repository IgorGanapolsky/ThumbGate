#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const { getHomeDir, getRuntimeDir, resolveProjectDir } = require('./feedback-paths');
const { resolveProKey } = require('./pro-local-dashboard');

const DEFAULT_ORIGIN = 'http://localhost:3456';
const DEFAULT_TIMEOUT_MS = 150;
const DEFAULT_BOOT_GRACE_MS = 5000;
const PKG_ROOT = path.join(__dirname, '..');

function parseOrigin(origin) {
  const url = new URL(origin || DEFAULT_ORIGIN);
  return {
    origin: url.origin,
    host: url.hostname,
    port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
    protocol: url.protocol,
  };
}

function runtimeStatePath(options = {}) {
  return path.join(getRuntimeDir(options), 'statusline-api.json');
}

function readRuntimeState(options = {}) {
  try {
    return JSON.parse(fs.readFileSync(runtimeStatePath(options), 'utf8'));
  } catch {
    return null;
  }
}

function writeRuntimeState(payload, options = {}) {
  const targetPath = runtimeStatePath(options);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2) + '\n');
  return targetPath;
}

function isPidAlive(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch {
    return false;
  }
}

function shouldReuseBootingState(state, now = Date.now()) {
  if (!state || !isPidAlive(state.pid)) return false;
  const startedAt = Date.parse(state.startedAt || 0);
  if (!Number.isFinite(startedAt)) return true;
  return now - startedAt < DEFAULT_BOOT_GRACE_MS;
}

function requestOk(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function probeLocalServer(origin, options = {}) {
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  return requestOk(`${origin}/health`, timeoutMs);
}

function launchLocalServer(options = {}) {
  const env = options.env || process.env;
  const origin = parseOrigin(options.origin || env.THUMBGATE_LOCAL_API_ORIGIN || DEFAULT_ORIGIN);
  const homeDir = options.homeDir || getHomeDir({ env });
  const resolvedKey = (options.resolveKey || resolveProKey)({ env, homeDir });
  const projectDir = resolveProjectDir({ env, cwd: options.cwd || process.cwd() });
  const childEnv = {
    ...env,
    HOST: origin.host,
    PORT: String(origin.port),
    THUMBGATE_LOCAL_API_ORIGIN: origin.origin,
    THUMBGATE_PROJECT_DIR: projectDir,
    THUMBGATE_PRO_MODE: '1',
  };

  if (resolvedKey && resolvedKey.key) {
    childEnv.THUMBGATE_API_KEY = resolvedKey.key;
  }

  const child = spawn(
    process.execPath,
    [path.join(PKG_ROOT, 'bin', 'cli.js'), 'start-api'],
    {
      cwd: projectDir,
      env: childEnv,
      detached: true,
      stdio: 'ignore',
    }
  );
  child.unref();

  const state = {
    pid: child.pid,
    projectDir,
    origin: origin.origin,
    startedAt: new Date().toISOString(),
  };
  writeRuntimeState(state, { env, home: homeDir });
  return state;
}

function buildLinkState({
  ready,
  booting,
  origin,
  canBootstrap,
}) {
  if (ready) {
    return {
      state: 'ready',
      dashboardLabel: 'Dashboard',
      lessonsLabel: 'Lessons',
      upLabel: '👍',
      downLabel: '👎',
      dashboardUrl: `${origin}/dashboard`,
      lessonsUrl: `${origin}/lessons`,
      upUrl: `${origin}/feedback/quick?signal=up`,
      downUrl: `${origin}/feedback/quick?signal=down`,
    };
  }

  if (booting) {
    return {
      state: 'booting',
      dashboardLabel: 'Dashboard…',
      lessonsLabel: 'Lessons…',
      upLabel: '👍',
      downLabel: '👎',
      dashboardUrl: '',
      lessonsUrl: '',
      upUrl: '',
      downUrl: '',
    };
  }

  return {
    state: canBootstrap ? 'offline' : 'unavailable',
    dashboardLabel: canBootstrap ? 'Dash: thumbgate pro' : 'Dashboard',
    lessonsLabel: 'Learn: thumbgate lessons',
    upLabel: '👍',
    downLabel: '👎',
    dashboardUrl: '',
    lessonsUrl: '',
    upUrl: '',
    downUrl: '',
  };
}

async function getStatuslineLinks(options = {}) {
  const env = options.env || process.env;
  if (env._TEST_THUMBGATE_STATUSLINE_LINKS_JSON) {
    return JSON.parse(env._TEST_THUMBGATE_STATUSLINE_LINKS_JSON);
  }

  const homeDir = options.homeDir || getHomeDir({ env });
  const origin = parseOrigin(options.origin || env.THUMBGATE_LOCAL_API_ORIGIN || DEFAULT_ORIGIN).origin;
  const probe = options.probeLocalServer || probeLocalServer;
  const resolveKey = options.resolveKey || resolveProKey;
  const startServer = options.launchLocalServer || launchLocalServer;
  const key = resolveKey({ env, homeDir });
  const canBootstrap = Boolean(key && key.key);

  const ready = await probe(origin, options);
  if (ready) {
    return buildLinkState({ ready: true, booting: false, origin, canBootstrap });
  }

  const state = readRuntimeState({ env, home: homeDir });
  if (shouldReuseBootingState(state)) {
    return buildLinkState({ ready: false, booting: true, origin, canBootstrap });
  }

  if (canBootstrap) {
    startServer({
      env,
      homeDir,
      origin,
      cwd: options.cwd || process.cwd(),
      resolveKey: () => key,
    });
    return buildLinkState({ ready: false, booting: true, origin, canBootstrap });
  }

  return buildLinkState({ ready: false, booting: false, origin, canBootstrap });
}

if (require.main === module) {
  getStatuslineLinks()
    .then((payload) => {
      process.stdout.write(JSON.stringify(payload));
    })
    .catch(() => {
      process.exit(0);
    });
}

module.exports = {
  buildLinkState,
  getStatuslineLinks,
  isPidAlive,
  launchLocalServer,
  parseOrigin,
  probeLocalServer,
  readRuntimeState,
  runtimeStatePath,
  shouldReuseBootingState,
  writeRuntimeState,
};
