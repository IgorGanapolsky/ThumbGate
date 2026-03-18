#!/usr/bin/env node
const { getBillingSummary } = require('./billing');

function getPulseSnapshot(summary, now = new Date()) {
  const funnel = summary.funnel || {};
  const revenue = summary.revenue || {};
  const signups = summary.signups || {};
  const trafficMetrics = summary.trafficMetrics || {};
  const pipeline = summary.pipeline || {};
  const operatorGeneratedAcquisition = summary.operatorGeneratedAcquisition || {};
  const dataQuality = summary.dataQuality || {};
  const leadCount = signups.uniqueLeads || 0;
  const activeCount = funnel.stageCounts ? funnel.stageCounts.activation || 0 : 0;
  const sprintLeads = pipeline.workflowSprintLeads ? pipeline.workflowSprintLeads.total || 0 : 0;
  const qualifiedSprintLeads = pipeline.qualifiedWorkflowSprintLeads ? pipeline.qualifiedWorkflowSprintLeads.total || 0 : 0;
  const paidProviderEvents = revenue.paidProviderEvents || 0;
  const paidOrders = revenue.paidOrders || 0;
  const bookedRevenueCents = revenue.bookedRevenueCents || 0;
  const conversionRate = leadCount > 0 ? ((paidOrders / leadCount) * 100).toFixed(2) : '0.00';
  const health = bookedRevenueCents > 0
    ? '🟢 BOOKED REVENUE ACTIVE'
    : ((leadCount > 0 || sprintLeads > 0) ? '🟡 PIPELINE ACTIVE' : '🔴 BLIND / COLD');

  let eta = 'N/A';
  if (bookedRevenueCents === 0 && (leadCount > 0 || sprintLeads > 0)) {
    const hoursRemaining = 4;
    const etaDate = new Date(now.getTime() + hoursRemaining * 60 * 60 * 1000);
    eta = `${etaDate.toLocaleTimeString()} (Decision Window)`;
  } else if (bookedRevenueCents > 0) {
    eta = 'SUCCESS';
  }

  return {
    leadCount,
    activeCount,
    visitors: trafficMetrics.visitors || 0,
    ctaClicks: trafficMetrics.ctaClicks || 0,
    sprintLeads,
    qualifiedSprintLeads,
    paidProviderEvents,
    paidOrders,
    bookedRevenueCents,
    conversionRate,
    health,
    eta,
    operatorGeneratedAcquisitionEvents: operatorGeneratedAcquisition.totalEvents || 0,
    operatorGeneratedUniqueLeads: operatorGeneratedAcquisition.uniqueLeads || 0,
    unreconciledPaidEvents: dataQuality.unreconciledPaidEvents || 0,
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
  console.log(`🚀 TRAFFIC: ${snapshot.visitors} Visitors | ${snapshot.ctaClicks} CTA Clicks | ${snapshot.leadCount} Unique Leads`);
  console.log(`🧪 PIPELINE: ${snapshot.sprintLeads} Sprint Leads | ${snapshot.qualifiedSprintLeads} Qualified Sprint Leads | ${snapshot.activeCount} Activations`);
  console.log(`🤖 OPERATOR ACQ: ${snapshot.operatorGeneratedAcquisitionEvents} Events | ${snapshot.operatorGeneratedUniqueLeads} Unique Leads`);
  console.log(`💳 REVENUE FLOW: ${snapshot.paidProviderEvents} Paid Provider Events | ${snapshot.paidOrders} Paid Orders`);
  console.log(`💵 BOOKED REVENUE: $${(snapshot.bookedRevenueCents / 100).toFixed(2)}`);
  console.log(`📈 HEALTH: ${snapshot.health} (${snapshot.conversionRate}% lead-to-paid conversion)`);
  console.log(`⏱️ FIRST DOLLAR ETA: ${snapshot.eta}`);
  console.log(`🧹 DATA QUALITY: ${snapshot.unreconciledPaidEvents} unreconciled paid event(s)`);
  console.log('─'.repeat(60));
  console.log('📊 TOP ACQUISITION CHANNELS:');
  snapshot.topAcquisitionChannels.forEach(([key, count]) => {
      const name = key.split(':')[1];
      console.log(`   - ${name.padEnd(25)} : ${count} events`);
  });
}
if (require.main === module) showPulse().catch(console.error);
module.exports = { showPulse, getPulseSnapshot };
