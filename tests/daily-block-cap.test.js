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

test('applyDailyBlockCap never downgrades catastrophic gates even over limit and under strict enforcement (regression: issue #2782)', () => {
  // Reproduces the exact scenario reported by Andy Martin (2026-07-08): a
  // free-tier user past the daily block cap had a "catastrophic" command
  // (force-push, git reset --hard, git clean -f, rm -rf on home/root) fall
  // back to a warning instead of staying blocked, with THUMBGATE_STRICT_ENFORCEMENT
  // set — applyDailyBlockCap had no notion of "catastrophic" and no strict-mode
  // check at all.
  //
  // isProTier() also checks a creator/dogfooding dev bypass keyed off the
  // real $HOME (~/.config/thumbgate/dev.json) and a real license file — on a
  // maintainer's own machine that bypass is active, which would otherwise
  // make this test silently no-op via the "skip if Pro" pattern used
  // elsewhere in this file. Per the project's own audit lesson ("tests for
  // Pro-gated features must inject the gate predicate, not couple to an
  // operator's saved local Pro license"), point $HOME at an empty temp dir
  // for the duration of this test so isProTier() reflects a genuine
  // free-tier install regardless of whose machine runs it.
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-blockcap-fakehome-'));
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
  delete process.env.THUMBGATE_API_KEY;
  delete process.env.THUMBGATE_DEV_BYPASS;
  delete process.env.CI;
  process.env.THUMBGATE_NO_TRIAL = '1';
  process.env.THUMBGATE_STRICT_ENFORCEMENT = '1';

  try {
    const { FREE_TIER_DAILY_BLOCKS, isProTier } = require('../scripts/rate-limiter');

    const statsPath = path.join(tmpDir, 'gate-stats-catastrophic.json');
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

    assert.equal(isProTier(), false, 'test setup must produce a genuine free-tier isProTier() result — the fix under test cannot be exercised otherwise');

    ge.STATS_PATH = statsPath;

    for (const gateId of ['force-push', 'git-reset-hard', 'git-clean-force', 'rm-rf-home-or-root', 'financial-control']) {
      const denyResult = { decision: 'deny', gate: gateId, message: 'Destructive command blocked', severity: 'critical', reasoning: ['test'] };
      const result = ge.applyDailyBlockCap(denyResult);
      assert.equal(result, null, `${gateId} must never be downgraded by the daily block cap`);
    }

    // A non-catastrophic gate at the same over-limit state still legitimately
    // downgrades — the free-tier limitation itself is not being removed, only
    // the catastrophic floor is exempted.
    const nonCatastrophic = ge.applyDailyBlockCap({ decision: 'deny', gate: 'style-violation-log', message: 'x', severity: 'low', reasoning: [] });
    assert.ok(nonCatastrophic, 'non-catastrophic gates still respect the daily cap');
    assert.equal(nonCatastrophic.decision, 'warn');
  } finally {
    delete process.env.THUMBGATE_STRICT_ENFORCEMENT;
    if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = originalUserProfile;
    fs.rmSync(fakeHome, { recursive: true, force: true });
    delete require.cache[require.resolve('../scripts/rate-limiter')];
    delete require.cache[require.resolve('../scripts/gates-engine')];
  }
});

test('FREE_TIER_DAILY_BLOCKS is exported from rate-limiter', () => {
  const rl = require('../scripts/rate-limiter');
  assert.equal(typeof rl.FREE_TIER_DAILY_BLOCKS, 'number');
  assert.ok(rl.FREE_TIER_DAILY_BLOCKS > 0, 'Should be positive');
  assert.ok(rl.FREE_TIER_DAILY_BLOCKS <= 25, 'Should be reasonable (<=25)');
});
