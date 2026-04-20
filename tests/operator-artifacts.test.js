'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPrPulseArtifact,
  buildReliabilityPulseArtifact,
  buildRevenuePulseArtifact,
  buildReleaseReadinessArtifact,
  formatArtifactMarkdown,
  generateOperatorArtifact,
  normalizeArtifactType,
} = require('../scripts/operator-artifacts');

const NOW = '2026-04-20T20:00:00.000Z';

test('normalizeArtifactType accepts high-signal aliases', () => {
  assert.equal(normalizeArtifactType('revenue'), 'revenue-pulse');
  assert.equal(normalizeArtifactType('prs'), 'pr-pulse');
  assert.equal(normalizeArtifactType('release'), 'release-readiness');
  assert.throws(() => normalizeArtifactType('unknown'), /Unknown operator artifact type/);
});

test('reliability artifact turns gate pressure into next actions', () => {
  const artifact = buildReliabilityPulseArtifact({
    now: NOW,
    dashboardData: {
      gateStats: { blocked: 7, warned: 2 },
      health: { feedbackCount: 120, memoryCount: 40 },
      diagnostics: { categories: [{ key: 'premature-completion', count: 3 }] },
      reviewDelta: { negativeAdded: 2 },
      lessonPipeline: { staleLessons: 1 },
    },
    sessionReport: {
      gates: { blocked: 7, warned: 2, pendingApproval: 1 },
    },
  });

  assert.equal(artifact.type, 'reliability-pulse');
  assert.equal(artifact.status, 'actionable');
  assert.equal(artifact.metrics.blocked, 7);
  assert.match(artifact.decision.nextActions.join('\n'), /Promote 2 new negative/);
  assert.match(artifact.decision.nextActions.join('\n'), /premature-completion/);
});

test('revenue artifact prioritizes acquisition when the system is at zero dollars', () => {
  const artifact = buildRevenuePulseArtifact({
    now: NOW,
    dashboardData: {
      analytics: {
        funnel: {
          visitors: 0,
          ctaClicks: 0,
          checkoutStarts: 0,
          acquisitionLeads: 0,
          paidOrders: 0,
        },
        revenue: {
          paidOrders: 0,
          bookedRevenueCents: 0,
        },
        seo: {
          landingViews: 0,
        },
      },
    },
  });

  assert.equal(artifact.type, 'revenue-pulse');
  assert.equal(artifact.status, 'actionable');
  assert.equal(artifact.decision.label, 'Create more acquisition surface');
  assert.match(artifact.decision.nextActions.join('\n'), /ThumbGate proof chunk/);
});

test('PR artifact classifies ready, blocked, pending, and draft PRs', async () => {
  const artifact = await buildPrPulseArtifact({
    now: NOW,
    prs: [
      { number: 10, title: 'ready', mergeStateStatus: 'CLEAN', mergeable: 'MERGEABLE', isDraft: false },
      { number: 11, title: 'blocked', mergeStateStatus: 'CLEAN', mergeable: 'MERGEABLE', isDraft: false },
      { number: 12, title: 'pending', mergeStateStatus: 'CLEAN', mergeable: 'MERGEABLE', isDraft: false },
      { number: 13, title: 'draft', mergeStateStatus: 'CLEAN', mergeable: 'MERGEABLE', isDraft: true },
      { number: 14, title: 'review', mergeStateStatus: 'CLEAN', mergeable: 'MERGEABLE', reviewDecision: 'REVIEW_REQUIRED', isDraft: false },
      { number: 15, title: 'behind', mergeStateStatus: 'BEHIND', mergeable: 'MERGEABLE', isDraft: false },
    ],
    checksByPr: {
      10: [{ name: 'ci', bucket: 'pass' }],
      11: [{ name: 'lint', bucket: 'fail' }],
      12: [{ name: 'build', bucket: 'pending' }],
      13: [{ name: 'ci', bucket: 'pass' }],
      14: [{ name: 'ci', bucket: 'pass' }],
      15: [{ name: 'ci', bucket: 'pass' }],
    },
  });

  assert.equal(artifact.type, 'pr-pulse');
  assert.equal(artifact.metrics.ready, 1);
  assert.equal(artifact.metrics.blocked, 3);
  assert.equal(artifact.metrics.pending, 1);
  assert.equal(artifact.metrics.draft, 1);
  assert.match(artifact.decision.nextActions.join('\n'), /#10/);
  assert.match(artifact.decision.nextActions.join('\n'), /#11/);
  assert.match(artifact.decision.nextActions.join('\n'), /review_required/);
  assert.match(artifact.decision.nextActions.join('\n'), /BEHIND/);
});

test('release readiness artifact blocks when release warnings are present', () => {
  const artifact = buildReleaseReadinessArtifact({
    now: NOW,
    packageInfo: { version: '1.2.3' },
    dashboardData: {
      health: { feedbackCount: 10, gateCount: 33, gateConfigLoaded: true },
      readiness: { warnings: ['MCP manifest mismatch'] },
      gateAudit: { warnings: 0 },
    },
  });

  assert.equal(artifact.type, 'release-readiness');
  assert.equal(artifact.status, 'blocked');
  assert.equal(artifact.metrics.version, '1.2.3');
  assert.match(artifact.decision.nextActions.join('\n'), /MCP manifest mismatch/);
});

test('generateOperatorArtifact composes injected dashboard data without shelling out', async () => {
  const artifact = await generateOperatorArtifact({
    type: 'reliability',
    now: NOW,
    dashboardData: {
      gateStats: { blocked: 0, warned: 0 },
      health: { feedbackCount: 1, memoryCount: 1 },
      reviewDelta: { negativeAdded: 0 },
      lessonPipeline: { staleLessons: 0 },
    },
    sessionReport: {
      gates: { blocked: 0, warned: 0, pendingApproval: 0 },
    },
  });

  assert.equal(artifact.type, 'reliability-pulse');
  assert.equal(artifact.status, 'healthy');
});

test('formatArtifactMarkdown emits a compact human artifact with evidence', () => {
  const artifact = buildRevenuePulseArtifact({
    now: NOW,
    dashboardData: {
      analytics: {
        funnel: { visitors: 5, ctaClicks: 1, checkoutStarts: 1, acquisitionLeads: 0 },
        revenue: { paidOrders: 0, bookedRevenueCents: 0 },
      },
    },
  });
  const markdown = formatArtifactMarkdown(artifact);

  assert.match(markdown, /^# Revenue Pulse/);
  assert.match(markdown, /Decision: Fix checkout conversion/);
  assert.match(markdown, /## Evidence/);
});
