#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { getBillingSummary } = require('./billing');
async function showPulse() {
  const summary = getBillingSummary();
  const now = new Date();
  console.log('📡 [MISSION CONTROL] MISSION PULSE — ' + now.toLocaleTimeString());
  console.log('─'.repeat(60));
  const funnel = summary.funnel;
  const leadCount = funnel.stageCounts.acquisition || 0;
  const activeCount = funnel.stageCounts.activation || 0;
  const paidCount = funnel.stageCounts.paid || 0;
  console.log(`🚀 GTM VELOCITY: ${leadCount} Leads | ${activeCount} Trials | ${paidCount} Sales`);
  const roi = (funnel.conversionRates.acquisitionToPaid * 100).toFixed(2);
  const health = paidCount > 0 ? '🟢 REVENUE ACTIVE' : (leadCount > 0 ? '🟡 WARM FUNNEL' : '🔴 BLIND / COLD');
  console.log(`📈 HEALTH: ${health} (${roi}% ROI)`);
  let eta = 'N/A';
  if (paidCount === 0 && leadCount > 0) {
    const hoursRemaining = 4;
    const etaDate = new Date(now.getTime() + hoursRemaining * 60 * 60 * 1000);
    eta = etaDate.toLocaleTimeString() + ' (Decision Window)';
  } else if (paidCount > 0) {
    eta = 'SUCCESS';
  }
  console.log(`⏱️ FIRST DOLLAR ETA: ${eta}`);
  console.log('─'.repeat(60));
  console.log('📊 TOP ACQUISITION CHANNELS:');
  const counts = funnel.eventCounts || {};
  Object.entries(counts)
    .filter(([key]) => key.startsWith('acquisition:'))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .forEach(([key, count]) => {
      const name = key.split(':')[1];
      console.log(`   - ${name.padEnd(25)} : ${count} events`);
    });
}
if (require.main === module) showPulse().catch(console.error);
module.exports = { showPulse };
