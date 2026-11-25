'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const au = require('../scripts/runtime-auto-update');
const cu = require('../scripts/check-update');

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tg-autoupdate-'));
}

function writeRuntime(dir, version) {
  const pkgDir = path.join(dir, 'node_modules', 'thumbgate');
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: 'thumbgate', version }));
}

const SKEW = { skewed: true, runtimeVersion: '1.39.1', currentVersion: '1.41.0' };

test('scheduleRuntimeAutoUpdate spawns one detached child per 24h with ignored stdio', () => {
  const home = tmpHome();
  const dir = path.join(home, '.thumbgate', 'runtime');
  const calls = [];
  const spawnFn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { on() {}, unref() {} };
  };
  const t0 = Date.parse('2026-11-25T12:00:00Z');
  assert.deepEqual(au.scheduleRuntimeAutoUpdate({ skew: SKEW, env: {}, now: t0, dir, spawnFn, nodePath: 'node' }), { started: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.detached, true);
  assert.equal(calls[0].opts.stdio, 'ignore');
  assert.deepEqual(calls[0].args.slice(1), ['--child', dir, '1.41.0', '']);

  assert.deepEqual(au.scheduleRuntimeAutoUpdate({ skew: SKEW, env: {}, now: t0 + 60_000, dir, spawnFn }),
    { started: false, reason: 'recently-tried' });
  assert.equal(au.scheduleRuntimeAutoUpdate({ skew: SKEW, env: {}, now: t0 + 25 * 3600_000, dir, spawnFn }).started, true);
  assert.equal(calls.length, 2);
});

test('scheduleRuntimeAutoUpdate respects opt-out, CI, bad versions and no skew', () => {
  const dir = path.join(tmpHome(), '.thumbgate', 'runtime');
  const spawnFn = () => { throw new Error('must not spawn'); };
  const run = (opts) => au.scheduleRuntimeAutoUpdate({ dir, spawnFn, env: {}, ...opts }).reason;
  assert.equal(run({ skew: SKEW, env: { THUMBGATE_NO_AUTO_UPDATE: '1' } }), 'opted-out');
  assert.equal(run({ skew: SKEW, env: { CI: 'true' } }), 'ci');
  assert.equal(run({ skew: { ...SKEW, currentVersion: 'latest; rm -rf /' } }), 'bad-version');
  assert.equal(run({ skew: { ...SKEW, runtimeVersion: '1.41.0' } }), 'not-older');
  assert.equal(run({ skew: { skewed: false } }), 'not-skewed');
});

test('scheduleRuntimeAutoUpdate never spawns under the test runner without an injected spawn', () => {
  const dir = path.join(tmpHome(), '.thumbgate', 'runtime');
  const result = au.scheduleRuntimeAutoUpdate({ skew: SKEW, env: { NODE_TEST_CONTEXT: 'child' }, dir });
  assert.deepEqual(result, { started: false, reason: 'test' });
});

test('refreshRuntime swaps in a verified staged install and keeps the old one on failure', () => {
  const dir = path.join(tmpHome(), '.thumbgate', 'runtime');
  writeRuntime(dir, '1.39.1');

  const bad = au.refreshRuntime(dir, '1.41.0', { install: () => { throw new Error('offline'); } });
  assert.equal(bad.ok, false);
  assert.equal(cu.readRuntimeVersion(dir), '1.39.1');

  const wrong = au.refreshRuntime(dir, '1.41.0', { install: (prefix) => writeRuntime(prefix, '1.40.0') });
  assert.deepEqual(wrong, { ok: false, before: '1.39.1', reason: 'verify-failed' });
  assert.equal(cu.readRuntimeVersion(dir), '1.39.1');

  const good = au.refreshRuntime(dir, '1.41.0', { install: (prefix, v) => writeRuntime(prefix, v) });
  assert.deepEqual(good, { ok: true, before: '1.39.1', after: '1.41.0' });
  assert.equal(cu.readRuntimeVersion(dir), '1.41.0');

  const leftovers = fs.readdirSync(path.dirname(dir)).filter((n) => n !== 'runtime');
  assert.deepEqual(leftovers, []);
});

test('refreshRuntime creates the runtime for pinned installs that never had one', () => {
  const dir = path.join(tmpHome(), '.thumbgate', 'runtime');
  const result = au.refreshRuntime(dir, '1.41.0', { install: (prefix, v) => writeRuntime(prefix, v) });
  assert.deepEqual(result, { ok: true, before: null, after: '1.41.0' });
});

test('the skew notice says the hooks are updating when a background update started', () => {
  const notice = cu.buildSkewNotice('1.39.1', '1.41.0', { updating: true });
  assert.match(notice, /background/);
  assert.match(notice, /v1\.41\.0/);
  assert.ok(notice.includes(cu.UPDATE_COMMAND));
});

test('scheduleLatestCheck runs only from the hook runtime, once per 24h, detached', () => {
  const home = tmpHome();
  const dir = path.join(home, '.thumbgate', 'runtime');
  const self = path.join(dir, 'node_modules', 'thumbgate', 'scripts', 'runtime-auto-update.js');
  const calls = [];
  const spawnFn = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { on() {}, unref() {} }; };
  const t0 = Date.parse('2026-11-25T12:00:00Z');

  assert.deepEqual(au.scheduleLatestCheck({ env: {}, now: t0, dir, spawnFn, self: path.join(home, 'src', 'scripts', 'x.js') }),
    { started: false, reason: 'not-runtime' });
  assert.deepEqual(au.scheduleLatestCheck({ env: {}, now: t0, dir, spawnFn, self, nodePath: 'node' }), { started: true });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, [self, '--check-latest', dir]);
  assert.equal(calls[0].opts.detached, true);
  assert.equal(calls[0].opts.stdio, 'ignore');
  assert.equal(au.scheduleLatestCheck({ env: {}, now: t0 + 3600_000, dir, spawnFn, self }).reason, 'recently-checked');
  assert.equal(au.scheduleLatestCheck({ env: {}, now: t0 + 25 * 3600_000, dir, spawnFn, self }).started, true);
  assert.equal(au.scheduleLatestCheck({ env: { THUMBGATE_NO_AUTO_UPDATE: '1' }, now: t0 + 60 * 3600_000, dir, spawnFn, self }).reason, 'opted-out');
  assert.equal(au.scheduleLatestCheck({ env: { CI: 'true' }, now: t0 + 60 * 3600_000, dir, spawnFn, self }).reason, 'ci');
  assert.equal(calls.length, 2);
});

test('checkLatest refreshes only when npm latest is newer than the runtime', async () => {
  const dir = path.join(tmpHome(), '.thumbgate', 'runtime');
  writeRuntime(dir, '1.42.0');
  const refreshed = [];
  const refresh = async (argv) => { refreshed.push(argv); };
  assert.deepEqual(await au.checkLatest(dir, { latestVersion: () => '1.42.0', refresh }), { updated: false, reason: 'current' });
  assert.deepEqual(await au.checkLatest(dir, { latestVersion: () => 'not a version', refresh }), { updated: false, reason: 'bad-version' });
  assert.deepEqual(await au.checkLatest(dir, { latestVersion: () => { throw new Error('offline'); }, refresh }), { updated: false, reason: 'lookup-failed' });
  assert.deepEqual(await au.checkLatest(dir, { latestVersion: () => '1.43.0', refresh }), { updated: true, from: '1.42.0', to: '1.43.0' });
  assert.deepEqual(refreshed, [[dir, '1.43.0', 'hook']]);
  const state = JSON.parse(fs.readFileSync(path.join(path.dirname(dir), au.RUNTIME_AUTO_UPDATE_STATE_FILE), 'utf8'));
  assert.equal(state.to, '1.43.0');
});

test('checkLatest waits for a refresh the MCP path already started, and takes over a stale lock', async () => {
  const dir = path.join(tmpHome(), '.thumbgate', 'runtime');
  writeRuntime(dir, '1.42.0');
  const file = path.join(path.dirname(dir), au.RUNTIME_AUTO_UPDATE_STATE_FILE);
  const t0 = Date.parse('2026-11-25T20:00:00Z');
  fs.writeFileSync(file, JSON.stringify({ startedAt: t0, from: '1.42.0', to: '1.44.0' }));
  const refreshed = [];
  const refresh = async (argv) => { refreshed.push(argv); };
  assert.deepEqual(await au.checkLatest(dir, { latestVersion: () => '1.43.0', refresh, now: t0 + 60_000 }), { updated: false, reason: 'refresh-in-progress' });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).to, '1.44.0');
  assert.equal(refreshed.length, 0);
  fs.writeFileSync(file, JSON.stringify({ startedAt: t0, finishedAt: t0 + 30_000, ok: false }));
  assert.equal((await au.checkLatest(dir, { latestVersion: () => '1.43.0', refresh, now: t0 + 60_000 })).updated, true);
  fs.writeFileSync(file, JSON.stringify({ startedAt: t0 }));
  assert.equal((await au.checkLatest(dir, { latestVersion: () => '1.43.0', refresh, now: t0 + 11 * 60_000 })).updated, true);
  assert.equal(refreshed.length, 2);
});

test('refreshRuntime never swaps in an older runtime than the one now live', () => {
  const dir = path.join(tmpHome(), '.thumbgate', 'runtime');
  writeRuntime(dir, '1.44.0');
  const install = (prefix, version) => writeRuntime(prefix, version);
  const result = au.refreshRuntime(dir, '1.43.0', { install });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not-older');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'node_modules', 'thumbgate', 'package.json'), 'utf8')).version, '1.44.0');
  assert.deepEqual(fs.readdirSync(path.dirname(dir)).filter((n) => n.includes('.next-')), []);
});
