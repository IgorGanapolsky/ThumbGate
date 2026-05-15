#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Point the install-id helper at an isolated tmp HOME before requiring any
// of the modules under test, so we never pollute the real ~/.thumbgate dir.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-activation-'));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;
// Ensure no real telemetry POST fires from the tracker's underlying trackEvent
// call. The marker write path runs regardless of this flag.
process.env.THUMBGATE_NO_TELEMETRY = '1';

const tracker = require('../scripts/activation-tracker');
const { INSTALL_ID_PATH } = require('../scripts/cli-telemetry');

function seedInstallMarker({ ageMs }) {
  const dir = path.dirname(INSTALL_ID_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(INSTALL_ID_PATH, 'test-install-uuid');
  const past = new Date(Date.now() - ageMs);
  fs.utimesSync(INSTALL_ID_PATH, past, past);
}

test.beforeEach(() => {
  tracker.resetForTesting();
  if (fs.existsSync(INSTALL_ID_PATH)) fs.unlinkSync(INSTALL_ID_PATH);
});

test('computeDaysSinceInstall returns null when install marker missing', () => {
  assert.equal(tracker.computeDaysSinceInstall(), null);
});

test('computeDaysSinceInstall returns days with 1-decimal precision', () => {
  seedInstallMarker({ ageMs: 3 * 86_400_000 + 6 * 3_600_000 }); // 3.25d
  const days = tracker.computeDaysSinceInstall();
  assert.ok(typeof days === 'number');
  assert.ok(days >= 3.2 && days <= 3.3, `expected ~3.25, got ${days}`);
});

test('recordFirstRulePromotion writes marker, returns true on first call, false thereafter', () => {
  seedInstallMarker({ ageMs: 86_400_000 }); // 1 day ago
  const first = tracker.recordFirstRulePromotion({ promotionCount: 1 });
  assert.equal(first, false, 'opt-out env should suppress the trackEvent send, but marker still writes');
  const marker = tracker.readMarker();
  assert.ok(marker, 'marker should be written even under opt-out so future runs do not double-fire');
  assert.equal(marker.telemetryOptOut, true);

  // Second call must be a no-op since marker exists
  const second = tracker.recordFirstRulePromotion({ promotionCount: 5 });
  assert.equal(second, false);
});

test('recordFirstRulePromotion fires telemetry when opt-out flag is clear', () => {
  delete process.env.THUMBGATE_NO_TELEMETRY;
  delete process.env.DO_NOT_TRACK;
  seedInstallMarker({ ageMs: 0.5 * 86_400_000 }); // 12h ago
  const fired = tracker.recordFirstRulePromotion({ promotionCount: 2, totalGates: 3 });
  // Restore for other tests
  process.env.THUMBGATE_NO_TELEMETRY = '1';
  assert.equal(fired, true);
  const marker = tracker.readMarker();
  assert.ok(marker);
  assert.equal(typeof marker.daysToFirstRule, 'number');
  assert.ok(marker.daysToFirstRule >= 0.4 && marker.daysToFirstRule <= 0.6);
  assert.equal(marker.promotionCount, 2);
  assert.equal(marker.totalGates, 3);
  assert.ok(['ci', 'owner', 'real_user'].includes(marker.visitorType));
});

test('marker survives across module-state resets (idempotency check)', () => {
  seedInstallMarker({ ageMs: 86_400_000 });
  tracker.recordFirstRulePromotion();
  // Re-require: even if module state is rebuilt, the marker file is the
  // single source of truth.
  delete require.cache[require.resolve('../scripts/activation-tracker')];
  const reloaded = require('../scripts/activation-tracker');
  const result = reloaded.recordFirstRulePromotion();
  assert.equal(result, false);
});

test.after(() => {
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch {}
});
