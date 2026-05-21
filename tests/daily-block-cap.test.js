'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// Isolated temp dir for stats
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-blockcap-test-'));

test.before(() => {
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  delete process.env.THUMBGATE_API_KEY;
  delete process.env.THUMBGATE_NO_RATE_LIMIT;
  delete process.env.CI;
  delete process.env.GITHUB_ACTIONS;
  process.env.THUMBGATE_NO_TRIAL = '1';
});

test.after(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  delete process.env.THUMBGATE_NO_TRIAL;
});

test('applyDailyBlockCap returns null for Pro users', () => {
  process.env.THUMBGATE_API_KEY = 'sk-test-pro';
  delete require.cache[require.resolve('../scripts/rate-limiter')];
  delete require.cache[require.resolve('../scripts/gates-engine')];
  const { applyDailyBlockCap } = require('../scripts/gates-engine');

  const denyResult = { decision: 'deny', gate: 'test-gate', message: 'blocked', severity: 'high', reasoning: [] };
  assert.equal(applyDailyBlockCap(denyResult), null, 'Pro users should not be capped');
  delete process.env.THUMBGATE_API_KEY;
});

test('applyDailyBlockCap returns null in CI', () => {
  process.env.CI = 'true';
  delete require.cache[require.resolve('../scripts/rate-limiter')];
  delete require.cache[require.resolve('../scripts/gates-engine')];
  const { applyDailyBlockCap } = require('../scripts/gates-engine');

  const denyResult = { decision: 'deny', gate: 'test-gate', message: 'blocked', severity: 'high', reasoning: [] };
  assert.equal(applyDailyBlockCap(denyResult), null, 'CI should not be capped');
  delete process.env.CI;
});

test('applyDailyBlockCap returns null when under limit', () => {
  delete process.env.THUMBGATE_API_KEY;
  delete process.env.CI;
  process.env.THUMBGATE_NO_TRIAL = '1';

  // Write stats with zero daily blocks
  const statsPath = path.join(tmpDir, 'gate-stats-cap.json');
  fs.writeFileSync(statsPath, JSON.stringify({ blocked: 0, warned: 0, passed: 0, byGate: {}, dailyBlocks: {} }));

  delete require.cache[require.resolve('../scripts/rate-limiter')];
  delete require.cache[require.resolve('../scripts/gates-engine')];
  const ge = require('../scripts/gates-engine');

  // Skip if creator dev bypass is active
  const { isProTier } = require('../scripts/rate-limiter');
  if (isProTier()) {
    assert.ok(true, 'Skipped: creator dev bypass active');
    return;
  }

  ge.STATS_PATH = statsPath;

  const denyResult = { decision: 'deny', gate: 'test-gate', message: 'blocked', severity: 'high', reasoning: [] };
  const result = ge.applyDailyBlockCap(denyResult);
  assert.equal(result, null, 'Under limit should allow block through');
});

test('applyDailyBlockCap downgrades deny to warn when over limit', () => {
  delete process.env.THUMBGATE_API_KEY;
  delete process.env.CI;
  process.env.THUMBGATE_NO_TRIAL = '1';

  const { FREE_TIER_DAILY_BLOCKS } = require('../scripts/rate-limiter');

  // Write stats with daily blocks at the limit
  const statsPath = path.join(tmpDir, 'gate-stats-over.json');
  const today = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(statsPath, JSON.stringify({
    blocked: FREE_TIER_DAILY_BLOCKS,
    warned: 0,
    passed: 0,
    byGate: {},
    dailyBlocks: { [today]: FREE_TIER_DAILY_BLOCKS },
  }));

  delete require.cache[require.resolve('../scripts/rate-limiter')];
  delete require.cache[require.resolve('../scripts/gates-engine')];
  const ge = require('../scripts/gates-engine');

  // Skip if creator dev bypass is active
  const { isProTier } = require('../scripts/rate-limiter');
  if (isProTier()) {
    assert.ok(true, 'Skipped: creator dev bypass active');
    return;
  }

  ge.STATS_PATH = statsPath;

  const denyResult = { decision: 'deny', gate: 'test-gate', message: 'Action blocked', severity: 'high', reasoning: ['test'] };
  const result = ge.applyDailyBlockCap(denyResult);
  assert.ok(result, 'Over limit should return capped result');
  assert.equal(result.decision, 'warn', 'Should downgrade to warn');
  assert.ok(result.message.includes('thumbgate.ai/go/pro'), 'Should include upgrade URL');
  assert.ok(result.message.includes('Daily protection limit reached'), 'Should mention limit');
  assert.equal(result.dailyBlockCapApplied, true, 'Should flag cap applied');
});

test('FREE_TIER_DAILY_BLOCKS is exported from rate-limiter', () => {
  const rl = require('../scripts/rate-limiter');
  assert.equal(typeof rl.FREE_TIER_DAILY_BLOCKS, 'number');
  assert.ok(rl.FREE_TIER_DAILY_BLOCKS > 0, 'Should be positive');
  assert.ok(rl.FREE_TIER_DAILY_BLOCKS <= 25, 'Should be reasonable (<=25)');
});
