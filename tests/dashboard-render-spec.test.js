'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ALLOWED_COMPONENT_TYPES,
  DASHBOARD_VIEWS,
  buildDashboardRenderSpec,
  normalizeView,
} = require('../scripts/dashboard-render-spec');

function createDashboardFixture() {
  return {
    gateStats: {
      totalGates: 6,
      manualCount: 4,
      autoCount: 2,
      blocked: 12,
      warned: 3,
      topBlocked: 'evidence-before-done',
      topBlockedCount: 8,
    },
    gates: [
      { id: 'evidence-before-done', name: 'Evidence Before Done', pattern: 'completion_claim_without_verification', action: 'block' },
      { id: 'never-force-push-main', name: 'Never force-push main', pattern: 'git\\s+push\\s+(--force|-f)', action: 'block' },
    ],
    diagnostics: {
      categories: [
        { key: 'verification_gap', count: 6, examples: ['Claimed done before running proof.'] },
      ],
    },
    liveMetrics: {
      gateHitRate: {
        blockedPerDay: 1.7,
        warnedPerDay: 0.4,
      },
    },
    analytics: {
      buyerLoss: {
        totalSignals: 3,
      },
      pipeline: {
        workflowSprintLeads: { total: 4, bySource: { producthunt: 3, website: 1 } },
        qualifiedWorkflowSprintLeads: { total: 2, bySource: { producthunt: 2 } },
      },
      revenue: {
        bookedRevenueCents: 12800,
        paidOrders: 1,
      },
      attribution: {
        acquisitionBySource: {
          producthunt: 3,
          website: 1,
        },
      },
    },
    team: {
      activeAgents: 5,
      totalAgents: 8,
      windowHours: 24,
      orgAdherenceRate: 92.4,
      riskAgents: [
        { id: 'claude-reviewer', project: 'checkout-flow', branch: 'fix/stripe-timeout', adherenceRate: 67.5 },
      ],
      topBlockedGates: [
        { gateId: 'evidence-before-done', blocked: 12, warned: 1 },
      ],
    },
    predictive: {
      upgradePropensity: {
        pro: { band: 'high', score: 0.71 },
        team: { band: 'medium', score: 0.54 },
      },
      revenueForecast: {
        predictedBookedRevenueCents: 12800,
        incrementalOpportunityCents: 4900,
      },
      anomalySummary: {
        count: 2,
        severity: 'warning',
      },
      anomalies: [
        { type: 'pricing_resistance', message: 'Price sensitivity dominates current loss reasons.', severity: 'warning' },
      ],
      topCreators: [
        { key: 'reach_vb', opportunityRevenueCents: 3100 },
      ],
      topSources: [
        { key: 'producthunt', opportunityRevenueCents: 1800 },
      ],
    },
  };
}

test('buildDashboardRenderSpec defaults to team review and only emits approved component kinds', () => {
  const spec = buildDashboardRenderSpec(createDashboardFixture());

  assert.equal(spec.view, DASHBOARD_VIEWS.TEAM_REVIEW);
  assert.deepEqual(spec.allowedComponentTypes, ALLOWED_COMPONENT_TYPES);
  assert.ok(Array.isArray(spec.availableViews));
  assert.ok(spec.components.length > 0);
  for (const component of spec.components) {
    assert.ok(ALLOWED_COMPONENT_TYPES.includes(component.type));
  }
});

test('buildDashboardRenderSpec builds workflow rollout view from acquisition and predictive data', () => {
  const spec = buildDashboardRenderSpec(createDashboardFixture(), { view: DASHBOARD_VIEWS.WORKFLOW_ROLLOUT });
  const sourceList = spec.components.find((component) => component.type === 'list' && component.title === 'Top acquisition sources');
  const rolloutList = spec.components.find((component) => component.type === 'list' && component.title === 'Next rollout moves');

  assert.equal(spec.view, DASHBOARD_VIEWS.WORKFLOW_ROLLOUT);
  assert.ok(sourceList);
  assert.equal(sourceList.items[0].title, 'producthunt');
  assert.ok(rolloutList.items.some((item) => item.title.includes('Double down on reach_vb')));
});

test('normalizeView rejects unsupported generated dashboard views', () => {
  assert.throws(() => normalizeView('freeform-ai-page'), /Unsupported dashboard render view/);
});
