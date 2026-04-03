#!/usr/bin/env node
const { getBusinessAnalytics } = require('./billing');

function generateFunnelReport() {
  const analytics = getBusinessAnalytics();
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║      Marketing & Revenue Funnel Analytics            ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Traffic Visitors:                  ${String((analytics.trafficMetrics && analytics.trafficMetrics.visitors) || 0).padStart(6)}           ║`);
  console.log(`║  CTA Clicks:                        ${String((analytics.trafficMetrics && analytics.trafficMetrics.ctaClicks) || 0).padStart(6)}           ║`);
  console.log(`║  Unique Leads:                      ${String(analytics.signups.uniqueLeads).padStart(6)}           ║`);
  console.log(`║  Sprint Leads:                      ${String((analytics.pipeline.workflowSprintLeads && analytics.pipeline.workflowSprintLeads.total) || 0).padStart(6)}           ║`);
  console.log(`║  Paid Provider Events:              ${String(analytics.revenue.paidProviderEvents || 0).padStart(6)}           ║`);
  console.log(`║  Paid Orders Tracked:               ${String(analytics.revenue.paidOrders).padStart(6)}           ║`);
  console.log(`║  Known Booked Revenue (cents):      ${String(analytics.revenue.bookedRevenueCents).padStart(6)}           ║`);
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log('║  Acquisition by Source:                              ║');
  Object.entries(analytics.signups.bySource).forEach(([key, count]) => {
    const line = `    ${key}: ${count}`;
    console.log(`║  ${line.padEnd(52)}║`);
  });
  console.log('║  Paid Orders by Source:                              ║');
  Object.entries(analytics.attribution.paidBySource).forEach(([key, count]) => {
    const line = `    ${key}: ${count}`;
    console.log(`║  ${line.padEnd(52)}║`);
  });
  console.log('║  Revenue by Source (cents):                          ║');
  Object.entries(analytics.attribution.bookedRevenueBySourceCents).forEach(([key, count]) => {
    const line = `    ${key}: ${count}`;
    console.log(`║  ${line.padEnd(52)}║`);
  });
  console.log('╚══════════════════════════════════════════════════════╝');
}
if (require.main === module) generateFunnelReport();
module.exports = { generateFunnelReport };
