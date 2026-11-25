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
