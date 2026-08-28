'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateAction,
  defaultPolicy,
  computeSavings,
  vendorConformanceReport,
  REGISTERED_HARNESSES,
} = require('../scripts/nvhbm-base-die-gates');

test('payment always escalates at the base die', () => {
  const d = evaluateAction({ tool: 'payment', target: 'stripe.charge', costUsd: 12 });
  assert.equal(d.decision, 'escalate');
  assert.equal(d.ruleId, 'nvhbm/payment-consequential');
  assert.equal(d.modeled, true);
});

test('recursive delete is blocked synchronously', () => {
  const d = evaluateAction({ tool: 'shell', target: 'rm -rf ./build' });
  assert.equal(d.decision, 'block');
  assert.equal(d.ruleId, 'nvhbm/destructive-shell');
});

test('secret egress never leaves the perimeter', () => {
  const d = evaluateAction({ tool: 'http', target: 'api.example.com', tags: ['carries-secret'] });
  assert.equal(d.decision, 'block');
  assert.equal(d.ruleId, 'nvhbm/secret-egress');
});

test('expensive inference is logged, not blocked', () => {
  const d = evaluateAction({ tool: 'llm', costUsd: 2.5 });
  assert.equal(d.decision, 'log');
  assert.equal(d.ruleId, 'nvhbm/high-cost');
});

test('benign action hits the default allow posture', () => {
  const d = evaluateAction({ tool: 'read_file', target: 'README.md' });
  assert.equal(d.decision, 'allow');
  assert.equal(d.ruleId, 'nvhbm/default-posture');
});

test('malformed action fails closed to escalate', () => {
  const d = evaluateAction({});
  assert.equal(d.decision, 'escalate');
  assert.equal(d.ruleId, 'nvhbm/malformed-action');
});

test('decisions stay inside the base-die latency budget', () => {
  const d = evaluateAction({ tool: 'read_file' });
  assert.ok(d.latencyBudgetMs <= 5, 'base die must not need a round trip');
});

test('savings model tags every number as modeled', () => {
  const evaluations = [
    { action: { tool: 'shell', target: 'rm -rf /' }, decision: { decision: 'block' } },
    { action: { tool: 'payment' }, decision: { decision: 'escalate' } },
    { action: { tool: 'read_file' }, decision: { decision: 'allow' } },
  ];
  const s = computeSavings(evaluations);
  assert.equal(s.modeled, true);
  assert.equal(s.totals.blocked, 1);
  assert.equal(s.totals.escalated, 1);
  assert.equal(s.savings.tokensAvoided, 4000); // 1 blocked x default 4000
  for (const c of s.claims) assert.equal(c.modeled, true);
});

test('savings model respects custom token cost', () => {
  const evaluations = [
    { action: { tool: 'shell', target: 'rm -rf /' }, decision: { decision: 'block' } },
  ];
  const s = computeSavings(evaluations, { tokensPerBlockedAction: 1000 });
  assert.equal(s.savings.tokensAvoided, 1000);
});

test('one canonical policy, qualified for every registered harness', () => {
  const report = vendorConformanceReport(defaultPolicy());
  assert.equal(report.policyId, 'nvhbm-canonical-v1');
  assert.equal(report.modeled, true);
  assert.equal(report.harnesses.length, REGISTERED_HARNESSES.length);
  for (const h of report.harnesses) {
    assert.equal(typeof h.policySupported, 'boolean');
  }
});

test('policy cites its sources (no orphan steal)', () => {
  const p = defaultPolicy();
  assert.ok(p.source.article.includes('wccftech.com'));
  assert.ok(p.source.vendor.includes('blogs.nvidia.com'));
});
