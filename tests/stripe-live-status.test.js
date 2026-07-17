const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  dollars,
  getLiveStatus,
  parseArgs,
} = require('../scripts/stripe-live-status');

function emptyStripeClient() {
  const emptyPage = async () => ({ data: [], has_more: false });
  return {
    balance: {
      retrieve: async () => ({ available: [], pending: [] }),
    },
    charges: { list: emptyPage },
    subscriptions: { list: emptyPage },
    products: { list: emptyPage },
    prices: { list: emptyPage },
    checkout: { sessions: { list: emptyPage } },
  };
}

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
  assert.deepEqual(report.gaps, [
    'STRIPE_SECRET_KEY is not set and no managed local key file is available',
  ]);
  assert.equal(report.revenue.netLifetime, 0);
  assert.equal(report.attribution.thumbgateVerified, false);
});

test('getLiveStatus loads a managed credential without returning the secret or its path', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-stripe-live-'));
  const secretPath = path.join(tmpDir, 'stripe.txt');
  const secret = 'sk_test_managed_live_status_fixture';
  fs.writeFileSync(secretPath, `${secret}\n`, { mode: 0o600 });
  let receivedSecret = null;
  try {
    const report = await getLiveStatus({
      env: {},
      secretPaths: [secretPath],
      stripeCtor: (value) => {
        receivedSecret = value;
        return emptyStripeClient();
      },
    });
    assert.equal(receivedSecret, secret);
    assert.equal(report.status, 'ok');
    assert.equal(report.credentialSource, 'managed_file');
    assert.equal(JSON.stringify(report).includes(secret), false);
    assert.equal(JSON.stringify(report).includes(secretPath), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
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

test('getLiveStatus reports missing dependency when Stripe export is not a factory', async () => {
  const report = await getLiveStatus({
    secretKey: 'sk_test_fake',
    stripeCtor: {},
  });

  assert.equal(report.status, 'missing_dependency');
  assert.equal(report.configured, false);
  assert.match(report.gaps[0], /Stripe SDK is unavailable/);
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
            { payment_status: 'paid', status: 'complete', amount_total: 4900 },
            { payment_status: 'unpaid', status: 'expired' },
          ],
        }),
      },
    },
  };

  const report = await getLiveStatus({ stripeClient, now });

  assert.equal(report.status, 'ok');
  assert.equal(report.configured, true);
  assert.equal(report.credentialSource, 'injected_client');
  assert.equal(report.balance.available, 30);
  assert.equal(report.revenue.grossLifetime, 68);
  assert.equal(report.revenue.refundedLifetime, 19);
  assert.equal(report.revenue.netLifetime, 49);
  assert.equal(report.revenue.today, 49);
  assert.equal(report.revenue.todayGross, 68);
  assert.equal(report.revenue.todayRefunded, 19);
  assert.equal(report.revenue.todayNet, 49);
  assert.equal(report.revenue.todayChargeCount, 2);
  assert.equal(report.charges.paid, 2);
  assert.equal(report.charges.refunded, 1);
  assert.equal(report.subscriptions.active, 1);
  assert.equal(report.subscriptions.mrr, 19);
  assert.equal(report.checkout.paymentStatusPaid, 1);
  assert.equal(report.checkout.positiveAmountPaid, 1);
  assert.equal(report.checkout.zeroAmountPaidStatus, 0);
  assert.equal(report.checkout.conversionRate, '50.0%');
  assert.equal(report.catalog.activeProductCount, 1);
  assert.equal(report.catalog.activePriceCount, 1);
  assert.equal(report.catalog.productsTruncated, false);
  assert.equal(report.activePrices[0].amount, 19);
  assert.equal(report.attribution.thumbgateVerified, false);
});

test('getLiveStatus excludes zero-amount paid statuses from payment completions', async () => {
  const stripeClient = emptyStripeClient();
  stripeClient.checkout.sessions.list = async () => ({
    data: [
      { id: 'cs_zero', payment_status: 'paid', status: 'complete', amount_total: 0 },
      { id: 'cs_paid', payment_status: 'paid', status: 'complete', amount_total: 49900 },
    ],
    has_more: false,
  });

  const report = await getLiveStatus({ stripeClient });
  assert.equal(report.checkout.statusComplete, 2);
  assert.equal(report.checkout.paymentStatusPaid, 2);
  assert.equal(report.checkout.completed, 1);
  assert.equal(report.checkout.positiveAmountPaid, 1);
  assert.equal(report.checkout.zeroAmountPaidStatus, 1);
  assert.equal(report.checkout.conversionRate, '50.0%');
});

test('getLiveStatus paginates lifetime Stripe collections instead of truncating the first page', async () => {
  const stripeClient = emptyStripeClient();
  let chargeCalls = 0;
  stripeClient.charges.list = async ({ starting_after: startingAfter }) => {
    chargeCalls += 1;
    if (!startingAfter) {
      return {
        data: [{ id: 'ch_1', status: 'succeeded', paid: true, amount: 1000, amount_refunded: 0, created: 0 }],
        has_more: true,
      };
    }
    return {
      data: [{ id: 'ch_2', status: 'succeeded', paid: true, amount: 2000, amount_refunded: 0, created: 0 }],
      has_more: false,
    };
  };

  const report = await getLiveStatus({ stripeClient });
  assert.equal(chargeCalls, 2);
  assert.equal(report.charges.total, 2);
  assert.equal(report.charges.paid, 2);
  assert.equal(report.revenue.grossLifetime, 30);
});

test('getLiveStatus normalizes annual subscriptions to monthly recurring revenue', async () => {
  const stripeClient = emptyStripeClient();
  stripeClient.subscriptions.list = async () => ({
    data: [{ status: 'active', plan: { amount: 14900, interval: 'year' } }],
    has_more: false,
  });

  const report = await getLiveStatus({ stripeClient });
  assert.ok(Math.abs(report.subscriptions.mrr - (149 / 12)) < Number.EPSILON * 10);
});

test('getLiveStatus reports catalog totals while bounding noisy catalog details', async () => {
  const stripeClient = emptyStripeClient();
  stripeClient.products.list = async () => ({
    data: [
      { id: 'prod_1', name: 'One' },
      { id: 'prod_2', name: 'Two' },
    ],
    has_more: false,
  });
  stripeClient.prices.list = async () => ({
    data: [
      { id: 'price_1', unit_amount: 100, type: 'one_time', product: 'prod_1' },
      { id: 'price_2', unit_amount: 200, type: 'one_time', product: 'prod_2' },
    ],
    has_more: false,
  });

  const report = await getLiveStatus({ stripeClient, catalogOutputLimit: 1 });
  assert.equal(report.catalog.activeProductCount, 2);
  assert.equal(report.catalog.activePriceCount, 2);
  assert.equal(report.catalog.productsTruncated, true);
  assert.equal(report.catalog.pricesTruncated, true);
  assert.equal(report.products.length, 1);
  assert.equal(report.activePrices.length, 1);
});
