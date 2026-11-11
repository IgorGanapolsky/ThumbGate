const test = require('node:test');
const assert = require('node:assert/strict');
const { formatReport } = require('../scripts/revenue-status.js');
const { getTelemetrySummary } = require('../scripts/telemetry-analytics.js');

test('revenue-status formats stripeHandoffClicks instead of misleading stripeConfirms when unpaid', () => {
  const fakeReport = {
    generatedAt: new Date().toISOString(),
    source: 'test',
    diagnosis: { primaryIssue: null, runtimePresenceKnown: true },
    publicProbe: {
      health: { status: 'healthy', version: '1.0.0' },
      telemetryPing: { status: 'ok' },
    },
    hostedAudit: {
      summaries: {
        today: {},
        '30d': {
          trafficMetrics: {
            visitors: 16266,
            pageViews: 14797,
            checkoutStarts: 374,
            checkoutPaidConfirmations: 0,
            checkoutCancelPageViews: 81,
          },
          ctas: {
            checkoutInterstitialViews: 489,
            checkoutInterstitialClicks: 158,
            checkoutInterstitialProConfirms: 157,
            paidConfirmations: 0,
            checkoutBotDeflections: 10,
          },
          revenue: {
            paidOrders: 0,
            bookedRevenueCents: 0,
          },
          signups: { uniqueLeads: 243 },
          pipeline: { workflowSprintLeads: { total: 0 } },
        },
        lifetime: {},
      },
      runtimePresence: {},
    },
  };

  const formatted = formatReport(fakeReport);
  // Ensure reports never falsely claim "stripeConfirms" for unpaid interstitial clicks
  assert.doesNotMatch(formatted, /stripeConfirms\s+\d+/i);
  // Ensure the accurate semantic metric is reported
  assert.match(formatted, /stripeHandoffClicks 157/);
  // Ensure zero paid confirms are reflected accurately
  assert.match(formatted, /paidOrders 0/);
  assert.doesNotMatch(formatted, /stripePaidConfirms/);
});

test('revenue-status reports stripePaidConfirms only when actual paid confirmations exist', () => {
  const fakeReportWithPaid = {
    generatedAt: new Date().toISOString(),
    source: 'test',
    diagnosis: { primaryIssue: null, runtimePresenceKnown: true },
    publicProbe: {
      health: { status: 'healthy', version: '1.0.0' },
      telemetryPing: { status: 'ok' },
    },
    hostedAudit: {
      summaries: {
        today: {},
        '30d': {
          trafficMetrics: {
            visitors: 100,
            pageViews: 80,
            checkoutStarts: 10,
            checkoutPaidConfirmations: 2,
          },
          ctas: {
            checkoutInterstitialViews: 20,
            checkoutInterstitialClicks: 10,
            checkoutInterstitialProConfirms: 5,
            paidConfirmations: 2,
            checkoutPaidConfirmations: 2,
            checkoutBotDeflections: 0,
          },
          revenue: {
            paidOrders: 2,
            bookedRevenueCents: 3800,
          },
          signups: { uniqueLeads: 5 },
          pipeline: { workflowSprintLeads: { total: 0 } },
        },
        lifetime: {},
      },
      runtimePresence: {},
    },
  };

  const formatted = formatReport(fakeReportWithPaid);
  assert.match(formatted, /stripeHandoffClicks 5/);
  assert.match(formatted, /stripePaidConfirms 2/);
  assert.match(formatted, /paidOrders 2/);
  assert.match(formatted, /bookedRevenue \$38\.00/);
});

test('telemetry-analytics distinguishes interstitial intent clicks from paid confirmations', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-test-'));
  const events = [
    { clientType: 'web', eventType: 'checkout_interstitial_cta_clicked', ctaId: 'pro_checkout_confirmed', timestamp: new Date().toISOString() },
    { clientType: 'web', eventType: 'pro_checkout_direct_stripe', ctaPlacement: 'checkout_interstitial', timestamp: new Date().toISOString() },
    { clientType: 'web', eventType: 'checkout_cancel_page_view', timestamp: new Date().toISOString() },
  ];
  fs.writeFileSync(path.join(tempDir, 'telemetry-pings.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n');

  try {
    const summary = getTelemetrySummary(tempDir, { windowMs: 86400000 });
    // Interstitial pro intent clicks are recorded
    assert.equal(summary.web.checkoutInterstitialProConfirms, 2);
    // But paid confirmations must remain 0
    assert.equal(summary.web.checkoutPaidConfirmations, 0);
    assert.equal(summary.web.checkoutCancelPageViews, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
