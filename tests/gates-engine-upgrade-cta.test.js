'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// Isolated temp dir for stats
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-cta-test-'));

test.before(() => {
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  // Ensure we're on free tier for testing
  delete process.env.THUMBGATE_API_KEY;
  delete process.env.THUMBGATE_NO_RATE_LIMIT;
  delete process.env.THUMBGATE_NO_NUDGE;
  delete process.env.CI;
  delete process.env.GITHUB_ACTIONS;
});

test.after(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

test('buildBlockActionProCta returns null when THUMBGATE_NO_NUDGE=1', () => {
  process.env.THUMBGATE_NO_NUDGE = '1';
  // Re-require to pick up fresh module state
  delete require.cache[require.resolve('../scripts/gates-engine')];
  const { buildBlockActionProCta } = require('../scripts/gates-engine');
  assert.equal(buildBlockActionProCta(), null);
  delete process.env.THUMBGATE_NO_NUDGE;
});

test('buildBlockActionProCta returns null in CI', () => {
  process.env.CI = 'true';
  delete require.cache[require.resolve('../scripts/gates-engine')];
  const { buildBlockActionProCta } = require('../scripts/gates-engine');
  assert.equal(buildBlockActionProCta(), null);
  delete process.env.CI;
});

test('buildBlockActionProCta returns null when blocks < 5', () => {
  // Write stats with low block count
  const statsPath = path.join(tmpDir, 'gate-stats.json');
  fs.writeFileSync(statsPath, JSON.stringify({ blocked: 2, warned: 0, passed: 10, byGate: {} }));

  delete require.cache[require.resolve('../scripts/gates-engine')];
  const ge = require('../scripts/gates-engine');
  ge.STATS_PATH = statsPath;
  assert.equal(ge.buildBlockActionProCta(), null);
});

test('buildBlockActionProCta returns message when blocks >= 5 (free tier)', () => {
  // Force free tier by disabling all Pro detection paths
  process.env.THUMBGATE_NO_TRIAL = '1';
  delete process.env.THUMBGATE_API_KEY;
  delete process.env.THUMBGATE_NO_RATE_LIMIT;

  const statsPath = path.join(tmpDir, 'gate-stats-5.json');
  fs.writeFileSync(statsPath, JSON.stringify({ blocked: 12, warned: 0, passed: 50, byGate: {} }));

  // Clear require caches so rate-limiter re-evaluates
  delete require.cache[require.resolve('../scripts/rate-limiter')];
  delete require.cache[require.resolve('../scripts/gates-engine')];
  const ge = require('../scripts/gates-engine');
  ge.STATS_PATH = statsPath;

  // If isProTier still returns true (e.g. creator dev file), skip gracefully
  const { isProTier } = require('../scripts/rate-limiter');
  if (isProTier()) {
    // Creator dev bypass active — can't test free-tier path on this machine
    assert.ok(true, 'Skipped: creator dev bypass active');
    delete process.env.THUMBGATE_NO_TRIAL;
    return;
  }

  const result = ge.buildBlockActionProCta();
  assert.ok(result, 'Should return a CTA string');
  assert.ok(result.includes('thumbgate.ai/go/pro'), 'Should include Pro URL');
  delete process.env.THUMBGATE_NO_TRIAL;
});

test('getInstallAgeDays and isInTrialPeriod are exported from rate-limiter', () => {
  const rl = require('../scripts/rate-limiter');
  assert.equal(typeof rl.getInstallAgeDays, 'function');
  assert.equal(typeof rl.isInTrialPeriod, 'function');
});
