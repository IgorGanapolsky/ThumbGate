#!/usr/bin/env node
/**
 * scripts/funnel-analytics.js
 * Provides observability into marketing outreach and revenue conversion.
 */

'use strict';

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
  
  console.log('║  Conversion Rates:                                   ║');
  const leadToUsage = (analytics.conversionRates.acquisitionToActivation * 100).toFixed(2) + '%';
  const usageToPaid = (analytics.conversionRates.activationToPaid * 100).toFixed(2) + '%';
  const leadToPaid = (analytics.conversionRates.acquisitionToPaid * 100).toFixed(2) + '%';
  
  console.log(`║    Lead -> Activation:  ${leadToUsage.padStart(10)}                   ║`);
  console.log(`║    Activation -> Paid:  ${usageToPaid.padStart(10)}                   ║`);
  console.log(`║    Lead -> Paid (ROI):  ${leadToPaid.padStart(10)}                   ║`);
  console.log('╠══════════════════════════════════════════════════════╣');

  // Estimate First Dollar ETA
  let etaMessage = 'N/A';
  if (analytics.stageCounts.paid > 0) {
    etaMessage = 'REVENUE ACTIVE';
  } else if (analytics.stageCounts.acquisition > 0) {
    const etaDate = new Date();
    etaDate.setHours(etaDate.getHours() + 4);
    etaMessage = etaDate.toLocaleTimeString() + ' (Estimated)';
  } else {
    etaMessage = 'NO LEADS IN FUNNEL';
  }

  console.log(`║  First Dollar ETA:  ${etaMessage.padStart(28)}         ║`);
  console.log('╠══════════════════════════════════════════════════════╣');

  // All Lead Sources
  const acquisitionEvents = events.filter(e => e.stage === 'acquisition');
  const sources = {};
  const eventsBySource = {};
  
  acquisitionEvents.forEach(e => {
    const s = e.metadata?.source || 'unknown';
    const ev = e.event || 'unknown';
    sources[s] = (sources[s] || 0) + 1;
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

if (require.main === module) {
  generateFunnelReport();
}

module.exports = { generateFunnelReport };
