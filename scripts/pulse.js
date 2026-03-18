#!/usr/bin/env node
const { getBillingSummary } = require('./billing');

function getPulseSnapshot(summary, now = new Date()) {
  const funnel = summary.funnel || {};
  const revenue = summary.revenue || {};
  const leadCount = funnel.stageCounts ? funnel.stageCounts.acquisition || 0 : 0;
  const activeCount = funnel.stageCounts ? funnel.stageCounts.activation || 0 : 0;
  const paidOrders = revenue.paidOrders || 0;
  const bookedRevenueCents = revenue.bookedRevenueCents || 0;
  const conversionRate = leadCount > 0 ? ((paidOrders / leadCount) * 100).toFixed(2) : '0.00';
  const health = paidOrders > 0 ? '🟢 REVENUE ACTIVE' : (leadCount > 0 ? '🟡 WARM FUNNEL' : '🔴 BLIND / COLD');

  let eta = 'N/A';
  if (paidOrders === 0 && leadCount > 0) {
    const hoursRemaining = 4;
    const etaDate = new Date(now.getTime() + hoursRemaining * 60 * 60 * 1000);
    eta = `${etaDate.toLocaleTimeString()} (Decision Window)`;
  } else if (paidOrders > 0) {
    eta = 'SUCCESS';
  }

  return {
    leadCount,
    activeCount,
    paidOrders,
    bookedRevenueCents,
    conversionRate,
    health,
    eta,
    topAcquisitionChannels: Object.entries(funnel.eventCounts || {})
      .filter(([key]) => key.startsWith('acquisition:'))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3),
  };
}

async function showPulse() {
  const now = new Date();
  const snapshot = getPulseSnapshot(getBillingSummary(), now);
  console.log('📡 [MISSION CONTROL] MISSION PULSE — ' + now.toLocaleTimeString());
  console.log('─'.repeat(60));
  console.log(`🚀 GTM VELOCITY: ${snapshot.leadCount} Leads | ${snapshot.activeCount} Trials | ${snapshot.paidOrders} Paid Orders`);
  console.log(`💵 BOOKED REVENUE: $${(snapshot.bookedRevenueCents / 100).toFixed(2)}`);
  console.log(`📈 HEALTH: ${snapshot.health} (${snapshot.conversionRate}% lead-to-paid conversion)`);
  console.log(`⏱️ FIRST DOLLAR ETA: ${snapshot.eta}`);
  console.log('─'.repeat(60));
  console.log('📊 TOP ACQUISITION CHANNELS:');
  snapshot.topAcquisitionChannels.forEach(([key, count]) => {
      const name = key.split(':')[1];
      console.log(`   - ${name.padEnd(25)} : ${count} events`);
  });
}
if (require.main === module) showPulse().catch(console.error);
module.exports = { showPulse, getPulseSnapshot };
