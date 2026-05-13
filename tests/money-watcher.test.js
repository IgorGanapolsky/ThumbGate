const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mw = require('../scripts/money-watcher');
test('getCommercialRevenueSnapshot is function', () => { assert.equal(typeof mw.getCommercialRevenueSnapshot, 'function'); });
test('watchMoney is function', () => { assert.equal(typeof mw.watchMoney, 'function'); });
test('handles missing data', () => {
  assert.deepEqual(mw.getCommercialRevenueSnapshot(), {
    paidOrders: 0,
    bookedRevenueCents: 0,
    latestPaidAt: null,
    latestPaidOrder: null,
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
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
