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

function defaultInstall(prefix, version) {
  const args = ['install', '--prefix', prefix, '--no-save', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error', `thumbgate@${version}`];
  const opts = { stdio: 'ignore', timeout: INSTALL_TIMEOUT_MS, windowsHide: true };
  if (process.platform === 'win32') {
    // npm.cmd needs cmd.exe; run npm-cli.js with node instead (same as check-update npmRunner).
    const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    execFileSync(process.execPath, [cli, ...args], opts);
    return;
  }
  execFileSync('npm', args, opts);
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

function runChild(argv) {
  const [dir, version, source] = argv;
  if (!dir || !VERSION_RE.test(String(version || ''))) return;
  const result = refreshRuntime(dir, version);
  const file = path.join(path.dirname(dir), STATE_FILE);
  writeState(file, { ...readState(file), finishedAt: Date.now(), ok: result.ok, reason: result.reason || null, after: result.after || null });
  try {
    require('./cli-telemetry').trackEvent('runtime_auto_update', {
      ok: result.ok,
      runtimeVersion: result.before || null,
      targetVersion: version,
      ...(result.reason ? { reason: result.reason } : {}),
      ...(source ? { source } : {}),
    });
  } catch { /* telemetry is optional */ }
}

module.exports = {
  scheduleRuntimeAutoUpdate,
  refreshRuntime,
  skipReason,
  stateFile,
  RUNTIME_AUTO_UPDATE_STATE_FILE: STATE_FILE,
};

if (require.main === module && process.argv[2] === '--child') {
  runChild(process.argv.slice(3));
}
