#!/usr/bin/env node
/**
 * money-watcher.js
 * Continuously polls the funnel ledger for the first real 'paid' event and alerts the system.
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
  console.log('👀 Money Watcher activated. Polling billing summary for new paid orders...');
  let initialSnapshot = getCommercialRevenueSnapshot(getBillingSummary());

  return setInterval(() => {
    const summary = getBillingSummary();
    const currentSnapshot = getCommercialRevenueSnapshot(summary);

    if (currentSnapshot.paidOrders > initialSnapshot.paidOrders) {
      const newCount = currentSnapshot.paidOrders - initialSnapshot.paidOrders;
      console.log(`\n🚨🚨🚨 PAYMENT ALERT: ${newCount} NEW PAID ORDER(S) DETECTED! 🚨🚨🚨`);
      console.log('Operational billing summary:');
      console.log(JSON.stringify({
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
