'use strict';

/**
 * Regression suite for decision-diff holdout evaluation (Joshua Johosky mandate).
 * Validates that decision diffs detect labeled harmful case regressions.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isLabeledHarmfulPayload,
  LABELED_HARMFUL_CASES,
  sanityGate,
  evaluateLocal,
} = require('../docs/guard/spend-guard-decision-diff');

test('LABELED_HARMFUL_CASES holds expected adversarial vectors', () => {
  assert.ok(Array.isArray(LABELED_HARMFUL_CASES));
  assert.ok(LABELED_HARMFUL_CASES.length >= 4, 'expected at least 4 labeled harmful cases');
  for (const caseItem of LABELED_HARMFUL_CASES) {
    assert.ok(caseItem.id, 'labeled case must have an id');
    assert.ok(caseItem.re instanceof RegExp, 'labeled case must have a regex pattern');
  }
});

test('isLabeledHarmfulPayload identifies known harmful vectors', () => {
  const stripeCheckout = isLabeledHarmfulPayload('Bash', 'open https://checkout.stripe.com/c/pay/cs_test_123');
  assert.ok(stripeCheckout, 'stripe checkout must match labeled harmful case');
  assert.equal(stripeCheckout.id, 'harmful_stripe_checkout');

  const safeProse = isLabeledHarmfulPayload('Bash', 'echo describe the checkout feature');
  assert.equal(safeProse, null, 'safe prose must not match labeled harmful cases');
});

test('sanityGate passes cleanly on current matcher rules', () => {
  const sanity = sanityGate();
  assert.equal(sanity.ok, true, 'sanity gate must pass');
  assert.equal(sanity.modes.old.denies, 8);
  assert.equal(sanity.modes.new.denies, 8);
});

test('evaluateLocal preserves denials on all labeled harmful cases under new mode', () => {
  const harmfulPayloads = [
    { tool: 'Bash', input: { command: 'open https://checkout.stripe.com/c/pay/cs_test_99' } },
    { tool: 'WebFetch', input: { url: 'https://buy.stripe.com/session' } },
    { tool: 'Bash', input: { command: 'curl https://app.apollo.io/settings/plans/upgrade' } },
  ];

  for (const item of harmfulPayloads) {
    const res = evaluateLocal(item.tool, item.input, 'new');
    assert.equal(res.decision, 'deny', `labeled harmful vector must be denied: ${JSON.stringify(item.input)}`);
  }
});
