#!/usr/bin/env node
/**
 * money-watcher.js
 * Continuously polls the commercial summary for net-new paid orders or booked revenue.
 */

'use strict';

const { getBillingSummary } = require('./billing');

function getCommercialRevenueSnapshot(summary) {
  const revenue = summary.revenue || {};
  return {
    paidOrders: revenue.paidOrders || 0,
    bookedRevenueCents: revenue.bookedRevenueCents || 0,
    latestPaidAt: revenue.latestPaidAt || null,
    latestPaidOrder: revenue.latestPaidOrder || null,
  };
}

function watchMoney(intervalMs = 10000) {
  console.log('👀 Money Watcher activated. Polling billing summary for commercial changes...');
  let initialSnapshot = getCommercialRevenueSnapshot(getBillingSummary());

  return setInterval(() => {
    const summary = getBillingSummary();
    const currentSnapshot = getCommercialRevenueSnapshot(summary);

    const newPaidOrders = currentSnapshot.paidOrders - initialSnapshot.paidOrders;
    const newBookedRevenue = currentSnapshot.bookedRevenueCents - initialSnapshot.bookedRevenueCents;

    if (newPaidOrders > 0 || newBookedRevenue > 0) {
      console.log('\n🚨🚨🚨 COMMERCIAL ALERT: NET-NEW PAID ACTIVITY DETECTED! 🚨🚨🚨');
      console.log('Operational billing summary:');
      console.log(JSON.stringify({
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
  }, intervalMs);
}

if (require.main === module) {
  watchMoney();
}

module.exports = {
  getCommercialRevenueSnapshot,
  watchMoney,
};
