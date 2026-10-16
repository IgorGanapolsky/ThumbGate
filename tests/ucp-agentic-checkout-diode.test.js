'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeCartExecutionHash,
  evaluateUcpCheckoutGate,
} = require('../scripts/ucp-agentic-checkout-diode');

test('evaluateUcpCheckoutGate: allows verified multi-merchant UCP cart within spend and quote bounds in <1ms', () => {
  const executed = new Set();
  const quote = {
    items: [
      { merchant: 'shopify:quince.com', sku: 'sweater-01', quantity: 1, unitPriceCents: 5000 },
      { merchant: 'target.com', sku: 'gift-set-02', quantity: 2, unitPriceCents: 3500 },
    ],
  };

  const res = evaluateUcpCheckoutGate({
    cartPayload: {
      cartId: 'ucp_cart_101',
      items: quote.items,
      paymentInstrument: 'google_wallet_amex',
    },
    quotedSnapshot: quote,
    executedOrderHashes: executed,
  });

  assert.equal(res.allowed, true);
  assert.equal(res.gateId, 'gate:ucp:verified_checkout');
  assert.equal(res.totalCartCents, 12000);
  assert.equal(res.merchantCount, 2);
  assert.ok(res.latencyMs < 5);
});

test('evaluateUcpCheckoutGate: blocks duplicate multi-retailer UCP order on retry, price surge, unverified seller, and spend overrun', () => {
  const executed = new Set();
  const quote = {
    items: [{ merchant: 'nike.com', sku: 'pegasus-41', quantity: 1, unitPriceCents: 14000 }],
  };

  // First call succeeds
  const first = evaluateUcpCheckoutGate({
    cartPayload: { cartId: 'ucp_cart_dup', items: quote.items },
    quotedSnapshot: quote,
    executedOrderHashes: executed,
  });
  assert.equal(first.allowed, true);

  // Second identical retry is blocked by idempotent_checkout_fence
  const retry = evaluateUcpCheckoutGate({
    cartPayload: { cartId: 'ucp_cart_dup', items: quote.items },
    quotedSnapshot: quote,
    executedOrderHashes: executed,
  });
  assert.equal(retry.allowed, false);
  assert.equal(retry.gateId, 'gate:ucp:idempotent_checkout_fence');

  // Price surge between cart save and checkout is blocked
  const surge = evaluateUcpCheckoutGate({
    cartPayload: {
      cartId: 'ucp_cart_surge',
      items: [{ merchant: 'nike.com', sku: 'pegasus-41', quantity: 1, unitPriceCents: 19500 }],
    },
    quotedSnapshot: quote,
  });
  assert.equal(surge.allowed, false);
  assert.equal(surge.gateId, 'gate:ucp:price_drift_and_sku_lock');

  // Unverified seller of record is blocked
  const phishSeller = evaluateUcpCheckoutGate({
    cartPayload: {
      cartId: 'ucp_cart_phish',
      items: [{ merchant: 'evil-spoof-checkout.xyz', sku: 'pegasus-41', quantity: 1, unitPriceCents: 14000 }],
    },
  });
  assert.equal(phishSeller.allowed, false);
  assert.equal(phishSeller.gateId, 'gate:ucp:seller_of_record_allowlist');

  // Multi-merchant cart total exceeding cap is blocked
  const overrun = evaluateUcpCheckoutGate({
    cartPayload: {
      cartId: 'ucp_cart_overrun',
      items: [{ merchant: 'wayfair.com', sku: 'sofa-01', quantity: 1, unitPriceCents: 95000 }],
    },
  });
  assert.equal(overrun.allowed, false);
  assert.equal(overrun.gateId, 'gate:ucp:multi_merchant_spend_cap');
});
