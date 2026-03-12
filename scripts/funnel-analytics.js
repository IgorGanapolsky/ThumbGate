#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { loadFunnelLedger, getFunnelAnalytics } = require('./billing');
function generateFunnelReport() {
  const events = loadFunnelLedger();
  const analytics = getFunnelAnalytics();
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║      Marketing & Revenue Funnel Analytics            ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Total Acquisition Events (Leads):  ${String(analytics.stageCounts.acquisition).padStart(6)}           ║`);
  console.log(`║  Total Activation Events (Usage):   ${String(analytics.stageCounts.activation).padStart(6)}           ║`);
  console.log(`║  Total Paid Events (Revenue):       ${String(analytics.stageCounts.paid).padStart(6)}           ║`);
  console.log('╠══════════════════════════════════════════════════════╣');
  const acquisitionEvents = events.filter(e => e.stage === 'acquisition');
  const eventsBySource = {};
  acquisitionEvents.forEach(e => {
    const s = e.metadata?.source || 'unknown';
    const ev = e.event || 'unknown';
    const key = `${s}:${ev}`;
    eventsBySource[key] = (eventsBySource[key] || 0) + 1;
  });
  console.log('║  Campaign Breakdown:                                 ║');
  Object.entries(eventsBySource).forEach(([key, count]) => {
    const line = `    ${key}: ${count}`;
    console.log(`║  ${line.padEnd(52)}║`);
  });
  console.log('╚══════════════════════════════════════════════════════╝');
}
if (require.main === module) generateFunnelReport();
module.exports = { generateFunnelReport };
