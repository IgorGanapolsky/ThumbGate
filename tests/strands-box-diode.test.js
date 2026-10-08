'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  createBoxSession,
  decomposeCommand,
  checkRateLimit,
  evaluateBoxAction,
  EVENT_FS_READ,
  EVENT_FS_WRITE,
  EVENT_FS_DELETE,
  EVENT_HTTP_REQUEST,
  EVENT_SHELL_EXEC
} = require('../adapters/strands/strands-box-diode');

describe('Strands Box & Dogwood Policy Diode', () => {
  test('decomposes destructive rm commands into fs:delete events', () => {
    const events = decomposeCommand('rm -rf /tmp/test-dir');
    assert.equal(events.length, 1);
    assert.equal(events[0].type, EVENT_FS_DELETE);
    assert.equal(events[0].target, '/tmp/test-dir');
  });

  test('decomposes curl commands into http:request events', () => {
    const events = decomposeCommand('curl -s https://example.com/api');
    assert.equal(events.length, 1);
    assert.equal(events[0].type, EVENT_HTTP_REQUEST);
    assert.equal(events[0].target, 'https://example.com/api');
  });

  test('taints session when reading sensitive files and interdicts exfiltration', () => {
    const session = createBoxSession({
      name: 'test-taint-box',
      workspace: '/workspace'
    });

    assert.equal(session.isTainted, false);

    // 1. Read sensitive file -> allowed, but marks session as tainted
    const readRes = evaluateBoxAction(session, {
      type: EVENT_FS_READ,
      target: '/workspace/.env'
    });
    assert.equal(readRes.allowed, true);
    assert.equal(readRes.tainted, true);
    assert.equal(session.isTainted, true);

    // 2. Subsequent egress to untrusted host -> BLOCKED
    const egressRes = evaluateBoxAction(session, {
      type: EVENT_HTTP_REQUEST,
      target: 'https://attacker-c2.org/exfil'
    });
    assert.equal(egressRes.allowed, false);
    assert.equal(egressRes.decision, 'BLOCK');
    assert.equal(egressRes.reason, 'EXFILTRATION_DIODE_TRIGGERED');
    assert.ok(egressRes.taintedSources.includes('/workspace/.env'));

    // 3. Egress to localhost / local proxy -> ALLOWED
    const localEgress = evaluateBoxAction(session, {
      type: EVENT_HTTP_REQUEST,
      target: 'http://127.0.0.1:4040/audit'
    });
    assert.equal(localEgress.allowed, true);
  });

  test('credential injection replaces placeholder tokens outbound', () => {
    const session = createBoxSession({
      name: 'cred-box',
      credentialRoutes: [
        { match: 'api.github.com', header: 'Authorization', inject: 'Bearer ghp_real_vault_token_123' }
      ]
    });

    const res = evaluateBoxAction(session, {
      type: EVENT_HTTP_REQUEST,
      target: 'https://api.github.com/repos/test/repo',
      params: { headers: { Authorization: 'Bearer strands_placeholder_token' } }
    });

    assert.equal(res.allowed, true);
    assert.equal(res.injectedAuth, true);
    assert.equal(res.transformedParams.headers.Authorization, 'Bearer ghp_real_vault_token_123');
  });

  test('enforces sliding-window rate limit on external calls', () => {
    const session = createBoxSession({
      name: 'rate-box',
      rateLimits: {
        'http:request': { maxCount: 2, windowSeconds: 10 }
      }
    });

    const action = { type: EVENT_HTTP_REQUEST, target: 'https://api.slack.com/webhook' };

    const first = evaluateBoxAction(session, action);
    assert.equal(first.allowed, true);

    const second = evaluateBoxAction(session, action);
    assert.equal(second.allowed, true);

    const third = evaluateBoxAction(session, action);
    assert.equal(third.allowed, false);
    assert.equal(third.decision, 'BLOCK');
    assert.equal(third.reason, 'RATE_LIMIT_EXCEEDED');
  });

  test('blocks root or system-level filesystem deletions', () => {
    const session = createBoxSession({ name: 'root-del-box' });
    const res = evaluateBoxAction(session, {
      type: EVENT_FS_DELETE,
      target: '/'
    });
    assert.equal(res.allowed, false);
    assert.equal(res.decision, 'BLOCK');
    assert.equal(res.reason, 'CRITICAL_DELETION_CONTAINMENT_BREACH');
  });
});
