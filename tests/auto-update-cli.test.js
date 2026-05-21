'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  shouldTrigger,
  touchMarker,
  isOptedOut,
  markerAgeMs,
  TWENTY_FOUR_HOURS_MS,
} = require('../scripts/auto-update-cli');

function makeMarker(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `tg-au-${label}-`));
  return path.join(dir, '.last-update-check');
}

test('isOptedOut — explicit env flag disables', () => {
  assert.equal(isOptedOut({ THUMBGATE_NO_AUTO_UPDATE: '1' }), true);
  assert.equal(isOptedOut({ THUMBGATE_NO_AUTO_UPDATE: '0' }), false);
  assert.equal(isOptedOut({}), false);
});

test('isOptedOut — CI envs disable (avoids version drift surprising pipelines)', () => {
  assert.equal(isOptedOut({ CI: 'true' }), true);
  assert.equal(isOptedOut({ CI: '1' }), true);
  assert.equal(isOptedOut({ CI: 'false' }), false);
});

test('isOptedOut — NODE_ENV=test disables (tests should be deterministic)', () => {
  assert.equal(isOptedOut({ NODE_ENV: 'test' }), true);
  assert.equal(isOptedOut({ NODE_ENV: 'production' }), false);
});

test('markerAgeMs — Infinity when marker missing', () => {
  const missing = path.join(os.tmpdir(), `tg-au-missing-${Date.now()}.txt`);
  assert.equal(markerAgeMs(Date.now(), missing), Infinity);
});

test('markerAgeMs — returns elapsed milliseconds for an existing marker', () => {
  const marker = makeMarker('age');
  fs.writeFileSync(marker, 'x');
  // Sleep briefly so age is provably > 0 even on fast filesystems.
  const start = Date.now();
  while (Date.now() - start < 30) { /* spin */ }
  const now = Date.now();
  const age = markerAgeMs(now, marker);
  assert.ok(Number.isFinite(age), `age must be a finite number, got ${age}`);
  assert.ok(age >= 0, `age must be non-negative, got ${age}`);
});

test('shouldTrigger — true when marker is missing (never-checked path)', () => {
  const missing = path.join(os.tmpdir(), `tg-au-trig-missing-${Date.now()}.txt`);
  assert.equal(shouldTrigger({ markerPath: missing, env: {} }), true);
});

test('shouldTrigger — false when marker is fresh (< 24h)', () => {
  const marker = makeMarker('fresh');
  fs.writeFileSync(marker, 'x');
  assert.equal(shouldTrigger({ markerPath: marker, env: {} }), false);
});

test('shouldTrigger — true when marker is stale (>= 24h via mtime backdating)', () => {
  const marker = makeMarker('stale');
  fs.writeFileSync(marker, 'x');
  const past = Date.now() - TWENTY_FOUR_HOURS_MS - 60_000;
  fs.utimesSync(marker, past / 1000, past / 1000);
  assert.equal(shouldTrigger({ markerPath: marker, env: {} }), true);
});

test('shouldTrigger — false when opted out even if marker is stale', () => {
  const marker = makeMarker('opted-out');
  fs.writeFileSync(marker, 'x');
  const past = Date.now() - TWENTY_FOUR_HOURS_MS - 60_000;
  fs.utimesSync(marker, past / 1000, past / 1000);
  assert.equal(shouldTrigger({ markerPath: marker, env: { THUMBGATE_NO_AUTO_UPDATE: '1' } }), false);
});

test('touchMarker — creates parent dirs + writes a numeric timestamp', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-au-touch-'));
  const marker = path.join(dir, 'nested', 'sub', '.last-update-check');
  const ok = touchMarker(marker);
  assert.equal(ok, true);
  assert.ok(fs.existsSync(marker));
  const content = fs.readFileSync(marker, 'utf8');
  assert.match(content, /^\d+$/, 'marker content should be a numeric timestamp');
});

test('touchMarker — returns false (does not throw) on permission failure', () => {
  // Attempt to write at a path that's not writable.
  const ok = touchMarker('/proc/this-cannot-be-written-to/.marker');
  assert.equal(ok, false);
});

test('integration — fresh marker → no trigger → stale → trigger → touch → no trigger again', () => {
  const marker = makeMarker('integration');
  fs.writeFileSync(marker, 'x');
  // 1. Fresh: no trigger
  assert.equal(shouldTrigger({ markerPath: marker, env: {} }), false);
  // 2. Backdated to stale: trigger
  const past = Date.now() - TWENTY_FOUR_HOURS_MS - 60_000;
  fs.utimesSync(marker, past / 1000, past / 1000);
  assert.equal(shouldTrigger({ markerPath: marker, env: {} }), true);
  // 3. Touch refreshes
  assert.equal(touchMarker(marker), true);
  // 4. Refreshed → no trigger
  assert.equal(shouldTrigger({ markerPath: marker, env: {} }), false);
});
