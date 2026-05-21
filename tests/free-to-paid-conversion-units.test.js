'use strict';

/**
 * Unit tests for the free-to-paid conversion feature additions:
 *
 *   - scripts/rate-limiter.js: getInstallAgeDays, isInTrialPeriod,
 *     trialDaysRemaining, FREE_TIER_DAILY_BLOCKS, todayKey
 *   - scripts/gates-engine.js: getTodayBlockCount, incrementTodayBlockCount,
 *     applyDailyBlockCap, buildBlockActionProCta
 *   - scripts/cli-telemetry.js: SESSION_ID export shape, payload assembly
 *     (clientType, sessionId)
 *
 * These exercise the new lines added in PR #2279 directly so SonarCloud sees
 * line-level coverage on the diff. They avoid spawning subprocesses where
 * possible to keep the test suite fast.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function freshHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-f2p-home-'));
  return dir;
}

function makeInstallId(homeDir, ageDays) {
  const idDir = path.join(homeDir, '.thumbgate');
  fs.mkdirSync(idDir, { recursive: true });
  const idFile = path.join(idDir, 'install-id');
  fs.writeFileSync(idFile, 'test-uuid-' + Math.random().toString(36).slice(2));
  if (ageDays != null) {
    const ts = (Date.now() - ageDays * 86400000) / 1000;
    fs.utimesSync(idFile, ts, ts);
  }
  return idFile;
}

function freshRequire(modPath) {
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

// ---------------------------------------------------------------------------
// rate-limiter: trial / install-age helpers
// ---------------------------------------------------------------------------

test('rate-limiter.getInstallAgeDays returns null when install-id file is missing', () => {
  const home = freshHome();
  const savedHome = process.env.HOME;
  process.env.HOME = home;
  try {
    delete require.cache[require.resolve('../scripts/cli-telemetry')];
    const rl = freshRequire('../scripts/rate-limiter');
    assert.equal(rl.getInstallAgeDays(), null);
  } finally {
    if (savedHome != null) process.env.HOME = savedHome; else delete process.env.HOME;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('rate-limiter.getInstallAgeDays returns positive number when install-id exists', () => {
  const home = freshHome();
  const savedHome = process.env.HOME;
  process.env.HOME = home;
  try {
    delete require.cache[require.resolve('../scripts/cli-telemetry')];
    makeInstallId(home, 3); // 3 days old
    const rl = freshRequire('../scripts/rate-limiter');
    const age = rl.getInstallAgeDays();
    assert.ok(typeof age === 'number');
    assert.ok(age >= 2.9 && age <= 3.1, `expected ~3 days, got ${age}`);
  } finally {
    if (savedHome != null) process.env.HOME = savedHome; else delete process.env.HOME;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('rate-limiter.isInTrialPeriod returns true mid-trial and false after expiry', () => {
  const home = freshHome();
  const savedHome = process.env.HOME;
  const savedCI = process.env.CI;
  const savedGHA = process.env.GITHUB_ACTIONS;
  const savedNoTrial = process.env.THUMBGATE_NO_TRIAL;
  process.env.HOME = home;
  delete process.env.CI;
  delete process.env.GITHUB_ACTIONS;
  delete process.env.THUMBGATE_NO_TRIAL;
  try {
    delete require.cache[require.resolve('../scripts/cli-telemetry')];
    makeInstallId(home, 5);
    let rl = freshRequire('../scripts/rate-limiter');
    assert.equal(rl.isInTrialPeriod(), true, 'should be in trial at age 5d');
    assert.ok(rl.trialDaysRemaining() > 0 && rl.trialDaysRemaining() <= rl.TRIAL_DAYS);

    // Now age the file beyond the trial window
    const expiredTs = (Date.now() - (rl.TRIAL_DAYS + 2) * 86400000) / 1000;
    fs.utimesSync(path.join(home, '.thumbgate', 'install-id'), expiredTs, expiredTs);
    delete require.cache[require.resolve('../scripts/cli-telemetry')];
    rl = freshRequire('../scripts/rate-limiter');
    assert.equal(rl.isInTrialPeriod(), false, 'should not be in trial after window');
    assert.equal(rl.trialDaysRemaining(), 0);
  } finally {
    if (savedHome != null) process.env.HOME = savedHome; else delete process.env.HOME;
    if (savedCI != null) process.env.CI = savedCI;
    if (savedGHA != null) process.env.GITHUB_ACTIONS = savedGHA;
    if (savedNoTrial != null) process.env.THUMBGATE_NO_TRIAL = savedNoTrial;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('rate-limiter.isInTrialPeriod returns false when CI is set', () => {
  const home = freshHome();
  const savedHome = process.env.HOME;
  const savedCI = process.env.CI;
  process.env.HOME = home;
  process.env.CI = '1';
  try {
    delete require.cache[require.resolve('../scripts/cli-telemetry')];
    makeInstallId(home, 2);
    const rl = freshRequire('../scripts/rate-limiter');
    assert.equal(rl.isInTrialPeriod(), false);
  } finally {
    if (savedHome != null) process.env.HOME = savedHome; else delete process.env.HOME;
    if (savedCI != null) process.env.CI = savedCI; else delete process.env.CI;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('rate-limiter.isInTrialPeriod returns false when install is < 1 minute old', () => {
  const home = freshHome();
  const savedHome = process.env.HOME;
  process.env.HOME = home;
  delete process.env.CI;
  delete process.env.GITHUB_ACTIONS;
  delete process.env.THUMBGATE_NO_TRIAL;
  try {
    delete require.cache[require.resolve('../scripts/cli-telemetry')];
    makeInstallId(home, null); // brand new — no utime override
    const rl = freshRequire('../scripts/rate-limiter');
    // Fresh install should not yet be in trial (guards against init-time false positives)
    assert.equal(rl.isInTrialPeriod(), false);
  } finally {
    if (savedHome != null) process.env.HOME = savedHome; else delete process.env.HOME;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('rate-limiter.todayKey returns ISO YYYY-MM-DD', () => {
  const rl = require('../scripts/rate-limiter');
  const key = rl.todayKey();
  assert.match(key, /^\d{4}-\d{2}-\d{2}$/);
});

test('rate-limiter exports FREE_TIER_DAILY_BLOCKS as a sane integer', () => {
  const rl = require('../scripts/rate-limiter');
  assert.equal(typeof rl.FREE_TIER_DAILY_BLOCKS, 'number');
  assert.ok(Number.isInteger(rl.FREE_TIER_DAILY_BLOCKS));
  assert.ok(rl.FREE_TIER_DAILY_BLOCKS >= 1 && rl.FREE_TIER_DAILY_BLOCKS <= 100);
});

// ---------------------------------------------------------------------------
// gates-engine: daily block cap helpers
// ---------------------------------------------------------------------------

test('gates-engine.getTodayBlockCount returns 0 when no stats file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-blocks-'));
  try {
    process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
    delete require.cache[require.resolve('../scripts/gates-engine')];
    const ge = require('../scripts/gates-engine');
    ge.STATS_PATH = path.join(tmpDir, 'gate-stats.json');
    assert.equal(ge.getTodayBlockCount(), 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.THUMBGATE_FEEDBACK_DIR;
  }
});

test('gates-engine.incrementTodayBlockCount writes today entry and prunes old dates', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-blocks-'));
  try {
    process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
    delete require.cache[require.resolve('../scripts/gates-engine')];
    const ge = require('../scripts/gates-engine');
    const statsPath = path.join(tmpDir, 'gate-stats.json');
    ge.STATS_PATH = statsPath;

    // Seed with 8 days of stale daily-block entries so the >7 prune fires
    const seed = { blocked: 0, warned: 0, passed: 0, byGate: {}, dailyBlocks: {} };
    for (let i = 0; i < 8; i++) {
      const d = new Date(Date.now() - (i + 30) * 86400000).toISOString().slice(0, 10);
      seed.dailyBlocks[d] = i + 1;
    }
    fs.writeFileSync(statsPath, JSON.stringify(seed));

    const after1 = ge.incrementTodayBlockCount();
    assert.equal(after1, 1, 'first increment should land at 1');
    const after2 = ge.incrementTodayBlockCount();
    assert.equal(after2, 2);

    const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
    const today = new Date().toISOString().slice(0, 10);
    assert.equal(stats.dailyBlocks[today], 2);
    const keys = Object.keys(stats.dailyBlocks);
    assert.ok(keys.length <= 7, `daily-block ledger should be pruned to <=7 keys, got ${keys.length}`);
    assert.ok(keys.includes(today));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.THUMBGATE_FEEDBACK_DIR;
  }
});

test('gates-engine.applyDailyBlockCap increments under-limit blocks and returns null', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-cap-'));
  const home = freshHome();
  const savedHome = process.env.HOME;
  process.env.HOME = home;
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  process.env.THUMBGATE_NO_TRIAL = '1';
  delete process.env.THUMBGATE_API_KEY;
  delete process.env.THUMBGATE_NO_RATE_LIMIT;
  delete process.env.CI;
  delete process.env.GITHUB_ACTIONS;
  try {
    delete require.cache[require.resolve('../scripts/cli-telemetry')];
    delete require.cache[require.resolve('../scripts/rate-limiter')];
    delete require.cache[require.resolve('../scripts/gates-engine')];
    const rl = require('../scripts/rate-limiter');
    if (rl.isProTier()) {
      // Creator-dev or license bypass — skip gracefully
      return;
    }
    const ge = require('../scripts/gates-engine');
    const statsPath = path.join(tmpDir, 'gate-stats.json');
    ge.STATS_PATH = statsPath;
    fs.writeFileSync(statsPath, JSON.stringify({ blocked: 0, warned: 0, passed: 0, byGate: {}, dailyBlocks: {} }));

    const denyResult = { decision: 'deny', gate: 'g', message: 'm', severity: 'high', reasoning: [] };
    const result = ge.applyDailyBlockCap(denyResult);
    assert.equal(result, null, 'under limit should return null and increment');
    const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
    const today = new Date().toISOString().slice(0, 10);
    assert.equal(stats.dailyBlocks[today], 1, 'increment counter on under-limit block');
  } finally {
    if (savedHome != null) process.env.HOME = savedHome; else delete process.env.HOME;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    delete process.env.THUMBGATE_NO_TRIAL;
  }
});

// ---------------------------------------------------------------------------
// gates-engine: buildBlockActionProCta tiered messaging
// ---------------------------------------------------------------------------

test('gates-engine.buildBlockActionProCta tiered messages at 5, 25, and 100 blocks', () => {
  const home = freshHome();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-cta-tiers-'));
  const savedHome = process.env.HOME;
  process.env.HOME = home;
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  process.env.THUMBGATE_NO_TRIAL = '1';
  delete process.env.CI;
  delete process.env.GITHUB_ACTIONS;
  delete process.env.THUMBGATE_API_KEY;
  delete process.env.THUMBGATE_NO_RATE_LIMIT;
  delete process.env.THUMBGATE_NO_NUDGE;
  try {
    delete require.cache[require.resolve('../scripts/cli-telemetry')];
    delete require.cache[require.resolve('../scripts/rate-limiter')];
    delete require.cache[require.resolve('../scripts/gates-engine')];
    const rl = require('../scripts/rate-limiter');
    if (rl.isProTier()) return; // creator-dev path: skip

    const ge = require('../scripts/gates-engine');
    ge.STATS_PATH = path.join(tmpDir, 'gate-stats.json');

    fs.writeFileSync(ge.STATS_PATH, JSON.stringify({ blocked: 10, warned: 0, passed: 0, byGate: {} }));
    const lowMsg = ge.buildBlockActionProCta();
    assert.ok(lowMsg && lowMsg.includes('thumbgate.ai/go/pro'));
    assert.match(lowMsg, /sync rules across machines/);

    fs.writeFileSync(ge.STATS_PATH, JSON.stringify({ blocked: 50, warned: 0, passed: 0, byGate: {} }));
    const midMsg = ge.buildBlockActionProCta();
    assert.ok(midMsg && midMsg.includes('thumbgate.ai/go/pro'));
    assert.match(midMsg, /\$19\/mo/);
    assert.match(midMsg, /50 actions blocked/);

    fs.writeFileSync(ge.STATS_PATH, JSON.stringify({ blocked: 250, warned: 0, passed: 0, byGate: {} }));
    const teamMsg = ge.buildBlockActionProCta();
    assert.ok(teamMsg && teamMsg.includes('thumbgate.ai/go/pro'));
    assert.match(teamMsg, /Your team could use this/);
  } finally {
    if (savedHome != null) process.env.HOME = savedHome; else delete process.env.HOME;
    delete process.env.THUMBGATE_NO_TRIAL;
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('gates-engine.buildBlockActionProCta returns null during trial', () => {
  const home = freshHome();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-cta-trial-'));
  const savedHome = process.env.HOME;
  process.env.HOME = home;
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  delete process.env.CI;
  delete process.env.GITHUB_ACTIONS;
  delete process.env.THUMBGATE_API_KEY;
  delete process.env.THUMBGATE_NO_RATE_LIMIT;
  delete process.env.THUMBGATE_NO_TRIAL;
  delete process.env.THUMBGATE_NO_NUDGE;
  try {
    delete require.cache[require.resolve('../scripts/cli-telemetry')];
    delete require.cache[require.resolve('../scripts/rate-limiter')];
    delete require.cache[require.resolve('../scripts/gates-engine')];
    makeInstallId(home, 5); // mid-trial
    const rl = require('../scripts/rate-limiter');
    if (!rl.isInTrialPeriod()) return;
    const ge = require('../scripts/gates-engine');
    ge.STATS_PATH = path.join(tmpDir, 'gate-stats.json');
    fs.writeFileSync(ge.STATS_PATH, JSON.stringify({ blocked: 50, warned: 0, passed: 0, byGate: {} }));
    assert.equal(ge.buildBlockActionProCta(), null, 'no Pro CTA during trial (they already have access)');
  } finally {
    if (savedHome != null) process.env.HOME = savedHome; else delete process.env.HOME;
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// cli-telemetry: SESSION_ID export + payload shape (clientType, sessionId)
// ---------------------------------------------------------------------------

test('cli-telemetry.SESSION_ID is exported as a non-empty string', () => {
  const tel = require('../scripts/cli-telemetry');
  assert.equal(typeof tel.SESSION_ID, 'string');
  assert.ok(tel.SESSION_ID.length >= 16, 'session id should be UUID-length or 32-char hex');
});

test('cli-telemetry.trackEvent payload includes sessionId + clientType + visitorType', async () => {
  // Stand up a tiny HTTPS-substitute by intercepting https.request before module-load.
  const Module = require('node:module');
  const origLoad = Module._load;
  let captured = null;
  Module._load = function (request, parent, isMain) {
    if (request === 'https') {
      return {
        request: (opts, cb) => {
          let body = '';
          return {
            on: () => {},
            end: (data) => {
              body = String(data || '');
              try {
                captured = JSON.parse(body);
              } catch (_) { /* ignore */ }
              if (typeof cb === 'function') {
                try { cb({ statusCode: 200, on: () => {}, resume: () => {} }); } catch (_) {}
              }
            },
            destroy: () => {},
          };
        },
      };
    }
    return origLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve('../scripts/cli-telemetry')];
    const tel = require('../scripts/cli-telemetry');
    const savedOpt = process.env.THUMBGATE_NO_TELEMETRY;
    const savedDnt = process.env.DO_NOT_TRACK;
    delete process.env.THUMBGATE_NO_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
    try {
      tel.trackEvent('test_event_x', { foo: 'bar' });
    } finally {
      if (savedOpt != null) process.env.THUMBGATE_NO_TELEMETRY = savedOpt;
      if (savedDnt != null) process.env.DO_NOT_TRACK = savedDnt;
    }
  } finally {
    Module._load = origLoad;
    delete require.cache[require.resolve('../scripts/cli-telemetry')];
  }

  assert.ok(captured, 'trackEvent should produce a payload');
  assert.equal(captured.eventType, 'test_event_x');
  assert.equal(captured.foo, 'bar');
  assert.equal(captured.clientType, 'cli');
  assert.ok(typeof captured.sessionId === 'string' && captured.sessionId.length >= 16);
  assert.ok(typeof captured.installId === 'string' && captured.installId.length >= 16);
  assert.ok(typeof captured.visitorType === 'string');
});
