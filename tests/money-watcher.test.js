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
