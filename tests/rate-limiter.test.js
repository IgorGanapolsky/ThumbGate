const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TEMP_USAGE_FILE = path.join(__dirname, '..', '.thumbgate', 'test-usage-limits.json');

describe('rate-limiter', () => {
  let rateLimiter;
  let getLicensePath;
  let tempHomeDir;
  const savedEnv = {};

  beforeEach(() => {
    savedEnv.HOME = process.env.HOME;
    savedEnv.USERPROFILE = process.env.USERPROFILE;
    savedEnv.THUMBGATE_API_KEY = process.env.THUMBGATE_API_KEY;
    savedEnv.THUMBGATE_PRO_MODE = process.env.THUMBGATE_PRO_MODE; // legacy, kept for cleanup
    savedEnv.THUMBGATE_NO_RATE_LIMIT = process.env.THUMBGATE_NO_RATE_LIMIT;
    savedEnv.THUMBGATE_DEV_SECRET = process.env.THUMBGATE_DEV_SECRET;
    savedEnv.THUMBGATE_DEV_BYPASS = process.env.THUMBGATE_DEV_BYPASS;
    savedEnv.THUMBGATE_DEV_KEY = process.env.THUMBGATE_DEV_KEY;

    tempHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-rate-limit-test-'));
    process.env.HOME = tempHomeDir;
    process.env.USERPROFILE = tempHomeDir;
    delete process.env.THUMBGATE_API_KEY;
    delete process.env.THUMBGATE_PRO_MODE;
    delete process.env.THUMBGATE_NO_RATE_LIMIT;
    delete process.env.THUMBGATE_DEV_SECRET;
    delete process.env.THUMBGATE_DEV_BYPASS;
    delete process.env.THUMBGATE_DEV_KEY;

    delete require.cache[require.resolve('../scripts/rate-limiter')];
    delete require.cache[require.resolve('../scripts/license')];
    delete require.cache[require.resolve('../scripts/pro-local-dashboard')];
    rateLimiter = require('../scripts/rate-limiter');
    ({ getLicensePath } = require('../scripts/license'));
    rateLimiter.USAGE_FILE = TEMP_USAGE_FILE;

    if (fs.existsSync(TEMP_USAGE_FILE)) fs.unlinkSync(TEMP_USAGE_FILE);
  });

  afterEach(() => {
    if (savedEnv.HOME !== undefined) process.env.HOME = savedEnv.HOME;
    else delete process.env.HOME;
    if (savedEnv.USERPROFILE !== undefined) process.env.USERPROFILE = savedEnv.USERPROFILE;
    else delete process.env.USERPROFILE;
    if (savedEnv.THUMBGATE_API_KEY !== undefined) process.env.THUMBGATE_API_KEY = savedEnv.THUMBGATE_API_KEY;
    else delete process.env.THUMBGATE_API_KEY;
    if (savedEnv.THUMBGATE_PRO_MODE !== undefined) process.env.THUMBGATE_PRO_MODE = savedEnv.THUMBGATE_PRO_MODE;
    else delete process.env.THUMBGATE_PRO_MODE;
    if (savedEnv.THUMBGATE_NO_RATE_LIMIT !== undefined) process.env.THUMBGATE_NO_RATE_LIMIT = savedEnv.THUMBGATE_NO_RATE_LIMIT;
    else delete process.env.THUMBGATE_NO_RATE_LIMIT;
    if (savedEnv.THUMBGATE_DEV_SECRET !== undefined) process.env.THUMBGATE_DEV_SECRET = savedEnv.THUMBGATE_DEV_SECRET;
    else delete process.env.THUMBGATE_DEV_SECRET;
    if (savedEnv.THUMBGATE_DEV_BYPASS !== undefined) process.env.THUMBGATE_DEV_BYPASS = savedEnv.THUMBGATE_DEV_BYPASS;
    else delete process.env.THUMBGATE_DEV_BYPASS;
    if (savedEnv.THUMBGATE_DEV_KEY !== undefined) process.env.THUMBGATE_DEV_KEY = savedEnv.THUMBGATE_DEV_KEY;
    else delete process.env.THUMBGATE_DEV_KEY;

    fs.rmSync(tempHomeDir, { recursive: true, force: true });
    if (fs.existsSync(TEMP_USAGE_FILE)) fs.unlinkSync(TEMP_USAGE_FILE);
  });

  it('allows 2 capture_feedback events per day on free tier, then nudges Pro', () => {
    assert.equal(rateLimiter.FREE_TIER_LIMITS.capture_feedback.daily, 2);
    assert.equal(rateLimiter.FREE_TIER_LIMITS.capture_feedback.lifetime, 10);
    for (let i = 0; i < 2; i++) {
      const result = rateLimiter.checkLimit('capture_feedback');
      assert.equal(result.allowed, true, `call ${i + 1} should be allowed`);
    }
    const blocked = rateLimiter.checkLimit('capture_feedback');
    assert.equal(blocked.allowed, false, 'call 3 should be blocked on the free daily limit');
    assert.equal(blocked.limitType, 'daily');
    assert.match(blocked.message, /Daily limit reached/i);
    assert.match(blocked.message, /2 captures\/day \(10 total\)/i);
    assert.match(blocked.message, /Upgrade|Pro/i);
  });

  it('blocks recall on free tier (Pro-only)', () => {
    const result = rateLimiter.checkLimit('recall');
    assert.equal(result.allowed, false, 'recall should be blocked on free tier');
    assert.ok(result.message.includes('Pro') || result.message.includes('Upgrade'), 'blocked message should mention Pro');
  });

  it('THUMBGATE_API_KEY marks pro tier', () => {
    process.env.THUMBGATE_API_KEY = 'test-key-123';
    assert.equal(rateLimiter.isProTier(), true);
    for (let i = 0; i < 10; i++) {
      const result = rateLimiter.checkLimit('capture_feedback');
      assert.equal(result.allowed, true, `call ${i + 1} should be allowed with API key`);
    }
  });

  it('7-day reverse trial grants pro tier for new installs', () => {
    assert.equal(typeof rateLimiter.isInTrialPeriod, 'function');
    assert.equal(typeof rateLimiter.trialDaysRemaining, 'function');
    assert.equal(rateLimiter.TRIAL_DAYS, 7);
  });

  it('unknown actions have no limit', () => {
    for (let i = 0; i < 20; i++) {
      const result = rateLimiter.checkLimit('unknown_action');
      assert.equal(result.allowed, true);
    }
  });

  it('FREE_TIER_MAX_GATES is a finite number', () => {
    assert.ok(Number.isFinite(rateLimiter.FREE_TIER_MAX_GATES));
    assert.ok(rateLimiter.FREE_TIER_MAX_GATES > 0);
  });

  it('FREE_TIER_LIMITS has limits for all gated actions', () => {
    const keys = Object.keys(rateLimiter.FREE_TIER_LIMITS);
    assert.ok(keys.includes('capture_feedback'), 'should limit capture_feedback');
    assert.ok(keys.includes('export_dpo'), 'should limit export_dpo');
    assert.ok(keys.includes('export_databricks'), 'should limit export_databricks');
    assert.ok(keys.includes('search_thumbgate'), 'should limit search_thumbgate');
    assert.ok(keys.includes('commerce_recall'), 'should limit commerce_recall');
    assert.equal(rateLimiter.FREE_TIER_LIMITS.export_dpo.daily, 0, 'DPO export daily should be 0');
    assert.equal(rateLimiter.FREE_TIER_LIMITS.export_dpo.lifetime, 0, 'DPO export lifetime should be 0');
  });

  it('export_dpo is blocked immediately on free tier (Pro-only)', () => {
    const blocked = rateLimiter.checkLimit('export_dpo');
    assert.equal(blocked.allowed, false, 'should be blocked (daily=0)');
    assert.ok(blocked.message.includes('Pro') || blocked.message.includes('Upgrade'), 'blocked message should mention Pro or upgrade');
  });

  it('pro tier bypasses export_dpo limit', () => {
    process.env.THUMBGATE_API_KEY = 'test-key-for-dpo';
    for (let i = 0; i < 5; i++) {
      assert.equal(rateLimiter.checkLimit('export_dpo').allowed, true);
    }
  });

  it('UPGRADE_MESSAGE references dashboard', () => {
    assert.ok(rateLimiter.UPGRADE_MESSAGE.includes('dashboard'));
  });

  it('names the repeat Pro would have blocked and scrubs secrets', () => {
    const sentence = rateLimiter.proWouldHaveBlockedSentence('agent force-pushed main and leaked ghp_abcdefghijklmnopqrstuvwxyz123456');
    assert.equal(
      sentence,
      'Pro would have blocked this repeat: agent force-pushed main and leaked [redacted]. https://thumbgate.ai/pro',
    );
    assert.equal(rateLimiter.proWouldHaveBlockedSentence('   '), null);
    const markdown = [
      '## git',
      '- Rule: do not force-push main',
      '- Latest mistake: git push --force origin main',
      '## shell',
      '- Rule: do not delete the repo',
      '- Latest mistake: rm -rf .',
      '## secrets',
      '- Rule: do not print tokens',
      '- Latest mistake: echo token',
      '## deploy',
      '- Rule: do not deploy untested',
      '- Latest mistake: agent deployed without tests',
    ].join('\n');
    assert.equal(rateLimiter.droppedRepeatFromRulesMarkdown(markdown, 3), 'agent deployed without tests');
  });

  it('CLI capture names the blocked repeat when the free limit is already hit', () => {
    const { spawnSync } = require('node:child_process');
    const usagePath = path.join(tempHomeDir, '.thumbgate', 'usage-limits.json');
    fs.mkdirSync(path.dirname(usagePath), { recursive: true });
    fs.writeFileSync(usagePath, JSON.stringify({
      date: new Date().toISOString().slice(0, 10),
      counts: { capture_feedback: 2 },
      lifetime: { capture_feedback: 2 },
    }));
    const result = spawnSync(process.execPath, ['bin/cli.js', 'capture', 'down', 'agent force-pushed main'], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: tempHomeDir,
        USERPROFILE: tempHomeDir,
        THUMBGATE_NO_TRIAL: '1',
        THUMBGATE_NO_NUDGE: '1',
        THUMBGATE_API_KEY: '',
        THUMBGATE_DEV_SECRET: '',
        THUMBGATE_DEV_BYPASS: '',
        THUMBGATE_DEV_KEY: '',
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Pro would have blocked this repeat: agent force-pushed main\. https:\/\/thumbgate\.ai\/pro/);
  });


  it('temp home starts without a saved license', () => {
    assert.equal(fs.existsSync(getLicensePath(tempHomeDir)), false);
  });
});
