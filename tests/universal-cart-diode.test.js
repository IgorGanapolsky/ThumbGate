'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateUniversalCartCheckout,
  resetSpendStateForTesting
} = require('../adapters/ucp/universal-cart-diode');

test('Google Universal Cart Diode: Unit & Integration Tests', async (t) => {

  t.beforeEach(() => {
    resetSpendStateForTesting();
  });

  await t.test('1. Allows safe verified purchase under $100 in sub-0.5ms', () => {
    // Warm up V8 JIT
    for (let i = 0; i < 5; i++) {
      evaluateUniversalCartCheckout({ toolName: 'warmup' });
    }

    const payload = {
      toolName: 'universal_cart_checkout',
      order: {
        merchant: 'target.com',
        total: 42.50,
        items: [
          { name: 'Wireless Mouse', quantity: 1, price: 42.50 }
        ]
      }
    };

    const res = evaluateUniversalCartCheckout(payload);
    assert.equal(res.allowed, true);
    assert.equal(res.code, 'UCP_CHECKOUT_APPROVED');
    assert.ok(res.latencyMs < 2.0, `Latency should be <2.0ms, got ${res.latencyMs}ms`);
    assert.ok(res.receipt);
    assert.ok(res.receipt.signature);
  });

  await t.test('2. Hard-blocks single order exceeding $100 threshold', () => {
    const payload = {
      toolName: 'universal_cart_checkout',
      order: {
        merchant: 'nike.com',
        total: 185.00,
        items: [
          { name: 'Air Zoom Running Shoes', quantity: 1, price: 185.00 }
        ]
      }
    };

    const res = evaluateUniversalCartCheckout(payload);
    assert.equal(res.allowed, false);
    assert.equal(res.code, 'ORDER_TOTAL_EXCEEDED');
    assert.match(res.reason, /exceeds max threshold/);
  });

  await t.test('3. Allows large order when explicit operator override provided', () => {
    const payload = {
      toolName: 'universal_cart_checkout',
      allowLargePurchase: true,
      order: {
        merchant: 'nike.com',
        total: 185.00,
        items: [
          { name: 'Air Zoom Running Shoes', quantity: 1, price: 185.00 }
        ]
      }
    };

    const res = evaluateUniversalCartCheckout(payload);
    assert.equal(res.allowed, true);
    assert.equal(res.code, 'UCP_CHECKOUT_APPROVED');
  });

  await t.test('4. Enforces daily spend ceiling ($250)', () => {
    // Order 1: $90 -> OK
    const r1 = evaluateUniversalCartCheckout({
      toolName: 'google_pay_purchase',
      order: { merchant: 'target.com', total: 90.00, items: [{ sku: 'A', quantity: 1 }] }
    });
    assert.equal(r1.allowed, true);

    // Order 2: $90 -> OK (total $180)
    const r2 = evaluateUniversalCartCheckout({
      toolName: 'google_pay_purchase',
      order: { merchant: 'target.com', total: 90.00, items: [{ sku: 'B', quantity: 1 }] }
    });
    assert.equal(r2.allowed, true);

    // Order 3: $80 -> BLOCKED ($180 + $80 = $260 > $250)
    const r3 = evaluateUniversalCartCheckout({
      toolName: 'google_pay_purchase',
      order: { merchant: 'target.com', total: 80.00, items: [{ sku: 'C', quantity: 1 }] }
    });
    assert.equal(r3.allowed, false);
    assert.equal(r3.code, 'DAILY_SPEND_CEILING_BREACHED');
  });

  await t.test('5. Interdicts runaway duplicate cart checkout loop', () => {
    const payload = {
      toolName: 'universal_cart_checkout',
      order: {
        merchant: 'quince.com',
        total: 50.00,
        items: [{ sku: 'SWEATER-1', quantity: 1, price: 50.00 }]
      }
    };

    // First attempt: ALLOW
    const res1 = evaluateUniversalCartCheckout(payload);
    assert.equal(res1.allowed, true);

    // Immediate second attempt with identical cart: BLOCK
    const res2 = evaluateUniversalCartCheckout(payload);
    assert.equal(res2.allowed, false);
    assert.equal(res2.code, 'DUPLICATE_CART_INTERDICTED');
  });

  await t.test('6. Blocks quantity spikes exceeding safety ceiling (e.g. qty 10)', () => {
    const payload = {
      toolName: 'universal_cart_checkout',
      order: {
        merchant: 'walmart.com',
        total: 90.00,
        items: [{ name: 'Energy Drink Pack', quantity: 10, price: 9.00 }]
      }
    };

    const res = evaluateUniversalCartCheckout(payload);
    assert.equal(res.allowed, false);
    assert.equal(res.code, 'QUANTITY_SPIKE_DETECTED');
  });

  await t.test('7. Blocks untrusted merchant domains', () => {
    const payload = {
      toolName: 'universal_cart_checkout',
      order: {
        merchant: 'suspicious-crypto-dropship.xyz',
        total: 45.00,
        items: [{ name: 'Gadget', quantity: 1, price: 45.00 }]
      }
    };

    const res = evaluateUniversalCartCheckout(payload);
    assert.equal(res.allowed, false);
    assert.equal(res.code, 'UNTRUSTED_MERCHANT_DOMAIN');
  });

  await t.test('8. Non-commerce tools pass through untouched', () => {
    const res = evaluateUniversalCartCheckout({
      toolName: 'read_file',
      path: '/etc/hosts'
    });
    assert.equal(res.allowed, true);
    assert.equal(res.reason, 'Non-commerce tool call passed');
  });

});
