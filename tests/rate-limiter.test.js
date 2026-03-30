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

  it('FREE_TIER_MAX_GATES is Infinity', () => {
    assert.equal(rateLimiter.FREE_TIER_MAX_GATES, Infinity);
  });

  it('FREE_TIER_LIMITS is empty (no limits)', () => {
    assert.deepEqual(Object.keys(rateLimiter.FREE_TIER_LIMITS), []);
  });

  it('UPGRADE_MESSAGE references dashboard', () => {
    assert.ok(rateLimiter.UPGRADE_MESSAGE.includes('dashboard'));
  });
});
