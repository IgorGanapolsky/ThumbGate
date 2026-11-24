'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { classifyCheckoutSessionDepth, summarizeCheckoutSessionDepth } = require('../scripts/billing');
const { projectAnalytics } = require('../scripts/owner-admin');

test('completed checkout does not prove paid funds', () => {
  assert.equal(classifyCheckoutSessionDepth({ status: 'complete', payment_status: 'unpaid', payment_intent: 'pi_pending' }), 'payment_attempt');
  assert.notEqual(classifyCheckoutSessionDepth({ status: 'complete', payment_status: 'no_payment_required' }), 'paid');
  assert.notEqual(classifyCheckoutSessionDepth({ status: 'complete' }), 'paid');
  assert.equal(classifyCheckoutSessionDepth({ status: 'complete', payment_status: 'paid' }), 'paid');
});

test('owner analytics preserves only aggregate session evidence join and unknowns', () => {
  const depth = summarizeCheckoutSessionDepth([
    { event: 'checkout_session_created', evidence: 'cs_a' },
    { event: 'checkout_session_created', evidence: 'cs_b' },
    { event: 'checkout_session_created', evidence: 'cs_unknown' },
  ], { status: 'partial', byId: { cs_a: 'identified', cs_b: 'payment_attempt' } });
  depth.byId = { cs_a: 'must_not_disclose' };
  depth.email = 'must_not_disclose@example.com';
  const out = projectAnalytics({ checkoutSessionDepth: depth });
  assert.equal(out.checkoutSessionDepth.sessionsCreated, 3);
  assert.equal(out.checkoutSessionDepth.identified, 1);
  assert.equal(out.checkoutSessionDepth.paymentAttempt, 1);
  assert.equal(out.checkoutSessionDepth.unresolved, 1);
  assert.equal(out.checkoutSessionDepth.basis, 'telemetry_heuristic');
  assert.equal(out.checkoutSessionDepth.lookupStatus, 'partial');
  assert.ok(!JSON.stringify(out).includes('must_not_disclose'));
});

test('overview does not equate event identities with people or local adoption', () => {
  const html = fs.readFileSync(require.resolve('../public/admin.html'), 'utf8');
  const fn = html.match(/function describeObstacle\(fields, funnel\) \{[\s\S]*?\n      \}/)[0];
  const describe = vm.runInNewContext('(' + fn + ')');
  const message = describe({ 'money.paying_customers': { value: 0 } }, { uniqueAcquisitionLeads: 45, stageCounts: { activation: 0 } });
  assert.match(message, /event identities/);
  assert.match(message, /does not establish unique people, installations or successful local use/);
  assert.doesNotMatch(message, /no lead has made/);
  assert.match(html, /Provider reconciliation is incomplete/);
  assert.match(html, /Recorded first API-key uses/);
});

test('partial currency evidence is never displayed as none in the window', () => {
  const html = fs.readFileSync(require.resolve('../public/admin.html'), 'utf8');
  const fn = html.match(/function metricValue\(m\) \{[\s\S]*?\n      \}/)[0];
  const value = vm.runInNewContext('(' + fn + ')');
  assert.equal(value({ value: {}, status: 'partial' }), 'No amounts found in partial evidence');
  assert.equal(value({ value: {}, status: 'ok' }), 'None in this window');
});
