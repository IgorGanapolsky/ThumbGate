const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildWorkflowSprintLead,
} = require('../scripts/workflow-sprint-intake');
const {
  getPulseSnapshot,
} = require('../scripts/pulse');
const {
  getCommercialRevenueSnapshot,
} = require('../scripts/money-watcher');

test('workflow sprint lead builder requires contactable qualification fields', () => {
  const lead = buildWorkflowSprintLead({
    email: 'buyer@example.com',
    company: 'Example Co',
    workflow: 'Code modernization',
    owner: 'Platform Lead',
    blocker: 'Review regressions keep repeating across agent runs.',
    runtime: 'Claude Code',
    utmSource: 'linkedin',
    ctaId: 'workflow_sprint_intake',
  });

  assert.match(lead.leadId, /^lead_/);
  assert.equal(lead.contact.email, 'buyer@example.com');
  assert.equal(lead.qualification.workflow, 'Code modernization');
  assert.equal(lead.attribution.utmSource, 'linkedin');
});

test('pulse snapshot reports paid orders instead of raw paid-stage events', () => {
  const snapshot = getPulseSnapshot({
    funnel: {
      stageCounts: {
        acquisition: 6,
        activation: 2,
        paid: 20,
      },
      eventCounts: {
        'acquisition:outreach_target_generated': 4,
      },
    },
    revenue: {
      paidOrders: 0,
      bookedRevenueCents: 0,
    },
  }, new Date('2026-03-17T15:00:00Z'));

  assert.equal(snapshot.paidOrders, 0);
  assert.equal(snapshot.bookedRevenueCents, 0);
  assert.match(snapshot.health, /WARM FUNNEL/);
  assert.equal(snapshot.conversionRate, '0.00');
});

test('money watcher snapshots commercial revenue fields only', () => {
  const snapshot = getCommercialRevenueSnapshot({
    revenue: {
      paidOrders: 2,
      bookedRevenueCents: 5800,
      latestPaidAt: '2026-03-17T15:00:00.000Z',
      latestPaidOrder: {
        orderId: 'ord_123',
      },
    },
  });

  assert.equal(snapshot.paidOrders, 2);
  assert.equal(snapshot.bookedRevenueCents, 5800);
  assert.equal(snapshot.latestPaidAt, '2026-03-17T15:00:00.000Z');
  assert.deepEqual(snapshot.latestPaidOrder, { orderId: 'ord_123' });
});
