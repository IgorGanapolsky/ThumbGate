'use strict';

// A configured rule that denies must deny every time. The free tier used to
// downgrade every DENY to a WARN once a user passed a daily block quota; that
// path is gone. Free-tier limits remain only on how many auto-promoted rules
// load and how many feedback captures a free user can make.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ENV_KEYS = [
  'HOME', 'USERPROFILE', 'THUMBGATE_FEEDBACK_DIR', 'THUMBGATE_STATE_DIR', 'THUMBGATE_API_KEY',
  'THUMBGATE_DEV_BYPASS', 'THUMBGATE_NO_RATE_LIMIT', 'THUMBGATE_NO_TRIAL', 'THUMBGATE_STRICT_ENFORCEMENT',
  'THUMBGATE_GOVERNANCE_MODE', 'THUMBGATE_GATES_CONFIG', 'THUMBGATE_SANDBOX_EVAL', 'CI', 'GITHUB_ACTIONS',
];

function freshModules() {
  for (const mod of ['../scripts/rate-limiter', '../scripts/gates-engine']) {
    delete require.cache[require.resolve(mod)];
  }
  return { rl: require('../scripts/rate-limiter'), ge: require('../scripts/gates-engine') };
}

// Point HOME at an empty dir so isProTier() reflects a genuine free install
// even on a maintainer machine with a saved license or dev bypass, and clear
// CI so the run is not exempted by an environment shortcut.
function withFreeTier(fn) {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-free-enforce-'));
  const home = path.join(root, 'home');
  const feedbackDir = path.join(root, 'feedback');
  fs.mkdirSync(home);
  fs.mkdirSync(feedbackDir);
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
  process.env.THUMBGATE_STATE_DIR = feedbackDir;
  process.env.THUMBGATE_NO_TRIAL = '1';
  try {
    const mods = freshModules();
    assert.equal(mods.rl.isProTier(), false, 'setup must produce a free-tier user');
    return fn({ ...mods, root, feedbackDir });
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    freshModules();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('free tier: the 1st and the 1,000th DENY of the day are both DENY', () => {
  withFreeTier(({ ge, root, feedbackDir }) => {
    process.env.THUMBGATE_STRICT_ENFORCEMENT = '1';
    const configPath = path.join(root, 'gates.json');
    fs.writeFileSync(configPath, JSON.stringify({
      version: 1,
      gates: [{
        id: 'test-forbidden-marker',
        layer: 'Execution',
        pattern: 'forbidden-marker-7f3a',
        action: 'block',
        message: 'forbidden marker is blocked',
        severity: 'high',
      }],
    }));
    ge.STATS_PATH = path.join(feedbackDir, 'gate-stats.json');

    const deny = (i) => ge.evaluateGates('Bash', { command: `echo forbidden-marker-7f3a ${i}` }, configPath);

    assert.equal(deny(1).decision, 'deny', '1st deny of the day');

    // Fast-forward to 999 blocks already today, including the legacy per-day
    // counter an older install may still carry, then take the 1,000th.
    const today = new Date().toISOString().slice(0, 10);
    const stats = JSON.parse(fs.readFileSync(ge.STATS_PATH, 'utf8'));
    stats.blocked = 999;
    stats.dailyBlocks = { [today]: 999 };
    fs.writeFileSync(ge.STATS_PATH, JSON.stringify(stats));

    const thousandth = deny(1000);
    assert.equal(thousandth.decision, 'deny', '1,000th deny of the day');
    assert.equal(thousandth.dailyBlockCapApplied, undefined);
    assert.equal(JSON.parse(fs.readFileSync(ge.STATS_PATH, 'utf8')).blocked, 1000);
  });
});

test('no daily block quota is exported or applied', () => {
  const { rl, ge } = freshModules();
  assert.equal('FREE_TIER_DAILY_BLOCKS' in rl, false);
  assert.equal('applyDailyBlockCap' in ge, false);
  assert.equal('getTodayBlockCount' in ge, false);
  assert.equal('incrementTodayBlockCount' in ge, false);
  const engineSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'gates-engine.js'), 'utf8');
  assert.doesNotMatch(engineSource, /dailyBlockCap|dailyBlocks|FREE_TIER_DAILY_BLOCKS/);
});

test('free tier still loads at most FREE_TIER_MAX_GATES auto-promoted rules', () => {
  withFreeTier(({ rl, ge, feedbackDir }) => {
    const autoGates = Array.from({ length: rl.FREE_TIER_MAX_GATES + 4 }, (_, i) => ({
      id: `auto-test-rule-${i}`,
      pattern: `auto-test-marker-${i}`,
      action: 'block',
      message: `auto rule ${i}`,
      projectKey: 'unassigned',
    }));
    fs.writeFileSync(path.join(feedbackDir, 'auto-promoted-gates.json'), JSON.stringify({ version: 1, gates: autoGates }));

    const config = ge.loadGatesConfig(undefined, undefined, { feedbackDir });
    const loaded = config.gates.filter((g) => String(g.id).startsWith('auto-test-rule-'));
    assert.equal(loaded.length, rl.FREE_TIER_MAX_GATES);
  });
});

test('free tier still caps feedback captures', () => {
  withFreeTier(({ rl }) => {
    const { daily } = rl.FREE_TIER_LIMITS.capture_feedback;
    for (let i = 0; i < daily; i += 1) {
      assert.equal(rl.checkLimit('capture_feedback').allowed, true, `capture ${i + 1} is within the free limit`);
    }
    const over = rl.checkLimit('capture_feedback');
    assert.equal(over.allowed, false, 'capture past the free limit is refused');
    assert.equal(over.limitType, 'daily');
  });
});
