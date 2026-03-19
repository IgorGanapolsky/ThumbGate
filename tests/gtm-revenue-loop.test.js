const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildFallbackMessage,
  buildMotionCatalog,
  buildRevenueLinks,
  deriveRevenueDirective,
  renderRevenueLoopMarkdown,
  selectOutreachMotion,
} = require('../scripts/gtm-revenue-loop');

test('motion catalog stays aligned with current commercial truth and proof links', () => {
  const links = buildRevenueLinks();
  const catalog = buildMotionCatalog(links);

  assert.match(catalog.pro.label, /Pro at \$49 one-time/);
  assert.match(catalog.pro.cta, /\/checkout\/pro$/);
  assert.match(catalog.sprint.cta, /#workflow-sprint-intake$/);
  assert.match(catalog.pro.truth, /COMMERCIAL_TRUTH\.md/);
  assert.match(catalog.pro.proof, /VERIFICATION_EVIDENCE\.md/);
});

test('cold-start directive stays dual-motion and avoids fake traction language', () => {
  const catalog = buildMotionCatalog(buildRevenueLinks());
  const directive = deriveRevenueDirective({
    revenue: {
      paidOrders: 0,
      bookedRevenueCents: 0,
    },
    trafficMetrics: {
      checkoutStarts: 0,
      ctaClicks: 0,
      visitors: 0,
    },
    signups: {
      uniqueLeads: 0,
    },
    pipeline: {
      workflowSprintLeads: {
        total: 0,
      },
      qualifiedWorkflowSprintLeads: {
        total: 0,
      },
    },
  }, catalog);

  assert.equal(directive.state, 'cold-start');
  assert.equal(directive.primaryMotion, 'pro');
  assert.equal(directive.secondaryMotion, 'sprint');
  assert.match(directive.headline, /No verified revenue/);
  assert.ok(directive.actions.some((entry) => /paid orders/i.test(entry)));
});

test('target classification sends team workflow pain to sprint and builders to pro', () => {
  const catalog = buildMotionCatalog(buildRevenueLinks());

  const sprintTarget = selectOutreachMotion({
    repoName: 'deployment-governance-agent',
    description: 'Production workflow governance and compliance gates for platform teams.',
  }, catalog);
  const proTarget = selectOutreachMotion({
    repoName: 'mcp-solo-helper',
    description: 'CLI for Claude Code builders who want better agent memory locally.',
  }, catalog);

  assert.equal(sprintTarget.key, 'sprint');
  assert.equal(proTarget.key, 'pro');
});

test('rendered revenue loop markdown anchors every target to truth and proof', () => {
  const links = buildRevenueLinks();
  const catalog = buildMotionCatalog(links);
  const selectedMotion = selectOutreachMotion({
    username: 'builder',
    repoName: 'mcp-solo-helper',
    description: 'CLI for Claude Code builders.',
  }, catalog);
  const message = buildFallbackMessage({
    username: 'builder',
    repoName: 'mcp-solo-helper',
  }, selectedMotion, catalog);

  const markdown = renderRevenueLoopMarkdown({
    generatedAt: '2026-03-18T00:00:00.000Z',
    source: 'local',
    fallbackReason: 'Hosted operational summary is not configured.',
    currentTruth: {
      publicSelfServeOffer: catalog.pro.label,
      teamPilotOffer: catalog.sprint.label,
      commercialTruthLink: catalog.pro.truth,
      verificationEvidenceLink: catalog.pro.proof,
    },
    directive: {
      state: 'cold-start',
      objective: 'First 10 paying customers',
      headline: 'No verified revenue and no active pipeline.',
      primaryMotion: 'pro',
      secondaryMotion: 'sprint',
      actions: ['Lead with Pro.', 'Use proof.'],
    },
    snapshot: {
      paidOrders: 0,
      bookedRevenueCents: 0,
      checkoutStarts: 0,
      uniqueLeads: 0,
      sprintLeads: 0,
      qualifiedSprintLeads: 0,
    },
    targets: [{
      username: 'builder',
      repoName: 'mcp-solo-helper',
      repoUrl: 'https://github.com/example/mcp-solo-helper',
      motionLabel: catalog.pro.label,
      motionReason: selectedMotion.reason,
      cta: catalog.pro.cta,
      message,
    }],
  });

  assert.match(markdown, /COMMERCIAL_TRUTH\.md/);
  assert.match(markdown, /VERIFICATION_EVIDENCE\.md/);
  assert.match(markdown, /Pro at \$49 one-time/);
  assert.doesNotMatch(markdown, /founding users today/i);
});
