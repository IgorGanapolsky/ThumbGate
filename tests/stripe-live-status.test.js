const test = require('node:test');
const assert = require('node:assert/strict');

const {
  dollars,
  getLiveStatus,
  parseArgs,
} = require('../scripts/stripe-live-status');

test('parseArgs enables strict mode explicitly', () => {
  assert.deepEqual(parseArgs([]), { strict: false });
  assert.deepEqual(parseArgs(['--strict']), { strict: true });
});

test('dollars converts cents to dollars', () => {
  assert.equal(dollars(4900), 49);
  assert.equal(dollars(undefined), 0);
});

test('getLiveStatus returns a machine-readable missing-secret report', async () => {
  const report = await getLiveStatus({ secretKey: '' });

  assert.equal(report.status, 'missing_secret');
  assert.equal(report.configured, false);
  assert.deepEqual(report.gaps, ['STRIPE_SECRET_KEY is not set']);
  assert.equal(report.revenue.netLifetime, 0);
});

test('getLiveStatus reports missing dependency when Stripe client shape is invalid', async () => {
  const report = await getLiveStatus({
    secretKey: 'sk_test_fake',
    stripeCtor: () => null,
  });

  assert.equal(report.status, 'missing_dependency');
  assert.equal(report.configured, false);
  assert.deepEqual(report.gaps, ['Stripe SDK did not create a client']);
});

test('getLiveStatus summarizes live Stripe objects from an injected client', async () => {
  const now = new Date('2026-04-14T16:00:00Z');
  const stripeClient = {
    balance: {
      retrieve: async () => ({
        available: [{ amount: 3000 }],
        pending: [{ amount: 1900 }],
      }),
    },
    charges: {
      list: async () => ({
        data: [
          { amount: 4900, amount_refunded: 0, created: Math.floor(now.getTime() / 1000), paid: true, refunded: false, status: 'succeeded' },
          { amount: 1900, amount_refunded: 1900, created: Math.floor(now.getTime() / 1000), paid: true, refunded: true, status: 'succeeded' },
          { amount: 4900, amount_refunded: 0, created: Math.floor(now.getTime() / 1000), paid: false, refunded: false, status: 'failed' },
        ],
      }),
    },
    subscriptions: {
      list: async () => ({
        data: [
          { status: 'active', plan: { amount: 1900 } },
          { status: 'canceled', plan: { amount: 1900 } },
        ],
      }),
    },
    products: {
      list: async () => ({
        data: [{ id: 'prod_1', name: 'ThumbGate Pro', default_price: 'price_1' }],
      }),
    },
    prices: {
      list: async () => ({
        data: [{ id: 'price_1', unit_amount: 1900, type: 'recurring', recurring: { interval: 'month' }, product: 'prod_1' }],
      }),
    },
    checkout: {
      sessions: {
        list: async () => ({
          data: [
            { payment_status: 'paid', status: 'complete' },
            { payment_status: 'unpaid', status: 'expired' },
          ],
        }),
      },
    },
  };

  const report = await getLiveStatus({ stripeClient, now });

  assert.equal(report.status, 'ok');
  assert.equal(report.configured, true);
  assert.equal(report.balance.available, 30);
  assert.equal(report.revenue.grossLifetime, 49);
  assert.equal(report.revenue.refundedLifetime, 19);
  assert.equal(report.revenue.netLifetime, 30);
  assert.equal(report.revenue.today, 49);
  assert.equal(report.subscriptions.active, 1);
  assert.equal(report.subscriptions.mrr, 19);
  assert.equal(report.checkout.conversionRate, '50.0%');
  assert.equal(report.activePrices[0].amount, 19);
});
