'use strict';

// 25 Nov 2026: the hook runtime sat at 1.42.1 while npm latest was 1.45.2. Three gaps, one test group each:
// the 24h lock held back a newer release after a successful update, init left an older runtime alone,
// and old runtimes never checked npm on their own (the shim now does, once a day).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const au = require('../scripts/runtime-auto-update');

function tmpHome() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-update-gaps-')));
}
function writeRuntime(dir, version) {
  const pkgDir = path.join(dir, 'node_modules', 'thumbgate');
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: 'thumbgate', version }));
}
function recorder() {
  const calls = [];
  return { calls, spawnFn: (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { on() {}, unref() {} }; } };
}
const T0 = Date.parse('2026-11-25T18:00:00Z');

test('24h lock: a finished successful update to an older target does not hold back a newer release', () => {
  const home = tmpHome();
  const dir = path.join(home, '.thumbgate', 'runtime');
  const file = path.join(home, '.thumbgate', au.RUNTIME_AUTO_UPDATE_STATE_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ startedAt: T0, from: '1.41.0', to: '1.42.0', finishedAt: T0 + 60_000, ok: true }));
  const { calls, spawnFn } = recorder();
  const skew = { skewed: true, runtimeVersion: '1.42.0', currentVersion: '1.45.2' };
  assert.deepEqual(au.scheduleRuntimeAutoUpdate({ skew, env: {}, now: T0 + 3600_000, dir, spawnFn, nodePath: 'node' }), { started: true });
  assert.equal(calls.length, 1);
  fs.rmSync(home, { recursive: true, force: true });
});

test('24h lock: still holds after a failed attempt, after a success to the same target, and while a refresh is running', () => {
  const home = tmpHome();
  const dir = path.join(home, '.thumbgate', 'runtime');
  const file = path.join(home, '.thumbgate', au.RUNTIME_AUTO_UPDATE_STATE_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { spawnFn } = recorder();
  const skew = { skewed: true, runtimeVersion: '1.42.0', currentVersion: '1.45.2' };
  const tryAt = (state, now) => { fs.writeFileSync(file, JSON.stringify(state)); return au.scheduleRuntimeAutoUpdate({ skew, env: {}, now, dir, spawnFn, nodePath: 'node' }); };
  assert.deepEqual(tryAt({ startedAt: T0, to: '1.45.2', finishedAt: T0 + 1000, ok: false }, T0 + 3600_000), { started: false, reason: 'recently-tried' });
  assert.deepEqual(tryAt({ startedAt: T0, to: '1.45.2', finishedAt: T0 + 1000, ok: true }, T0 + 3600_000), { started: false, reason: 'recently-tried' });
  assert.deepEqual(tryAt({ startedAt: T0, to: '1.44.0' }, T0 + 60_000), { started: false, reason: 'recently-tried' });
  assert.equal(tryAt({ startedAt: T0, to: '1.45.2', ok: false, finishedAt: T0 + 1 }, T0 + 25 * 3600_000).started, true, 'a failure is retried after 24h');
  fs.rmSync(home, { recursive: true, force: true });
});

test('init: an older runtime is refreshed to the running package version, detached, ignoring the 24h lock', () => {
  const home = tmpHome();
  const dir = path.join(home, '.thumbgate', 'runtime');
  writeRuntime(dir, '1.42.1');
  const file = path.join(home, '.thumbgate', au.RUNTIME_AUTO_UPDATE_STATE_FILE);
  fs.writeFileSync(file, JSON.stringify({ startedAt: T0, to: '1.42.1', finishedAt: T0 + 1000, ok: false }));
  const { calls, spawnFn } = recorder();
  const r = au.refreshRuntimeOnInit({ packageVersion: '1.45.2', env: {}, now: T0 + 60_000, dir, spawnFn, nodePath: 'node' });
  assert.deepEqual(r, { started: true });
  assert.deepEqual(calls[0].args.slice(1), ['--child', dir, '1.45.2', 'init']);
  assert.equal(calls[0].opts.detached, true);
  fs.rmSync(home, { recursive: true, force: true });
});

test('init: leaves a current runtime, a missing runtime, an opt-out, and a refresh still running alone', () => {
  const home = tmpHome();
  const dir = path.join(home, '.thumbgate', 'runtime');
  const { calls, spawnFn } = recorder();
  const go = (extra = {}) => au.refreshRuntimeOnInit({ packageVersion: '1.45.2', env: {}, now: T0, dir, spawnFn, nodePath: 'node', ...extra });
  assert.deepEqual(go(), { started: false, reason: 'no-runtime' });
  writeRuntime(dir, '1.45.2');
  assert.deepEqual(go(), { started: false, reason: 'current' });
  writeRuntime(dir, '1.42.1');
  assert.deepEqual(go({ env: { THUMBGATE_NO_AUTO_UPDATE: '1' } }), { started: false, reason: 'opted-out' });
  assert.deepEqual(go({ packageVersion: 'next' }), { started: false, reason: 'bad-version' });
  const file = path.join(home, '.thumbgate', au.RUNTIME_AUTO_UPDATE_STATE_FILE);
  fs.writeFileSync(file, JSON.stringify({ startedAt: T0 - 1000, to: '1.45.2' }));
  assert.deepEqual(go(), { started: false, reason: 'recently-tried' });
  assert.equal(calls.length, 0);
  fs.rmSync(home, { recursive: true, force: true });
});

test('shim: once a day it starts a detached --check-latest on the runtime, and THUMBGATE_NO_AUTO_UPDATE=1 turns it off', async () => {
  const home = tmpHome();
  const runtime = path.join(home, '.thumbgate', 'runtime');
  const bin = path.join(runtime, 'node_modules', '.bin', 'thumbgate');
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.writeFileSync(bin, '#!/usr/bin/env bash\necho ran-runtime\n', { mode: 0o755 });
  const scriptDir = path.join(runtime, 'node_modules', 'thumbgate', 'scripts');
  fs.mkdirSync(scriptDir, { recursive: true });
  const marker = path.join(home, 'marker.txt');
  // The stand-in updater mentions --check-latest (the shim greps for it) and records its argv.
  fs.writeFileSync(path.join(scriptDir, 'runtime-auto-update.js'),
    `// supports --check-latest\nrequire('fs').appendFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(' ') + '\\n');\n`);
  const savedHome = process.env.HOME;
  process.env.HOME = home;
  delete require.cache[require.resolve('../scripts/install-shim')];
  const { installShim } = require('../scripts/install-shim');
  const shim = installShim();
  process.env.HOME = savedHome;
  const run = (extraEnv = {}) => cp.spawnSync('bash', [shim], { env: { PATH: process.env.PATH, HOME: home, ...extraEnv }, encoding: 'utf8' });
  const waitForMarker = async (lines) => {
    for (let i = 0; i < 40; i += 1) {
      if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim().split('\n').length >= lines) return;
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  const optedOut = run({ THUMBGATE_NO_AUTO_UPDATE: '1' });
  assert.match(optedOut.stdout, /ran-runtime/);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(fs.existsSync(marker), false, 'opt-out starts no check');

  const first = run();
  assert.match(first.stdout, /ran-runtime/, 'the hook still runs the runtime');
  await waitForMarker(1);
  assert.equal(fs.readFileSync(marker, 'utf8').trim(), `--check-latest ${runtime}`);

  run();
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(fs.readFileSync(marker, 'utf8').trim().split('\n').length, 1, 'a second run the same day starts no second check');

  // A stamp older than a day lets the next run check again.
  const stamp = path.join(home, '.thumbgate', 'shim-latest-check');
  const old = new Date(Date.now() - 2 * 24 * 3600_000);
  fs.utimesSync(stamp, old, old);
  run();
  await waitForMarker(2);
  assert.equal(fs.readFileSync(marker, 'utf8').trim().split('\n').length, 2, 'a day later it checks again');
  fs.rmSync(home, { recursive: true, force: true });
});
