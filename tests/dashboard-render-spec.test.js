'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ALLOWED_COMPONENT_TYPES,
  DASHBOARD_VIEWS,
  buildAssuranceTimelineItems,
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
    gateAudit: {
      days: [
        { dayKey: '2026-07-31', allow: 0, deny: 0, warn: 0, intercepted: 0, total: 0 },
        { dayKey: '2026-08-01', allow: 4, deny: 0, warn: 1, intercepted: 1, total: 5 },
        {
          dayKey: '2026-08-02',
          allow: 5,
          deny: 2,
          warn: 0,
          intercepted: 2,
          total: 7,
          command: 'must not reach the render spec',
          content: 'must not reach the render spec',
        },
      ],
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

test('incident review renders a privacy-safe newest-first daily assurance timeline', () => {
  const spec = buildDashboardRenderSpec(createDashboardFixture(), {
    view: DASHBOARD_VIEWS.INCIDENT_REVIEW,
  });
  const timeline = spec.components.find(
    (component) => component.type === 'list' && component.title === 'Daily assurance timeline',
  );

  assert.ok(timeline);
  assert.equal(timeline.items.length, 2);
  assert.deepEqual(timeline.items[0], {
    title: '2026-08-02',
    subtitle: '7 evaluated · 2 intercepted',
    badge: '2 denied · 0 warned',
    tone: 'danger',
  });
  assert.equal(timeline.items[1].title, '2026-08-01');
  assert.doesNotMatch(JSON.stringify(timeline), /must not reach the render spec/);
});

test('assurance timeline is capped at seven non-empty aggregate days', () => {
  const days = Array.from({ length: 10 }, (_, index) => ({
    dayKey: `2026-07-${String(index + 20).padStart(2, '0')}`,
    allow: 1,
    deny: 0,
    warn: 0,
    intercepted: 0,
    total: 1,
  }));

  const items = buildAssuranceTimelineItems({ days });
  assert.equal(items.length, 7);
  assert.equal(items[0].title, '2026-07-29');
  assert.equal(items[6].title, '2026-07-23');
});

test('incident review does not convert missing gate evidence into a safety claim', () => {
  const fixture = createDashboardFixture();
  fixture.gateAudit = { days: [] };
  const spec = buildDashboardRenderSpec(fixture, {
    view: DASHBOARD_VIEWS.INCIDENT_REVIEW,
  });
  const timeline = spec.components.find(
    (component) => component.type === 'list' && component.title === 'Daily assurance timeline',
  );

  assert.deepEqual(timeline.items, []);
  assert.equal(
    timeline.emptyMessage,
    'No gate decisions were recorded in this window; no safety conclusion is implied.',
  );
});

const assurancePagePath = path.join(
  __dirname,
  '..',
  'public',
  'use-cases',
  'continuous-agent-assurance.html',
);
const assurancePageHtml = fs.readFileSync(assurancePagePath, 'utf8');

test('continuous agent assurance page has a canonical, structured public contract', () => {
  assert.match(assurancePageHtml, /<link rel="canonical" href="https:\/\/thumbgate\.ai\/use-cases\/continuous-agent-assurance">/);
  assert.match(assurancePageHtml, /"@type": "TechArticle"/);
  assert.match(assurancePageHtml, /Continuous AI Agent Assurance/i);
});

test('assurance page explains the observe, enforce, verify lifecycle in order', () => {
  const observe = assurancePageHtml.indexOf('01 · OBSERVE');
  const enforce = assurancePageHtml.indexOf('02 · ENFORCE');
  const verify = assurancePageHtml.indexOf('03 · VERIFY');

  assert.ok(observe >= 0);
  assert.ok(enforce > observe);
  assert.ok(verify > enforce);
  assert.match(assurancePageHtml, /Deterministic checks hold execution authority/i);
});

test('assurance page makes feedback-to-enforcement staging explicit', () => {
  assert.match(assurancePageHtml, /👍 👎/);
  assert.match(assurancePageHtml, /Capture/);
  assert.match(assurancePageHtml, /Propose/);
  assert.match(assurancePageHtml, /Validate/);
  assert.match(assurancePageHtml, /Promote/);
  assert.match(assurancePageHtml, /Feedback proposes; humans govern/i);
});

test('assurance page keeps privacy, spend, and evidence boundaries explicit', () => {
  assert.match(assurancePageHtml, /No raw prompts required/i);
  assert.match(assurancePageHtml, /Local-first, offline-capable/i);
  assert.match(assurancePageHtml, /No external spend is necessary/i);
  assert.match(assurancePageHtml, /cannot prove/i);
  assert.match(assurancePageHtml, /zero risk/i);
  assert.doesNotMatch(assurancePageHtml, /guarantees? safety|100% safe|fully compliant/i);
});

test('assurance page links authoritative references and existing buyer paths', () => {
  for (const expected of [
    'https://www.nist.gov/itl/ai-risk-management-framework',
    'https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf',
    'https://genai.owasp.org/',
    'https://atlas.mitre.org/',
    'https://opentelemetry.io/docs/specs/semconv/gen-ai/',
    'https://developers.openai.com/api/docs/guides/agents/guardrails-approvals',
    'href="/diagnostic"',
    'href="/dashboard"',
  ]) {
    assert.ok(assurancePageHtml.includes(expected), `missing expected reference: ${expected}`);
  }
});

test('assurance page adapts operating mechanics without copying competitor branding or slogans', () => {
  assert.doesNotMatch(assurancePageHtml, /District Cyber|Imagine, Innovate, Ignite|full-cycle model development|24\/7 monitoring/i);
  assert.doesNotMatch(assurancePageHtml, /\$\d/);
});
