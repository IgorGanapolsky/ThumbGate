const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TARGET_SEARCH_QUERIES,
  analyzeTargetEvidence,
  applyPipelineStateToTargets,
  buildFallbackMessage,
  buildCheckoutCloseDraft,
  buildOperatorHandoffPayload,
  buildOperatorSendNowPayload,
  buildMarketplaceCopy,
  buildMotionCatalog,
  buildPainConfirmedFollowUp,
  buildRevenueLoopReport,
  buildRevenueLinks,
  buildSelfServeFollowUp,
  clampTargetCount,
  deriveRevenueDirective,
  fetchGitHubJson,
  hasCredibleRepoDescription,
  hasCredibleRepoIdentity,
  hasLowBuyerIntentSignals,
  parseArgs,
  prospectTargets,
  renderMarketplaceCopyMarkdown,
  renderOperatorHandoffMarkdown,
  renderOperatorSendNowCsv,
  renderRevenueLoopMarkdown,
  renderTeamOutreachMessagesMarkdown,
  resolveRevenueLoopSummary,
  runRevenueLoop,
  selectOutreachMotion,
  summarizeCommercialSnapshot,
  writeRevenueLoopOutputs,
} = require('../scripts/gtm-revenue-loop');
const { getWarmOutboundTargets } = require('../scripts/warm-outreach-targets');
const {
  advanceSalesLead,
  importRevenueLoopReport,
  loadSalesLeads,
} = require('../scripts/sales-pipeline');

test('motion catalog stays aligned with current commercial truth and proof links', () => {
  const links = buildRevenueLinks();
  const catalog = buildMotionCatalog(links);

  assert.match(links.guideLink, /\/guide$/);
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
  assert.match(postFirstDollar.headline, /Verified booked revenue exists/);
});

test('post-first-dollar directive downgrades to historical proof language when hosted billing is not verified', () => {
  const catalog = buildMotionCatalog(buildRevenueLinks());
  const directive = deriveRevenueDirective({
    revenue: { paidOrders: 2, bookedRevenueCents: 2000 },
    trafficMetrics: {},
    signups: {},
    pipeline: {},
  }, catalog, {
    mode: 'historical-local',
  });

  assert.equal(directive.state, 'post-first-dollar');
  assert.match(directive.headline, /Historical booked revenue is verified/);
  assert.ok(directive.actions.some((entry) => /current live revenue/i.test(entry)));
});

test('resolveRevenueLoopSummary prefers hosted revenue status when local operator auth is missing', async () => {
  const result = await resolveRevenueLoopSummary({
    getOperationalBillingSummaryFn: async () => ({
      source: 'local',
      summary: {
        revenue: { paidOrders: 0, bookedRevenueCents: 0 },
        trafficMetrics: { checkoutStarts: 0 },
        signups: { uniqueLeads: 0 },
        pipeline: {},
      },
      fallbackReason: 'Hosted operational summary is not configured.',
    }),
    generateRevenueStatusReportFn: async () => ({
      source: 'hosted-via-railway-env',
      hostedAudit: {
        summaries: {
          today: {
            status: 200,
            revenue: { paidOrders: 2, bookedRevenueCents: 2000 },
            trafficMetrics: { checkoutStarts: 1, visitors: 10 },
            signups: { uniqueLeads: 1 },
            pipeline: {},
          },
        },
      },
    }),
  });

  assert.equal(result.source, 'hosted-via-railway-env');
  assert.equal(result.fallbackReason, null);
  assert.equal(result.summary.revenue.paidOrders, 2);
  assert.equal(result.summary.revenue.bookedRevenueCents, 2000);
  assert.equal(result.summary.trafficMetrics.checkoutStarts, 1);
});

test('resolveRevenueLoopSummary keeps local numbers when hosted revenue status still falls back', async () => {
  const result = await resolveRevenueLoopSummary({
    getOperationalBillingSummaryFn: async () => ({
      source: 'local',
      summary: {
        revenue: { paidOrders: 0, bookedRevenueCents: 0 },
        trafficMetrics: { checkoutStarts: 0 },
        signups: { uniqueLeads: 0 },
        pipeline: {},
      },
      fallbackReason: 'Hosted operational summary is not configured.',
    }),
    generateRevenueStatusReportFn: async () => ({
      source: 'local-fallback',
      hostedAudit: {
        summaries: {
          today: {
            status: 200,
            revenue: { paidOrders: 99, bookedRevenueCents: 9900 },
          },
        },
      },
    }),
  });

  assert.equal(result.source, 'local');
  assert.equal(result.fallbackReason, 'Hosted operational summary is not configured.');
  assert.equal(result.summary.revenue.paidOrders, 0);
});

test('resolveRevenueLoopSummary retries hosted revenue status before accepting local fallback', async () => {
  let hostedCalls = 0;
  let retryWaits = 0;

  const result = await resolveRevenueLoopSummary({
    getOperationalBillingSummaryFn: async () => ({
      source: 'local',
      summary: {
        revenue: { paidOrders: 0, bookedRevenueCents: 0 },
        trafficMetrics: { checkoutStarts: 0 },
        signups: { uniqueLeads: 0 },
        pipeline: {},
      },
      fallbackReason: 'Hosted operational summary is not configured.',
    }),
    generateRevenueStatusReportFn: async () => {
      hostedCalls += 1;
      if (hostedCalls === 1) {
        return {
          source: 'local-fallback',
          hostedAudit: {
            summaries: {
              today: {
                status: 200,
                revenue: { paidOrders: 0, bookedRevenueCents: 0 },
              },
            },
          },
        };
      }

      return {
        source: 'hosted-via-railway-env',
        hostedAudit: {
          summaries: {
            today: {
              status: 200,
              revenue: { paidOrders: 2, bookedRevenueCents: 2000 },
              trafficMetrics: { checkoutStarts: 1 },
              signups: { uniqueLeads: 1 },
              pipeline: {},
            },
          },
        },
      };
    },
    waitForRetryFn: async () => {
      retryWaits += 1;
    },
    hostedRetryDelayMs: 0,
  });

  assert.equal(hostedCalls, 2);
  assert.equal(retryWaits, 1);
  assert.equal(result.source, 'hosted-via-railway-env');
  assert.equal(result.fallbackReason, null);
  assert.equal(result.summary.revenue.paidOrders, 2);
  assert.equal(result.summary.revenue.bookedRevenueCents, 2000);
});

test('resolveRevenueLoopSummary selects the freshest hosted window with commercial signal', async () => {
  const result = await resolveRevenueLoopSummary({
    getOperationalBillingSummaryFn: async () => ({
      source: 'local',
      summary: {
        revenue: { paidOrders: 0, bookedRevenueCents: 0 },
        trafficMetrics: { checkoutStarts: 0 },
        signups: { uniqueLeads: 0 },
        pipeline: {},
      },
      fallbackReason: 'Hosted operational summary is not configured.',
    }),
    generateRevenueStatusReportFn: async () => ({
      source: 'hosted-via-railway-env',
      hostedAudit: {
        summaries: {
          today: {
            status: 200,
            revenue: { paidOrders: 0, bookedRevenueCents: 0 },
            trafficMetrics: { checkoutStarts: 0 },
            signups: { uniqueLeads: 0 },
            pipeline: {},
          },
          '30d': {
            status: 200,
            revenue: { paidOrders: 6, bookedRevenueCents: 16900 },
            trafficMetrics: { checkoutStarts: 531 },
            signups: { uniqueLeads: 346 },
            pipeline: {},
          },
          lifetime: {
            status: 200,
            revenue: { paidOrders: 6, bookedRevenueCents: 16900 },
            trafficMetrics: { checkoutStarts: 615 },
            signups: { uniqueLeads: 352 },
            pipeline: {},
          },
        },
      },
    }),
  });

  assert.equal(result.source, 'hosted-via-railway-env');
  assert.equal(result.summaryWindow, '30d');
  assert.equal(result.summary.revenue.paidOrders, 6);
  assert.equal(result.summary.revenue.bookedRevenueCents, 16900);
  assert.equal(result.summary.trafficMetrics.checkoutStarts, 531);
});

test('resolveRevenueLoopSummary prefers booked revenue over checkout-only daily activity', async () => {
  const result = await resolveRevenueLoopSummary({
    getOperationalBillingSummaryFn: async () => ({
      source: 'local',
      summary: {
        revenue: { paidOrders: 0, bookedRevenueCents: 0 },
        trafficMetrics: { checkoutStarts: 0 },
        signups: { uniqueLeads: 0 },
        pipeline: {},
      },
      fallbackReason: 'Hosted operational summary is not configured.',
    }),
    generateRevenueStatusReportFn: async () => ({
      source: 'hosted-via-railway-env',
      hostedAudit: {
        summaries: {
          today: {
            status: 200,
            revenue: { paidOrders: 0, bookedRevenueCents: 0 },
            trafficMetrics: { checkoutStarts: 13 },
            signups: { uniqueLeads: 13 },
            pipeline: {},
          },
          '30d': {
            status: 200,
            revenue: { paidOrders: 6, bookedRevenueCents: 16900 },
            trafficMetrics: { checkoutStarts: 583 },
            signups: { uniqueLeads: 399 },
            pipeline: {},
          },
          lifetime: {
            status: 200,
            revenue: { paidOrders: 6, bookedRevenueCents: 16900 },
            trafficMetrics: { checkoutStarts: 677 },
            signups: { uniqueLeads: 414 },
            pipeline: {},
          },
        },
      },
    }),
  });

  assert.equal(result.source, 'hosted-via-railway-env');
  assert.equal(result.summaryWindow, '30d');
  assert.equal(result.summary.revenue.paidOrders, 6);
  assert.equal(deriveRevenueDirective(result.summary).state, 'post-first-dollar');
});

test('resolveRevenueLoopSummary skips hosted audit when local metrics are explicitly requested', async () => {
  let hostedAuditCalls = 0;
  const result = await resolveRevenueLoopSummary({
    getOperationalBillingSummaryFn: async () => ({
      source: 'local',
      summary: {
        revenue: { paidOrders: 0, bookedRevenueCents: 0 },
        trafficMetrics: { checkoutStarts: 0 },
        signups: { uniqueLeads: 0 },
        pipeline: {},
      },
      fallbackReason: 'Hosted operational summary is disabled.',
      hostedStatus: null,
    }),
    generateRevenueStatusReportFn: async () => {
      hostedAuditCalls += 1;
      return {
        source: 'hosted-http-api',
      };
    },
  });

  assert.equal(result.source, 'local');
  assert.equal(hostedAuditCalls, 0);
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
  const proToolingTarget = selectOutreachMotion({
    repoName: 'claude-code-hooks',
    description: 'Hook bundle for Claude Code local-first guardrails and safer agent setup.',
    evidence: {
      score: 7,
      outreachAngle: 'Lead with the proof-backed setup guide and local-first enforcement before any team-motion pitch.',
    },
  }, catalog);

  assert.equal(sprintTarget.key, 'sprint');
  assert.equal(proTarget.key, 'pro');
  assert.equal(proToolingTarget.key, 'pro');
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

test('target search queries keep the GitLab review discovery lane active', () => {
  assert.ok(TARGET_SEARCH_QUERIES.includes('search/repositories?q=GitLab+review+automation+agent+sort:updated'));
});

test('self-serve hook surfaces keep the guide-first outreach angle even when they mention platforms', () => {
  const target = analyzeTargetEvidence({
    repoName: 'claude-hooks',
    description: 'Cross-platform Claude Code hooks for deterministic memory recall and local-first guardrails.',
    stars: 17,
    updatedAt: new Date().toISOString(),
  });

  assert.ok(target.score >= 4);
  assert.match(target.outreachAngle, /proof-backed setup guide|local-first enforcement/i);
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

test('low buyer-intent signals identify educational discovery surfaces', () => {
  assert.equal(hasLowBuyerIntentSignals({
    repoName: 'Learning-about-MCP',
    description: 'Course notes and learning repo for MCP experiments.',
  }), true);
  assert.equal(hasLowBuyerIntentSignals({
    repoName: 'mcp-jira-stdio',
    description: 'Production Jira workflow automation with approval handoffs.',
  }), false);
});

test('prospects GitHub targets via REST search, filters low-signal repos, and dedupes repeated repos', async () => {
  const requestedUrls = [];
  const fetchImpl = async (url, options) => {
    requestedUrls.push(String(url));
    assert.equal(options.headers.accept, 'application/vnd.github+json');
    if (String(url).includes('/users/builder')) {
      return {
        ok: true,
        async text() {
          return JSON.stringify({
            html_url: 'https://github.com/builder',
            blog: 'builder.dev',
            company: '@builder-labs',
          });
        },
      };
    }
    return {
      ok: true,
      async text() {
        return JSON.stringify({
          items: [
            {
              owner: {
                login: 'builder',
                html_url: 'https://github.com/builder',
              },
              name: 'production-mcp-server',
              html_url: 'https://github.com/builder/production-mcp-server',
              description: 'Production MCP server for deployment workflow approvals and audit proof.',
              stargazers_count: 42,
              updated_at: new Date().toISOString(),
            },
            {
              owner: {
                login: 'builder',
                html_url: 'https://github.com/builder',
              },
              name: 'production-mcp-server',
              html_url: 'https://github.com/builder/production-mcp-server',
              description: 'Duplicate target',
              stargazers_count: 42,
              updated_at: new Date().toISOString(),
            },
            {
              owner: {
                login: 'builder',
                html_url: 'https://github.com/builder',
              },
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
  assert.equal(result.targets[0].accountName, 'builder');
  assert.equal(result.targets[0].contactUrl, 'https://builder.dev/');
  assert.equal(result.targets[0].company, '@builder-labs');
  assert.deepEqual(result.targets[0].contactSurfaces, [
    { label: 'Website', url: 'https://builder.dev/' },
    { label: 'GitHub profile', url: 'https://github.com/builder' },
    { label: 'Repository', url: 'https://github.com/builder/production-mcp-server' },
  ]);
  assert.ok(result.targets[0].evidence.score >= 5);
  assert.equal(requestedUrls.length, TARGET_SEARCH_QUERIES.length + 1);
  assert.equal(
    requestedUrls.filter((url) => url.startsWith('https://api.github.com/search/repositories')).length,
    TARGET_SEARCH_QUERIES.length,
  );
  assert.ok(requestedUrls.some((url) => url === 'https://api.github.com/users/builder'));
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

test('prospecting drops educational learning repos that look active but have low buyer intent', async () => {
  const result = await prospectTargets(5, {
    fetchImpl: async () => ({
      ok: true,
      async text() {
        return JSON.stringify({
          items: [
            {
              owner: { login: 'builder' },
              name: 'Learning-about-MCP',
              html_url: 'https://github.com/builder/Learning-about-MCP',
              description: 'Learning repo for MCP workflow experiments, production notes, and agent patterns.',
              stargazers_count: 0,
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

test('prospecting drops portfolio-style repos even when they mention workflows', async () => {
  const result = await prospectTargets(5, {
    fetchImpl: async () => ({
      ok: true,
      async text() {
        return JSON.stringify({
          items: [
            {
              owner: { login: 'builder' },
              name: 'agent-workflow-portfolio',
              html_url: 'https://github.com/builder/agent-workflow-portfolio',
              description: 'Portfolio of workflow automation projects, approval demos, and AI agent experiments.',
              stargazers_count: 0,
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

test('prospecting reserves a third self-serve slot when strong tool-path targets exist', async () => {
  const selfServeNames = new Set([
    'codex-plugin-governor',
    'opencode-swarm',
    'claude-code-hooks',
  ]);
  const result = await prospectTargets(6, {
    fetchImpl: async (url) => {
      if (String(url).includes('/users/')) {
        const username = String(url).split('/').pop();
        return {
          ok: true,
          async text() {
            return JSON.stringify({
              html_url: `https://github.com/${username}`,
              blog: `${username}.dev`,
              company: `${username}-labs`,
            });
          },
        };
      }

      return {
        ok: true,
        async text() {
          return JSON.stringify({
            items: [
              {
                owner: { login: 'selfserve1', html_url: 'https://github.com/selfserve1' },
                name: 'codex-plugin-governor',
                html_url: 'https://github.com/selfserve1/codex-plugin-governor',
                description: 'Codex plugin with hooks, status line, local-first install flow, and proof-backed setup.',
                stargazers_count: 12,
                updated_at: new Date().toISOString(),
              },
              {
                owner: { login: 'selfserve2', html_url: 'https://github.com/selfserve2' },
                name: 'opencode-swarm',
                html_url: 'https://github.com/selfserve2/opencode-swarm',
                description: 'OpenCode plugin and local hook pack for agent workflow installs and setup.',
                stargazers_count: 246,
                updated_at: new Date().toISOString(),
              },
              {
                owner: { login: 'selfserve3', html_url: 'https://github.com/selfserve3' },
                name: 'claude-code-hooks',
                html_url: 'https://github.com/selfserve3/claude-code-hooks',
                description: 'Claude Code hooks, ruleset, installer, and local-first setup for safer coding workflows.',
                stargazers_count: 8,
                updated_at: new Date().toISOString(),
              },
              {
                owner: { login: 'core1', html_url: 'https://github.com/core1' },
                name: 'production-mcp-server',
                html_url: 'https://github.com/core1/production-mcp-server',
                description: 'Production MCP server for deployment workflow approvals and audit proof.',
                stargazers_count: 42,
                updated_at: new Date().toISOString(),
              },
              {
                owner: { login: 'core2', html_url: 'https://github.com/core2' },
                name: 'slack-approval-agent',
                html_url: 'https://github.com/core2/slack-approval-agent',
                description: 'Slack workflow agent for approval routing, rollback checks, and release governance.',
                stargazers_count: 19,
                updated_at: new Date().toISOString(),
              },
              {
                owner: { login: 'core3', html_url: 'https://github.com/core3' },
                name: 'review-flow',
                html_url: 'https://github.com/core3/review-flow',
                description: 'GitHub review workflow automation agent with approval boundaries and audit proof.',
                stargazers_count: 36,
                updated_at: new Date().toISOString(),
              },
            ],
          });
        },
      };
    },
  });

  assert.equal(result.targets.length, 6);
  assert.equal(
    result.targets.filter((target) => selfServeNames.has(target.repoName)).length,
    3,
  );
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
  assert.equal(prospects.errors.length, TARGET_SEARCH_QUERIES.length);
});

test('GitHub discovery falls back to gh auth token when env tokens are absent', async () => {
  const originalGithubToken = process.env.GITHUB_TOKEN;
  const originalGhToken = process.env.GH_TOKEN;
  const originalGhPat = process.env.GH_PAT;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  delete process.env.GH_PAT;

  try {
    let execCalls = 0;
    const result = await fetchGitHubJson('search/repositories?q=test', {
      execFileSyncImpl(command, args, options) {
        execCalls += 1;
        assert.equal(command, 'gh');
        assert.deepEqual(args, ['auth', 'token']);
        assert.equal(options.encoding, 'utf8');
        return 'gh-cli-token\n';
      },
      fetchImpl: async (_url, options) => {
        assert.equal(options.headers.authorization, 'Bearer gh-cli-token');
        return {
          ok: true,
          async text() {
            return '{"items":[]}';
          },
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(execCalls, 1);
  } finally {
    if (originalGithubToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalGithubToken;
    if (originalGhToken === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = originalGhToken;
    if (originalGhPat === undefined) delete process.env.GH_PAT;
    else process.env.GH_PAT = originalGhPat;
  }
});

test('prospecting reuses gh auth token fallback for search and profile enrichment', async () => {
  const originalGithubToken = process.env.GITHUB_TOKEN;
  const originalGhToken = process.env.GH_TOKEN;
  const originalGhPat = process.env.GH_PAT;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  delete process.env.GH_PAT;

  try {
    let execCalls = 0;
    const requestedAuthHeaders = [];
    const result = await prospectTargets(2, {
      execFileSyncImpl() {
        execCalls += 1;
        return 'gh-cli-token\n';
      },
      fetchImpl: async (url, options) => {
        requestedAuthHeaders.push(options.headers.authorization);
        if (String(url).includes('/users/builder')) {
          return {
            ok: true,
            async text() {
              return JSON.stringify({
                html_url: 'https://github.com/builder',
                blog: 'builder.dev',
                company: '@builder-labs',
              });
            },
          };
        }
        return {
          ok: true,
          async text() {
            return JSON.stringify({
              items: [
                {
                  owner: {
                    login: 'builder',
                    html_url: 'https://github.com/builder',
                  },
                  name: 'production-mcp-server',
                  html_url: 'https://github.com/builder/production-mcp-server',
                  description: 'Production MCP server for deployment workflow approvals and audit proof.',
                  stargazers_count: 42,
                  updated_at: new Date().toISOString(),
                },
              ],
            });
          },
        };
      },
    });

    assert.equal(result.targets.length, 1);
    assert.ok(execCalls >= 1);
    assert.ok(requestedAuthHeaders.length >= 2);
    assert.ok(requestedAuthHeaders.every((value) => value === 'Bearer gh-cli-token'));
  } finally {
    if (originalGithubToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalGithubToken;
    if (originalGhToken === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = originalGhToken;
    if (originalGhPat === undefined) delete process.env.GH_PAT;
    else process.env.GH_PAT = originalGhPat;
  }
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
      company: 'Builder Labs',
      contactUrl: 'https://www.reddit.com/user/builder/',
      contactSurfaces: [
        {
          label: 'Reddit DM',
          url: 'https://www.reddit.com/user/builder/',
        },
      ],
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
  assert.match(markdown, /Contact surfaces: Reddit DM: https:\/\/www\.reddit\.com\/user\/builder\//);
  assert.match(markdown, /Company: Builder Labs/);
  assert.match(markdown, /Warm Discovery Queue/);
  assert.match(markdown, /Source: reddit \/ reddit_dm/);
  assert.match(markdown, /Workflow Hardening Sprint/);
  assert.match(markdown, /Pipeline stage: targeted/);
  assert.match(markdown, /Evidence score: 8/);
  assert.match(markdown, /Outreach angle:/);
  assert.doesNotMatch(markdown, /founding users today/i);
});

test('pipeline-aware targets inherit follow-up stages and drop terminal leads', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-gtm-pipeline-'));
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');

  try {
    importRevenueLoopReport({
      generatedAt: '2026-04-26T00:00:00.000Z',
      targets: [
        {
          source: 'github',
          channel: 'github',
          username: 'builder',
          repoName: 'production-mcp-server',
          repoUrl: 'https://github.com/builder/production-mcp-server',
          description: 'Production workflow automation with GitHub integrations.',
          motion: 'sprint',
          motionLabel: 'Workflow Hardening Sprint',
          motionReason: 'Target can be approached with one concrete workflow-hardening offer.',
          cta: 'https://thumbgate-production.up.railway.app/#workflow-sprint-intake',
          message: 'I can harden one AI-agent workflow for you.',
        },
        {
          source: 'github',
          channel: 'github',
          username: 'paid_builder',
          repoName: 'approval-gates',
          repoUrl: 'https://github.com/paid_builder/approval-gates',
          description: 'Approval gates for agent workflows.',
          motion: 'sprint',
          motionLabel: 'Workflow Hardening Sprint',
          motionReason: 'Target can be approached with one concrete workflow-hardening offer.',
          cta: 'https://thumbgate-production.up.railway.app/#workflow-sprint-intake',
          message: 'I can harden one AI-agent workflow for you.',
        },
      ],
    }, { statePath });

    const leads = loadSalesLeads({ statePath });
    const repliedLead = leads.find((lead) => lead.contact.username === 'builder');
    const paidLead = leads.find((lead) => lead.contact.username === 'paid_builder');

    advanceSalesLead({
      leadId: repliedLead.leadId,
      stage: 'contacted',
      note: 'Sent first touch.',
    }, { statePath });
    advanceSalesLead({
      leadId: repliedLead.leadId,
      stage: 'replied',
      note: 'Buyer confirmed pain.',
    }, { statePath });
    advanceSalesLead({
      leadId: paidLead.leadId,
      stage: 'contacted',
      note: 'Sent first touch.',
    }, { statePath });
    advanceSalesLead({
      leadId: paidLead.leadId,
      stage: 'replied',
      note: 'Buyer replied.',
    }, { statePath });
    advanceSalesLead({
      leadId: paidLead.leadId,
      stage: 'call_booked',
      note: 'Call booked.',
    }, { statePath });
    advanceSalesLead({
      leadId: paidLead.leadId,
      stage: 'sprint_intake',
      note: 'Sprint intake completed.',
    }, { statePath });
    advanceSalesLead({
      leadId: paidLead.leadId,
      stage: 'paid',
      amountCents: 4900,
      note: 'Paid sprint.',
    }, { statePath });

    const targets = applyPipelineStateToTargets([
      {
        temperature: 'cold',
        source: 'github',
        channel: 'github',
        username: 'builder',
        accountName: 'builder',
        contactUrl: 'https://github.com/builder',
        contactSurfaces: [
          {
            label: 'GitHub profile',
            url: 'https://github.com/builder',
          },
        ],
        repoName: 'production-mcp-server',
        repoUrl: 'https://github.com/builder/production-mcp-server',
        description: 'Production workflow automation with GitHub integrations.',
      },
      {
        temperature: 'cold',
        source: 'github',
        channel: 'github',
        username: 'paid_builder',
        accountName: 'paid_builder',
        contactUrl: 'https://github.com/paid_builder',
        contactSurfaces: [
          {
            label: 'GitHub profile',
            url: 'https://github.com/paid_builder',
          },
        ],
        repoName: 'approval-gates',
        repoUrl: 'https://github.com/paid_builder/approval-gates',
        description: 'Approval gates for agent workflows.',
      },
      {
        temperature: 'warm',
        source: 'reddit',
        channel: 'reddit_dm',
        username: 'fresh_builder',
        accountName: 'r/ClaudeCode',
        contactUrl: 'https://www.reddit.com/user/fresh_builder/',
        contactSurfaces: [
          {
            label: 'Reddit DM',
            url: 'https://www.reddit.com/user/fresh_builder/',
          },
        ],
        repoName: '',
        repoUrl: '',
        description: 'Warm discovery lead with review-boundary pain.',
      },
    ], { salesStatePath: statePath });

    assert.equal(targets.length, 2);
    assert.equal(targets[0].pipelineStage, 'replied');
    assert.match(targets[0].nextOperatorAction, /15-minute diagnostic|sprint intake/);
    assert.equal(targets[1].pipelineStage, 'targeted');
    assert.equal(targets.some((target) => target.username === 'paid_builder'), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('team outreach markdown stays discovery-first and evidence-backed', () => {
  const links = buildRevenueLinks();
  const catalog = buildMotionCatalog(links);
  const markdown = renderTeamOutreachMessagesMarkdown({
    generatedAt: '2026-04-26T00:00:00.000Z',
    targets: [{
      temperature: 'warm',
      source: 'reddit',
      channel: 'reddit_dm',
      username: 'builder',
      accountName: 'r/ClaudeCode',
      contactUrl: 'https://www.reddit.com/user/builder/',
      contactSurfaces: [
        {
          label: 'Reddit DM',
          url: 'https://www.reddit.com/user/builder/',
        },
      ],
      evidenceScore: 9,
      evidence: ['warm inbound engagement', 'workflow pain named'],
      evidenceSources: [
        {
          label: 'Target signal',
          url: 'https://www.reddit.com/user/builder/',
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
      outreachAngle: 'Lead with one repeated workflow blocker.',
      motionLabel: catalog.sprint.label,
      motionReason: 'Warm target already named a repeated workflow blocker.',
      proofPackTrigger: 'Use proof pack only after the buyer confirms pain.',
      cta: catalog.sprint.cta,
      firstTouchDraft: 'I will harden one AI-agent workflow for you.',
      painConfirmedFollowUpDraft: 'If the workflow pain is real, I can send the proof pack.',
    }],
  });

  assert.match(markdown, /CUSTOMER_DISCOVERY_SPRINT\.md/);
  assert.match(markdown, /operator-priority-handoff\.md/);
  assert.match(markdown, /VERIFICATION_EVIDENCE\.md/);
  assert.match(markdown, /COMMERCIAL_TRUTH\.md/);
  assert.match(markdown, /I will harden one AI-agent workflow for you/);
  assert.match(markdown, /Evidence sources:/);
  assert.match(markdown, /Contact surfaces: Reddit DM: https:\/\/www\.reddit\.com\/user\/builder\//);
  assert.match(markdown, /Pain-confirmed follow-up:/);
  assert.match(markdown, /Tool-path follow-up:/);
  assert.match(markdown, /Checkout close draft:/);
  assert.match(markdown, /Log after send: `npm run sales:pipeline -- advance --lead 'reddit_builder_/);
  assert.match(markdown, /Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'reddit_builder_/);
  assert.match(markdown, /Log after checkout started: `npm run sales:pipeline -- advance --lead 'reddit_builder_/);
  assert.match(markdown, /Log after paid: `npm run sales:pipeline -- advance --lead 'reddit_builder_/);
  assert.match(markdown, /checkout\/pro/);
});

test('operator handoff markdown prioritizes follow-ups, then warm discovery, then production-rollout buyers before generic cold GitHub', () => {
  const links = buildRevenueLinks();
  const catalog = buildMotionCatalog(links);
  const markdown = renderOperatorHandoffMarkdown({
    generatedAt: '2026-04-26T00:00:00.000Z',
    directive: {
      state: 'cold-start',
      headline: 'No verified revenue and no active pipeline.',
    },
    snapshot: {
      paidOrders: 0,
      checkoutStarts: 0,
    },
    targets: [
      {
        temperature: 'warm',
        source: 'reddit',
        channel: 'reddit_dm',
        username: 'follow_builder',
        accountName: 'r/ClaudeCode',
        contactUrl: 'https://www.reddit.com/user/follow_builder/',
        contactSurfaces: [
          {
            label: 'Reddit DM',
            url: 'https://www.reddit.com/user/follow_builder/',
          },
        ],
        evidenceScore: 10,
        evidence: ['warm inbound engagement', 'buyer replied'],
        motion: 'sprint',
        motionLabel: catalog.sprint.label,
        motionReason: 'Warm target already replied and should be converted now.',
        pipelineStage: 'replied',
        nextOperatorAction: 'Convert the reply into a 15-minute diagnostic or sprint intake.',
        pipelineUpdatedAt: '2026-04-26T01:00:00.000Z',
        proofPackTrigger: 'Use proof pack only after the buyer confirms pain.',
        cta: catalog.sprint.cta,
        firstTouchDraft: 'I will harden one AI-agent workflow for you.',
        painConfirmedFollowUpDraft: 'If the workflow pain is real, I can send the proof pack.',
      },
      {
        temperature: 'cold',
        source: 'github',
        channel: 'github',
        username: 'builder',
        company: 'Builder Labs',
        contactUrl: 'https://builder.dev/',
        contactSurfaces: [
          {
            label: 'Website',
            url: 'https://builder.dev/',
          },
          {
            label: 'GitHub profile',
            url: 'https://github.com/builder',
          },
        ],
        repoName: 'production-mcp-server',
        repoUrl: 'https://github.com/builder/production-mcp-server',
        evidenceScore: 11,
        evidence: ['production or platform workflow', '42 GitHub stars'],
        motion: 'sprint',
        motionLabel: catalog.sprint.label,
        motionReason: 'Lead with rollout proof for one production workflow that cannot afford repeated agent mistakes.',
        pipelineStage: 'targeted',
        proofPackTrigger: 'Use proof pack only after the buyer confirms pain.',
        cta: catalog.sprint.cta,
        firstTouchDraft: 'I will harden one production workflow for you.',
        painConfirmedFollowUpDraft: 'If the workflow pain is real, I can send the proof pack.',
      },
      {
        temperature: 'warm',
        source: 'reddit',
        channel: 'reddit_dm',
        username: 'warm_builder',
        accountName: 'r/ClaudeCode',
        contactUrl: 'https://www.reddit.com/user/warm_builder/',
        contactSurfaces: [
          {
            label: 'Reddit DM',
            url: 'https://www.reddit.com/user/warm_builder/',
          },
        ],
        evidenceScore: 8,
        evidence: ['warm inbound engagement', 'workflow pain named'],
        motion: 'sprint',
        motionLabel: catalog.sprint.label,
        motionReason: 'Warm target already named a repeated workflow blocker.',
        pipelineStage: 'targeted',
        proofPackTrigger: 'Use proof pack only after the buyer confirms pain.',
        cta: catalog.sprint.cta,
        firstTouchDraft: 'I will harden one AI-agent workflow for you.',
        painConfirmedFollowUpDraft: 'If the workflow pain is real, I can send the proof pack.',
      },
    ],
  });

  assert.match(markdown, /sales:pipeline -- import --source docs\/marketing\/gtm-revenue-loop\.json/);
  assert.match(markdown, /Follow Up Now/);
  assert.match(markdown, /Active follow-ups: 1/);
  assert.match(markdown, /Warm targets ready now: 1/);
  assert.match(markdown, /Self-serve closes ready now: 0/);
  assert.match(markdown, /Production-rollout targets ready now: 1/);
  assert.match(markdown, /Cold GitHub targets ready next: 0/);
  assert.ok(markdown.indexOf('@follow_builder') < markdown.indexOf('@warm_builder'));
  assert.ok(markdown.indexOf('@warm_builder') < markdown.indexOf('@builder'));
  assert.match(markdown, /Send Next: Production Rollout/);
  assert.match(markdown, /VERIFICATION_EVIDENCE\.md/);
  assert.match(markdown, /COMMERCIAL_TRUTH\.md/);
  assert.match(markdown, /Contact surfaces: Website: https:\/\/builder\.dev\/; GitHub profile: https:\/\/github\.com\/builder/);
  assert.match(markdown, /Company: Builder Labs/);
  assert.match(markdown, /Pipeline lead id: reddit_follow_builder_/);
  assert.match(markdown, /Log after send: `npm run sales:pipeline -- advance --lead 'reddit_follow_builder_/);
  assert.match(markdown, /Log after checkout started: `npm run sales:pipeline -- advance --lead 'reddit_follow_builder_/);
  assert.match(markdown, /Log after sprint intake: `npm run sales:pipeline -- advance --lead 'reddit_follow_builder_/);
  assert.match(markdown, /Log after paid: `npm run sales:pipeline -- advance --lead 'reddit_follow_builder_/);
  assert.match(markdown, /Tool-path follow-up:/);
  assert.match(markdown, /Checkout close draft:/);
});

test('operator handoff payload mirrors the ranked queue and sales commands in machine-readable form', () => {
  const links = buildRevenueLinks();
  const catalog = buildMotionCatalog(links);
  const payload = buildOperatorHandoffPayload({
    generatedAt: '2026-04-26T00:00:00.000Z',
    directive: {
      state: 'post-first-dollar',
      headline: 'Verified booked revenue exists. Keep selling one concrete Workflow Hardening Sprint first, then route self-serve buyers to Pro.',
    },
    snapshot: {
      paidOrders: 2,
      checkoutStarts: 1,
    },
    targets: [
      {
        temperature: 'warm',
        source: 'reddit',
        channel: 'reddit_dm',
        username: 'follow_builder',
        accountName: 'r/ClaudeCode',
        contactUrl: 'https://www.reddit.com/user/follow_builder/',
        contactSurfaces: [
          {
            label: 'Reddit DM',
            url: 'https://www.reddit.com/user/follow_builder/',
          },
        ],
        evidenceScore: 10,
        evidence: ['warm inbound engagement', 'buyer replied'],
        motion: 'sprint',
        motionLabel: catalog.sprint.label,
        motionReason: 'Warm target already replied and should be converted now.',
        pipelineStage: 'replied',
        nextOperatorAction: 'Convert the reply into a 15-minute diagnostic or sprint intake.',
        pipelineUpdatedAt: '2026-04-26T01:00:00.000Z',
        proofPackTrigger: 'Use proof pack only after the buyer confirms pain.',
        cta: catalog.sprint.cta,
        firstTouchDraft: 'I will harden one AI-agent workflow for you.',
        painConfirmedFollowUpDraft: 'If the workflow pain is real, I can send the proof pack.',
      },
      {
        temperature: 'warm',
        source: 'reddit',
        channel: 'reddit_dm',
        username: 'warm_builder',
        accountName: 'r/ClaudeCode',
        contactUrl: 'https://www.reddit.com/user/warm_builder/',
        contactSurfaces: [
          {
            label: 'Reddit DM',
            url: 'https://www.reddit.com/user/warm_builder/',
          },
        ],
        evidenceScore: 8,
        evidence: ['warm inbound engagement', 'workflow pain named'],
        motion: 'sprint',
        motionLabel: catalog.sprint.label,
        motionReason: 'Warm target already named a repeated workflow blocker.',
        pipelineStage: 'targeted',
        proofPackTrigger: 'Use proof pack only after the buyer confirms pain.',
        cta: catalog.sprint.cta,
        firstTouchDraft: 'I will harden one AI-agent workflow for you.',
        painConfirmedFollowUpDraft: 'If the workflow pain is real, I can send the proof pack.',
      },
      {
        temperature: 'cold',
        source: 'github',
        channel: 'github',
        username: 'self_serve_builder',
        company: 'Solo Builder LLC',
        contactUrl: 'https://solo.builder.dev/',
        contactSurfaces: [
          {
            label: 'Website',
            url: 'https://solo.builder.dev/',
          },
          {
            label: 'GitHub profile',
            url: 'https://github.com/self_serve_builder',
          },
        ],
        repoName: 'claude-code-hooks',
        repoUrl: 'https://github.com/self_serve_builder/claude-code-hooks',
        evidenceScore: 9,
        evidence: ['self-serve agent tooling', 'updated in the last 7 days'],
        motion: 'pro',
        motionLabel: catalog.pro.label,
        motionReason: 'Target looks like a local hook surface, so the guide-to-Pro lane is the faster close.',
        pipelineStage: 'targeted',
        proofPackTrigger: 'Use proof pack only after the buyer confirms pain.',
        cta: catalog.pro.cta,
        firstTouchDraft: 'Start with the setup guide, then move to Pro if the tool path fits.',
        painConfirmedFollowUpDraft: 'If you want the tool path, I can send the live Pro checkout.',
        selfServeFollowUpDraft: 'Use the setup guide first, then move to Pro.',
        checkoutCloseDraft: 'If you are ready for the self-serve lane, here is the live Pro checkout.',
      },
      {
        temperature: 'cold',
        source: 'github',
        channel: 'github',
        username: 'builder',
        company: 'Builder Labs',
        contactUrl: 'https://builder.dev/',
        contactSurfaces: [
          {
            label: 'Website',
            url: 'https://builder.dev/',
          },
          {
            label: 'GitHub profile',
            url: 'https://github.com/builder',
          },
        ],
        repoName: 'production-mcp-server',
        repoUrl: 'https://github.com/builder/production-mcp-server',
        evidenceScore: 11,
        evidence: ['production or platform workflow', '42 GitHub stars'],
        motion: 'sprint',
        motionLabel: catalog.sprint.label,
        motionReason: 'Lead with rollout proof for one production workflow that cannot afford repeated agent mistakes.',
        pipelineStage: 'targeted',
        proofPackTrigger: 'Use proof pack only after the buyer confirms pain.',
        cta: catalog.sprint.cta,
        firstTouchDraft: 'I will harden one production workflow for you.',
        painConfirmedFollowUpDraft: 'If the workflow pain is real, I can send the proof pack.',
      },
    ],
  });

  assert.equal(payload.summary.revenueState, 'post-first-dollar');
  assert.equal(payload.summary.activeFollowUps, 1);
  assert.equal(payload.summary.warmTargetsReadyNow, 1);
  assert.equal(payload.summary.selfServeTargetsReadyNow, 1);
  assert.equal(payload.summary.productionRolloutTargetsReadyNow, 1);
  assert.equal(payload.summary.coldGitHubTargetsReadyNext, 0);
  assert.ok(payload.operatorRules.some((rule) => /Use Pro after one blocked repeat/i.test(rule)));
  assert.equal(payload.importCommand, 'npm run sales:pipeline -- import --source docs/marketing/gtm-revenue-loop.json');
  const followUpSection = payload.sections.find((section) => section.key === 'follow_up_now');
  const warmSection = payload.sections.find((section) => section.key === 'send_now_warm_discovery');
  const selfServeSection = payload.sections.find((section) => section.key === 'close_now_self_serve_pro');
  const productionSection = payload.sections.find((section) => section.key === 'send_next_production_rollout');
  const coldSection = payload.sections.find((section) => section.key === 'seed_next_cold_github');
  assert.equal(followUpSection.targets[0].label, '@follow_builder - r/ClaudeCode');
  assert.equal(followUpSection.targets[0].salesCommands.markSprintIntake.includes('reddit_follow_builder_'), true);
  assert.equal(followUpSection.targets[0].salesCommands.markPaid.includes('reddit_follow_builder_'), true);
  assert.match(followUpSection.targets[0].selfServeFollowUpDraft, /guide/);
  assert.match(followUpSection.targets[0].checkoutCloseDraft, /Commercial truth:/);
  assert.equal(warmSection.targets[0].contactSurfaces[0].label, 'Reddit DM');
  assert.equal(selfServeSection.targets[0].label, '@self_serve_builder - claude-code-hooks');
  assert.equal(selfServeSection.targets[0].motionLabel, catalog.pro.label);
  assert.equal(productionSection.targets[0].label, '@builder - production-mcp-server');
  assert.equal(productionSection.targets[0].contactSurfaces[1].url, 'https://github.com/builder');
  assert.equal(coldSection.targets.length, 0);
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
  assert.match(message, /prevention gate and proof run/);
  assert.doesNotMatch(message, /Lead with/i);
  assert.doesNotMatch(message, /VERIFICATION_EVIDENCE/);
  assert.doesNotMatch(message, /COMMERCIAL_TRUTH/);
});

test('first-touch outreach applies the evidence angle without leaking operator instructions', () => {
  const catalog = buildMotionCatalog(buildRevenueLinks());
  const selectedMotion = selectOutreachMotion({
    username: 'freema',
    repoName: 'mcp-jira-stdio',
    description: 'MCP server for Jira integration with workflow approvals and issue handoffs.',
    evidence: {
      score: 10,
      outreachAngle: 'Lead with one business-system workflow that needs approval boundaries, rollback safety, and proof.',
    },
  }, catalog);
  const message = buildFallbackMessage({
    username: 'freema',
    repoName: 'mcp-jira-stdio',
    description: 'MCP server for Jira integration with workflow approvals and issue handoffs.',
  }, selectedMotion, catalog);

  assert.match(message, /approval, handoff, or rollback step/i);
  assert.match(message, /mcp-jira-stdio/);
  assert.doesNotMatch(message, /Lead with/i);
  assert.doesNotMatch(message, /approval boundaries/i);
});

test('sales pipeline commands do not leak outreach instruction prefixes', () => {
  const report = buildRevenueLoopReport({
    source: 'local',
    fallbackReason: null,
    summary: {
      revenue: { paidOrders: 2, bookedRevenueCents: 2000 },
      trafficMetrics: {},
      signups: {},
      pipeline: {},
    },
    motionCatalog: buildMotionCatalog(buildRevenueLinks()),
    directive: deriveRevenueDirective({
      revenue: { paidOrders: 2, bookedRevenueCents: 2000 },
      trafficMetrics: {},
      signups: {},
      pipeline: {},
    }, buildMotionCatalog(buildRevenueLinks())),
    targets: [{
      temperature: 'cold',
      source: 'github',
      channel: 'github',
      username: 'freema',
      accountName: 'freema',
      contactUrl: 'https://github.com/freema',
      repoName: 'mcp-jira-stdio',
      repoUrl: 'https://github.com/freema/mcp-jira-stdio',
      description: 'MCP server for Jira integration with workflow approvals and issue handoffs.',
      evidence: {
        score: 10,
        evidence: ['business-system integration'],
        outreachAngle: 'Lead with one business-system workflow that needs approval boundaries, rollback safety, and proof.',
      },
      selectedMotion: {
        key: 'sprint',
        label: 'Workflow Hardening Sprint',
        reason: 'Lead with one business-system workflow that needs approval boundaries, rollback safety, and proof.',
      },
    }],
  });

  assert.match(report.targets[0].salesCommands.markContacted, /focused on one business-system workflow that needs approval boundaries, rollback safety, and proof\./);
  assert.doesNotMatch(report.targets[0].salesCommands.markContacted, /Lead with/i);
  assert.doesNotMatch(report.targets[0].salesCommands.markPaid, /Lead with/i);
});

test('first-touch outreach specializes sprint hooks without repo names', () => {
  const catalog = buildMotionCatalog(buildRevenueLinks());
  const cases = [{
    target: {
      username: 'opsbuilder',
      accountName: 'OpenOps',
      repoName: '',
      description: 'Slack approval routing for CRM analytics handoffs.',
    },
    expectedRef: '@OpenOps',
    expectedHook: /approval, handoff, or rollback step/i,
  }, {
    target: {
      username: 'releaseops',
      accountName: '@shipguard',
      repoName: '',
      description: 'CI/CD release compliance monitor for production incidents.',
    },
    expectedRef: '@shipguard',
    expectedHook: /deploy, release, or incident workflow/i,
  }, {
    target: {
      username: 'memorylab',
      accountName: 'memory-lab',
      repoName: '',
      description: 'Agent context memory orchestrator for tool use recovery.',
    },
    expectedRef: '@memory-lab',
    expectedHook: /context, memory, or tool-use failure/i,
  }, {
    target: {
      username: 'plainbuilder',
      accountName: '',
      repoName: '',
      description: 'Lightweight helper for repeated operational mistakes.',
    },
    expectedRef: 'your workflow',
    expectedHook: /workflow keeps repeating the same mistake/i,
  }];

  for (const { target, expectedRef, expectedHook } of cases) {
    const selectedMotion = selectOutreachMotion(target, catalog);
    const message = buildFallbackMessage(target, selectedMotion, catalog);

    assert.equal(selectedMotion.key, 'sprint');
    assert.match(message, new RegExp(`shipping ${expectedRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(message, expectedHook);
    assert.doesNotMatch(message, /``/);
    assert.doesNotMatch(message, /Lead with/i);
  }
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

test('conversion follow-ups keep the guide before checkout and truth plus proof at close', () => {
  const catalog = buildMotionCatalog(buildRevenueLinks());
  const sprintMotion = selectOutreachMotion({
    username: 'builder',
    repoName: 'production-mcp-server',
    description: 'Production MCP server for deployment workflow approvals and audit proof.',
    evidence: {
      score: 10,
      outreachAngle: 'Lead with rollout proof for one production workflow that cannot afford repeated agent mistakes.',
    },
  }, catalog);
  const proMotion = selectOutreachMotion({
    username: 'demo_builder',
    repoName: 'mcp-demo-template',
    description: 'Tutorial and demo template for Claude Code builders.',
  }, catalog);

  const selfServeDraft = buildSelfServeFollowUp({
    repoName: 'production-mcp-server',
  }, sprintMotion, catalog);
  const closeDraft = buildCheckoutCloseDraft({
    repoName: 'mcp-demo-template',
  }, proMotion, catalog);

  assert.match(selfServeDraft, /proof-backed setup guide/i);
  assert.match(selfServeDraft, /checkout\/pro/);
  assert.doesNotMatch(selfServeDraft, /VERIFICATION_EVIDENCE/);
  assert.match(closeDraft, /Commercial truth:/);
  assert.match(closeDraft, /Verification evidence:/);
  assert.match(closeDraft, /checkout\/pro/);
});

test('pro first-touch outreach stays discovery-first and defers checkout links', () => {
  const catalog = buildMotionCatalog(buildRevenueLinks());
  const selectedMotion = selectOutreachMotion({
    username: 'builder',
    repoName: 'mcp-demo-template',
    description: 'Tutorial and demo template for Claude Code builders.',
  }, catalog);
  const message = buildFallbackMessage({
    username: 'builder',
    repoName: 'mcp-demo-template',
    description: 'Tutorial and demo template for Claude Code builders.',
  }, selectedMotion, catalog);

  assert.equal(selectedMotion.key, 'pro');
  assert.match(message, /self-serve tool path/i);
  assert.match(message, /proof-backed setup guide/i);
  assert.match(message, /thumbgate-production\.up\.railway\.app\/guide/);
  assert.doesNotMatch(message, /checkout\/pro/);
  assert.doesNotMatch(message, /VERIFICATION_EVIDENCE/);
  assert.doesNotMatch(message, /COMMERCIAL_TRUTH/);
});

test('self-serve targets generate self-serve sales-command notes instead of sprint notes', () => {
  const links = buildRevenueLinks();
  const catalog = buildMotionCatalog(links);
  const report = buildRevenueLoopReport({
    source: 'local',
    fallbackReason: null,
    summary: {
      revenue: { paidOrders: 2, bookedRevenueCents: 2000 },
      trafficMetrics: {},
      signups: {},
      pipeline: {},
    },
    motionCatalog: catalog,
    directive: deriveRevenueDirective({
      revenue: { paidOrders: 2, bookedRevenueCents: 2000 },
      trafficMetrics: {},
      signups: {},
      pipeline: {},
    }, catalog),
    targets: [{
      temperature: 'cold',
      source: 'github',
      channel: 'github',
      username: 'builder',
      accountName: 'builder',
      contactUrl: 'https://github.com/builder',
      repoName: 'claude-code-hooks',
      repoUrl: 'https://github.com/builder/claude-code-hooks',
      description: 'Hook bundle for Claude Code local-first guardrails and safer agent setup.',
      evidence: {
        score: 8,
        evidence: ['self-serve agent tooling'],
        outreachAngle: 'Lead with the proof-backed setup guide and local-first enforcement before any team-motion pitch.',
      },
      selectedMotion: {
        key: 'pro',
        label: catalog.pro.label,
        reason: 'Target looks like a local hook, plugin, or config surface, so start with the setup guide and Pro follow-on before pitching a sprint.',
      },
      message: 'Start with the guide.',
      proofPackTrigger: 'Use proof pack only after the buyer confirms pain.',
    }],
  });

  assert.match(report.targets[0].salesCommands.markContacted, /self-serve first touch/i);
  assert.match(report.targets[0].salesCommands.markContacted, /proof-backed setup guide and local-first enforcement/i);
  assert.match(report.targets[0].salesCommands.markCallBooked, /self-serve conversation exposed repeated pain/i);
  assert.match(report.targets[0].salesCommands.markSprintIntake, /escalated from the self-serve lane/i);
});

test('sprint target sales-command notes strip operator phrasing from the pain hypothesis', () => {
  const catalog = buildMotionCatalog(buildRevenueLinks());
  const report = buildRevenueLoopReport({
    source: 'local',
    fallbackReason: null,
    summary: {
      revenue: { paidOrders: 2, bookedRevenueCents: 2000 },
      trafficMetrics: {},
      signups: {},
      pipeline: {},
    },
    motionCatalog: catalog,
    directive: deriveRevenueDirective({
      revenue: { paidOrders: 2, bookedRevenueCents: 2000 },
      trafficMetrics: {},
      signups: {},
      pipeline: {},
    }, catalog),
    targets: [{
      temperature: 'cold',
      source: 'github',
      channel: 'github',
      username: 'builder',
      accountName: 'builder',
      contactUrl: 'https://github.com/builder',
      repoName: 'production-mcp-server',
      repoUrl: 'https://github.com/builder/production-mcp-server',
      description: 'Production workflow governance for platform teams.',
      evidence: {
        score: 10,
        evidence: ['production or platform workflow'],
        outreachAngle: 'Lead with rollout proof for one production workflow that cannot afford repeated agent mistakes.',
      },
      selectedMotion: {
        key: 'sprint',
        label: catalog.sprint.label,
        reason: 'Lead with one business-system workflow that needs approval boundaries, rollback safety, and proof.',
      },
      message: 'Start with workflow hardening.',
      proofPackTrigger: 'Use proof pack only after the buyer confirms pain.',
    }],
  });

  assert.doesNotMatch(report.targets[0].salesCommands.markContacted, /focused on Lead with/i);
  assert.match(report.targets[0].salesCommands.markContacted, /focused on one business-system workflow/i);
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
      company: 'Builder Labs',
      contactUrl: 'https://www.reddit.com/user/builder/',
      contactSurfaces: [
        {
          label: 'Reddit DM',
          url: 'https://www.reddit.com/user/builder/',
        },
      ],
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

test('revenue loop report records billing verification context for historical local runs', () => {
  const links = buildRevenueLinks();
  const catalog = buildMotionCatalog(links);
  const report = buildRevenueLoopReport({
    source: 'local',
    fallbackReason: 'Hosted operational summary is not configured.',
    summary: {
      revenue: { paidOrders: 2, bookedRevenueCents: 2000 },
      trafficMetrics: { checkoutStarts: 1 },
      signups: {},
      pipeline: {},
    },
    motionCatalog: catalog,
    directive: deriveRevenueDirective({
      revenue: { paidOrders: 2, bookedRevenueCents: 2000 },
      trafficMetrics: { checkoutStarts: 1 },
      signups: {},
      pipeline: {},
    }, catalog, {
      mode: 'historical-local',
    }),
    targets: [],
  });

  assert.equal(report.verification.mode, 'historical-local');
  assert.match(report.verification.label, /Historical booked revenue is verified/);
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
        username: 'buildertools',
        accountName: 'buildertools',
        contactUrl: '',
        repoName: 'codex-hook-pack',
        repoUrl: 'https://github.com/example/codex-hook-pack',
        evidence: {
          score: 9,
          evidence: ['self-serve agent tooling', 'updated in the last 7 days'],
          outreachAngle: 'Lead with the proof-backed setup guide and local-first enforcement before any team-motion pitch.',
        },
        outreachAngle: 'Lead with the proof-backed setup guide and local-first enforcement before any team-motion pitch.',
        motion: 'pro',
        motionLabel: catalog.pro.label,
        motionReason: 'Target looks like a local hook surface, so the guide-to-Pro lane is the faster close.',
        selectedMotion: {
          key: 'pro',
          label: catalog.pro.label,
          reason: 'Target looks like a local hook surface, so the guide-to-Pro lane is the faster close.',
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
  assert.match(pack.recommendedCtas[1].cta, /#workflow-sprint-intake$/);
  assert.equal(pack.recommendedCtas[2].label, catalog.pro.label);
  assert.match(pack.recommendedCtas[2].cta, /\/checkout\/pro$/);
  assert.ok(pack.topSignals.some((signal) => /Warm discovery workflows/.test(signal.label)));
  assert.ok(pack.topSignals.some((signal) => /Business-system workflow approvals/.test(signal.label)));
  assert.ok(pack.topSignals.some((signal) => /Self-serve agent tooling/.test(signal.label)));
  assert.ok(Array.isArray(pack.listingVariants));
  assert.ok(pack.listingVariants.some((variant) => /Warm discovery workflows/.test(variant.label)));
  assert.ok(pack.listingVariants.some((variant) => variant.primaryCta.label === 'Proof-backed setup guide'));
  assert.ok(pack.listingVariants.some((variant) => variant.secondaryCta.label === catalog.pro.label));
  assert.ok(pack.sampleTargets.some((target) => target.account === 'buildertools/codex-hook-pack'));
  assert.ok(pack.listingBullets.some((bullet) => /Use Pro after one blocked repeat/i.test(bullet)));
  assert.match(markdown, /Listing Variants/);
  assert.match(markdown, /Audience: Warm buyers who already named a repeated workflow failure\./);
  assert.match(markdown, /Headline: Turn one repeated AI-agent workflow failure into a proof-backed sprint\./);
  assert.match(markdown, /Primary CTA: Proof-backed setup guide: https:\/\/thumbgate-production\.up\.railway\.app\/guide/);
  assert.match(markdown, /Proof Policy/);
  assert.match(markdown, /Evidence Backstop/);
  assert.match(markdown, /Use Pro after one blocked repeat or explicit self-serve install intent/i);
  assert.match(markdown, /Self-serve agent tooling/);
  assert.match(markdown, /COMMERCIAL_TRUTH\.md/);
  assert.match(markdown, /VERIFICATION_EVIDENCE\.md/);
  assert.ok(pack.evidenceBackstop.claimGuardrails.some((entry) => /Do not lead with proof links/i.test(entry)));
  assert.doesNotMatch(markdown, /cta unavailable in this run/i);
  assert.doesNotMatch(markdown, /paid customers already exist/i);
});

test('marketplace copy avoids live revenue language when only historical proof is available', () => {
  const links = buildRevenueLinks();
  const catalog = buildMotionCatalog(links);
  const report = buildRevenueLoopReport({
    source: 'local',
    fallbackReason: 'Hosted operational summary is not configured.',
    summary: {
      revenue: { paidOrders: 2, bookedRevenueCents: 2000 },
      trafficMetrics: {},
      signups: {},
      pipeline: {},
    },
    motionCatalog: catalog,
    directive: deriveRevenueDirective({
      revenue: { paidOrders: 2, bookedRevenueCents: 2000 },
      trafficMetrics: {},
      signups: {},
      pipeline: {},
    }, catalog, {
      mode: 'historical-local',
    }),
    targets: [],
  });

  const pack = buildMarketplaceCopy(report);

  assert.match(pack.shortDescription, /Harden one AI-agent workflow/i);
  assert.doesNotMatch(pack.shortDescription, /Verified booked revenue exists/i);
});

test('marketplace copy keeps the Pro CTA when no target currently uses the Pro motion', () => {
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
        selectedMotion: {
          key: 'sprint',
          label: catalog.sprint.label,
          reason: 'Warm workflow pain already exists.',
        },
        pipelineStage: 'targeted',
        message: 'I can harden one workflow for you this week.',
      },
    ],
  });

  const pack = buildMarketplaceCopy(report);
  const markdown = renderMarketplaceCopyMarkdown(pack);

  assert.equal(pack.recommendedCtas[2].label, catalog.pro.label);
  assert.equal(pack.recommendedCtas[2].cta, catalog.pro.cta);
  assert.match(markdown, /Pro at \$19\/mo or \$149\/yr: https:\/\/thumbgate-production\.up\.railway\.app\/checkout\/pro/);
  assert.doesNotMatch(markdown, /cta unavailable in this run/);
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
      company: 'Builder Labs',
      contactUrl: 'https://www.reddit.com/user/builder/',
      contactSurfaces: [
        {
          label: 'Reddit DM',
          url: 'https://www.reddit.com/user/builder/',
        },
      ],
      repoName: 'production-mcp-server',
      repoUrl: 'https://github.com/example/production-mcp-server',
      updatedAt: '2026-04-20T00:00:00.000Z',
      offer: 'workflow_hardening_sprint',
      selectedMotion: catalog.sprint,
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
    const teamOutreach = fs.readFileSync(path.join(reportDir, 'team-outreach-messages.md'), 'utf8');
    const operatorHandoff = fs.readFileSync(path.join(reportDir, 'operator-priority-handoff.md'), 'utf8');
    const operatorHandoffJson = JSON.parse(fs.readFileSync(path.join(reportDir, 'operator-priority-handoff.json'), 'utf8'));
    const operatorSendNowMarkdown = fs.readFileSync(path.join(reportDir, 'operator-send-now.md'), 'utf8');
    const operatorSendNowCsv = fs.readFileSync(path.join(reportDir, 'operator-send-now.csv'), 'utf8');
    const operatorSendNowJson = JSON.parse(fs.readFileSync(path.join(reportDir, 'operator-send-now.json'), 'utf8'));

    assert.equal(written.reportDir, reportDir);
    assert.equal(written.docsPath, null);
    assert.ok(fs.existsSync(path.join(reportDir, 'gtm-revenue-loop.md')));
    assert.ok(fs.existsSync(path.join(reportDir, 'gtm-revenue-loop.json')));
    assert.ok(fs.existsSync(path.join(reportDir, 'gtm-marketplace-copy.md')));
    assert.ok(fs.existsSync(path.join(reportDir, 'gtm-marketplace-copy.json')));
    assert.ok(fs.existsSync(csvPath));
    assert.ok(fs.existsSync(path.join(reportDir, 'gtm-target-queue.jsonl')));
    assert.ok(fs.existsSync(path.join(reportDir, 'team-outreach-messages.md')));
    assert.ok(fs.existsSync(path.join(reportDir, 'operator-priority-handoff.md')));
    assert.ok(fs.existsSync(path.join(reportDir, 'operator-priority-handoff.json')));
    assert.ok(fs.existsSync(path.join(reportDir, 'operator-send-now.md')));
    assert.ok(fs.existsSync(path.join(reportDir, 'operator-send-now.csv')));
    assert.ok(fs.existsSync(path.join(reportDir, 'operator-send-now.json')));
    assert.match(csv, /^temperature,source,channel,username,accountName,company,contactUrl,contactSurfaces,repoName,repoUrl,updatedAt,offer,pipelineStage,pipelineLeadId,nextOperatorAction,pipelineUpdatedAt,evidenceScore,evidence,evidenceSource,evidenceLinks,claimGuardrails,outreachAngle,motionLabel,motionReason,proofPackTrigger,cta,firstTouchDraft,painConfirmedFollowUpDraft,selfServeFollowUpDraft,checkoutCloseDraft,markContactedCommand,markRepliedCommand,markCallBookedCommand,markCheckoutStartedCommand,markSprintIntakeCommand,markPaidCommand/m);
    assert.match(csv, /"I can harden one workflow, then prove it\."/);
    assert.match(csv, /"If the workflow pain is real, I can send the proof pack\."/);
    assert.match(csv, /proof-backed setup guide/);
    assert.match(csv, /Commercial truth:/);
    assert.match(csv, /Builder Labs/);
    assert.match(csv, /Reddit DM: https:\/\/www\.reddit\.com\/user\/builder\//);
    assert.match(csv, /Commercial truth: .*COMMERCIAL_TRUTH\.md/);
    assert.match(csv, /Do not claim revenue, installs, or marketplace approval without direct command evidence\./);
    assert.match(csv, /reddit_builder_production_mcp_server/);
    assert.match(csv, /Send the first-touch draft and log the outreach in the sales pipeline\./);
    assert.match(csv, /markSprintIntakeCommand/);
    assert.match(csv, /Buyer moved into Workflow Hardening Sprint intake/);
    assert.match(marketplaceCopy.headline, /workflow/i);
    assert.equal(marketplaceCopy.recommendedCtas[0].label, 'Proof-backed setup guide');
    assert.match(marketplaceCopy.recommendedCtas[0].cta, /thumbgate-production\.up\.railway\.app\/guide/);
    assert.match(marketplaceCopy.recommendedCtas[1].cta, /#workflow-sprint-intake$/);
    assert.match(marketplaceCopy.recommendedCtas[2].cta, /\/checkout\/pro$/);
    assert.ok(Array.isArray(marketplaceCopy.topSignals));
    assert.ok(Array.isArray(marketplaceCopy.listingVariants));
    assert.ok(marketplaceCopy.listingVariants.some((variant) => /Warm discovery workflows|Workflow control surfaces/.test(variant.label)));
    assert.equal(JSON.parse(jsonl.trim()).repoName, 'production-mcp-server');
    assert.match(jsonl, /"pipelineLeadId":"reddit_builder_production_mcp_server"/);
    assert.match(jsonl, /"salesCommands":\{"markContacted":"npm run sales:pipeline -- advance --lead 'reddit_builder_production_mcp_server'/);
    assert.match(teamOutreach, /CUSTOMER_DISCOVERY_SPRINT\.md/);
    assert.match(teamOutreach, /operator-priority-handoff\.md/);
    assert.match(teamOutreach, /I will harden one AI-agent workflow for you/);
    assert.match(teamOutreach, /If the workflow pain is real, I can send the proof pack\./);
    assert.match(teamOutreach, /Log after send: `npm run sales:pipeline -- advance --lead 'reddit_builder_production_mcp_server'/);
    assert.match(operatorHandoff, /Revenue Operator Priority Handoff/);
    assert.match(operatorHandoff, /sales:pipeline -- import --source docs\/marketing\/gtm-revenue-loop\.json/);
    assert.match(operatorHandoff, /Send Now: Warm Discovery/);
    assert.match(operatorHandoff, /Pipeline lead id: reddit_builder_production_mcp_server/);
    assert.match(operatorHandoff, /Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'reddit_builder_production_mcp_server'/);
    assert.match(operatorHandoff, /Evidence sources: Target signal: https:\/\/github\.com\/example\/production-mcp-server; Commercial truth:/);
    assert.match(operatorHandoff, /Claim guardrails: Do not claim revenue, installs, or marketplace approval without direct command evidence\./);
    assert.equal(operatorHandoffJson.sections.find((section) => section.key === 'send_now_warm_discovery').label, 'Send Now: Warm Discovery');
    assert.equal(operatorHandoffJson.sections.find((section) => section.key === 'send_now_warm_discovery').targets[0].pipelineLeadId, 'reddit_builder_production_mcp_server');
    assert.match(operatorSendNowMarkdown, /Revenue Operator Send-Now Sheet/);
    assert.match(operatorSendNowMarkdown, /Pair this file with `operator-priority-handoff\.md`/);
    assert.match(operatorSendNowMarkdown, /## Send Now: Warm Discovery/);
    assert.match(operatorSendNowMarkdown, /Log after send: `npm run sales:pipeline -- advance --lead 'reddit_builder_production_mcp_server'/);
    assert.deepEqual(operatorHandoffJson.sections.find((section) => section.key === 'send_now_warm_discovery').targets[0].claimGuardrails, [
      'Do not claim revenue, installs, or marketplace approval without direct command evidence.',
    ]);
    assert.match(operatorSendNowCsv, /^rank,sectionKey,sectionLabel,temperature,source,channel,pipelineStage,pipelineLeadId,username,accountName,company,repoName,repoUrl,contactSurface,contactSurfaces,pipelineUpdatedAt,nextOperatorStep,evidenceScore,evidence,evidenceLinks,claimGuardrails,motionLabel,whyNow,proofRule,cta,firstTouchDraft,painConfirmedFollowUpDraft,selfServeFollowUpDraft,checkoutCloseDraft,markContactedCommand,markRepliedCommand,markCallBookedCommand,markCheckoutStartedCommand,markSprintIntakeCommand,markPaidCommand/m);
    assert.match(operatorSendNowCsv, /send_now_warm_discovery/);
    assert.match(operatorSendNowCsv, /reddit_builder_production_mcp_server/);
    assert.match(operatorSendNowCsv, /Builder Labs/);
    assert.match(operatorSendNowCsv, /Target signal: https:\/\/github\.com\/example\/production-mcp-server; Commercial truth:/);
    assert.match(operatorSendNowCsv, /Do not claim revenue, installs, or marketplace approval without direct command evidence\./);
    assert.equal(operatorSendNowJson.rows[0].sectionKey, 'send_now_warm_discovery');
    assert.equal(operatorSendNowJson.rows[0].pipelineLeadId, 'reddit_builder_production_mcp_server');
    assert.equal(operatorSendNowJson.rows[0].evidenceSources[0].label, 'Target signal');
    assert.equal(operatorSendNowJson.rows[0].claimGuardrails[0], 'Do not claim revenue, installs, or marketplace approval without direct command evidence.');
    assert.equal(operatorSendNowJson.rows[0].markSprintIntakeCommand.includes('sprint_intake'), true);
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
      selectedMotion: catalog.sprint,
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
    assert.ok(fs.existsSync(path.join(marketingDir, 'team-outreach-messages.md')));
    assert.ok(fs.existsSync(path.join(marketingDir, 'operator-priority-handoff.md')));
    assert.ok(fs.existsSync(path.join(marketingDir, 'operator-priority-handoff.json')));
    assert.ok(fs.existsSync(path.join(marketingDir, 'operator-send-now.md')));
    assert.ok(fs.existsSync(path.join(marketingDir, 'operator-send-now.csv')));
    assert.ok(fs.existsSync(path.join(marketingDir, 'operator-send-now.json')));
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('operator send-now export flattens ranked handoff rows for batch ops', () => {
  const links = buildRevenueLinks();
  const catalog = buildMotionCatalog(links);
  const report = {
    generatedAt: '2026-04-25T00:00:00.000Z',
    directive: {
      state: 'post-first-dollar',
      headline: 'Verified booked revenue exists.',
    },
    verification: {
      label: 'Live hosted billing summary verified for this run.',
    },
    snapshot: {
      paidOrders: 2,
      checkoutStarts: 5,
    },
    targets: [{
      temperature: 'warm',
      source: 'reddit',
      channel: 'reddit_dm',
      username: 'builder',
      accountName: 'r/ClaudeCode',
      company: 'Builder Labs',
      contactUrl: 'https://www.reddit.com/user/builder/',
      contactSurfaces: [
        {
          label: 'Reddit DM',
          url: 'https://www.reddit.com/user/builder/',
        },
      ],
      repoName: 'production-mcp-server',
      repoUrl: 'https://github.com/example/production-mcp-server',
      selectedMotion: catalog.sprint,
      pipelineStage: 'targeted',
      evidenceScore: 9,
      evidence: ['workflow control surface', '42 GitHub stars'],
      evidenceSources: [
        {
          label: 'Target signal',
          url: 'https://github.com/example/production-mcp-server',
        },
        {
          label: 'Commercial truth',
          url: catalog.pro.truth,
        },
      ],
      claimGuardrails: [
        'Do not claim revenue, installs, or marketplace approval without direct command evidence.',
      ],
      motionLabel: catalog.sprint.label,
      motionReason: 'Lead with rollout proof for one production workflow that cannot afford repeated agent mistakes.',
      proofPackTrigger: 'Use proof pack only after the buyer confirms pain.',
      cta: catalog.sprint.cta,
      firstTouchDraft: 'I can harden one workflow, then prove it.',
      painConfirmedFollowUpDraft: 'If the workflow pain is real, I can send the proof pack.',
    }],
  };

  const payload = buildOperatorSendNowPayload(report);
  const csv = renderOperatorSendNowCsv(report);

  assert.equal(payload.rows.length, 1);
  assert.equal(payload.rows[0].sectionKey, 'send_now_warm_discovery');
  assert.equal(payload.rows[0].pipelineLeadId, 'reddit_builder_production_mcp_server');
  assert.equal(payload.rows[0].company, 'Builder Labs');
  assert.equal(payload.rows[0].evidenceSources[0].label, 'Target signal');
  assert.equal(payload.rows[0].claimGuardrails[0], 'Do not claim revenue, installs, or marketplace approval without direct command evidence.');
  assert.match(csv, /send_now_warm_discovery/);
  assert.match(csv, /Reddit DM: https:\/\/www\.reddit\.com\/user\/builder\//);
  assert.match(csv, /Target signal: https:\/\/github\.com\/example\/production-mcp-server; Commercial truth:/);
  assert.match(csv, /I can harden one workflow, then prove it\./);
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

test('operator handoff markdown preserves summary why-now and contact-surface fields', () => {
  const links = buildRevenueLinks();
  const catalog = buildMotionCatalog(links);
  const report = {
    generatedAt: '2026-04-28T00:22:35.266Z',
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
    },
    targets: [{
      temperature: 'warm',
      source: 'github',
      channel: 'github',
      username: 'builder',
      accountName: 'builder',
      contactUrl: 'https://builder.example/contact',
      contactSurfaces: [
        { label: 'Website', url: 'https://builder.example/contact' },
        { label: 'Repository', url: 'https://github.com/example/production-mcp-server' },
      ],
      repoName: 'production-mcp-server',
      repoUrl: 'https://github.com/example/production-mcp-server',
      updatedAt: '2026-04-20T00:00:00.000Z',
      pipelineStage: 'targeted',
      pipelineLeadId: 'github_builder_production_mcp_server',
      evidenceScore: 9,
      evidence: ['workflow control surface', '42 GitHub stars'],
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
      motionLabel: catalog.sprint.label,
      motionReason: 'Lead with rollout proof for one production workflow that cannot afford repeated agent mistakes.',
      proofPackTrigger: 'Use proof pack only after the buyer confirms pain.',
      cta: catalog.sprint.cta,
      firstTouchDraft: 'I can harden one workflow, then prove it.',
      painConfirmedFollowUpDraft: 'If the workflow pain is real, I can send the proof pack.',
    }],
  };

  const markdown = renderOperatorHandoffMarkdown(report);

  assert.match(markdown, /- Contact surface: https:\/\/builder\.example\/contact/);
  assert.match(markdown, /- Why now: Lead with rollout proof for one production workflow that cannot afford repeated agent mistakes\./);
});

test('operator handoff falls back to repo contact surface and outreach angle when direct fields are absent', () => {
  const links = buildRevenueLinks();
  const catalog = buildMotionCatalog(links);
  const report = {
    generatedAt: '2026-04-25T00:00:00.000Z',
    source: 'local',
    fallbackReason: '',
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
    },
    targets: [{
      temperature: 'cold',
      source: 'github',
      channel: 'github',
      username: 'fallback',
      accountName: 'fallback',
      repoName: 'autonomy-gates',
      repoUrl: 'https://github.com/example/autonomy-gates',
      updatedAt: '2026-04-20T00:00:00.000Z',
      pipelineStage: 'targeted',
      pipelineLeadId: 'github_fallback_autonomy_gates',
      evidenceScore: 7,
      evidence: ['workflow control surface'],
      motionLabel: catalog.sprint.label,
      outreachAngle: 'Lead with one approval boundary before rollout.',
      proofPackTrigger: 'Use proof pack only after the buyer confirms pain.',
      cta: catalog.sprint.cta,
      firstTouchDraft: 'I can harden one workflow, then prove it.',
      painConfirmedFollowUpDraft: 'If the workflow pain is real, I can send the proof pack.',
    }],
  };

  const markdown = renderOperatorHandoffMarkdown(report);
  const payload = buildOperatorHandoffPayload(report);
  const coldSection = payload.sections.find((section) => section.key === 'seed_next_cold_github');

  assert.match(markdown, /- Contact surface: https:\/\/github\.com\/example\/autonomy-gates/);
  assert.match(markdown, /- Contact surfaces: n\/a/);
  assert.match(markdown, /- Why now: Lead with one approval boundary before rollout\./);
  assert.equal(coldSection.targets[0].contactSurface, 'https://github.com/example/autonomy-gates');
  assert.deepEqual(coldSection.targets[0].contactSurfaces, []);
  assert.equal(coldSection.targets[0].whyNow, 'Lead with one approval boundary before rollout.');
});

test('operator handoff payload preserves explicit summary contact-surface and why-now fields', () => {
  const links = buildRevenueLinks();
  const catalog = buildMotionCatalog(links);
  const report = {
    generatedAt: '2026-04-28T00:22:35.266Z',
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
    },
    targets: [{
      temperature: 'warm',
      source: 'github',
      channel: 'github',
      username: 'builder',
      accountName: 'builder',
      contactSurface: 'https://operators.example/hello',
      contactUrl: 'https://builder.example/contact',
      contactSurfaces: [
        { label: 'Operator form', url: 'https://operators.example/hello' },
      ],
      repoName: 'production-mcp-server',
      repoUrl: 'https://github.com/example/production-mcp-server',
      updatedAt: '2026-04-20T00:00:00.000Z',
      pipelineStage: 'targeted',
      pipelineLeadId: 'github_builder_production_mcp_server',
      evidenceScore: 9,
      evidence: ['workflow control surface', '42 GitHub stars'],
      motionLabel: catalog.sprint.label,
      whyNow: 'Lead with the operator intake that already matches their rollout workflow.',
      motionReason: 'This fallback should not win when whyNow exists.',
      outreachAngle: 'This fallback should not win either.',
      proofPackTrigger: 'Use proof pack only after the buyer confirms pain.',
      cta: catalog.sprint.cta,
      firstTouchDraft: 'I can harden one workflow, then prove it.',
      painConfirmedFollowUpDraft: 'If the workflow pain is real, I can send the proof pack.',
    }],
  };

  const markdown = renderOperatorHandoffMarkdown(report);
  const payload = buildOperatorHandoffPayload(report);
  const warmSection = payload.sections.find((section) => section.key === 'send_now_warm_discovery');

  assert.match(markdown, /- Contact surface: https:\/\/operators\.example\/hello/);
  assert.match(markdown, /- Why now: Lead with the operator intake that already matches their rollout workflow\./);
  assert.equal(warmSection.targets[0].contactSurface, 'https://operators.example/hello');
  assert.equal(warmSection.targets[0].whyNow, 'Lead with the operator intake that already matches their rollout workflow.');
});

test('operator handoff falls back to n/a when no contact surface or why-now context exists', () => {
  const links = buildRevenueLinks();
  const catalog = buildMotionCatalog(links);
  const report = {
    generatedAt: '2026-04-28T00:22:35.266Z',
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
    },
    targets: [{
      temperature: 'cold',
      source: 'github',
      channel: 'github',
      username: 'minimal',
      accountName: 'minimal',
      pipelineStage: 'targeted',
      pipelineLeadId: 'github_minimal_unknown',
      evidenceScore: 4,
      evidence: [],
      motionLabel: catalog.sprint.label,
      proofPackTrigger: 'Use proof pack only after the buyer confirms pain.',
      cta: catalog.sprint.cta,
      firstTouchDraft: 'I can harden one workflow, then prove it.',
      painConfirmedFollowUpDraft: 'If the workflow pain is real, I can send the proof pack.',
    }],
  };

  const markdown = renderOperatorHandoffMarkdown(report);
  const payload = buildOperatorHandoffPayload(report);
  const coldSection = payload.sections.find((section) => section.key === 'seed_next_cold_github');

  assert.match(markdown, /- Contact surface: n\/a/);
  assert.match(markdown, /- Why now: n\/a/);
  assert.equal(coldSection.targets[0].contactSurface, 'n/a');
  assert.equal(coldSection.targets[0].whyNow, '');
});

test('runRevenueLoop writes an evidence-backed target queue with discovery warnings when GitHub search fails', async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-revenue-loop-'));
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  try {
    const { report, written } = await runRevenueLoop({
      maxTargets: 2,
      reportDir,
      getOperationalBillingSummaryFn: async () => ({
        source: 'local',
        fallbackReason: 'hosted operational summary is disabled for this test',
        summary: {
          trafficMetrics: { visitors: 3, checkoutStarts: 1 },
          signups: { uniqueLeads: 1 },
          revenue: { paidOrders: 0, bookedRevenueCents: 0 },
          pipeline: { workflowSprintLeads: { total: 0 } },
        },
      }),
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
    assert.match(report.marketplaceCopy.recommendedCtas[1].cta, /#workflow-sprint-intake$/);
    assert.match(report.marketplaceCopy.recommendedCtas[2].cta, /\/checkout\/pro$/);
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
