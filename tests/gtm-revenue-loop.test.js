const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  analyzeTargetEvidence,
  buildFallbackMessage,
  buildMarketplaceCopy,
  buildMotionCatalog,
  buildPainConfirmedFollowUp,
  buildRevenueLoopReport,
  buildRevenueLinks,
  clampTargetCount,
  deriveRevenueDirective,
  fetchGitHubJson,
  hasCredibleRepoDescription,
  hasCredibleRepoIdentity,
  parseArgs,
  prospectTargets,
  renderMarketplaceCopyMarkdown,
  renderRevenueLoopMarkdown,
  runRevenueLoop,
  selectOutreachMotion,
  summarizeCommercialSnapshot,
  writeRevenueLoopOutputs,
} = require('../scripts/gtm-revenue-loop');
const { getWarmOutboundTargets } = require('../scripts/warm-outreach-targets');

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

test('repo description sanity gate rejects corrupted GitHub metadata', () => {
  assert.equal(hasCredibleRepoDescription({
    description: 'Production workflow approvals and audit proof for MCP teams.',
  }), true);
  assert.equal(hasCredibleRepoDescription({
    description: "Skip to content github / docs @@ -10,23 +10,8 @@ .github/workflows/repo-sync.yml Showing 501 changed files",
  }), false);
  assert.equal(hasCredibleRepoDescription({
    description: 'x'.repeat(501),
  }), false);
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

test('prospecting drops repositories with corrupted descriptions even when scores look high', async () => {
  const result = await prospectTargets(5, {
    fetchImpl: async () => ({
      ok: true,
      async text() {
        return JSON.stringify({
          items: [
            {
              owner: { login: 'Sfedfcv' },
              name: 'redesigned-pancake',
              html_url: 'https://github.com/Sfedfcv/redesigned-pancake',
              description: "Skip to content github / docs @@ -10,23 +10,8 @@ .github/workflows/repo-sync.yml Showing 501 changed files with 5,397 additions and 1,362 deletions.",
              stargazers_count: 224,
              updated_at: new Date().toISOString(),
            },
            {
              owner: { login: 'freema' },
              name: 'mcp-jira-stdio',
              html_url: 'https://github.com/freema/mcp-jira-stdio',
              description: 'MCP server for Jira integration with stdio transport. Issue management, project tracking, and workflow automation via Model Context Protocol.',
              stargazers_count: 11,
              updated_at: new Date().toISOString(),
            },
          ],
        });
      },
    }),
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.targets.length, 1);
  assert.equal(result.targets[0].repoName, 'mcp-jira-stdio');
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
      temperature: 'warm',
      source: 'reddit',
      channel: 'reddit_dm',
      username: 'builder',
      accountName: 'r/ClaudeCode',
      contactUrl: 'https://www.reddit.com/user/builder/',
      repoName: 'mcp-solo-helper',
      repoUrl: 'https://github.com/example/mcp-solo-helper',
      evidenceScore: 8,
      evidence: ['agent infrastructure', 'updated in the last 7 days'],
      evidenceSources: [
        {
          label: 'Target signal',
          url: 'https://github.com/example/mcp-solo-helper',
        },
        {
          label: 'Commercial truth',
          url: catalog.pro.truth,
        },
        {
          label: 'Verification evidence',
          url: catalog.pro.proof,
        },
      ],
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
  assert.match(markdown, /Evidence Backstop/);
  assert.match(markdown, /Evidence sources:/);
  assert.match(markdown, /Warm Discovery Queue/);
  assert.match(markdown, /Source: reddit \/ reddit_dm/);
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

test('pain-confirmed follow-up adds proof links only after the buyer confirms pain', () => {
  const catalog = buildMotionCatalog(buildRevenueLinks());
  const selectedMotion = selectOutreachMotion({
    username: 'builder',
    repoName: 'production-mcp-server',
    description: 'MCP server for production agent workflows.',
  }, catalog);
  const message = buildPainConfirmedFollowUp({
    username: 'builder',
    repoName: 'production-mcp-server',
  }, selectedMotion, catalog);

  assert.equal(selectedMotion.key, 'sprint');
  assert.match(message, /VERIFICATION_EVIDENCE/);
  assert.match(message, /COMMERCIAL_TRUTH/);
  assert.match(message, /Workflow Hardening Sprint/i);
});

test('pain-confirmed follow-up supports self-serve Pro targets', () => {
  const catalog = buildMotionCatalog(buildRevenueLinks());
  const selectedMotion = selectOutreachMotion({
    username: 'builder',
    repoName: 'mcp-demo-template',
    description: 'Tutorial and demo template for Claude Code builders.',
  }, catalog);
  const message = buildPainConfirmedFollowUp({
    username: 'builder',
    repoName: 'mcp-demo-template',
  }, selectedMotion, catalog);

  assert.equal(selectedMotion.key, 'pro');
  assert.match(message, /checkout\/pro/);
  assert.match(message, /self-serve path/);
  assert.match(message, /VERIFICATION_EVIDENCE/);
  assert.match(message, /COMMERCIAL_TRUTH/);
});

test('pain-confirmed follow-up falls back to workflow language for warm targets without a repo', () => {
  const catalog = buildMotionCatalog(buildRevenueLinks());
  const message = buildPainConfirmedFollowUp({
    username: 'builder',
    repoName: '',
  }, {
    key: 'sprint',
    label: catalog.sprint.label,
    reason: 'Warm target already named a repeated workflow failure.',
  }, catalog);

  assert.match(message, /If your workflow really has one repeated workflow failure blocking rollout/);
  assert.doesNotMatch(message, /``/);
  assert.match(message, /VERIFICATION_EVIDENCE/);
  assert.match(message, /COMMERCIAL_TRUTH/);
});

test('revenue loop report keeps evidence metadata on each target', () => {
  const links = buildRevenueLinks();
  const catalog = buildMotionCatalog(links);
  const report = buildRevenueLoopReport({
    source: 'local',
    fallbackReason: '',
    summary: {
      revenue: { paidOrders: 0, bookedRevenueCents: 0 },
      trafficMetrics: {},
      signups: {},
      pipeline: {},
    },
    motionCatalog: catalog,
    directive: {
      state: 'cold-start',
      objective: 'First 10 paying customers',
      headline: 'No verified revenue and no active pipeline.',
      primaryMotion: 'sprint',
      secondaryMotion: 'pro',
      actions: ['Lead with one workflow.'],
    },
    targets: [{
      temperature: 'warm',
      source: 'reddit',
      channel: 'reddit_dm',
      username: 'builder',
      accountName: 'r/ClaudeCode',
      contactUrl: 'https://www.reddit.com/user/builder/',
      repoName: 'production-mcp-server',
      repoUrl: 'https://github.com/example/production-mcp-server',
      description: 'Production workflow automation with GitHub integrations.',
      stars: 42,
      updatedAt: '2026-04-20T00:00:00.000Z',
      evidence: {
        score: 9,
        evidence: ['workflow control surface', '42 GitHub stars'],
        outreachAngle: 'Lead with rollout proof for one production workflow that cannot afford repeated agent mistakes.',
      },
      proofPackTrigger: 'Use proof pack only after the buyer confirms pain.',
      selectedMotion: {
        key: 'sprint',
        label: catalog.sprint.label,
        reason: 'Lead with rollout proof for one production workflow that cannot afford repeated agent mistakes.',
      },
      message: 'I can harden one production workflow for you this week.',
      followUpMessage: 'I can send the proof pack once the buyer confirms pain.',
    }],
  });

  assert.equal(report.targets[0].evidenceScore, 9);
  assert.equal(report.targets[0].temperature, 'warm');
  assert.equal(report.targets[0].source, 'reddit');
  assert.deepEqual(report.targets[0].evidence, ['workflow control surface', '42 GitHub stars']);
  assert.match(report.targets[0].outreachAngle, /rollout proof/);
  assert.equal(report.targets[0].evidenceSource, 'https://github.com/example/production-mcp-server');
  assert.equal(report.targets[0].evidenceSources[0].label, 'Target signal');
  assert.ok(report.targets[0].evidenceSources.some((entry) => /COMMERCIAL_TRUTH\.md/.test(entry.url)));
  assert.ok(report.targets[0].evidenceSources.some((entry) => /VERIFICATION_EVIDENCE\.md/.test(entry.url)));
  assert.ok(report.targets[0].claimGuardrails.some((entry) => /Do not claim revenue/i.test(entry)));
  assert.equal(report.targets[0].offer, 'workflow_hardening_sprint');
  assert.match(report.targets[0].proofPackTrigger, /buyer confirms pain/);
  assert.match(report.targets[0].firstTouchDraft, /harden one production workflow/);
  assert.match(report.targets[0].painConfirmedFollowUpDraft, /proof pack/);
  assert.match(report.evidenceBackstop.sourceRule, /Every listing, queue row, and pain-confirmed follow-up/);
});

test('marketplace copy pack stays tied to current revenue-loop evidence', () => {
  const links = buildRevenueLinks();
  const catalog = buildMotionCatalog(links);
  const report = buildRevenueLoopReport({
    source: 'local',
    fallbackReason: 'Hosted operational summary is not configured.',
    summary: {
      revenue: { paidOrders: 0, bookedRevenueCents: 0 },
      trafficMetrics: {},
      signups: {},
      pipeline: {},
    },
    motionCatalog: catalog,
    directive: {
      state: 'cold-start',
      objective: 'First 10 paying customers',
      headline: 'No verified revenue and no active pipeline. Stop treating posts as sales; directly sell one Workflow Hardening Sprint.',
      primaryMotion: 'sprint',
      secondaryMotion: 'pro',
      actions: ['Lead with one workflow.'],
    },
    targets: [
      {
        temperature: 'warm',
        source: 'reddit',
        channel: 'reddit_dm',
        username: 'builder',
        accountName: 'r/ClaudeCode',
        contactUrl: 'https://www.reddit.com/user/builder/',
        repoName: '',
        repoUrl: '',
        evidence: {
          score: 8,
          evidence: ['warm inbound engagement'],
          outreachAngle: 'Lead with one repeated workflow failure.',
        },
        outreachAngle: 'Lead with one repeated workflow failure.',
        motion: 'sprint',
        motionLabel: catalog.sprint.label,
        motionReason: 'Warm workflow pain already exists.',
        selectedMotion: {
          key: 'sprint',
          label: catalog.sprint.label,
          reason: 'Warm workflow pain already exists.',
        },
        pipelineStage: 'targeted',
        offer: 'workflow_hardening_sprint',
        cta: catalog.sprint.cta,
      },
      {
        temperature: 'cold',
        source: 'github',
        channel: 'github',
        username: 'freema',
        accountName: 'freema',
        contactUrl: '',
        repoName: 'mcp-jira-stdio',
        repoUrl: 'https://github.com/freema/mcp-jira-stdio',
        evidence: {
          score: 10,
          evidence: ['workflow control surface', 'business-system integration'],
          outreachAngle: 'Lead with approval boundaries, rollback safety, and proof.',
        },
        outreachAngle: 'Lead with approval boundaries, rollback safety, and proof.',
        motion: 'sprint',
        motionLabel: catalog.sprint.label,
        motionReason: 'Jira workflows need approval boundaries.',
        selectedMotion: {
          key: 'sprint',
          label: catalog.sprint.label,
          reason: 'Jira workflows need approval boundaries.',
        },
        pipelineStage: 'targeted',
        offer: 'workflow_hardening_sprint',
        cta: catalog.sprint.cta,
      },
      {
        temperature: 'cold',
        source: 'github',
        channel: 'github',
        username: 'platform',
        accountName: 'platform',
        contactUrl: '',
        repoName: 'release-governor',
        repoUrl: 'https://github.com/example/release-governor',
        evidence: {
          score: 9,
          evidence: ['production or platform workflow'],
          outreachAngle: 'Lead with rollout proof for one production workflow.',
        },
        outreachAngle: 'Lead with rollout proof for one production workflow.',
        motion: 'pro',
        motionLabel: catalog.pro.label,
        motionReason: 'Self-serve path is secondary.',
        selectedMotion: {
          key: 'pro',
          label: catalog.pro.label,
          reason: 'Self-serve path is secondary.',
        },
        pipelineStage: 'targeted',
        offer: 'pro_self_serve',
        cta: catalog.pro.cta,
      },
    ],
  });
  const pack = buildMarketplaceCopy(report);
  const markdown = renderMarketplaceCopyMarkdown(pack);

  assert.match(pack.headline, /Harden one AI-agent workflow/i);
  assert.equal(pack.recommendedCtas[0].label, 'Proof-backed setup guide');
  assert.match(pack.recommendedCtas[0].cta, /thumbgate-production\.up\.railway\.app\/guide/);
  assert.equal(pack.recommendedCtas[1].label, catalog.sprint.label);
  assert.equal(pack.recommendedCtas[2].label, catalog.pro.label);
  assert.ok(pack.topSignals.some((signal) => /Warm discovery workflows/.test(signal.label)));
  assert.ok(pack.topSignals.some((signal) => /Business-system workflow approvals/.test(signal.label)));
  assert.match(markdown, /Proof Policy/);
  assert.match(markdown, /Evidence Backstop/);
  assert.match(markdown, /COMMERCIAL_TRUTH\.md/);
  assert.match(markdown, /VERIFICATION_EVIDENCE\.md/);
  assert.ok(pack.evidenceBackstop.claimGuardrails.some((entry) => /Do not lead with proof links/i.test(entry)));
  assert.doesNotMatch(markdown, /paid customers already exist/i);
});

test('writeRevenueLoopOutputs writes markdown, json, and csv artifacts for operator import', () => {
  const links = buildRevenueLinks();
  const catalog = buildMotionCatalog(links);
  const report = {
    generatedAt: '2026-04-25T00:00:00.000Z',
    source: 'local',
    fallbackReason: 'Hosted operational summary is not configured.',
    currentTruth: {
      publicSelfServeOffer: catalog.pro.label,
      teamPilotOffer: catalog.sprint.label,
      guideLink: links.guideLink,
      commercialTruthLink: catalog.pro.truth,
      verificationEvidenceLink: catalog.pro.proof,
    },
    directive: {
      state: 'cold-start',
      objective: 'First 10 paying customers',
      headline: 'No verified revenue and no active pipeline.',
      primaryMotion: 'sprint',
      secondaryMotion: 'pro',
      actions: ['Lead with one workflow.'],
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
      temperature: 'warm',
      source: 'reddit',
      channel: 'reddit_dm',
      username: 'builder',
      accountName: 'r/ClaudeCode',
      contactUrl: 'https://www.reddit.com/user/builder/',
      repoName: 'production-mcp-server',
      repoUrl: 'https://github.com/example/production-mcp-server',
      updatedAt: '2026-04-20T00:00:00.000Z',
      offer: 'workflow_hardening_sprint',
      pipelineStage: 'targeted',
      evidenceScore: 9,
      evidence: ['workflow control surface', '42 GitHub stars'],
      evidenceSource: 'https://github.com/example/production-mcp-server',
      evidenceSources: [
        {
          label: 'Target signal',
          url: 'https://github.com/example/production-mcp-server',
        },
        {
          label: 'Commercial truth',
          url: catalog.pro.truth,
        },
        {
          label: 'Verification evidence',
          url: catalog.pro.proof,
        },
      ],
      claimGuardrails: [
        'Do not claim revenue, installs, or marketplace approval without direct command evidence.',
      ],
      outreachAngle: 'Lead with rollout proof for one production workflow that cannot afford repeated agent mistakes.',
      motionLabel: catalog.sprint.label,
      motionReason: 'Lead with rollout proof for one production workflow that cannot afford repeated agent mistakes.',
      proofPackTrigger: 'Use proof pack only after the buyer confirms pain.',
      cta: catalog.sprint.cta,
      firstTouchDraft: 'I can harden one workflow, then prove it.',
      painConfirmedFollowUpDraft: 'If the workflow pain is real, I can send the proof pack.',
    }],
  };
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-gtm-'));

  try {
    const written = writeRevenueLoopOutputs(report, { reportDir });
    const csvPath = path.join(reportDir, 'gtm-target-queue.csv');
    const csv = fs.readFileSync(csvPath, 'utf8');
    const marketplaceCopy = JSON.parse(fs.readFileSync(path.join(reportDir, 'gtm-marketplace-copy.json'), 'utf8'));
    const jsonl = fs.readFileSync(path.join(reportDir, 'gtm-target-queue.jsonl'), 'utf8');

    assert.equal(written.reportDir, reportDir);
    assert.equal(written.docsPath, null);
    assert.ok(fs.existsSync(path.join(reportDir, 'gtm-revenue-loop.md')));
    assert.ok(fs.existsSync(path.join(reportDir, 'gtm-revenue-loop.json')));
    assert.ok(fs.existsSync(path.join(reportDir, 'gtm-marketplace-copy.md')));
    assert.ok(fs.existsSync(path.join(reportDir, 'gtm-marketplace-copy.json')));
    assert.ok(fs.existsSync(csvPath));
    assert.ok(fs.existsSync(path.join(reportDir, 'gtm-target-queue.jsonl')));
    assert.match(csv, /^temperature,source,channel,username,accountName,contactUrl,repoName,repoUrl,updatedAt,offer,pipelineStage,evidenceScore,evidence,evidenceSource,evidenceLinks,claimGuardrails,outreachAngle,motionLabel,motionReason,proofPackTrigger,cta,firstTouchDraft,painConfirmedFollowUpDraft/m);
    assert.match(csv, /"I can harden one workflow, then prove it\."/);
    assert.match(csv, /"If the workflow pain is real, I can send the proof pack\."/);
    assert.match(csv, /Commercial truth: .*COMMERCIAL_TRUTH\.md/);
    assert.match(csv, /Do not claim revenue, installs, or marketplace approval without direct command evidence\./);
    assert.match(marketplaceCopy.headline, /workflow/i);
    assert.equal(marketplaceCopy.recommendedCtas[0].label, 'Proof-backed setup guide');
    assert.match(marketplaceCopy.recommendedCtas[0].cta, /thumbgate-production\.up\.railway\.app\/guide/);
    assert.ok(Array.isArray(marketplaceCopy.topSignals));
    assert.equal(JSON.parse(jsonl.trim()).repoName, 'production-mcp-server');
  } finally {
    fs.rmSync(reportDir, { recursive: true, force: true });
  }
});

test('writeRevenueLoopOutputs mirrors dedicated GTM docs instead of overwriting GitOps docs', () => {
  const links = buildRevenueLinks();
  const catalog = buildMotionCatalog(links);
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-gtm-docs-'));
  const docsDir = path.join(repoRoot, 'docs');
  const marketingDir = path.join(docsDir, 'marketing');
  const gitopsPath = path.join(docsDir, 'AUTONOMOUS_GITOPS.md');
  const report = {
    generatedAt: '2026-04-25T00:00:00.000Z',
    source: 'local',
    fallbackReason: 'Hosted operational summary is not configured.',
    currentTruth: {
      publicSelfServeOffer: catalog.pro.label,
      teamPilotOffer: catalog.sprint.label,
      guideLink: links.guideLink,
      commercialTruthLink: catalog.pro.truth,
      verificationEvidenceLink: catalog.pro.proof,
    },
    directive: {
      state: 'cold-start',
      objective: 'First 10 paying customers',
      headline: 'No verified revenue and no active pipeline.',
      primaryMotion: 'sprint',
      secondaryMotion: 'pro',
      actions: ['Lead with one workflow.'],
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
      temperature: 'warm',
      source: 'reddit',
      channel: 'reddit_dm',
      username: 'builder',
      accountName: 'r/ClaudeCode',
      contactUrl: 'https://www.reddit.com/user/builder/',
      repoName: 'production-mcp-server',
      repoUrl: 'https://github.com/example/production-mcp-server',
      updatedAt: '2026-04-20T00:00:00.000Z',
      offer: 'workflow_hardening_sprint',
      pipelineStage: 'targeted',
      evidenceScore: 9,
      evidence: ['workflow control surface', '42 GitHub stars'],
      evidenceSource: 'https://github.com/example/production-mcp-server',
      evidenceSources: [
        {
          label: 'Target signal',
          url: 'https://github.com/example/production-mcp-server',
        },
        {
          label: 'Commercial truth',
          url: catalog.pro.truth,
        },
        {
          label: 'Verification evidence',
          url: catalog.pro.proof,
        },
      ],
      claimGuardrails: [
        'Do not claim revenue, installs, or marketplace approval without direct command evidence.',
      ],
      outreachAngle: 'Lead with rollout proof for one production workflow that cannot afford repeated agent mistakes.',
      motionLabel: catalog.sprint.label,
      motionReason: 'Lead with rollout proof for one production workflow that cannot afford repeated agent mistakes.',
      proofPackTrigger: 'Use proof pack only after the buyer confirms pain.',
      cta: catalog.sprint.cta,
      firstTouchDraft: 'I can harden one workflow, then prove it.',
      painConfirmedFollowUpDraft: 'If the workflow pain is real, I can send the proof pack.',
    }],
  };

  try {
    fs.mkdirSync(marketingDir, { recursive: true });
    fs.writeFileSync(gitopsPath, '# Keep this GitOps guide intact.\n', 'utf8');

    const written = writeRevenueLoopOutputs(report, {
      writeDocs: true,
      repoRoot,
    });

    assert.equal(written.docsPath, path.join(marketingDir, 'gtm-revenue-loop.md'));
    assert.equal(fs.readFileSync(gitopsPath, 'utf8'), '# Keep this GitOps guide intact.\n');
    assert.ok(fs.existsSync(path.join(marketingDir, 'gtm-revenue-loop.md')));
    assert.ok(fs.existsSync(path.join(marketingDir, 'gtm-revenue-loop.json')));
    assert.ok(fs.existsSync(path.join(marketingDir, 'gtm-marketplace-copy.md')));
    assert.ok(fs.existsSync(path.join(marketingDir, 'gtm-marketplace-copy.json')));
    assert.ok(fs.existsSync(path.join(marketingDir, 'gtm-target-queue.csv')));
    assert.ok(fs.existsSync(path.join(marketingDir, 'gtm-target-queue.jsonl')));
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('warm-target report output does not emit blank repo placeholders in follow-up drafts', () => {
  const links = buildRevenueLinks();
  const catalog = buildMotionCatalog(links);
  const report = buildRevenueLoopReport({
    source: 'local',
    fallbackReason: '',
    summary: {
      revenue: { paidOrders: 0, bookedRevenueCents: 0 },
      trafficMetrics: {},
      signups: {},
      pipeline: {},
    },
    motionCatalog: catalog,
    directive: {
      state: 'cold-start',
      objective: 'First 10 paying customers',
      headline: 'No verified revenue and no active pipeline.',
      primaryMotion: 'sprint',
      secondaryMotion: 'pro',
      actions: ['Lead with one workflow.'],
    },
    targets: [{
      temperature: 'warm',
      source: 'reddit',
      channel: 'reddit_dm',
      username: 'builder',
      accountName: 'r/ClaudeCode',
      contactUrl: 'https://www.reddit.com/user/builder/',
      repoName: '',
      repoUrl: '',
      description: 'Builder already named a repeated workflow blocker.',
      stars: 0,
      updatedAt: null,
      evidence: {
        score: 8,
        evidence: ['warm inbound engagement'],
        outreachAngle: 'Lead with one repeated workflow blocker.',
      },
      proofPackTrigger: 'Use proof pack only after the buyer confirms pain.',
      selectedMotion: {
        key: 'sprint',
        label: catalog.sprint.label,
        reason: 'Warm target already named a repeated workflow blocker.',
      },
      message: 'I can harden one AI-agent workflow for you this week.',
    }],
  });

  assert.match(report.targets[0].painConfirmedFollowUpDraft, /If your workflow really has one repeated workflow failure blocking rollout/);
  assert.doesNotMatch(report.targets[0].painConfirmedFollowUpDraft, /``/);
});

test('runRevenueLoop writes an evidence-backed target queue with discovery warnings when GitHub search fails', async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-revenue-loop-'));
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  try {
    const { report, written } = await runRevenueLoop({
      maxTargets: 2,
      reportDir,
      fetchImpl: async (url) => {
        if (String(url).includes('Claude+Code+review+automation')) {
          return {
            ok: false,
            status: 503,
            async text() {
              return 'search temporarily unavailable';
            },
          };
        }

        return {
          ok: true,
          async text() {
            return JSON.stringify({
              items: [{
                owner: { login: 'builder' },
                name: 'production-mcp-server',
                html_url: 'https://github.com/example/production-mcp-server',
                description: 'Production workflow automation with GitHub integrations.',
                stargazers_count: 42,
                updated_at: '2026-04-20T00:00:00.000Z',
              }],
            });
          },
        };
      },
    });

    assert.equal(report.targets.length, 5);
    assert.equal(report.targets.filter((target) => target.temperature === 'warm').length, 4);
    assert.equal(report.targets.filter((target) => target.temperature !== 'warm').length, 1);
    assert.ok(Array.isArray(report.discoveryWarnings));
    assert.equal(report.discoveryWarnings.length, 1);
    assert.match(report.discoveryWarnings[0], /temporarily unavailable/);
    assert.ok(report.marketplaceCopy);
    assert.match(report.currentTruth.guideLink, /thumbgate-production\.up\.railway\.app\/guide/);
    assert.ok(Array.isArray(report.marketplaceCopy.topSignals));
    assert.equal(report.marketplaceCopy.recommendedCtas[0].label, 'Proof-backed setup guide');
    assert.match(report.targets[0].proofPackTrigger, /buyer confirms pain/);
    assert.match(report.targets[0].painConfirmedFollowUpDraft, /VERIFICATION_EVIDENCE/);
    assert.equal(written.reportDir, reportDir);
    assert.ok(fs.existsSync(path.join(reportDir, 'gtm-marketplace-copy.md')));
    assert.ok(fs.existsSync(path.join(reportDir, 'gtm-marketplace-copy.json')));
    assert.ok(fs.existsSync(path.join(reportDir, 'gtm-target-queue.csv')));
    assert.ok(fs.existsSync(path.join(reportDir, 'gtm-target-queue.jsonl')));
  } finally {
    if (originalGeminiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalGeminiKey;
    }
    fs.rmSync(reportDir, { recursive: true, force: true });
  }
});

test('warm discovery targets stay sprint-first and evidence-backed', () => {
  const warmTargets = getWarmOutboundTargets('https://thumbgate-production.up.railway.app/#workflow-sprint-intake');

  assert.equal(warmTargets.length, 4);
  assert.ok(warmTargets.every((target) => target.temperature === 'warm'));
  assert.ok(warmTargets.every((target) => target.selectedMotion.key === 'sprint'));
  assert.ok(warmTargets.every((target) => /harden end-to-end this week|harden that workflow/.test(target.message)));
  assert.ok(warmTargets.every((target) => !/lifetime pro|no strings attached/i.test(target.message)));
});
