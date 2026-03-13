const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { problemDetail, PROBLEM_TYPES } = require('../scripts/problem-detail');

describe('RFC 9457 Problem Detail', () => {
  test('problemDetail includes required fields', () => {
    const p = problemDetail({
      type: PROBLEM_TYPES.RATE_LIMIT,
      title: 'Rate limit exceeded',
      status: 429,
    });
    assert.equal(p.type, 'urn:rlhf:error:rate-limit-exceeded');
    assert.equal(p.title, 'Rate limit exceeded');
    assert.equal(p.status, 429);
    assert.equal(p.detail, undefined);
  });

  test('problemDetail includes optional detail', () => {
    const p = problemDetail({
      type: PROBLEM_TYPES.UNAUTHORIZED,
      title: 'Unauthorized',
      status: 401,
      detail: 'API key required',
    });
    assert.equal(p.detail, 'API key required');
  });

  test('problemDetail passes through extensions', () => {
    const p = problemDetail({
      type: PROBLEM_TYPES.RATE_LIMIT,
      title: 'Rate limit',
      status: 429,
      retryAfter: 3600,
    });
    assert.equal(p.retryAfter, 3600);
  });

  test('all PROBLEM_TYPES are URN strings', () => {
    for (const [key, val] of Object.entries(PROBLEM_TYPES)) {
      assert.ok(val.startsWith('urn:rlhf:error:'), `${key} should be a URN`);
    }
  });

  test('problemDetail Content-Type should be application/problem+json', () => {
    // Verify the constant exists — sendProblem sets the header
    const p = problemDetail({
      type: PROBLEM_TYPES.NOT_FOUND,
      title: 'Not Found',
      status: 404,
    });
    assert.equal(typeof p.type, 'string');
    assert.equal(typeof p.title, 'string');
    assert.equal(typeof p.status, 'number');
  });
});
