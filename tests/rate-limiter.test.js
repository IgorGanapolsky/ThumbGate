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
    savedEnv.THUMBGATE_PRO_MODE = process.env.THUMBGATE_PRO_MODE;
    savedEnv.THUMBGATE_NO_RATE_LIMIT = process.env.THUMBGATE_NO_RATE_LIMIT;

    tempHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-rate-limit-test-'));
    process.env.HOME = tempHomeDir;
    process.env.USERPROFILE = tempHomeDir;
    delete process.env.THUMBGATE_API_KEY;
    delete process.env.THUMBGATE_PRO_MODE;
    delete process.env.THUMBGATE_NO_RATE_LIMIT;

    delete require.cache[require.resolve('../scripts/rate-limiter')];
    delete require.cache[require.resolve('../scripts/license')];
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

    fs.rmSync(tempHomeDir, { recursive: true, force: true });
    if (fs.existsSync(TEMP_USAGE_FILE)) fs.unlinkSync(TEMP_USAGE_FILE);
  });

  it('allows 3 capture_feedback on free tier then blocks', () => {
    for (let i = 0; i < 3; i++) {
      const result = rateLimiter.checkLimit('capture_feedback');
      assert.equal(result.allowed, true, `call ${i + 1} should be allowed`);
    }
    const blocked = rateLimiter.checkLimit('capture_feedback');
    assert.equal(blocked.allowed, false, 'call 4 should be blocked');
    assert.ok(blocked.message.includes('Free tier limit reached'), 'blocked message should mention free tier limit');
  });

  it('allows unlimited recall calls on free tier', () => {
    for (let i = 0; i < 20; i++) {
      const result = rateLimiter.checkLimit('recall');
      assert.equal(result.allowed, true, `call ${i + 1} should be allowed`);
    }
  });

  it('THUMBGATE_API_KEY marks pro tier', () => {
    process.env.THUMBGATE_API_KEY = 'test-key-123';
    assert.equal(rateLimiter.isProTier(), true);
    for (let i = 0; i < 10; i++) {
      const result = rateLimiter.checkLimit('capture_feedback');
      assert.equal(result.allowed, true, `call ${i + 1} should be allowed with API key`);
    }
  });

  it('THUMBGATE_PRO_MODE=1 marks pro tier', () => {
    process.env.THUMBGATE_PRO_MODE = '1';
    assert.equal(rateLimiter.isProTier(), true);
    for (let i = 0; i < 10; i++) {
      const result = rateLimiter.checkLimit('capture_feedback');
      assert.equal(result.allowed, true, `call ${i + 1} should be allowed with PRO_MODE`);
    }
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
    assert.equal(rateLimiter.FREE_TIER_LIMITS.export_dpo.daily, 0, 'DPO export should be Pro-only');
  });

  it('export_dpo is blocked immediately on free tier (Pro-only)', () => {
    const blocked = rateLimiter.checkLimit('export_dpo');
    assert.equal(blocked.allowed, false, 'should be blocked (daily=0)');
    assert.ok(blocked.message.includes('Upgrade'), 'blocked message should mention upgrade');
  });

  it('pro tier bypasses export_dpo limit', () => {
    process.env.THUMBGATE_PRO_MODE = '1';
    for (let i = 0; i < 5; i++) {
      assert.equal(rateLimiter.checkLimit('export_dpo').allowed, true);
    }
  });

  it('UPGRADE_MESSAGE references dashboard', () => {
    assert.ok(rateLimiter.UPGRADE_MESSAGE.includes('dashboard'));
  });

  it('temp home starts without a saved license', () => {
    assert.equal(fs.existsSync(getLicensePath(tempHomeDir)), false);
  });
});
