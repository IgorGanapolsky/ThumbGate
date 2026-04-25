const test = require('node:test');
const assert = require('node:assert/strict');

const {
  analyzeTargetEvidence,
  buildFallbackMessage,
  buildMotionCatalog,
  buildRevenueLinks,
  clampTargetCount,
  deriveRevenueDirective,
  fetchGitHubJson,
  hasCredibleRepoIdentity,
  parseArgs,
  prospectTargets,
  renderRevenueLoopMarkdown,
  selectOutreachMotion,
  summarizeCommercialSnapshot,
} = require('../scripts/gtm-revenue-loop');

test('motion catalog stays aligned with current commercial truth and proof links', () => {
  const links = buildRevenueLinks();
  const catalog = buildMotionCatalog(links);

  assert.match(catalog.pro.label, /Pro at \$19\/mo or \$149\/yr/);
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
  assert.equal(directive.primaryMotion, 'sprint');
  assert.equal(directive.secondaryMotion, 'pro');
  assert.match(directive.headline, /No verified revenue/);
  assert.match(directive.headline, /Workflow Hardening Sprint/);
  assert.ok(directive.actions.some((entry) => /paid orders/i.test(entry)));
  assert.ok(directive.actions.some((entry) => /contacted -> replied -> call booked/i.test(entry)));
});

test('revenue directives switch once interest or paid orders exist', () => {
  const catalog = buildMotionCatalog(buildRevenueLinks());
  const pipelineActive = deriveRevenueDirective({
    revenue: { paidOrders: 0, bookedRevenueCents: 0 },
    trafficMetrics: { checkoutStarts: 1 },
    signups: { uniqueLeads: 0 },
    pipeline: {},
  }, catalog);
  const postFirstDollar = deriveRevenueDirective({
    revenue: { paidOrders: 1, bookedRevenueCents: 4900 },
    trafficMetrics: {},
    signups: {},
    pipeline: {},
  }, catalog);

  assert.equal(pipelineActive.state, 'pipeline-active-no-revenue');
  assert.match(pipelineActive.headline, /paid conversion is still zero/);
  assert.equal(postFirstDollar.state, 'post-first-dollar');
  assert.match(postFirstDollar.headline, /Revenue is proven/);
});

test('argument and commercial snapshot helpers stay bounded and explicit', () => {
  assert.deepEqual(parseArgs(['--write-docs', '--report-dir', 'reports/gtm', '--max-targets=99']), {
    maxTargets: 12,
    reportDir: 'reports/gtm',
    writeDocs: true,
  });
  assert.equal(clampTargetCount('0'), 6);
  assert.equal(clampTargetCount('3'), 3);
  assert.deepEqual(summarizeCommercialSnapshot({
    revenue: { paidOrders: 2, bookedRevenueCents: 9800 },
    trafficMetrics: { checkoutStarts: 3, ctaClicks: 4, visitors: 5 },
    signups: { uniqueLeads: 6 },
    pipeline: {
      workflowSprintLeads: { total: 7 },
      qualifiedWorkflowSprintLeads: { total: 8 },
    },
  }), {
    paidOrders: 2,
    bookedRevenueCents: 9800,
    checkoutStarts: 3,
    ctaClicks: 4,
    visitors: 5,
    uniqueLeads: 6,
    sprintLeads: 7,
    qualifiedSprintLeads: 8,
    latestPaidAt: null,
  });
});

test('target classification leads with sprint unless target is clearly self-serve only', () => {
  const catalog = buildMotionCatalog(buildRevenueLinks());

  const sprintTarget = selectOutreachMotion({
    repoName: 'deployment-governance-agent',
    description: 'Production workflow governance and compliance gates for platform teams.',
    evidence: {
      score: 10,
      outreachAngle: 'Lead with rollout proof for one production workflow that cannot afford repeated agent mistakes.',
    },
  }, catalog);
  const proTarget = selectOutreachMotion({
    repoName: 'mcp-demo-template',
    description: 'Tutorial and demo template for Claude Code builders.',
  }, catalog);

  assert.equal(sprintTarget.key, 'sprint');
  assert.equal(proTarget.key, 'pro');
});

test('target evidence favors production workflows over generic fresh repos', () => {
  const strong = analyzeTargetEvidence({
    repoName: 'jira-workflow-guardian',
    description: 'Production Jira workflow governance with approval gates and audit proof for platform teams.',
    stars: 84,
    updatedAt: new Date().toISOString(),
  });
  const weak = analyzeTargetEvidence({
    repoName: 'mcp-playground-demo',
    description: 'Template demo for trying MCP quickly.',
    stars: 0,
    updatedAt: new Date().toISOString(),
  });

  assert.ok(strong.score > weak.score);
  assert.ok(strong.evidence.some((entry) => /workflow control surface/i.test(entry)));
  assert.match(strong.outreachAngle, /rollout proof|approval boundaries/i);
});

test('repo identity filter drops obviously weak identifiers', () => {
  assert.equal(hasCredibleRepoIdentity({ repoName: '-L-' }), false);
  assert.equal(hasCredibleRepoIdentity({ repoName: 'mcp-jira-stdio' }), true);
});

test('prospects GitHub targets via REST search, filters low-signal repos, and dedupes repeated repos', async () => {
  const requestedUrls = [];
  const fetchImpl = async (url, options) => {
    requestedUrls.push(String(url));
    assert.equal(options.headers.accept, 'application/vnd.github+json');
    return {
      ok: true,
      async text() {
        return JSON.stringify({
          items: [
            {
              owner: { login: 'builder' },
              name: 'production-mcp-server',
              html_url: 'https://github.com/builder/production-mcp-server',
              description: 'Production MCP server for deployment workflow approvals and audit proof.',
              stargazers_count: 42,
              updated_at: new Date().toISOString(),
            },
            {
              owner: { login: 'builder' },
              name: 'production-mcp-server',
              html_url: 'https://github.com/builder/production-mcp-server',
              description: 'Duplicate target',
              stargazers_count: 42,
              updated_at: new Date().toISOString(),
            },
            {
              owner: { login: 'builder' },
              name: 'mcp-demo-template',
              html_url: 'https://github.com/builder/mcp-demo-template',
              description: 'Template demo for Claude Code builders.',
              stargazers_count: 0,
              updated_at: new Date().toISOString(),
            },
          ],
        });
      },
    };
  };

  const result = await prospectTargets(5, { fetchImpl });

  assert.equal(result.errors.length, 0);
  assert.equal(result.targets.length, 1);
  assert.equal(result.targets[0].username, 'builder');
  assert.ok(result.targets[0].evidence.score >= 5);
  assert.equal(requestedUrls.length, 3);
  assert.ok(requestedUrls.every((url) => url.startsWith('https://api.github.com/search/repositories')));
});

test('GitHub discovery reports API and parser failures as non-fatal warnings', async () => {
  const failed = await fetchGitHubJson('search/repositories?q=test', {
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      async text() {
        return 'rate limited';
      },
    }),
  });
  const invalid = await fetchGitHubJson('search/repositories?q=test', {
    fetchImpl: async () => ({
      ok: true,
      async text() {
        return '{not json';
      },
    }),
  });
  const unavailable = await fetchGitHubJson('search/repositories?q=test', { fetchImpl: null });
  const prospects = await prospectTargets(2, {
    fetchImpl: async () => ({
      ok: false,
      status: 500,
      async text() {
        return 'github unavailable';
      },
    }),
  });

  assert.equal(failed.ok, false);
  assert.match(failed.error, /rate limited/);
  assert.equal(invalid.ok, false);
  assert.equal(unavailable.ok, false);
  assert.equal(prospects.targets.length, 0);
  assert.equal(prospects.errors.length, 3);
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
      evidenceScore: 8,
      evidence: ['agent infrastructure', 'updated in the last 7 days'],
      outreachAngle: 'Lead with context-drift hardening for one workflow before proposing any broader agent platform story.',
      motion: selectedMotion.key,
      motionLabel: selectedMotion.label,
      motionReason: selectedMotion.reason,
      pipelineStage: 'targeted',
      offer: 'workflow_hardening_sprint',
      cta: catalog[selectedMotion.key].cta,
      message,
    }],
  });

  assert.match(markdown, /COMMERCIAL_TRUTH\.md/);
  assert.match(markdown, /VERIFICATION_EVIDENCE\.md/);
  assert.match(markdown, /Workflow Hardening Sprint/);
  assert.match(markdown, /Pipeline stage: targeted/);
  assert.match(markdown, /Evidence score: 8/);
  assert.match(markdown, /Outreach angle:/);
  assert.doesNotMatch(markdown, /founding users today/i);
});

test('first-touch outreach does not push proof before pain is confirmed', () => {
  const catalog = buildMotionCatalog(buildRevenueLinks());
  const selectedMotion = selectOutreachMotion({
    username: 'builder',
    repoName: 'production-mcp-server',
    description: 'MCP server for production agent workflows.',
  }, catalog);
  const message = buildFallbackMessage({
    username: 'builder',
    repoName: 'production-mcp-server',
  }, selectedMotion, catalog);

  assert.equal(selectedMotion.key, 'sprint');
  assert.match(message, /harden/);
  assert.doesNotMatch(message, /VERIFICATION_EVIDENCE/);
  assert.doesNotMatch(message, /COMMERCIAL_TRUTH/);
});
