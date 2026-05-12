'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  checkAndRecord,
  DEFAULT_LIMITS,
  _resetForTests,
} = require('../scripts/public-rate-limiter');

function mockReq({ ip = '1.2.3.4', xff } = {}) {
  return {
    headers: xff ? { 'x-forwarded-for': xff } : {},
    socket: { remoteAddress: ip },
  };
}

test('allows first request under any defined action', () => {
  _resetForTests();
  const res = checkAndRecord('intake_workflow_sprint', mockReq());
  assert.equal(res.allowed, true);
  assert.equal(res.count, 1);
});

test('blocks once limit reached and reports retry-after', () => {
  _resetForTests();
  const req = mockReq({ ip: '1.2.3.4' });
  const limit = DEFAULT_LIMITS.intake_workflow_sprint.max;
  for (let i = 0; i < limit; i++) {
    const r = checkAndRecord('intake_workflow_sprint', req);
    assert.equal(r.allowed, true, `request ${i + 1} should be allowed`);
  }
  const overLimit = checkAndRecord('intake_workflow_sprint', req);
  assert.equal(overLimit.allowed, false);
  assert.ok(overLimit.retryAfterSeconds > 0, 'must report retry-after');
  assert.equal(overLimit.count, limit);
});

test('per-IP isolation: limits do NOT bleed across IPs', () => {
  _resetForTests();
  const ipA = mockReq({ ip: '10.0.0.1' });
  const ipB = mockReq({ ip: '10.0.0.2' });
  const limit = DEFAULT_LIMITS.intake_workflow_sprint.max;
  for (let i = 0; i < limit; i++) {
    assert.equal(checkAndRecord('intake_workflow_sprint', ipA).allowed, true);
  }
  // ipA should be blocked
  assert.equal(checkAndRecord('intake_workflow_sprint', ipA).allowed, false);
  // ipB should still be allowed
  assert.equal(checkAndRecord('intake_workflow_sprint', ipB).allowed, true);
});

test('per-action isolation: hitting one action does not deplete another', () => {
  _resetForTests();
  const req = mockReq();
  for (let i = 0; i < DEFAULT_LIMITS.intake_workflow_sprint.max; i++) {
    checkAndRecord('intake_workflow_sprint', req);
  }
  assert.equal(checkAndRecord('intake_workflow_sprint', req).allowed, false);
  // checkout_create has its own bucket — must still be allowed.
  assert.equal(checkAndRecord('checkout_create', req).allowed, true);
});

test('respects X-Forwarded-For when proxy header present', () => {
  _resetForTests();
  const limit = DEFAULT_LIMITS.checkout_create.max;
  const reqA = mockReq({ ip: '127.0.0.1', xff: '203.0.113.1' });
  const reqB = mockReq({ ip: '127.0.0.1', xff: '203.0.113.2' });
  for (let i = 0; i < limit; i++) {
    assert.equal(checkAndRecord('checkout_create', reqA).allowed, true);
  }
  assert.equal(checkAndRecord('checkout_create', reqA).allowed, false);
  // Different XFF IP — independent bucket even though socket-IP is the same.
  assert.equal(checkAndRecord('checkout_create', reqB).allowed, true);
});

test('THUMBGATE_NO_RATE_LIMIT=1 disables all gates', () => {
  _resetForTests();
  process.env.THUMBGATE_NO_RATE_LIMIT = '1';
  try {
    const req = mockReq();
    for (let i = 0; i < 1000; i++) {
      assert.equal(checkAndRecord('intake_workflow_sprint', req).allowed, true);
    }
  } finally {
    delete process.env.THUMBGATE_NO_RATE_LIMIT;
  }
});

test('unknown actions fail open (no surprise blocking of un-declared limits)', () => {
  _resetForTests();
  const req = mockReq();
  for (let i = 0; i < 100; i++) {
    assert.equal(checkAndRecord('completely_unknown_action_xyz', req).allowed, true);
  }
});
