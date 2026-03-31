const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const TEMP_USAGE_FILE = path.join(__dirname, '..', '.rlhf', 'test-usage-limits.json');

describe('rate-limiter', () => {
  let rateLimiter;
  const savedEnv = {};

  beforeEach(() => {
    savedEnv.RLHF_API_KEY = process.env.RLHF_API_KEY;
    savedEnv.RLHF_PRO_MODE = process.env.RLHF_PRO_MODE;
    delete process.env.RLHF_API_KEY;
    delete process.env.RLHF_PRO_MODE;

    delete require.cache[require.resolve('../scripts/rate-limiter')];
    rateLimiter = require('../scripts/rate-limiter');
    rateLimiter.USAGE_FILE = TEMP_USAGE_FILE;

    if (fs.existsSync(TEMP_USAGE_FILE)) fs.unlinkSync(TEMP_USAGE_FILE);
  });

  afterEach(() => {
    if (savedEnv.RLHF_API_KEY !== undefined) process.env.RLHF_API_KEY = savedEnv.RLHF_API_KEY;
    else delete process.env.RLHF_API_KEY;
    if (savedEnv.RLHF_PRO_MODE !== undefined) process.env.RLHF_PRO_MODE = savedEnv.RLHF_PRO_MODE;
    else delete process.env.RLHF_PRO_MODE;
    if (fs.existsSync(TEMP_USAGE_FILE)) fs.unlinkSync(TEMP_USAGE_FILE);
  });

  it('allows unlimited capture_feedback calls on free tier', () => {
    for (let i = 0; i < 20; i++) {
      const result = rateLimiter.checkLimit('capture_feedback');
      assert.equal(result.allowed, true, `call ${i + 1} should be allowed`);
    }
  });

  it('allows unlimited recall calls on free tier', () => {
    for (let i = 0; i < 20; i++) {
      const result = rateLimiter.checkLimit('recall');
      assert.equal(result.allowed, true, `call ${i + 1} should be allowed`);
    }
  });

  it('RLHF_API_KEY marks pro tier', () => {
    process.env.RLHF_API_KEY = 'test-key-123';
    assert.equal(rateLimiter.isProTier(), true);
    for (let i = 0; i < 10; i++) {
      const result = rateLimiter.checkLimit('capture_feedback');
      assert.equal(result.allowed, true, `call ${i + 1} should be allowed with API key`);
    }
  });

  it('RLHF_PRO_MODE=1 marks pro tier', () => {
    process.env.RLHF_PRO_MODE = '1';
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

  it('FREE_TIER_LIMITS has power-feature limits', () => {
    assert.ok(Object.keys(rateLimiter.FREE_TIER_LIMITS).length > 0, 'should have some limits');
    assert.ok(rateLimiter.FREE_TIER_LIMITS.export_dpo > 0, 'export_dpo should have a limit');
    assert.ok(rateLimiter.FREE_TIER_LIMITS.search_rlhf > 0, 'search_rlhf should have a limit');
  });

  it('export_dpo is blocked after limit', () => {
    const limit = rateLimiter.FREE_TIER_LIMITS.export_dpo;
    for (let i = 0; i < limit; i++) {
      assert.equal(rateLimiter.checkLimit('export_dpo').allowed, true, `call ${i + 1} should be allowed`);
    }
    const blocked = rateLimiter.checkLimit('export_dpo');
    assert.equal(blocked.allowed, false, 'should be blocked after limit');
    assert.ok(blocked.message.includes('Upgrade'), 'blocked message should mention upgrade');
  });

  it('pro tier bypasses export_dpo limit', () => {
    process.env.RLHF_PRO_MODE = '1';
    for (let i = 0; i < 50; i++) {
      assert.equal(rateLimiter.checkLimit('export_dpo').allowed, true);
    }
  });

  it('UPGRADE_MESSAGE references dashboard', () => {
    assert.ok(rateLimiter.UPGRADE_MESSAGE.includes('dashboard'));
  });

  it('UPGRADE_MESSAGE includes checkout URL', () => {
    assert.ok(rateLimiter.UPGRADE_MESSAGE.includes('railway'));
  });
});
