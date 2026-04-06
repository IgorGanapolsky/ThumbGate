'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function resolveProofPaths() {
  const proofDir = process.env.THUMBGATE_PROOF_DIR || path.join(ROOT, 'proof');
  return {
    proofDir,
    reportJson: path.join(proofDir, 'data-pipeline-report.json'),
    reportMd: path.join(proofDir, 'data-pipeline-report.md'),
  };
}

function loadFresh(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(modulePath);
}

function buildStubTelemetry() {
  return {
    window: {
      window: '30d',
      timeZone: 'America/New_York',
      bounded: true,
      startLocalDate: '2026-03-01',
      endLocalDate: '2026-03-30',
      now: '2026-03-30T12:00:00.000Z',
    },
    totalEvents: 3,
    latestSeenAt: '2026-03-30T12:00:00.000Z',
    byClientType: { web: 3 },
    byEventType: { landing_page_view: 1, checkout_start: 1, reason_not_buying: 1 },
    visitors: {
      totalEvents: 3,
      uniqueVisitors: 1,
      uniqueSessions: 1,
      pageViews: 1,
      attributedPageViews: 1,
      attributionCoverageRate: 1,
      visitorIdCoverageRate: 1,
      sessionIdCoverageRate: 1,
      acquisitionIdCoverageRate: 1,
      byCreator: { reach_vb: 1 },
      bySource: { producthunt: 1 },
      byCampaign: { ph_launch: 1 },
      byTrafficChannel: { producthunt: 1 },
      byCommunity: { ProductHunt: 1 },
      byOfferCode: { PH_EARLY: 1 },
      byCampaignVariant: { launch_comment: 1 },
      byReferrerHost: { 'www.producthunt.com': 1 },
    },
    ctas: {
      totalClicks: 1,
      checkoutStarts: 1,
      uniqueCheckoutStarters: 1,
      checkoutFailures: 0,
      checkoutCancelled: 0,
      checkoutAbandoned: 0,
      paidConfirmations: 1,
      byCreator: { reach_vb: 1 },
      bySource: { producthunt: 1 },
      byCampaign: { ph_launch: 1 },
      byTrafficChannel: { producthunt: 1 },
      byCommunity: { ProductHunt: 1 },
      byOfferCode: { PH_EARLY: 1 },
      byCampaignVariant: { launch_comment: 1 },
      checkoutStartsBySource: { producthunt: 1 },
      checkoutStartsByCampaign: { ph_launch: 1 },
      checkoutStartsByTrafficChannel: { producthunt: 1 },
      checkoutStartsByCreator: { reach_vb: 1 },
      checkoutStartsByCommunity: { ProductHunt: 1 },
      checkoutStartsByOfferCode: { PH_EARLY: 1 },
      checkoutStartsByCampaignVariant: { launch_comment: 1 },
      byId: { pricing_pro: 1 },
    },
    buyerLoss: {
      totalSignals: 1,
      reasonsByCode: { too_expensive: 1 },
    },
    seo: {
      landingViews: 0,
      bySurface: {},
      byQuery: {},
    },
    cli: {
      uniqueInstalls: 0,
      byPlatform: {},
    },
    recent: [],
  };
}

function buildStubBilling(overrides = {}) {
  return {
    generatedAt: '2026-03-30T12:00:00.000Z',
    window: {
      window: '30d',
      timeZone: 'America/New_York',
      bounded: true,
      startLocalDate: '2026-03-01',
      endLocalDate: '2026-03-30',
      now: '2026-03-30T12:00:00.000Z',
    },
    coverage: {
      source: 'funnel_ledger+revenue_ledger+key_store+workflow_sprint_leads',
    },
    signups: {
      uniqueLeads: 1,
    },
    revenue: {
      paidCustomers: 1,
      bookedRevenueCents: 4900,
    },
    pipeline: {
      workflowSprintLeads: { byCreator: { reach_vb: 1 } },
      qualifiedWorkflowSprintLeads: { byCreator: { reach_vb: 1 } },
    },
    attribution: {
      acquisitionByCreator: { reach_vb: 1 },
      acquisitionBySource: { producthunt: 1 },
      acquisitionByCampaign: { ph_launch: 1 },
      acquisitionByCommunity: { ProductHunt: 1 },
      acquisitionByOfferCode: { PH_EARLY: 1 },
      paidByCreator: { reach_vb: 1 },
      paidBySource: { producthunt: 1 },
      paidByCampaign: { ph_launch: 1 },
      paidByCommunity: { ProductHunt: 1 },
      paidByOfferCode: { PH_EARLY: 1 },
      bookedRevenueByCreatorCents: { reach_vb: 4900 },
      bookedRevenueBySourceCents: { producthunt: 4900 },
      bookedRevenueByCampaignCents: { ph_launch: 4900 },
      bookedRevenueByCommunityCents: { ProductHunt: 4900 },
      bookedRevenueByOfferCodeCents: { PH_EARLY: 4900 },
    },
    trafficMetrics: {},
    operatorGeneratedAcquisition: {},
    dataQuality: {
      unreconciledPaidEvents: 0,
    },
    keys: {
      active: 1,
      totalUsage: 42,
    },
    ...overrides,
  };
}

async function run() {
  const results = { passed: 0, failed: 0, requirements: {} };
  const { proofDir, reportJson, reportMd } = resolveProofPaths();

  const checks = [
    {
      id: 'DATA-PIPE-01',
      desc: 'materializeAgenticDataPipeline builds raw, staging, semantic, and lineage layers from billing and telemetry inputs',
      fn: async () => {
        const { materializeAgenticDataPipeline } = loadFresh('./agentic-data-pipeline');
        const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-data-pipeline-proof-'));
        try {
          const snapshot = await materializeAgenticDataPipeline({
            feedbackDir,
            write: false,
            recordWorkflowRun: false,
            telemetryEvents: [
              {
                receivedAt: '2026-03-30T11:00:00.000Z',
                eventType: 'landing_page_view',
              },
              {
                receivedAt: '2026-03-30T11:05:00.000Z',
                eventType: 'checkout_start',
              },
            ],
            telemetryAnalytics: buildStubTelemetry(),
            billingSummary: buildStubBilling(),
          });

          if (snapshot.semantic.metrics.bookedRevenueCents !== 4900) {
            throw new Error('Expected booked revenue semantic metric');
          }
          if (!snapshot.staging.dims.creators.some((entry) => entry.key === 'reach_vb')) {
            throw new Error('Expected one staged creator row');
          }
          if (snapshot.staging.dims.sources.length !== 1) {
            throw new Error('Expected one staged source row');
          }
          if (snapshot.lineage.stages.length !== 3) {
            throw new Error('Expected three lineage stages');
          }
        } finally {
          fs.rmSync(feedbackDir, { recursive: true, force: true });
        }
      },
    },
    {
      id: 'DATA-PIPE-02',
      desc: 'pipeline reruns are idempotent and downgrade to noop when source hashes do not change',
      fn: async () => {
        const { materializeAgenticDataPipeline } = loadFresh('./agentic-data-pipeline');
        const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-data-pipeline-proof-'));
        try {
          const first = await materializeAgenticDataPipeline({
            feedbackDir,
            write: true,
            recordWorkflowRun: false,
            telemetryEvents: [{ receivedAt: '2026-03-30T11:00:00.000Z', eventType: 'landing_page_view' }],
            telemetryAnalytics: buildStubTelemetry(),
            billingSummary: buildStubBilling(),
          });
          const second = await materializeAgenticDataPipeline({
            feedbackDir,
            write: true,
            recordWorkflowRun: false,
            telemetryEvents: [{ receivedAt: '2026-03-30T11:00:00.000Z', eventType: 'landing_page_view' }],
            telemetryAnalytics: buildStubTelemetry(),
            billingSummary: buildStubBilling(),
          });

          if (first.snapshotId !== second.snapshotId) {
            throw new Error('Expected stable snapshot IDs across identical reruns');
          }
          if (second.lineage.incremental.mode !== 'noop') {
            throw new Error('Expected noop incremental mode on identical rerun');
          }
        } finally {
          fs.rmSync(feedbackDir, { recursive: true, force: true });
        }
      },
    },
    {
      id: 'DATA-PIPE-03',
      desc: 'reconciliation flags unreconciled paid events and telemetry coverage drift as warnings',
      fn: async () => {
        const { materializeAgenticDataPipeline } = loadFresh('./agentic-data-pipeline');
        const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-data-pipeline-proof-'));
        try {
          const snapshot = await materializeAgenticDataPipeline({
            feedbackDir,
            write: false,
            recordWorkflowRun: false,
            telemetryEvents: [{ receivedAt: '2026-03-30T11:00:00.000Z', eventType: 'landing_page_view' }],
            telemetryAnalytics: {
              ...buildStubTelemetry(),
              visitors: {
                ...buildStubTelemetry().visitors,
                attributionCoverageRate: 0.25,
              },
              ctas: {
                ...buildStubTelemetry().ctas,
                checkoutStarts: 0,
              },
            },
            billingSummary: buildStubBilling({
              revenue: {
                paidCustomers: 2,
                bookedRevenueCents: 4900,
              },
              dataQuality: {
                unreconciledPaidEvents: 1,
              },
            }),
          });

          if (snapshot.staging.reconciliation.status !== 'warning') {
            throw new Error('Expected warning reconciliation status');
          }
          if (snapshot.semantic.metrics.pipelineWarnings < 2) {
            throw new Error('Expected multiple pipeline warnings');
          }
        } finally {
          fs.rmSync(feedbackDir, { recursive: true, force: true });
        }
      },
    },
    {
      id: 'DATA-PIPE-04',
      desc: 'schedule manager emits a managed async-job spec for automated pipeline materialization',
      fn: () => {
        const { buildAgenticDataPipelineSchedule } = loadFresh('./schedule-manager');
        const schedule = buildAgenticDataPipelineSchedule({
          id: 'nightly-data-pipeline',
          feedbackDir: '/tmp/thumbgate-feedback',
          outDir: '/tmp/thumbgate-pipeline',
          window: '30d',
          recordWorkflowRun: false,
        });

        if (!schedule.command.includes('async-job-runner.js')) {
          throw new Error('Expected async job runner schedule command');
        }
        if (schedule.jobSpec.stages[0].name !== 'materialize_pipeline') {
          throw new Error('Expected pipeline materialization stage');
        }
      },
    },
    {
      id: 'DATA-PIPE-05',
      desc: 'semantic-layer consumes the staged pipeline and surfaces pipeline quality metrics',
      fn: async () => {
        const { getBusinessMetrics } = loadFresh('./semantic-layer');
        const metrics = await getBusinessMetrics({
          write: false,
          recordWorkflowRun: false,
          telemetryEvents: [{ receivedAt: '2026-03-30T11:00:00.000Z', eventType: 'landing_page_view' }],
          telemetryAnalytics: buildStubTelemetry(),
          billingSummary: buildStubBilling(),
        });

        if (metrics.pipeline.reconciliationStatus !== 'healthy') {
          throw new Error('Expected healthy reconciliation status');
        }
        if (metrics.metrics.attributionCoverageRate !== 1) {
          throw new Error('Expected attribution coverage metric');
        }
      },
    },
    {
      id: 'DATA-PIPE-06',
      desc: 'verify-run full includes the data-pipeline proof lane and artifact',
      fn: () => {
        const { buildVerifyPlan, recordVerifyWorkflowRun } = loadFresh('./verify-run');
        const commands = buildVerifyPlan('full')
          .map((step) => [step.command, ...(step.args || [])].join(' '))
          .join('\n');

        if (!commands.includes('prove:data-pipeline')) {
          throw new Error('verify:full is missing prove:data-pipeline');
        }

        const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-data-pipeline-proof-'));
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-data-pipeline-proof-cwd-'));
        try {
          const entry = recordVerifyWorkflowRun('full', cwd, feedbackDir);
          if (!entry.proofArtifacts.some((artifact) => artifact.endsWith(path.join('proof', 'data-pipeline-report.json')))) {
            throw new Error('verify workflow run is missing data pipeline proof artifact');
          }
        } finally {
          fs.rmSync(feedbackDir, { recursive: true, force: true });
          fs.rmSync(cwd, { recursive: true, force: true });
        }
      },
    },
  ];

  console.log('Agentic Data Pipeline - Proof Gate\n');
  console.log('Checking requirements:\n');

  for (const check of checks) {
    try {
      await check.fn();
      results.passed += 1;
      results.requirements[check.id] = { desc: check.desc, status: 'passed' };
      console.log(`✅ ${check.id} — ${check.desc}`);
    } catch (error) {
      results.failed += 1;
      results.requirements[check.id] = {
        desc: check.desc,
        status: 'failed',
        error: error.message,
      };
      console.log(`❌ ${check.id} — ${check.desc}`);
      console.log(`   ${error.message}`);
    }
  }

  ensureDir(proofDir);
  const report = {
    phase: '15-agentic-data-pipeline',
    generatedAt: new Date().toISOString(),
    passed: results.passed,
    failed: results.failed,
    requirements: results.requirements,
  };
  fs.writeFileSync(reportJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const markdown = [
    '# Agentic Data Pipeline Proof Report',
    '',
    `- passed: ${results.passed}`,
    `- failed: ${results.failed}`,
    '',
    ...Object.entries(results.requirements).map(([id, entry]) => {
      const prefix = entry.status === 'passed' ? '[x]' : '[ ]';
      const suffix = entry.error ? ` — ${entry.error}` : '';
      return `${prefix} **${id}** ${entry.desc}${suffix}`;
    }),
    '',
    `${results.passed} passed, ${results.failed} failed`,
  ].join('\n');
  fs.writeFileSync(reportMd, `${markdown}\n`, 'utf8');

  console.log(`\n${results.passed} passed, ${results.failed} failed`);
  if (results.failed > 0) {
    process.exitCode = 1;
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
