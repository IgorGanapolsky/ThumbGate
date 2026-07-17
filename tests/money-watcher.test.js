const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mw = require('../scripts/money-watcher');
test('getCommercialRevenueSnapshot is function', () => { assert.equal(typeof mw.getCommercialRevenueSnapshot, 'function'); });
test('watchMoney is function', () => { assert.equal(typeof mw.watchMoney, 'function'); });
test('default watcher interval is hourly to avoid high-frequency provider scans', () => {
  assert.equal(mw.DEFAULT_INTERVAL_MS, 60 * 60 * 1000);
  assert.equal(mw.parseArgs([]).intervalMs, mw.DEFAULT_INTERVAL_MS);
});
test('handles missing data', () => {
  assert.deepEqual(mw.getCommercialRevenueSnapshot(), {
    paidOrders: 0,
    bookedRevenueCents: 0,
    latestPaidAt: null,
    latestPaidOrder: null,
    stripeProductAttribution: {
      verified: false,
      catalogVersion: null,
      payingCustomerCount: 0,
      netRevenueCents: 0,
      activeSubscriptionCount: 0,
      mrrCents: 0,
      todayNetRevenueCents: 0,
    },
  });
});
test('buildCommercialAlert returns null when revenue does not increase', () => {
  assert.equal(mw.buildCommercialAlert(
    { paidOrders: 1, bookedRevenueCents: 1900 },
    { paidOrders: 1, bookedRevenueCents: 1900 },
    { source: 'local' }
  ), null);
});

test('safeLogJson strips control characters from remote billing payloads', () => {
  const rendered = mw.safeLogJson({
    fallbackReason: 'bad\r\nFORGED',
    latestPaidOrder: {
      orderId: 'ord_1\tINJECT',
    },
  });

  assert.doesNotMatch(rendered, /\r|\nFORGED|\t/);
  assert.match(rendered, /bad  FORGED/);
  assert.match(rendered, /ord_1 INJECT/);
});

test('buildLogSafeSnapshot omits raw order payloads from console output', () => {
  const snapshot = mw.buildLogSafeSnapshot({
    source: 'remote\r\nFORGED',
    fallbackReason: 'stripe\tfallback',
    generatedAt: '2026-05-13T14:00:00Z',
    revenue: {
      paidOrders: '2',
      bookedRevenueCents: '4900',
      latestPaidAt: '2026-05-13T13:00:00Z',
      latestPaidOrder: { email: 'buyer@example.com', orderId: 'ord_1' },
    },
  });

  assert.deepEqual(snapshot, {
    source: 'remote  FORGED',
    fallbackReason: 'stripe fallback',
    generatedAt: '2026-05-13T14:00:00Z',
    revenue: {
      paidOrders: 2,
      bookedRevenueCents: 4900,
      latestPaidAt: '2026-05-13T13:00:00Z',
      hasLatestPaidOrder: true,
    },
    stripeProductAttribution: {
      verified: false,
      catalogVersion: null,
      payingCustomerCount: 0,
      netRevenueCents: 0,
      activeSubscriptionCount: 0,
      mrrCents: 0,
      todayNetRevenueCents: 0,
    },
  });
});

test('buildLogSafeAlert sanitizes alert output and keeps only scalar counters', () => {
  const output = mw.buildLogSafeAlert({
    detectedAt: '2026-05-13T14:00:00Z',
    source: 'stripe\r\nFORGED',
    fallbackReason: 'webhook\tfallback',
    newPaidOrders: '1',
    newBookedRevenueCents: '4900',
    latestPaidAt: '2026-05-13T13:00:00Z',
    latestPaidOrder: { email: 'buyer@example.com' },
    paidOrders: '2',
    bookedRevenueCents: '9800',
  }, {
    keys: {
      active: '3',
      totalUsage: '17',
    },
  });

  assert.deepEqual(output, {
    detectedAt: '2026-05-13T14:00:00Z',
    source: 'stripe  FORGED',
    fallbackReason: 'webhook fallback',
    newPaidOrders: 1,
    newBookedRevenueCents: 4900,
    verifiedPaymentDetected: false,
    hostedActivityDetected: false,
    newProductAttributedCustomerCount: 0,
    newProductAttributedNetRevenueCents: 0,
    newProductAttributedActiveSubscriptionCount: 0,
    newProductAttributedMrrCents: 0,
    stripeCatalogVersion: null,
    latestPaidAt: '2026-05-13T13:00:00Z',
    hasLatestPaidOrder: true,
    paidOrders: 2,
    bookedRevenueCents: 9800,
    activeKeys: 3,
    totalUsage: 17,
  });
});

test('buildLogSafeAlert defaults malformed numeric fields to zero', () => {
  assert.equal(mw.buildLogSafeAlert({ newPaidOrders: 'nan' }).newPaidOrders, 0);
});

test('checkForCommercialChange persists state and records new paid activity', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-money-watch-'));
  const statePath = path.join(tmpDir, 'state.json');
  const alertLogPath = path.join(tmpDir, 'alerts.jsonl');

  const firstRun = await mw.checkForCommercialChange({
    statePath,
    alertLogPath,
    getSummary: async () => ({
      source: 'local',
      fallbackReason: null,
      summary: {
        revenue: {
          paidOrders: 0,
          bookedRevenueCents: 0,
        },
      },
    }),
  });
  const secondRun = await mw.checkForCommercialChange({
    statePath,
    alertLogPath,
    getSummary: async () => ({
      source: 'local',
      fallbackReason: null,
      summary: {
        revenue: {
          paidOrders: 1,
          bookedRevenueCents: 1900,
          latestPaidAt: '2026-04-06T16:00:00.000Z',
          latestPaidOrder: {
            orderId: 'ord_live_1',
          },
        },
      },
    }),
  });

  assert.equal(firstRun.changed, false);
  assert.match(firstRun.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(secondRun.changed, true);
  assert.equal(secondRun.alert.newPaidOrders, 1);
  assert.equal(secondRun.alert.newBookedRevenueCents, 1900);
  assert.match(fs.readFileSync(alertLogPath, 'utf8'), /ord_live_1/);
  assert.deepEqual(mw.readSnapshotState(statePath), {
    paidOrders: 1,
    bookedRevenueCents: 1900,
    latestPaidAt: '2026-04-06T16:00:00.000Z',
    latestPaidOrder: {
      orderId: 'ord_live_1',
    },
    stripeProductAttribution: {
      verified: false,
      catalogVersion: null,
      payingCustomerCount: 0,
      netRevenueCents: 0,
      activeSubscriptionCount: 0,
      mrrCents: 0,
      todayNetRevenueCents: 0,
    },
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('exact product attribution is fail closed until the catalog audit reconciles', () => {
  const unverified = mw.getProductAttributedStripeSnapshot({
    productAttribution: {
      verified: false,
      catalogVersion: 'thumbgate-stripe-revenue-catalog-v1',
      thumbgate: {
        uniquePayingCustomerCount: 99,
        netRevenueCents: 999999,
      },
    },
  });

  assert.deepEqual(unverified, {
    verified: false,
    catalogVersion: 'thumbgate-stripe-revenue-catalog-v1',
    payingCustomerCount: 0,
    netRevenueCents: 0,
    activeSubscriptionCount: 0,
    mrrCents: 0,
    todayNetRevenueCents: 0,
  });
});

test('exact product-attributed payment increase emits a verified alert independently of hosted counters', () => {
  const previous = mw.getCommercialRevenueSnapshot({}, {
    productAttribution: {
      verified: true,
      catalogVersion: 'thumbgate-stripe-revenue-catalog-v1',
      thumbgate: {
        uniquePayingCustomerCount: 0,
        netRevenueCents: 0,
        activeSubscriptionCount: 0,
        mrrCents: 0,
        revenueWindows: { todayNetRevenueCents: 0 },
      },
    },
  });
  const current = mw.getCommercialRevenueSnapshot({}, {
    productAttribution: {
      verified: true,
      catalogVersion: 'thumbgate-stripe-revenue-catalog-v1',
      thumbgate: {
        uniquePayingCustomerCount: 1,
        netRevenueCents: 49900,
        activeSubscriptionCount: 0,
        mrrCents: 0,
        revenueWindows: { todayNetRevenueCents: 49900 },
      },
    },
  });

  const alert = mw.buildCommercialAlert(previous, current, { source: 'hosted' });

  assert.equal(alert.verifiedPaymentDetected, true);
  assert.equal(alert.hostedActivityDetected, false);
  assert.equal(alert.newProductAttributedCustomerCount, 1);
  assert.equal(alert.newProductAttributedNetRevenueCents, 49900);
  assert.equal(alert.stripeCatalogVersion, 'thumbgate-stripe-revenue-catalog-v1');
});

test('recovery from an unverified audit establishes a baseline without fabricating a new payment', () => {
  const previous = mw.getCommercialRevenueSnapshot();
  const recovered = mw.getCommercialRevenueSnapshot({}, {
    productAttribution: {
      verified: true,
      catalogVersion: 'thumbgate-stripe-revenue-catalog-v1',
      thumbgate: {
        uniquePayingCustomerCount: 1,
        netRevenueCents: 49900,
        activeSubscriptionCount: 0,
        mrrCents: 0,
        revenueWindows: { todayNetRevenueCents: 49900 },
      },
    },
  });

  assert.equal(mw.buildCommercialAlert(previous, recovered), null);
});

test('hourly watcher persists only aggregate exact Stripe truth', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-exact-money-watch-'));
  const statePath = path.join(tmpDir, 'state.json');
  const alertLogPath = path.join(tmpDir, 'alerts.jsonl');

  const result = await mw.checkForCommercialChange({
    statePath,
    alertLogPath,
    previousSnapshot: mw.getCommercialRevenueSnapshot({}, {
      productAttribution: {
        verified: true,
        catalogVersion: 'thumbgate-stripe-revenue-catalog-v1',
        thumbgate: {
          uniquePayingCustomerCount: 0,
          netRevenueCents: 0,
          activeSubscriptionCount: 0,
          mrrCents: 0,
          revenueWindows: { todayNetRevenueCents: 0 },
        },
      },
    }),
    getSummary: async () => ({
      source: 'hosted',
      fallbackReason: null,
      summary: { revenue: { paidOrders: 0, bookedRevenueCents: 0 } },
    }),
    getExternalAudit: async () => ({
      ownerEmails: ['must-not-persist@example.com'],
      productAttribution: {
        verified: true,
        catalogVersion: 'thumbgate-stripe-revenue-catalog-v1',
        thumbgate: {
          uniquePayingCustomerCount: 1,
          netRevenueCents: 1900,
          activeSubscriptionCount: 1,
          mrrCents: 1900,
          revenueWindows: { todayNetRevenueCents: 1900 },
          individualPayments: [{ payerEmail: 'must-not-persist@example.com' }],
        },
      },
    }),
  });

  const serializedState = fs.readFileSync(statePath, 'utf8');
  assert.equal(result.alert.verifiedPaymentDetected, true);
  assert.match(serializedState, /"netRevenueCents": 1900/);
  assert.doesNotMatch(serializedState, /must-not-persist|payerEmail|individualPayments/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
