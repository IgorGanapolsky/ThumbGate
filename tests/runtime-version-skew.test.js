'use strict';

// Loop 2 of docs/decisions/2026-11-24-revenue-funnel-activation.md: old hook runtimes never
// self-upgrade, so fixes never reached them. Detect and report the gap; update only on request.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const cu = require('../scripts/check-update');

function fakeRuntime(version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-runtime-'));
  if (version) {
    const pkgDir = path.join(dir, 'node_modules', 'thumbgate');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: 'thumbgate', version }));
  }
  return dir;
}

test('isOlder compares semver triples and refuses junk', () => {
  assert.equal(cu.isOlder('1.39.1', '1.40.13'), true);
  assert.equal(cu.isOlder('1.40.13', '1.40.13'), false);
  assert.equal(cu.isOlder('2.0.0', '1.99.99'), false);
  assert.equal(cu.isOlder('unknown', '1.40.13'), false);
});

test('detectSkew flags an older cached runtime and ignores a missing one', () => {
  assert.deepEqual(cu.detectSkew({ currentVersion: '1.40.13', dir: fakeRuntime('1.39.1') }),
    { skewed: true, runtimeVersion: '1.39.1', currentVersion: '1.40.13' });
  assert.equal(cu.detectSkew({ currentVersion: '1.40.13', dir: fakeRuntime('1.40.13') }).skewed, false);
  assert.equal(cu.detectSkew({ currentVersion: '1.40.13', dir: fakeRuntime(null) }).skewed, false);
});

test('the notice names both versions and the one update command', () => {
  const notice = cu.buildSkewNotice('1.39.1', '1.40.13');
  assert.match(notice, /v1\.39\.1/);
  assert.match(notice, /v1\.40\.13/);
  assert.ok(notice.includes(cu.UPDATE_COMMAND));
});

test('reportSkewOnce pings at most once per 24h and respects opt-out', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-skew-state-'));
  const calls = [];
  const track = (eventType, metadata) => calls.push({ eventType, metadata });
  const skew = { skewed: true, runtimeVersion: '1.39.1', currentVersion: '1.40.13' };
  const t0 = Date.parse('2026-11-24T12:00:00Z');
  assert.equal(cu.reportSkewOnce({ skew, env: {}, now: t0, stateDir, track }), true);
  assert.equal(cu.reportSkewOnce({ skew, env: {}, now: t0 + 60_000, stateDir, track }), false);
  assert.equal(cu.reportSkewOnce({ skew, env: {}, now: t0 + 25 * 3600_000, stateDir, track }), true);
  assert.equal(cu.reportSkewOnce({ skew, env: { THUMBGATE_NO_TELEMETRY: '1' }, now: t0 + 60 * 3600_000, stateDir, track }), false);
  assert.equal(cu.reportSkewOnce({ skew: { skewed: false }, env: {}, now: t0 + 90 * 3600_000, stateDir, track }), false);
  assert.deepEqual(calls.map((c) => c.eventType), ['runtime_version_skew', 'runtime_version_skew']);
  assert.deepEqual(calls[0].metadata, { runtimeVersion: '1.39.1', currentVersion: '1.40.13' });
});

test('refreshHookRuntime updates an existing runtime with npm and skips when none exists', () => {
  const runs = [];
  const dir = fakeRuntime('1.39.1');
  const res = cu.refreshHookRuntime({ dir, run: (cmd, args) => runs.push([cmd, ...args]) });
  assert.equal(res.refreshed, true);
  assert.deepEqual(runs[0].slice(0, 4), ['npm', 'install', '--prefix', dir]);
  assert.equal(runs[0][runs[0].length - 1], 'thumbgate@latest');

  const missing = path.join(os.tmpdir(), `tg-runtime-missing-${process.pid}-${Date.now()}`);
  assert.deepEqual(cu.refreshHookRuntime({ dir: missing, run: () => { throw new Error('must not run'); } }),
    { refreshed: false, reason: 'no-runtime' });

  // A runtime folder with a missing or broken manifest is still repaired.
  const broken = fakeRuntime(null);
  assert.equal(cu.refreshHookRuntime({ dir: broken, run: (cmd, args) => runs.push([cmd, ...args]) }).refreshed, true);
  assert.equal(runs[1][3], broken);

  const failed = cu.refreshHookRuntime({ dir, run: () => { throw new Error('offline'); } });
  assert.equal(failed.reason, 'install-failed');
});
