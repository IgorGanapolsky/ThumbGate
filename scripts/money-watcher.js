#!/usr/bin/env node
/**
 * money-watcher.js
 * Continuously polls the commercial summary for net-new paid orders or booked revenue.
 */

'use strict';

const { getOperationalBillingSummary } = require('./operational-summary');

function getCommercialRevenueSnapshot(summary) {
  const revenue = summary.revenue || {};
  return {
    paidOrders: revenue.paidOrders || 0,
    bookedRevenueCents: revenue.bookedRevenueCents || 0,
    latestPaidAt: revenue.latestPaidAt || null,
    latestPaidOrder: revenue.latestPaidOrder || null,
  };
}

async function watchMoney(intervalMs = 10000) {
  console.log('👀 Money Watcher activated. Polling billing summary for commercial changes...');
  const initialState = await getOperationalBillingSummary();
  let initialSnapshot = getCommercialRevenueSnapshot(initialState.summary);
  let polling = false;

  return setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      const { source, summary, fallbackReason } = await getOperationalBillingSummary();
      const currentSnapshot = getCommercialRevenueSnapshot(summary);

      const newPaidOrders = currentSnapshot.paidOrders - initialSnapshot.paidOrders;
      const newBookedRevenue = currentSnapshot.bookedRevenueCents - initialSnapshot.bookedRevenueCents;

      if (newPaidOrders > 0 || newBookedRevenue > 0) {
        console.log('\n🚨🚨🚨 COMMERCIAL ALERT: NET-NEW PAID ACTIVITY DETECTED! 🚨🚨🚨');
        console.log('Operational billing summary:');
        console.log(JSON.stringify({
          source,
          fallbackReason,
          newPaidOrders,
          newBookedRevenueCents: newBookedRevenue,
          latestPaidAt: currentSnapshot.latestPaidAt,
          latestPaidOrder: currentSnapshot.latestPaidOrder,
          bookedRevenueCents: currentSnapshot.bookedRevenueCents,
          activeKeys: summary.keys.active,
          totalUsage: summary.keys.totalUsage,
        }, null, 2));

        process.stdout.write('\x07');
        initialSnapshot = currentSnapshot;
      }
    } finally {
      polling = false;
    }
  }, intervalMs);
}

if (require.main === module) {
  watchMoney().catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = {
  getCommercialRevenueSnapshot,
  watchMoney,
};
