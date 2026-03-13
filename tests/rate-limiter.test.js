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

  it('allows first 5 capture_feedback calls', () => {
    for (let i = 0; i < 5; i++) {
      const result = rateLimiter.checkLimit('capture_feedback');
      assert.equal(result.allowed, true, `call ${i + 1} should be allowed`);
    }
  });

  it('blocks 6th capture_feedback call on same day', () => {
    for (let i = 0; i < 5; i++) {
      rateLimiter.checkLimit('capture_feedback');
    }
    const result = rateLimiter.checkLimit('capture_feedback');
    assert.equal(result.allowed, false);
    assert.ok(result.message.includes('Free tier limit reached'));
  });

  it('blocks 6th recall call on same day', () => {
    for (let i = 0; i < 5; i++) {
      rateLimiter.checkLimit('recall');
    }
    const result = rateLimiter.checkLimit('recall');
    assert.equal(result.allowed, false);
    assert.ok(result.message.includes('Free tier limit reached'));
  });

  it('resets counts on date rollover', () => {
    // Write usage data with yesterday's date
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    rateLimiter.saveUsage({ date: yesterday, counts: { capture_feedback: 5, recall: 5 } });

    const result = rateLimiter.checkLimit('capture_feedback');
    assert.equal(result.allowed, true, 'should reset and allow after date change');
  });

  it('RLHF_API_KEY bypasses limits', () => {
    process.env.RLHF_API_KEY = 'test-key-123';
    for (let i = 0; i < 10; i++) {
      const result = rateLimiter.checkLimit('capture_feedback');
      assert.equal(result.allowed, true, `call ${i + 1} should be allowed with API key`);
    }
  });

  it('RLHF_PRO_MODE=1 bypasses limits', () => {
    process.env.RLHF_PRO_MODE = '1';
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

  it('FREE_TIER_MAX_GATES is 5', () => {
    assert.equal(rateLimiter.FREE_TIER_MAX_GATES, 5);
  });
});
