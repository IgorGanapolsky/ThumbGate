'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  runStage,
  claimLive,
  evaluateAction,
} = require('../scripts/futureagi-prepost-gate');

test('spend with no pre-eval is fail-closed', () => {
  const pre = runStage({ stage: 'pre', actionClass: 'spend', checks: [] });
  assert.equal(pre.blocked, true);
  assert.equal(pre.live, false);
  assert.equal(pre.triggered[0].reason, 'missing_check');
});

test('timeout or error on send blocks (invert FailOpen)', () => {
  const timeout = runStage({
    stage: 'pre',
    actionClass: 'send',
    checks: [{ name: 'judge', timeout: true }],
  });
  assert.equal(timeout.blocked, true);
  assert.equal(timeout.triggered[0].reason, 'timeout');

  const error = runStage({
    stage: 'pre',
    actionClass: 'customer',
    checks: [{ name: 'judge', error: true, message: 'down' }],
  });
  assert.equal(error.blocked, true);
  assert.equal(error.triggered[0].reason, 'error');
});

test('hard Pass=false still triggers without a score', () => {
  const pre = runStage({
    stage: 'pre',
    actionClass: 'production',
    checks: [{ name: 'policy', pass: false, message: 'deny' }],
  });
  assert.equal(pre.blocked, true);
  assert.equal(pre.triggered[0].reason, 'hard_fail');
});

test('score above threshold blocks consequential actions', () => {
  const pre = runStage({
    stage: 'pre',
    actionClass: 'spend',
    threshold: 0.4,
    checks: [{ name: 'risk', pass: true, score: 0.9 }],
  });
  assert.equal(pre.blocked, true);
  assert.equal(pre.triggered[0].reason, 'threshold');
});

test('warn on a non-consequential path does not block', () => {
  const pre = runStage({
    stage: 'pre',
    actionClass: 'read',
    checks: [{ name: 'style', pass: false, action: 'warn', message: 'noisy' }],
  });
  assert.equal(pre.blocked, false);
  assert.equal(pre.triggered[0].action, 'warn');
});

test('failed post-eval cannot claim live even if the action ran', () => {
  const post = runStage({
    stage: 'post',
    actionClass: 'spend',
    checks: [{ name: 'critic', pass: false, message: 'not_satisfactory' }],
  });
  assert.equal(post.blocked, true);
  assert.equal(post.live, false);
  const claim = claimLive({
    critic: 'fully_satisfactory',
    pre: { blocked: false },
    post,
  });
  assert.equal(claim.live, false);
  assert.ok(claim.reasons.includes('post_blocked'));
});

test('overnight lease does not renew when critic is not_satisfactory', () => {
  const claim = claimLive({
    critic: 'not_satisfactory',
    pre: { blocked: false },
    post: { blocked: false, live: true },
  });
  assert.equal(claim.live, false);
  assert.ok(claim.reasons.includes('critic_not_satisfactory'));
});

test('missing critic fails closed', () => {
  const claim = claimLive({
    pre: { blocked: false },
    post: { blocked: false, live: true },
  });
  assert.equal(claim.live, false);
});

test('evaluateAction allows spend only when pre passes and critic is ok', () => {
  const blocked = evaluateAction({
    actionClass: 'spend',
    critic: 'fully_satisfactory',
    preChecks: [],
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.live, false);

  const ok = evaluateAction({
    actionClass: 'spend',
    critic: 'caveats',
    preChecks: [{ name: 'judge', pass: true, score: 0 }],
    postChecks: [{ name: 'critic', pass: true, score: 0 }],
  });
  assert.equal(ok.allowed, true);
  assert.equal(ok.live, true);
  assert.equal(ok.pre.triggered.length, 0);
  assert.ok(!JSON.stringify(ok).includes('sk-'));
});

test('receipts stay content-free (no payload / prompt dump)', () => {
  const pre = runStage({
    stage: 'pre',
    actionClass: 'spend',
    checks: [{
      name: 'judge',
      pass: false,
      message: 'deny',
      prompt: 'SECRET_PROMPT',
      payload: { card: '4242' },
    }],
  });
  const dumped = JSON.stringify(pre);
  assert.equal(dumped.includes('SECRET_PROMPT'), false);
  assert.equal(dumped.includes('4242'), false);
});
