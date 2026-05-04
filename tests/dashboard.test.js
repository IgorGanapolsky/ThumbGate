const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-dashboard-test-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
process.env._TEST_THUMBGATE_FALLBACK_FEEDBACK_DIR = tmpDir;
process.env._TEST_LEGACY_FEEDBACK_DIR = tmpDir;
process.env._TEST_API_KEYS_PATH = path.join(tmpDir, 'api-keys.json');
process.env._TEST_FUNNEL_LEDGER_PATH = path.join(tmpDir, 'funnel-events.jsonl');
process.env._TEST_REVENUE_LEDGER_PATH = path.join(tmpDir, 'revenue-events.jsonl');

const {
  generateDashboard,
  buildReviewSnapshot,
  readDashboardReviewState,
  writeDashboardReviewState,
  computeApprovalStats,
  computeSessionTrend,
  printDashboard,
  readJSONL,
  readJsonFile,
} = require('../scripts/dashboard');

test.beforeEach(() => {
  for (const fileName of [
    'feedback-log.jsonl',
    'memory-log.jsonl',
    'diagnostic-log.jsonl',
    'audit-trail.jsonl',
    'dashboard-review-state.json',
    'decision-journal.jsonl',
    'intervention-policy.json',
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

function writeAgentRuns(entries) {
  const runsPath = path.join(tmpDir, 'agent-runs.jsonl');
  const lines = entries.map((e) => JSON.stringify(e)).join('\n');
  fs.writeFileSync(runsPath, lines + '\n');
}

function writeContextPacks(entries) {
  const packsPath = path.join(tmpDir, 'contextfs', 'provenance', 'packs.jsonl');
  fs.mkdirSync(path.dirname(packsPath), { recursive: true });
  const lines = entries.map((entry) => JSON.stringify(entry)).join('\n');
  fs.writeFileSync(packsPath, lines + '\n');
}

function writeAuditLog(entries) {
  const auditPath = path.join(tmpDir, 'audit-trail.jsonl');
  const lines = entries.map((entry) => JSON.stringify(entry)).join('\n');
  fs.writeFileSync(auditPath, lines + '\n');
}

function writeDecisionLog(entries) {
  const decisionPath = path.join(tmpDir, 'decision-journal.jsonl');
  const lines = entries.map((entry) => JSON.stringify(entry)).join('\n');
  fs.writeFileSync(decisionPath, lines + '\n');
}

function localDayKey(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
  assert.equal(data.gateAudit.dayCount, 14);
  assert.equal(data.gateAudit.totals.deny, 0);
  assert.equal(data.gateAudit.totals.warn, 0);
  assert.ok(data.delegation);
  assert.equal(data.delegation.attemptCount, 0);
  assert.equal(data.secretGuard.blocked, 0);
  assert.equal(data.analytics.funnel.visitors, 0);
  assert.equal(data.analytics.northStar.weeklyActiveProofBackedWorkflowRuns, 0);
  assert.equal(data.observability.diagnosticEvents, 0);
  assert.equal(typeof data.team.activeAgents, 'number');
  assert.equal(typeof data.backgroundAgents.total, 'number');
  assert.equal(typeof data.regulatedProof.policyOriginCount, 'number');
  assert.equal(data.predictive.anomalySummary.count, 0);
  assert.equal(data.predictive.upgradePropensity.pro.band, 'very_low');
  assert.equal(data.templateLibrary.total, 13);
  assert.equal(data.templateLibrary.categories['Git Safety'], 1);
  assert.equal(typeof data.settingsStatus.resolvedSettings.mcp.defaultProfile, 'string');
  assert.ok(Array.isArray(data.settingsStatus.origins));
});

test('generateDashboard summarizes background-agent mode and regulated proof posture', () => {
  const now = new Date().toISOString();
  writeAgentRuns([
    { id: 'run_a', timestamp: now, agentId: 'bg-agent-1', runType: 'refund-review', status: 'completed', gatesChecked: 4, gatesBlocked: 1 },
    { id: 'run_b', timestamp: now, agentId: 'bg-agent-2', runType: 'invoice-send', status: 'failed', gatesChecked: 2, gatesBlocked: 1 },
  ]);
  writeWorkflowRuns([
    {
      timestamp: now,
      workflowId: 'wf_background',
      workflowName: 'Background refund lane',
      owner: 'ops',
      runtime: 'codex',
      status: 'passed',
      customerType: 'paid_team',
      reviewed: true,
      proofBacked: true,
      proofArtifacts: ['proof/refund-review.txt'],
    },
  ]);

  const data = generateDashboard(tmpDir);

  assert.equal(data.backgroundAgents.total, 2);
  assert.equal(data.backgroundAgents.gatesBlocked, 2);
  assert.equal(data.backgroundAgents.topRunType.runType, 'invoice-send');
  assert.equal(data.regulatedProof.reviewedRuns, 1);
  assert.equal(data.regulatedProof.proofBackedRuns, 1);
  assert.equal(data.regulatedProof.latestProofArtifacts[0], 'proof/refund-review.txt');
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

test('generateDashboard falls back cleanly when private dashboard modules are absent', () => {
  const originalExistsSync = fs.existsSync;
  fs.existsSync = (candidatePath) => {
    if (typeof candidatePath === 'string' && (
      candidatePath.endsWith('org-dashboard.js') ||
      candidatePath.endsWith('delegation-runtime.js') ||
      candidatePath.endsWith('workflow-sprint-intake.js')
    )) {
      return false;
    }
    return originalExistsSync(candidatePath);
  };

  try {
    const data = generateDashboard(tmpDir);
    assert.equal(data.delegation.totalHandoffs, 0);
    assert.equal(data.delegation.availability, 'private_core');
    assert.equal(data.team.proRequired, true);
    assert.equal(data.team.availability, 'private_core');
    assert.match(data.team.upgradeMessage, /private ThumbGate Core runtime/);
    assert.equal(data.analytics.pipeline.workflowSprintLeads.total, 0);
  } finally {
    fs.existsSync = originalExistsSync;
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
  assert.ok(data.gateAudit);
  assert.ok(data.harness);
  assert.ok(data.interventionPolicy);
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
  assert.equal(data.interventionPolicy.exampleCount >= 30, true);
  assert.equal(typeof data.interventionPolicy.metrics.trainingAccuracy, 'number');
  assert.equal(data.diagnostics.totalDiagnosed, 10);
  assert.equal(data.delegation.attemptCount, 0);
  assert.equal(data.diagnostics.categories[0].key, 'tool_output_misread');
  assert.equal(data.secretGuard.blocked, 0);
  assert.equal(data.gateAudit.dayCount, 14);
  assert.equal(data.analytics.funnel.visitors, 0);
  assert.ok(data.predictive.upgradePropensity.pro.score >= 0);
  assert.equal(data.templateLibrary.total, 13);
});

test('generateDashboard reports only activity since the saved review checkpoint', () => {
  const baselineTime = '2026-04-14T10:00:00.000Z';
  const freshTime = '2026-04-15T10:00:00.000Z';

  writeFeedbackLog([
    {
      id: 'fb_before',
      signal: 'positive',
      context: 'Already reviewed feedback',
      timestamp: baselineTime,
    },
    {
      id: 'fb_after_neg',
      signal: 'negative',
      context: 'New regression after the checkpoint',
      timestamp: freshTime,
    },
    {
      id: 'fb_after_pos',
      signal: 'positive',
      context: 'New passing verification',
      timestamp: '2026-04-15T11:00:00.000Z',
    },
  ]);
  writeMemoryLog([
    {
      id: 'mem_after',
      title: 'MISTAKE: New regression after the checkpoint',
      category: 'error',
      timestamp: '2026-04-15T11:05:00.000Z',
    },
  ]);
  writeAuditLog([
    {
      id: 'audit_after',
      timestamp: '2026-04-15T11:10:00.000Z',
      decision: 'deny',
      gateId: 'evidence-before-done',
    },
  ]);

  const snapshot = buildReviewSnapshot(tmpDir, {
    feedbackEntries: [
      { signal: 'positive', timestamp: baselineTime },
    ],
    memoryEntries: [],
    auditEntries: [],
    reviewedAt: '2026-04-14T12:00:00.000Z',
    projectRoot: null,
  });
  writeDashboardReviewState(tmpDir, snapshot);

  const saved = readDashboardReviewState(tmpDir);
  assert.equal(saved.reviewedAt, '2026-04-14T12:00:00.000Z');

  const data = generateDashboard(tmpDir);
  assert.ok(data.reviewDelta);
  assert.equal(data.reviewDelta.hasBaseline, true);
  assert.equal(data.reviewDelta.feedbackAdded, 2);
  assert.equal(data.reviewDelta.negativeAdded, 1);
  assert.equal(data.reviewDelta.lessonsAdded, 1);
  assert.equal(data.reviewDelta.blocksAdded, 1);
  assert.match(data.reviewDelta.headline, /Since your last review/i);
  assert.match(data.reviewDelta.latestFeedback.title, /New regression after the checkpoint/i);
  assert.match(data.reviewDelta.latestLesson.title, /New regression after the checkpoint/i);
});

test('generateDashboard summarizes learned intervention policy from mixed evidence', () => {
  const now = Date.now();
  writeFeedbackLog([
    {
      signal: 'negative',
      timestamp: new Date(now - 3000).toISOString(),
      context: 'tests were failing and coverage was not verified before claiming success',
      diagnosis: {
        rootCauseCategory: 'tool_output_misread',
        criticalFailureStep: 'verification',
      },
      tags: ['testing', 'verification'],
    },
    {
      signal: 'positive',
      timestamp: new Date(now - 2000).toISOString(),
      context: 'verified the proof commands and fixed the release flow',
    },
  ]);
  writeDiagnosticLog(Array.from({ length: 4 }, (_, index) => ({
    source: 'verification_loop',
    timestamp: new Date(now - ((4 - index) * 1000)).toISOString(),
    step: 'verification',
    context: 'coverage claim mismatched the actual output',
    diagnosis: {
      rootCauseCategory: 'tool_output_misread',
      criticalFailureStep: 'verification',
      violations: [{ constraintId: 'workflow:proof_commands' }],
    },
  })));
  writeAuditLog(Array.from({ length: 4 }, (_, index) => ({
    id: `audit_${index}`,
    timestamp: new Date(now - ((8 - index) * 1000)).toISOString(),
    toolName: 'Bash',
    toolInput: {
      command: 'npm publish',
      changed_files: ['package.json', 'server.json'],
    },
    decision: 'deny',
    gateId: 'publish_requires_mainline_head',
    message: 'Publish and tag flows should execute from the protected mainline branch.',
    source: 'gates-engine',
  })));

  const data = generateDashboard(tmpDir);
  assert.equal(data.interventionPolicy.enabled, true);
  assert.ok(data.interventionPolicy.exampleCount >= 10);
  assert.ok(data.interventionPolicy.labelCounts.verify >= 1);
  assert.ok(data.interventionPolicy.labelCounts.deny >= 1);
  assert.equal(data.interventionPolicy.daily.length, 14);
  assert.ok(data.interventionPolicy.nonAllowRate > 0);
});

test('generateDashboard returns a daily gate audit series from the audit trail', () => {
  const now = Date.now();
  writeAuditLog([
    {
      id: 'audit_today_deny',
      timestamp: new Date(now).toISOString(),
      toolName: 'Bash',
      decision: 'deny',
      gateId: 'force-push',
      source: 'gates-engine',
    },
    {
      id: 'audit_today_warn',
      timestamp: new Date(now).toISOString(),
      toolName: 'Edit',
      decision: 'warn',
      gateId: 'protected-file',
      source: 'gates-engine',
    },
    {
      id: 'audit_yesterday_allow',
      timestamp: new Date(now - (24 * 60 * 60 * 1000)).toISOString(),
      toolName: 'Read',
      decision: 'allow',
      source: 'gates-engine',
    },
  ]);

  const data = generateDashboard(tmpDir);
  const todayKey = localDayKey(now);
  const yesterdayKey = localDayKey(now - (24 * 60 * 60 * 1000));
  const todaySeries = data.gateAudit.days.find((entry) => entry.dayKey === todayKey);
  const yesterdaySeries = data.gateAudit.days.find((entry) => entry.dayKey === yesterdayKey);

  assert.ok(todaySeries);
  assert.equal(todaySeries.deny, 1);
  assert.equal(todaySeries.warn, 1);
  assert.equal(todaySeries.intercepted, 2);
  assert.ok(yesterdaySeries);
  assert.equal(yesterdaySeries.allow, 1);
  assert.equal(yesterdaySeries.intercepted, 0);
  assert.equal(data.gateAudit.totals.deny, 1);
  assert.equal(data.gateAudit.totals.warn, 1);
  assert.equal(data.gateAudit.totals.allow, 1);
  assert.equal(data.gateAudit.activeDays >= 2, true);
});

test('generateDashboard summarizes live decision-loop metrics from the decision journal', () => {
  writeDecisionLog([
    {
      recordType: 'evaluation',
      actionId: 'decision_fast',
      timestamp: '2026-04-09T10:00:00.000Z',
      toolName: 'Edit',
      toolInput: { filePath: 'README.md' },
      changedFiles: ['README.md'],
      recommendation: {
        decision: 'allow',
        executionMode: 'auto_execute',
        decisionOwner: 'agent',
        reversibility: 'two_way_door',
        riskBand: 'low',
      },
      blastRadius: { severity: 'low', fileCount: 1, surfaceCount: 1 },
    },
    {
      recordType: 'outcome',
      actionId: 'decision_fast',
      timestamp: '2026-04-09T10:02:00.000Z',
      outcome: 'completed',
      actor: 'agent',
      actualDecision: 'allow',
      latencyMs: 120000,
    },
    {
      recordType: 'evaluation',
      actionId: 'decision_review',
      timestamp: '2026-04-09T11:00:00.000Z',
      toolName: 'Bash',
      toolInput: { command: 'npm publish' },
      changedFiles: ['package.json'],
      recommendation: {
        decision: 'warn',
        executionMode: 'checkpoint_required',
        decisionOwner: 'human',
        reversibility: 'one_way_door',
        riskBand: 'high',
      },
      blastRadius: { severity: 'high', fileCount: 1, surfaceCount: 1 },
    },
    {
      recordType: 'outcome',
      actionId: 'decision_review',
      timestamp: '2026-04-09T11:06:00.000Z',
      outcome: 'overridden',
      actor: 'human',
      actualDecision: 'warn',
      latencyMs: 360000,
    },
  ]);

  const data = generateDashboard(tmpDir);
  assert.equal(data.decisions.evaluationCount, 2);
  assert.equal(data.decisions.fastPathCount, 1);
  assert.equal(data.decisions.overrideCount, 1);
  assert.equal(data.liveMetrics.decisionLoop.fastPathRate, 0.5);
  assert.equal(data.liveMetrics.decisionLoop.overrideRate, 0.5);
  assert.equal(data.liveMetrics.decisionLoop.medianLatencyMs, 240000);
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

test('generateDashboard surfaces actionable remediations and agent surface inventory', () => {
  writeFeedbackLog([
    {
      id: 'fb_inv_1',
      signal: 'negative',
      skill: 'github',
      context: 'Skipped verification before merge',
      tags: ['git-workflow', 'verification'],
      timestamp: new Date().toISOString(),
    },
    {
      id: 'fb_inv_2',
      signal: 'negative',
      skill: 'github',
      context: 'Skipped verification before merge again',
      tags: ['git-workflow', 'verification'],
      timestamp: new Date().toISOString(),
    },
    {
      id: 'fb_inv_3',
      signal: 'negative',
      skill: 'github',
      context: 'Skipped verification before merge a third time',
      tags: ['git-workflow', 'verification'],
      timestamp: new Date().toISOString(),
    },
  ]);
  writeAuditLog([
    {
      id: 'audit_inv_1',
      timestamp: new Date().toISOString(),
      toolName: 'Bash',
      decision: 'deny',
      gateId: 'evidence-before-done',
      source: 'gates-engine',
    },
    {
      id: 'audit_inv_2',
      timestamp: new Date().toISOString(),
      toolName: 'Edit',
      decision: 'warn',
      gateId: 'protected-policy-file',
      source: 'secret-guard',
    },
  ]);
  writeDecisionLog([
    {
      recordType: 'evaluation',
      actionId: 'decision_inv_1',
      timestamp: new Date().toISOString(),
      toolName: 'Bash',
      recommendation: { executionMode: 'checkpoint_required' },
    },
    {
      recordType: 'evaluation',
      actionId: 'decision_inv_2',
      timestamp: new Date().toISOString(),
      toolName: 'Edit',
      recommendation: { executionMode: 'auto_execute' },
    },
  ]);

  const data = generateDashboard(tmpDir);

  assert.ok(Array.isArray(data.actionableRemediations));
  assert.ok(data.actionableRemediations.some((item) => item.type === 'skill-improve'));
  assert.equal(data.agentSurfaceInventory.profile, data.readiness.permissions.profile);
  assert.ok(Array.isArray(data.agentSurfaceInventory.observedTools));
  assert.ok(data.agentSurfaceInventory.observedTools.some((tool) => tool.toolName === 'Bash'));
  assert.ok(Array.isArray(data.agentSurfaceInventory.policySources));
  assert.ok(data.agentSurfaceInventory.policySources.some((source) => source.source === 'gates-engine'));
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
      receivedAt: new Date(Date.now() + 1).toISOString(),
      eventType: 'checkout_bootstrap',
      clientType: 'web',
      acquisitionId: 'acq_repeat_1',
      visitorId: 'visitor_repeat_1',
      sessionId: 'session_repeat_2',
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

test('generateDashboard ranks lost-revenue causes from behavior, objections, and checkout drop-off', () => {
  writeTelemetryLog([
    {
      receivedAt: new Date().toISOString(),
      eventType: 'landing_page_view',
      clientType: 'web',
      acquisitionId: 'acq_loss_dashboard_1',
      visitorId: 'visitor_loss_dashboard_1',
      sessionId: 'session_loss_dashboard_1',
      source: 'website',
      page: '/',
    },
    {
      receivedAt: new Date().toISOString(),
      eventType: 'cta_impression',
      clientType: 'web',
      acquisitionId: 'acq_loss_dashboard_1',
      visitorId: 'visitor_loss_dashboard_1',
      sessionId: 'session_loss_dashboard_1',
      ctaId: 'pricing_pro_trial',
      ctaPlacement: 'pricing',
      planId: 'pro',
      page: '/',
    },
    {
      receivedAt: new Date().toISOString(),
      eventType: 'checkout_bootstrap',
      clientType: 'web',
      acquisitionId: 'acq_loss_dashboard_1',
      visitorId: 'visitor_loss_dashboard_1',
      sessionId: 'session_loss_dashboard_1',
      ctaId: 'pricing_pro_trial',
      page: '/checkout/pro',
    },
    {
      receivedAt: new Date().toISOString(),
      eventType: 'checkout_cancelled',
      clientType: 'web',
      acquisitionId: 'acq_loss_dashboard_1',
      visitorId: 'visitor_loss_dashboard_1',
      sessionId: 'session_loss_dashboard_1',
      reasonCode: 'too_expensive',
    },
    {
      receivedAt: new Date().toISOString(),
      eventType: 'reason_not_buying',
      clientType: 'web',
      acquisitionId: 'acq_loss_dashboard_1',
      visitorId: 'visitor_loss_dashboard_1',
      sessionId: 'session_loss_dashboard_1',
      reasonCode: 'too_expensive',
    },
    {
      receivedAt: new Date().toISOString(),
      eventType: 'buyer_email_focus',
      clientType: 'web',
      acquisitionId: 'acq_loss_dashboard_1',
      visitorId: 'visitor_loss_dashboard_1',
      sessionId: 'session_loss_dashboard_1',
    },
    {
      receivedAt: new Date().toISOString(),
      eventType: 'buyer_email_abandon',
      clientType: 'web',
      acquisitionId: 'acq_loss_dashboard_1',
      visitorId: 'visitor_loss_dashboard_1',
      sessionId: 'session_loss_dashboard_1',
    },
    {
      receivedAt: new Date().toISOString(),
      eventType: 'page_exit',
      clientType: 'web',
      acquisitionId: 'acq_loss_dashboard_1',
      visitorId: 'visitor_loss_dashboard_1',
      sessionId: 'session_loss_dashboard_1',
      lastVisibleSection: 'hero',
      dwellBucket: 'under_10s',
      scrollBucket: 'under_25',
      engagementMs: 5000,
      maxScrollPercent: 20,
    },
  ]);

  const data = generateDashboard(tmpDir);
  assert.ok(data.analytics.lossAnalysis);
  assert.equal(data.analytics.lossAnalysis.primaryIssue.key, 'explicit_pricing');
  assert.equal(data.analytics.lossAnalysis.explicitThemes[0].key, 'pricing');
  assert.equal(data.analytics.lossAnalysis.revenueOpportunity.currentMonthlyPriceCents, 1900);
  assert.equal(data.analytics.lossAnalysis.revenueOpportunity.checkoutLossCount, 1);
  assert.equal(data.analytics.lossAnalysis.behaviorSignals.emailAbandonEvents, 1);
  assert.equal(data.analytics.lossAnalysis.behaviorSignals.topExitSection.key, 'hero');
  assert.ok(data.analytics.lossAnalysis.inferredCauses.some((cause) => cause.key === 'checkout_friction'));
  assert.ok(data.analytics.lossAnalysis.stageDropoff.some((entry) => entry.key === 'checkout_to_paid'));
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

test('printDashboard renders learned policy metrics for operator review', () => {
  const now = Date.now();
  writeFeedbackLog([
    {
      signal: 'negative',
      timestamp: new Date(now - 3000).toISOString(),
      context: 'tests were failing and coverage was not verified before claiming success',
      diagnosis: {
        rootCauseCategory: 'tool_output_misread',
        criticalFailureStep: 'verification',
      },
      tags: ['testing', 'verification'],
    },
    {
      signal: 'positive',
      timestamp: new Date(now - 2000).toISOString(),
      context: 'verified the proof commands and fixed the release flow',
    },
  ]);
  writeDiagnosticLog(Array.from({ length: 4 }, (_, index) => ({
    source: 'verification_loop',
    timestamp: new Date(now - ((4 - index) * 1000)).toISOString(),
    step: 'verification',
    context: 'coverage claim mismatched the actual output',
    diagnosis: {
      rootCauseCategory: 'tool_output_misread',
      criticalFailureStep: 'verification',
      violations: [{ constraintId: 'workflow:proof_commands' }],
    },
  })));
  writeAuditLog(Array.from({ length: 4 }, (_, index) => ({
    id: `audit_${index}`,
    timestamp: new Date(now - ((8 - index) * 1000)).toISOString(),
    toolName: 'Bash',
    toolInput: {
      command: 'npm publish',
      changed_files: ['package.json', 'server.json'],
    },
    decision: 'deny',
    gateId: 'publish_requires_mainline_head',
    message: 'Publish and tag flows should execute from the protected mainline branch.',
    source: 'gates-engine',
  })));

  const data = generateDashboard(tmpDir);
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => {
    lines.push(args.join(' '));
  };

  try {
    printDashboard(data);
  } finally {
    console.log = originalLog;
  }

  const output = lines.join('\n');
  assert.match(output, /🧠 Learned Policy/);
  assert.match(output, /Enabled\s+: yes/);
  assert.match(output, /Train Accuracy/);
  assert.match(output, /Holdout Accuracy/);
  assert.match(output, /Recent Pressure/);
  assert.match(output, /Top Deny Signal/);
  assert.match(output, /🧭 Decision Loop/);
  assert.match(output, /Fast Path/);
  assert.match(output, /Override Rate/);
});
