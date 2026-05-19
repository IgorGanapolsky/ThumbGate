'use strict';

// Regression test for ThumbGate#2188 — May 2026 incident where every Stripe
// checkout silently rendered "page not found" because inline product_data
// name-matched an ARCHIVED product, causing new prices to inherit active=false.
//
// The guard added in scripts/billing.js (verifyActiveProductForPlan) refuses
// to create a checkout session when the only Stripe product matching the
// plan's product name is archived. This test pins that behavior.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const billing = require('../scripts/billing.js');
const verifyActiveProductForPlan = billing._verifyActiveProductForPlan;

function buildStripeStub(products) {
  return {
    products: {
      async list() {
        return { data: products };
      },
    },
  };
}

test('passes when an active product with the expected name exists', async () => {
  const stripe = buildStripeStub([
    { id: 'prod_active', name: 'ThumbGate Pro', active: true },
    { id: 'prod_archived', name: 'ThumbGate Pro', active: false },
  ]);
  // Must not throw — an active match exists.
  await verifyActiveProductForPlan(stripe, 'pro');
});

test('passes when no product with the expected name exists (Stripe will create one)', async () => {
  const stripe = buildStripeStub([
    { id: 'prod_other', name: 'Some Other Product', active: true },
  ]);
  await verifyActiveProductForPlan(stripe, 'pro');
});

test('throws when only an ARCHIVED product matches the expected name', async () => {
  const stripe = buildStripeStub([
    { id: 'prod_archived', name: 'ThumbGate Pro', active: false },
  ]);
  await assert.rejects(
    () => verifyActiveProductForPlan(stripe, 'pro'),
    (err) => {
      assert.ok(err instanceof Error, 'must throw an Error');
      assert.match(err.message, /archived/, 'must mention archived state');
      assert.match(err.message, /prod_archived/, 'must include the archived product id');
      assert.match(err.message, /ThumbGate#2188/, 'must reference the incident');
      assert.match(err.message, /ThumbGate Pro/, 'must name the plan');
      return true;
    },
  );
});

test('checks the right product name for plan=team', async () => {
  const stripe = buildStripeStub([
    { id: 'prod_team_archived', name: 'ThumbGate Team', active: false },
  ]);
  await assert.rejects(
    () => verifyActiveProductForPlan(stripe, 'team'),
    /ThumbGate Team/,
  );
});

test('does not throw on Stripe API transient failure (does not block checkout on infra hiccups)', async () => {
  const stripe = {
    products: {
      async list() {
        throw new Error('Stripe API timeout');
      },
    },
  };
  // The guard is best-effort — transient Stripe API failures should not
  // block checkout creation. The downstream session.create call will
  // surface real Stripe errors if Stripe is actually down.
  await verifyActiveProductForPlan(stripe, 'pro');
});
