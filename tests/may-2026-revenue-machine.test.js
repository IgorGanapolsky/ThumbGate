const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseArgs,
  buildRevenuePlan,
  formatPlan,
} = require('../scripts/may-2026-revenue-machine');

function report(overrides = {}) {
  return {
    source: 'hosted-via-railway-env',
    diagnosis: {
      runtimePresenceKnown: true,
    },
    hostedAudit: {
      runtimePresence: {
        THUMBGATE_GA_MEASUREMENT_ID: false,
        THUMBGATE_CHECKOUT_FALLBACK_URL: false,
      },
      summaries: {
        today: {
          trafficMetrics: { visitors: 3360 },
          revenue: { paidOrders: 2, bookedRevenueCents: 2000 },
          pipeline: { workflowSprintLeads: { total: 0 } },
        },
        '30d': {
          trafficMetrics: { visitors: 12502, checkoutStarts: 583 },
          ctas: {
            checkoutStartsBySource: { website: 400, npm: 30 },
            checkoutStartsByCampaign: { pro_pack: 160, first_dollar: 56 },
          },
          signups: { uniqueLeads: 399 },
          revenue: { paidOrders: 6, bookedRevenueCents: 16900 },
          pipeline: { workflowSprintLeads: { total: 0 } },
          attribution: {
            paidBySource: { website: 2, npm: 1 },
            paidByCampaign: { pro_pack: 1 },
            bookedRevenueBySourceCents: { website: 2000, npm: 14900 },
            bookedRevenueByCampaignCents: { pro_pack: 1000 },
          },
        },
        lifetime: {},
      },
    },
    ...overrides,
  };
}

test('parseArgs carries bounded audit timeout controls', () => {
  const options = parseArgs([
    '--fetch-timeout-ms=3000',
    '--command-timeout-ms=9000',
  ]);

  assert.equal(options.fetchTimeoutMs, 3000);
  assert.equal(options.commandTimeoutMs, 9000);
});

test('buildRevenuePlan turns live funnel gaps into ordered actions', () => {
  const plan = buildRevenuePlan(report());

  assert.equal(plan.metrics.visitors30d, 12502);
  assert.equal(plan.metrics.checkoutStarts30d, 583);
  assert.equal(plan.metrics.sprintLeads30d, 0);
  assert.equal(plan.actions[0].title, 'Set GA4 measurement ID in Railway/GitHub variables');
  assert.ok(plan.actions.some((action) => action.title === 'Activate paid high-ticket path above the sprint intake'));
  assert.ok(plan.actions.some((action) => action.status === 'blocked_on_outbound_authority'));
  assert.equal(plan.metrics.leakingSource.key, 'website');
  assert.equal(plan.metrics.leakingCampaign.key, 'pro_pack');
  assert.ok(plan.constraints.some((constraint) => /Do not send public posts/.test(constraint)));
});

test('formatPlan gives the operator exact next steps', () => {
  const output = formatPlan(buildRevenuePlan(report()));

  assert.match(output, /May 2026 Revenue Machine/);
  assert.match(output, /30d: visitors 12502, checkoutStarts 583, paidOrders 6/);
  assert.match(output, /Need:/);
  assert.match(output, /THUMBGATE_SPRINT_DIAGNOSTIC_CHECKOUT_URL/);
  assert.match(output, /Written approval to send ThumbGate sales follow-up/);
  assert.match(output, /Top leaking source: website/);
});

test('buildRevenuePlan treats configured sprint checkout links as a close-path action', () => {
  const base = report();
  const plan = buildRevenuePlan(report({
    hostedAudit: {
      ...base.hostedAudit,
      runtimePresence: {
        THUMBGATE_GA_MEASUREMENT_ID: true,
        THUMBGATE_CHECKOUT_FALLBACK_URL: true,
        THUMBGATE_SPRINT_DIAGNOSTIC_CHECKOUT_URL: true,
        THUMBGATE_WORKFLOW_SPRINT_CHECKOUT_URL: true,
      },
    },
  }));

  assert.ok(!plan.actions.some((action) => action.status === 'blocked_on_payment_links'));
  assert.ok(plan.actions.some((action) => action.title === 'Convert the live paid diagnostic/sprint path into outbound closes'));
});

test('buildRevenuePlan avoids blocked account actions when runtime presence is unknown', () => {
  const plan = buildRevenuePlan(report({
    diagnosis: {
      runtimePresenceKnown: false,
    },
    hostedAudit: {
      runtimePresence: {},
      summaries: {
        today: { trafficMetrics: { visitors: 3 } },
        '30d': {
          trafficMetrics: { visitors: 50, checkoutStarts: 1 },
          signups: { uniqueLeads: 1 },
          revenue: { paidOrders: 1, bookedRevenueCents: 4900 },
          pipeline: { workflowSprintLeads: { total: 1 } },
        },
        lifetime: {},
      },
    },
  }));

  assert.ok(!plan.actions.some((action) => /GA4 measurement/.test(action.title)));
  assert.ok(plan.actions.some((action) => action.status === 'ready'));
});
