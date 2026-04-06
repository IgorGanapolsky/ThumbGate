const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-dashboard-test-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
process.env._TEST_API_KEYS_PATH = path.join(tmpDir, 'api-keys.json');
process.env._TEST_FUNNEL_LEDGER_PATH = path.join(tmpDir, 'funnel-events.jsonl');
process.env._TEST_REVENUE_LEDGER_PATH = path.join(tmpDir, 'revenue-events.jsonl');

const {
  generateDashboard,
  computeApprovalStats,
  computeSessionTrend,
  readJSONL,
  readJsonFile,
} = require('../scripts/dashboard');

test.beforeEach(() => {
  for (const fileName of [
    'feedback-log.jsonl',
    'memory-log.jsonl',
    'diagnostic-log.jsonl',
    'telemetry-pings.jsonl',
    'funnel-events.jsonl',
    'revenue-events.jsonl',
    'api-keys.json',
  ]) {
    fs.rmSync(path.join(tmpDir, fileName), { force: true });
  }
});

test.after(() => {
  delete process.env._TEST_API_KEYS_PATH;
  delete process.env._TEST_FUNNEL_LEDGER_PATH;
  delete process.env._TEST_REVENUE_LEDGER_PATH;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFeedbackLog(entries) {
  const logPath = path.join(tmpDir, 'feedback-log.jsonl');
  const lines = entries.map((e) => JSON.stringify(e)).join('\n');
  fs.writeFileSync(logPath, lines + '\n');
}

function writeMemoryLog(entries) {
  const memPath = path.join(tmpDir, 'memory-log.jsonl');
  const lines = entries.map((e) => JSON.stringify(e)).join('\n');
  fs.writeFileSync(memPath, lines + '\n');
}

function writeDiagnosticLog(entries) {
  const diagnosticPath = path.join(tmpDir, 'diagnostic-log.jsonl');
  const lines = entries.map((e) => JSON.stringify(e)).join('\n');
  fs.writeFileSync(diagnosticPath, lines + '\n');
}

function writeTelemetryLog(entries) {
  const telemetryPath = path.join(tmpDir, 'telemetry-pings.jsonl');
  const lines = entries.map((e) => JSON.stringify(e)).join('\n');
  fs.writeFileSync(telemetryPath, lines + '\n');
}

function writeFunnelLedger(entries) {
  const ledgerPath = path.join(tmpDir, 'funnel-events.jsonl');
  const lines = entries.map((e) => JSON.stringify(e)).join('\n');
  fs.writeFileSync(ledgerPath, lines + '\n');
}

function writeRevenueLedger(entries) {
  const ledgerPath = path.join(tmpDir, 'revenue-events.jsonl');
  const lines = entries.map((e) => JSON.stringify(e)).join('\n');
  fs.writeFileSync(ledgerPath, lines + '\n');
}

function writeWorkflowRuns(entries) {
  const runsPath = path.join(tmpDir, 'workflow-runs.jsonl');
  const lines = entries.map((e) => JSON.stringify(e)).join('\n');
  fs.writeFileSync(runsPath, lines + '\n');
}

function writeContextPacks(entries) {
  const packsPath = path.join(tmpDir, 'contextfs', 'provenance', 'packs.jsonl');
  fs.mkdirSync(path.dirname(packsPath), { recursive: true });
  const lines = entries.map((entry) => JSON.stringify(entry)).join('\n');
  fs.writeFileSync(packsPath, lines + '\n');
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

test('generateDashboard handles empty state (no files)', () => {
  // Clear any existing files
  const logPath = path.join(tmpDir, 'feedback-log.jsonl');
  if (fs.existsSync(logPath)) fs.unlinkSync(logPath);

  const data = generateDashboard(tmpDir);
  assert.equal(data.approval.total, 0);
  assert.equal(data.approval.approvalRate, 0);
  assert.equal(data.approval.positive, 0);
  assert.equal(data.approval.negative, 0);
  assert.equal(data.health.feedbackCount, 0);
  assert.equal(data.health.memoryCount, 0);
  assert.equal(data.diagnostics.totalDiagnosed, 0);
  assert.equal(data.harness.score, 20);
  assert.equal(data.harness.status, 'bootstrapping');
  assert.equal(data.harness.lessonCount, 0);
  assert.ok(data.delegation);
  assert.equal(data.delegation.attemptCount, 0);
  assert.equal(data.secretGuard.blocked, 0);
  assert.equal(data.analytics.funnel.visitors, 0);
  assert.equal(data.analytics.northStar.weeklyActiveProofBackedWorkflowRuns, 0);
  assert.equal(data.observability.diagnosticEvents, 0);
  assert.equal(typeof data.team.activeAgents, 'number');
  assert.equal(data.predictive.anomalySummary.count, 0);
  assert.equal(data.predictive.upgradePropensity.pro.band, 'very_low');
  assert.equal(data.templateLibrary.total, 6);
  assert.equal(data.templateLibrary.categories['Git Safety'], 1);
  assert.equal(typeof data.settingsStatus.resolvedSettings.mcp.defaultProfile, 'string');
  assert.ok(Array.isArray(data.settingsStatus.origins));
});

test('generateDashboard surfaces tracking readiness and instrumentation truth', () => {
  const previousGaId = process.env.THUMBGATE_GA_MEASUREMENT_ID;
  const previousGoogleVerification = process.env.THUMBGATE_GOOGLE_SITE_VERIFICATION;
  const previousMcpProfile = process.env.THUMBGATE_MCP_PROFILE;
  const previousContainer = process.env.container;
  const repoHasMcpConfig = fs.existsSync(path.join(__dirname, '..', '.mcp.json'));
  process.env.THUMBGATE_GA_MEASUREMENT_ID = 'G-TEST1234';
  process.env.THUMBGATE_GOOGLE_SITE_VERIFICATION = 'test-verification-token';
  process.env.THUMBGATE_MCP_PROFILE = 'default';
  process.env.container = '1';

  try {
    writeTelemetryLog([
      {
        receivedAt: new Date().toISOString(),
        eventType: 'landing_page_view',
        clientType: 'web',
        acquisitionId: 'acq_track_1',
        visitorId: 'visitor_track_1',
        sessionId: 'session_track_1',
        source: 'organic_search',
        utmSource: 'google',
        utmMedium: 'organic',
        page: '/',
      },
      {
        receivedAt: new Date().toISOString(),
        eventType: 'seo_landing_view',
        clientType: 'web',
        acquisitionId: 'acq_track_1',
        visitorId: 'visitor_track_1',
        sessionId: 'session_track_1',
        seoSurface: 'google_search',
        seoQuery: 'ai reliability system',
      },
    ]);

    const data = generateDashboard(tmpDir);
    assert.equal(data.instrumentation.plausibleConfigured, true);
    assert.equal(data.instrumentation.ga4Configured, true);
    assert.equal(data.instrumentation.googleSearchConsoleConfigured, true);
    assert.equal(data.instrumentation.softwareApplicationSchemaPresent, true);
    assert.equal(data.instrumentation.faqSchemaPresent, true);
    assert.equal(data.instrumentation.telemetryEventsPresent, true);
    assert.equal(data.instrumentation.uniqueVisitorsTracked, 1);
    assert.equal(data.instrumentation.seoSignalsPresent, true);
    assert.equal(data.instrumentation.bookedRevenueTrackingEnabled, true);
    assert.equal(data.instrumentation.paidOrderTrackingEnabled, true);
    assert.equal(data.instrumentation.invoiceTrackingEnabled, false);
    assert.equal(data.instrumentation.attributionTrackingEnabled, true);
    assert.equal(data.readiness.overallStatus, repoHasMcpConfig ? 'ready' : 'needs_attention');
    assert.equal(data.readiness.runtime.mode, 'container');
    assert.equal(data.readiness.bootstrap.ready, repoHasMcpConfig);
    assert.equal(data.readiness.permissions.tier, 'builder');
    assert.equal(data.readiness.articleAlignment.runtimeIsolation, true);
    assert.equal(data.readiness.articleAlignment.contextConditioning, repoHasMcpConfig);
    assert.equal(data.readiness.articleAlignment.permissionEnvelope, true);
    if (!repoHasMcpConfig) {
      assert.ok(data.readiness.bootstrap.missingRequired.includes('.mcp.json'));
    }
  } finally {
    if (previousGaId === undefined) {
      delete process.env.THUMBGATE_GA_MEASUREMENT_ID;
    } else {
      process.env.THUMBGATE_GA_MEASUREMENT_ID = previousGaId;
    }
    if (previousGoogleVerification === undefined) {
      delete process.env.THUMBGATE_GOOGLE_SITE_VERIFICATION;
    } else {
      process.env.THUMBGATE_GOOGLE_SITE_VERIFICATION = previousGoogleVerification;
    }
    if (previousMcpProfile === undefined) {
      delete process.env.THUMBGATE_MCP_PROFILE;
    } else {
      process.env.THUMBGATE_MCP_PROFILE = previousMcpProfile;
    }
    if (previousContainer === undefined) {
      delete process.env.container;
    } else {
      process.env.container = previousContainer;
    }
  }
});

// ---------------------------------------------------------------------------
// Approval stats
// ---------------------------------------------------------------------------

test('computeApprovalStats calculates correct rates', () => {
  const entries = [
    { signal: 'positive', timestamp: new Date().toISOString() },
    { signal: 'positive', timestamp: new Date().toISOString() },
    { signal: 'negative', timestamp: new Date().toISOString() },
    { signal: 'positive', timestamp: new Date().toISOString() },
  ];
  const stats = computeApprovalStats(entries);
  assert.equal(stats.total, 4);
  assert.equal(stats.positive, 3);
  assert.equal(stats.negative, 1);
  assert.equal(stats.approvalRate, 75);
});

test('computeApprovalStats handles all-negative entries', () => {
  const entries = [
    { signal: 'negative', timestamp: new Date().toISOString() },
    { signal: 'negative', timestamp: new Date().toISOString() },
  ];
  const stats = computeApprovalStats(entries);
  assert.equal(stats.approvalRate, 0);
  assert.equal(stats.negative, 2);
});

// ---------------------------------------------------------------------------
// 7-day trend detection
// ---------------------------------------------------------------------------

test('computeApprovalStats detects improving trend', () => {
  const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const recentDate = new Date().toISOString();

  // Old entries: mostly negative
  const oldEntries = Array.from({ length: 20 }, () => ({ signal: 'negative', timestamp: oldDate }));
  // Recent entries: mostly positive
  const recentEntries = Array.from({ length: 20 }, () => ({ signal: 'positive', timestamp: recentDate }));

  const stats = computeApprovalStats([...oldEntries, ...recentEntries]);
  assert.equal(stats.trendDirection, 'improving');
});

// ---------------------------------------------------------------------------
// Session trend bars
// ---------------------------------------------------------------------------

test('computeSessionTrend generates bars for sufficient data', () => {
  const entries = Array.from({ length: 20 }, (_, i) => ({
    signal: i % 2 === 0 ? 'positive' : 'negative',
    timestamp: new Date().toISOString(),
  }));
  const trend = computeSessionTrend(entries, 10);
  assert.ok(typeof trend.bars === 'string');
  assert.ok(trend.percentage >= 0 && trend.percentage <= 100);
});

test('computeSessionTrend returns empty for insufficient data', () => {
  const trend = computeSessionTrend([], 10);
  assert.equal(trend.percentage, 0);
});

// ---------------------------------------------------------------------------
// Full dashboard with sample data
// ---------------------------------------------------------------------------

test('generateDashboard returns complete structure with data', () => {
  const now = new Date();
  const entries = [];
  for (let i = 0; i < 30; i++) {
    entries.push({
      signal: i < 20 ? 'positive' : 'negative',
      timestamp: new Date(now.getTime() - i * 60000).toISOString(),
      tags: i >= 20 ? ['testing'] : [],
      diagnosis: i >= 20 ? {
        rootCauseCategory: 'tool_output_misread',
        criticalFailureStep: 'verification',
        violations: [{ constraintId: 'workflow:proof_commands' }],
      } : null,
    });
  }
  writeFeedbackLog(entries);
  writeMemoryLog([{ id: 'mem-1' }, { id: 'mem-2' }]);

  const data = generateDashboard(tmpDir);

  // Structure checks
  assert.ok(data.approval);
  assert.ok(data.gateStats);
  assert.ok(data.prevention);
  assert.ok(data.trend);
  assert.ok(data.health);
  assert.ok(data.harness);
  assert.ok(data.diagnostics);
  assert.ok(data.delegation);
  assert.ok(data.secretGuard);
  assert.ok(data.team);
  assert.ok(data.predictive);
  assert.ok(data.templateLibrary);

  // Values
  assert.equal(data.approval.total, 30);
  assert.equal(data.approval.positive, 20);
  assert.equal(data.approval.negative, 10);
  assert.equal(data.health.feedbackCount, 30);
  assert.equal(data.health.memoryCount, 2);
  assert.equal(data.harness.errorLessonCount, 0);
  assert.equal(data.harness.topRecommendations.length, 0);
  assert.equal(data.diagnostics.totalDiagnosed, 10);
  assert.equal(data.delegation.attemptCount, 0);
  assert.equal(data.diagnostics.categories[0].key, 'tool_output_misread');
  assert.equal(data.secretGuard.blocked, 0);
  assert.equal(data.analytics.funnel.visitors, 0);
  assert.ok(data.predictive.upgradePropensity.pro.score >= 0);
  assert.equal(data.templateLibrary.total, 6);
});

test('generateDashboard aggregates persisted diagnostics beyond feedback capture', () => {
  writeFeedbackLog([
    { signal: 'positive', timestamp: new Date().toISOString() },
  ]);
  writeDiagnosticLog([
    {
      source: 'verification_loop',
      diagnosis: {
        rootCauseCategory: 'intent_plan_misalignment',
        criticalFailureStep: 'verification',
        violations: [{ constraintId: 'intent:publish_dpo_training_data' }],
      },
    },
  ]);

  const data = generateDashboard(tmpDir);
  assert.equal(data.diagnostics.totalDiagnosed, 1);
  assert.equal(data.diagnostics.categories[0].key, 'intent_plan_misalignment');
  assert.equal(data.observability.diagnosticEvents, 1);
  assert.equal(data.observability.topSource.key, 'verification_loop');
});

test('generateDashboard reports secret guard violations separately', () => {
  writeFeedbackLog([
    { signal: 'positive', timestamp: new Date().toISOString() },
  ]);
  writeDiagnosticLog([
    {
      source: 'secret_guard',
      step: 'pre_tool_use',
      timestamp: new Date().toISOString(),
      diagnosis: {
        rootCauseCategory: 'guardrail_triggered',
        criticalFailureStep: 'pre_tool_use',
        violations: [{ constraintId: 'security:stripe_live_secret' }],
      },
    },
  ]);

  const data = generateDashboard(tmpDir);
  assert.equal(data.secretGuard.blocked, 1);
  assert.equal(data.secretGuard.topConstraint.key, 'security:stripe_live_secret');
  assert.equal(data.secretGuard.recent[0].step, 'pre_tool_use');
  assert.equal(data.observability.secretGuardBlocks, 1);
});

test('generateDashboard includes visitor funnel and booked revenue analytics', () => {
  writeFeedbackLog([
    { signal: 'positive', timestamp: new Date().toISOString() },
  ]);
  writeTelemetryLog([
    {
      receivedAt: new Date().toISOString(),
      eventType: 'landing_page_view',
      clientType: 'web',
      acquisitionId: 'acq_dash_1',
      visitorId: 'visitor_1',
      sessionId: 'session_1',
      source: 'website',
      utmSource: 'website',
      utmCampaign: 'launch',
      page: '/',
    },
    {
      receivedAt: new Date().toISOString(),
      eventType: 'checkout_start',
      clientType: 'web',
      acquisitionId: 'acq_dash_1',
      visitorId: 'visitor_1',
      sessionId: 'session_1',
      installId: 'inst_1',
      source: 'website',
      utmSource: 'website',
      utmCampaign: 'launch',
      ctaPlacement: 'pricing',
      planId: 'pro',
      page: '/',
      ctaId: 'pricing_pro',
    },
  ]);
  writeFunnelLedger([
    {
      timestamp: new Date().toISOString(),
      stage: 'acquisition',
      event: 'checkout_session_created',
      acquisitionId: 'acq_dash_1',
      visitorId: 'visitor_1',
      sessionId: 'session_1',
      traceId: 'trace_dash_1',
      ctaId: 'pricing_pro',
      landingPath: '/',
      metadata: {
        acquisitionId: 'acq_dash_1',
        visitorId: 'visitor_1',
        sessionId: 'session_1',
        source: 'website',
        utmSource: 'website',
        utmCampaign: 'launch',
        ctaId: 'pricing_pro',
        landingPath: '/',
      },
    },
    {
      timestamp: new Date().toISOString(),
      stage: 'paid',
      event: 'stripe_checkout_completed',
      acquisitionId: 'acq_dash_1',
      evidence: 'cs_dash_1',
      traceId: 'trace_dash_1',
      metadata: {
        customerId: 'cus_dash_1',
        source: 'website',
        utmSource: 'website',
        utmCampaign: 'launch',
      },
    },
  ]);
  writeRevenueLedger([
    {
      timestamp: new Date().toISOString(),
      provider: 'stripe',
      event: 'stripe_checkout_completed',
      status: 'paid',
      customerId: 'cus_dash_1',
      orderId: 'cs_dash_1',
      acquisitionId: 'acq_dash_1',
      visitorId: 'visitor_1',
      sessionId: 'session_1',
      ctaId: 'pricing_pro',
      landingPath: '/',
      referrerHost: 'search.example',
      amountCents: 4900,
      currency: 'USD',
      amountKnown: true,
      attribution: {
        source: 'website',
        utmSource: 'website',
        utmCampaign: 'launch',
        ctaId: 'pricing_pro',
        landingPath: '/',
        referrerHost: 'search.example',
      },
    },
  ]);
  writeWorkflowRuns([
    {
      timestamp: new Date().toISOString(),
      workflowId: 'repo_self_dogfood_full_verify',
      workflowName: 'Repo self dogfood verification',
      owner: 'cto',
      runtime: 'node',
      proofBacked: true,
      reviewed: true,
      customerType: 'internal_dogfood',
      teamId: 'internal_repo',
    },
  ]);

  const data = generateDashboard(tmpDir);
  assert.equal(data.analytics.telemetry.visitors.uniqueVisitors, 1);
  assert.equal(data.analytics.telemetry.ctas.totalClicks, 1);
  assert.equal(data.analytics.telemetry.ctas.checkoutStarts, 1);
  assert.equal(data.analytics.telemetry.ctas.uniqueCheckoutStarters, 1);
  assert.equal(data.analytics.funnel.acquisitionLeads, 1);
  assert.equal(data.analytics.funnel.paidOrders, 1);
  assert.equal(data.analytics.funnel.visitorToPaidRate, 1);
  assert.equal(data.analytics.revenue.bookedRevenueCents, 4900);
  assert.equal(data.analytics.revenue.paidProviderEvents, 1);
  assert.equal(data.analytics.attribution.paidByCampaign.launch, 1);
  assert.equal(data.analytics.attribution.bookedRevenueByCtaId.pricing_pro, 4900);
  assert.equal(data.analytics.reconciliation.matchedAcquisitions, 1);
  assert.equal(data.analytics.reconciliation.matchedPaidOrders, 1);
  assert.equal(data.analytics.identityCoverage.acquisitionIdCoverage, 1);
  assert.equal(data.analytics.dataQuality.unreconciledPaidEvents, 0);
  assert.equal(data.analytics.northStar.weeklyActiveProofBackedWorkflowRuns, 1);
  assert.equal(data.analytics.northStar.weeklyTeamsRunningProofBackedWorkflows, 1);
});

test('generateDashboard reports semantic cache efficiency from context pack provenance', () => {
  writeContextPacks([
    {
      packId: 'pack_base',
      query: 'verification testing evidence',
      usedChars: 1200,
      createdAt: '2026-03-20T12:00:00.000Z',
      cache: { hit: false },
    },
    {
      packId: 'pack_hit_1',
      query: 'testing verification evidence',
      usedChars: 1200,
      createdAt: '2026-03-20T12:01:00.000Z',
      cache: { hit: true, similarity: 1, sourcePackId: 'pack_base' },
    },
    {
      packId: 'pack_hit_2',
      query: 'proof verification loop',
      usedChars: 800,
      createdAt: '2026-03-20T12:02:00.000Z',
      cache: { hit: true, similarity: 0.8, sourcePackId: 'pack_base' },
    },
  ]);

  const data = generateDashboard(tmpDir);

  assert.equal(data.analytics.efficiency.semanticCacheEnabled, true);
  assert.equal(data.analytics.efficiency.contextPackRequests, 3);
  assert.equal(data.analytics.efficiency.semanticCacheHits, 2);
  assert.equal(data.analytics.efficiency.semanticCacheHitRate, 0.6667);
  assert.equal(data.analytics.efficiency.averageSemanticSimilarity, 0.9);
  assert.equal(data.analytics.efficiency.estimatedContextCharsReused, 2000);
  assert.equal(data.analytics.efficiency.estimatedContextTokensReused, 500);
});

test('generateDashboard computes a harness score and top next fix recommendations from lessons', () => {
  writeFeedbackLog([
    {
      id: 'fb_harness_repeat_1',
      signal: 'negative',
      context: 'Skipped proof before release',
      tags: ['release', 'verification'],
      timestamp: new Date().toISOString(),
      diagnosis: {
        rootCauseCategory: 'verification_failure',
        criticalFailureStep: 'release',
      },
    },
    {
      id: 'fb_harness_repeat_2',
      signal: 'negative',
      context: 'Skipped proof before release',
      tags: ['release', 'verification'],
      timestamp: new Date().toISOString(),
      diagnosis: {
        rootCauseCategory: 'verification_failure',
        criticalFailureStep: 'release',
      },
    },
  ]);
  writeMemoryLog([
    {
      id: 'mem_harness_repeat_1',
      title: 'MISTAKE: Skipped proof before release',
      content: 'What went wrong: Skipped proof before release\nHow to avoid: Attach proof before shipping',
      category: 'error',
      importance: 'high',
      tags: ['feedback', 'negative', 'release', 'verification'],
      sourceFeedbackId: 'fb_harness_repeat_1',
      timestamp: '2026-03-23T16:00:01.000Z',
    },
    {
      id: 'mem_harness_repeat_2',
      title: 'MISTAKE: Merge shipped without rollback notes',
      content: 'Action needed: add rollback notes before shipping',
      category: 'error',
      importance: 'high',
      tags: ['feedback', 'negative', 'release', 'verification'],
      sourceFeedbackId: 'fb_harness_repeat_2',
      timestamp: '2026-03-23T16:10:01.000Z',
    },
  ]);

  const data = generateDashboard(tmpDir);

  assert.equal(data.harness.lessonCount, 2);
  assert.equal(data.harness.errorLessonCount, 2);
  assert.equal(data.harness.correctionCoverage, 1);
  assert.equal(data.harness.enforcementCoverage, 0);
  assert.equal(data.harness.diagnosticCoverage, 1);
  assert.equal(data.harness.repeatFailureRate, 1);
  assert.equal(data.harness.status, 'weak');
  assert.ok(data.harness.topRecommendations.some((recommendation) => recommendation.type === 'pre_action_gate'));
  assert.ok(data.harness.topRecommendations.some((recommendation) => recommendation.type === 'prevention_rule'));
});

test('generateDashboard separates repeated CTA clicks from unique checkout starters and flags orphan revenue', () => {
  writeTelemetryLog([
    {
      receivedAt: new Date().toISOString(),
      eventType: 'cta_click',
      clientType: 'web',
      acquisitionId: 'acq_repeat_1',
      visitorId: 'visitor_repeat_1',
      sessionId: 'session_repeat_1',
      ctaId: 'workflow_sprint_proof',
      page: '/',
    },
    {
      receivedAt: new Date().toISOString(),
      eventType: 'checkout_bootstrap',
      clientType: 'web',
      acquisitionId: 'acq_repeat_1',
      visitorId: 'visitor_repeat_1',
      sessionId: 'session_repeat_1',
      ctaId: 'pricing_pro',
      page: '/',
    },
    {
      receivedAt: new Date().toISOString(),
      eventType: 'checkout_bootstrap',
      clientType: 'web',
      acquisitionId: 'acq_repeat_1',
      visitorId: 'visitor_repeat_1',
      sessionId: 'session_repeat_1',
      ctaId: 'pricing_pro',
      page: '/',
    },
  ]);
  writeFunnelLedger([
    {
      timestamp: new Date().toISOString(),
      stage: 'acquisition',
      event: 'checkout_session_created',
      acquisitionId: 'acq_repeat_1',
      metadata: {
        acquisitionId: 'acq_repeat_1',
        ctaId: 'pricing_pro',
      },
    },
  ]);
  writeRevenueLedger([
    {
      timestamp: new Date().toISOString(),
      provider: 'stripe',
      event: 'stripe_checkout_completed',
      status: 'paid',
      customerId: 'cus_repeat_1',
      orderId: 'cs_repeat_1',
      acquisitionId: 'acq_orphan_1',
      amountCents: 4900,
      currency: 'USD',
      amountKnown: true,
      attribution: {
        source: 'website',
      },
    },
  ]);

  const data = generateDashboard(tmpDir);
  assert.equal(data.analytics.telemetry.ctas.totalClicks, 3);
  assert.equal(data.analytics.telemetry.ctas.checkoutStarts, 2);
  assert.equal(data.analytics.telemetry.ctas.uniqueCheckoutStarters, 1);
  assert.equal(data.analytics.funnel.ctaClicks, 3);
  assert.equal(data.analytics.funnel.checkoutStarts, 2);
  assert.equal(data.analytics.reconciliation.telemetryCheckoutStarts, 2);
  assert.equal(data.analytics.reconciliation.paidWithoutAcquisition, 1);
});

test('generateDashboard surfaces telemetry ingest errors and checkout failure codes', () => {
  writeDiagnosticLog([
    {
      source: 'telemetry_ingest',
      step: 'telemetry_ingest',
      timestamp: new Date().toISOString(),
      diagnosis: {
        rootCauseCategory: 'invalid_invocation',
        criticalFailureStep: 'telemetry_ingest',
        violations: [{ constraintId: 'telemetry:ingest' }],
      },
    },
  ]);
  writeTelemetryLog([
    {
      receivedAt: new Date().toISOString(),
      eventType: 'checkout_api_failed',
      clientType: 'web',
      acquisitionId: 'acq_failure_1',
      visitorId: 'visitor_failure_1',
      sessionId: 'session_failure_1',
      ctaId: 'pricing_pro',
      failureCode: 'checkout_request_failed',
      httpStatus: 500,
      page: '/',
    },
  ]);

  const data = generateDashboard(tmpDir);
  assert.equal(data.observability.telemetryIngestErrors, 1);
  assert.equal(data.observability.checkoutApiFailuresByCode.checkout_request_failed, 1);
});

// ---------------------------------------------------------------------------
// readJSONL / readJsonFile helpers
// ---------------------------------------------------------------------------

test('readJSONL returns empty array for missing file', () => {
  const result = readJSONL(path.join(tmpDir, 'nonexistent.jsonl'));
  assert.deepEqual(result, []);
});

test('readJsonFile returns null for missing file', () => {
  const result = readJsonFile(path.join(tmpDir, 'nonexistent.json'));
  assert.equal(result, null);
});

test('readJsonFile returns null for invalid JSON', () => {
  const badPath = path.join(tmpDir, 'bad.json');
  fs.writeFileSync(badPath, 'not json');
  const result = readJsonFile(badPath);
  assert.equal(result, null);
});
