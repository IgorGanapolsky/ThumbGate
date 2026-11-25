#!/usr/bin/env node
'use strict';

// Background refresh of the hook runtime (~/.thumbgate/runtime).
//
// Hooks run the cached runtime and never upgrade it on their own, and installs wired before 1.40.15
// stay pinned to their first version forever. The MCP server is usually started as thumbgate@latest,
// so it is the one process that knows a newer build exists. When it sees the hooks behind, it starts
// this script as a detached child that installs the MCP server's own version into a staging folder
// and swaps it in. The MCP server never waits for it, and its stdio stays untouched.
//
// Igor approved the background update on 2026-11-25. Opt out with THUMBGATE_NO_AUTO_UPDATE=1.

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { runtimeDir, readRuntimeVersion, isOlder } = require('./check-update');

const STATE_FILE = 'runtime-auto-update.json';
const RETRY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const VERSION_RE = /^\d+\.\d+\.\d+$/;

function stateFile(env = process.env) {
  return path.join(path.dirname(runtimeDir(env)), STATE_FILE);
}

function readState(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { return {}; }
}

function writeState(file, state) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** Why a background update should not start, or null when it may. */
function skipReason({ skew, env = process.env, now = Date.now(), file }) {
  if (!skew || !skew.skewed) return 'not-skewed';
  if (env.THUMBGATE_NO_AUTO_UPDATE === '1') return 'opted-out';
  if (env.CI === 'true' || env.CI === '1') return 'ci';
  if (!VERSION_RE.test(String(skew.currentVersion || ''))) return 'bad-version';
  if (skew.runtimeVersion && !isOlder(skew.runtimeVersion, skew.currentVersion)) return 'not-older';
  const last = readState(file);
  if (now - (Number(last.startedAt) || 0) < RETRY_INTERVAL_MS) return 'recently-tried';
  return null;
}

/**
 * Start a detached refresh of the hook runtime to `skew.currentVersion`. Never throws, never blocks.
 * At most one attempt per machine per 24h. `spawnFn` is for tests; without it nothing runs under
 * the node test runner.
 * @returns {{ started: boolean, reason?: string }}
 */
function scheduleRuntimeAutoUpdate({ skew, env = process.env, now = Date.now(), dir, spawnFn, nodePath = process.execPath } = {}) {
  try {
    const target = dir || runtimeDir(env);
    const file = path.join(path.dirname(target), STATE_FILE);
    const reason = skipReason({ skew, env, now, file });
    if (reason) return { started: false, reason };
    if (!spawnFn && (env.NODE_TEST_CONTEXT || process.env.NODE_TEST_CONTEXT)) return { started: false, reason: 'test' };
    // Written before the spawn, so it doubles as the lock against parallel MCP servers.
    if (!writeState(file, { startedAt: now, from: skew.runtimeVersion || null, to: skew.currentVersion })) {
      return { started: false, reason: 'state-unwritable' };
    }
    const child = (spawnFn || spawn)(nodePath, [__filename, '--child', target, skew.currentVersion, skew.source || ''], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env,
    });
    if (child && typeof child.on === 'function') child.on('error', () => {});
    if (child && typeof child.unref === 'function') child.unref();
    return { started: true };
  } catch {
    return { started: false, reason: 'spawn-failed' };
  }
}

// True when this file is the copy inside the hook runtime, so source checkouts, global installs and
// npx-cache runs never touch ~/.thumbgate/runtime from the hook path.
function runningFromRuntime(dir, self = __filename) {
  const root = path.resolve(dir) + path.sep;
  return path.resolve(self).startsWith(root);
}

/**
 * Hook-side update check, so every install keeps up with npm even when no MCP server started from
 * @latest is around to notice (Codex and plugin installs run the MCP server from the runtime itself,
 * and hooks-only installs have none). Called from gate-check and session-start. Costs one small
 * file read; at most once per 24h it starts a detached child that asks npm for `latest` and, if the
 * runtime is older, refreshes it the same way the MCP path does. Never throws, never blocks.
 * @returns {{ started: boolean, reason?: string }}
 */
function scheduleLatestCheck({ env = process.env, now = Date.now(), dir, spawnFn, nodePath = process.execPath, self = __filename } = {}) {
  try {
    const target = dir || runtimeDir(env);
    if (env.THUMBGATE_NO_AUTO_UPDATE === '1') return { started: false, reason: 'opted-out' };
    if (env.CI === 'true' || env.CI === '1') return { started: false, reason: 'ci' };
    if (!runningFromRuntime(target, self)) return { started: false, reason: 'not-runtime' };
    if (!spawnFn && (env.NODE_TEST_CONTEXT || process.env.NODE_TEST_CONTEXT)) return { started: false, reason: 'test' };
    const file = path.join(path.dirname(target), STATE_FILE);
    const state = readState(file);
    if (now - (Number(state.latestCheckedAt) || 0) < RETRY_INTERVAL_MS) return { started: false, reason: 'recently-checked' };
    if (!writeState(file, { ...state, latestCheckedAt: now })) return { started: false, reason: 'state-unwritable' };
    const child = (spawnFn || spawn)(nodePath, [self, '--check-latest', target], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env,
    });
    if (child && typeof child.on === 'function') child.on('error', () => {});
    if (child && typeof child.unref === 'function') child.unref();
    return { started: true };
  } catch {
    return { started: false, reason: 'spawn-failed' };
  }
}

function npmArgsRunner(args, opts) {
  if (process.platform === 'win32') {
    // npm.cmd needs cmd.exe; run npm-cli.js with node instead (same as check-update npmRunner).
    const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    return execFileSync(process.execPath, [cli, ...args], opts);
  }
  return execFileSync('npm', args, opts);
}

function defaultLatestVersion() {
  const out = npmArgsRunner(['view', 'thumbgate@latest', 'version', '--loglevel=error'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30 * 1000, windowsHide: true,
  });
  return String(out || '').trim();
}

/** Child side of scheduleLatestCheck: refresh the runtime when npm has a newer `latest`. */
async function checkLatest(dir, { latestVersion = defaultLatestVersion, refresh = runChild } = {}) {
  let latest = '';
  try { latest = latestVersion(); } catch { return { updated: false, reason: 'lookup-failed' }; }
  if (!VERSION_RE.test(latest)) return { updated: false, reason: 'bad-version' };
  const current = readRuntimeVersion(dir);
  if (!current || !isOlder(current, latest)) return { updated: false, reason: 'current' };
  // Same lock the MCP path uses, so it does not start a second refresh today.
  const file = path.join(path.dirname(dir), STATE_FILE);
  writeState(file, { ...readState(file), startedAt: Date.now(), from: current, to: latest });
  await refresh([dir, latest, 'hook']);
  return { updated: true, from: current, to: latest };
}

function defaultInstall(prefix, version) {
  const args = ['install', '--prefix', prefix, '--no-save', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error', `thumbgate@${version}`];
  npmArgsRunner(args, { stdio: 'ignore', timeout: INSTALL_TIMEOUT_MS, windowsHide: true });
}

/**
 * Install `version` into a staging folder next to `dir`, check it, then swap it in, so hooks
 * running during the install keep the old runtime. Never throws.
 * @returns {{ ok: boolean, before: string|null, after?: string|null, reason?: string }}
 */
function refreshRuntime(dir, version, { install = defaultInstall } = {}) {
  const before = readRuntimeVersion(dir);
  const stamp = `${process.pid}-${Date.now()}`;
  const staging = `${dir}.next-${stamp}`;
  const retired = `${dir}.old-${stamp}`;
  const cleanup = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ } };
  try {
    fs.mkdirSync(staging, { recursive: true });
    install(staging, version);
    const staged = readRuntimeVersion(staging);
    if (staged !== version) {
      cleanup(staging);
      return { ok: false, before, reason: 'verify-failed' };
    }
    let moved = false;
    if (fs.existsSync(dir)) {
      fs.renameSync(dir, retired);
      moved = true;
    }
    try {
      fs.renameSync(staging, dir);
    } catch (err) {
      if (moved) { try { fs.renameSync(retired, dir); } catch { /* leave retired for next try */ } }
      throw err;
    }
    if (moved) cleanup(retired);
    return { ok: true, before, after: readRuntimeVersion(dir) };
  } catch {
    cleanup(staging);
    return { ok: false, before, reason: 'install-failed' };
  }
}

async function runChild(argv) {
  const [dir, version, source] = argv;
  if (!dir || !VERSION_RE.test(String(version || ''))) return;
  const result = refreshRuntime(dir, version);
  const file = path.join(path.dirname(dir), STATE_FILE);
  writeState(file, { ...readState(file), finishedAt: Date.now(), ok: result.ok, reason: result.reason || null, after: result.after || null });
  // This child exits as soon as the work is done, so wait for the ping (about 3s at most).
  // The server keeps `reason` (as reasonCode) and `version`, so success is sent as reason "updated".
  try {
    await require('./cli-telemetry').trackEvent('runtime_auto_update', {
      ok: result.ok,
      runtimeVersion: result.before || null,
      targetVersion: version,
      reason: result.ok ? 'updated' : (result.reason || 'failed'),
      ...(source ? { source } : {}),
    }, { awaitDelivery: true });
  } catch { /* telemetry is optional */ }
}

module.exports = {
  scheduleRuntimeAutoUpdate,
  scheduleLatestCheck,
  checkLatest,
  runningFromRuntime,
  refreshRuntime,
  skipReason,
  stateFile,
  RUNTIME_AUTO_UPDATE_STATE_FILE: STATE_FILE,
};

if (require.main === module && process.argv[2] === '--child') {
  runChild(process.argv.slice(3)).catch(() => {});
}

if (require.main === module && process.argv[2] === '--check-latest' && process.argv[3]) {
  checkLatest(process.argv[3]).catch(() => {});
}
