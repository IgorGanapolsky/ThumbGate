'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildAgenticDataPipelineJobSpec,
  buildDataPipelineMaterializeCommand,
  buildReconciliation,
  materializeAgenticDataPipeline,
  resolvePipelinePaths,
} = require('../scripts/agentic-data-pipeline');

function createStubTelemetry() {
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
      bySource: { producthunt: 1 },
      byCampaign: { ph_launch: 1 },
      byTrafficChannel: { producthunt: 1 },
      byCommunity: { ProductHunt: 1 },
      byOfferCode: { PH_EARLY: 1 },
      byCampaignVariant: { launch_comment: 1 },
      checkoutStartsBySource: { producthunt: 1 },
      checkoutStartsByCampaign: { ph_launch: 1 },
      checkoutStartsByTrafficChannel: { producthunt: 1 },
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

function createStubBilling(overrides = {}) {
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
    signups: {
      uniqueLeads: 1,
    },
    revenue: {
      paidCustomers: 1,
      bookedRevenueCents: 4900,
    },
    attribution: {
      acquisitionBySource: { producthunt: 1 },
      acquisitionByCampaign: { ph_launch: 1 },
      acquisitionByCommunity: { ProductHunt: 1 },
      acquisitionByOfferCode: { PH_EARLY: 1 },
      paidBySource: { producthunt: 1 },
      paidByCampaign: { ph_launch: 1 },
      paidByCommunity: { ProductHunt: 1 },
      paidByOfferCode: { PH_EARLY: 1 },
      bookedRevenueBySourceCents: { producthunt: 4900 },
      bookedRevenueByCampaignCents: { ph_launch: 4900 },
      bookedRevenueByCommunityCents: { ProductHunt: 4900 },
      bookedRevenueByOfferCodeCents: { PH_EARLY: 4900 },
    },
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

test('resolvePipelinePaths nests artifacts under an agentic-data-pipeline root', () => {
  const paths = resolvePipelinePaths({
    feedbackDir: '/tmp/thumbgate-feedback',
  });

  assert.match(paths.rootDir, /agentic-data-pipeline$/);
  assert.match(paths.telemetryRawPath, /raw\/telemetry-snapshot\.json$/);
  assert.match(paths.semanticPath, /semantic\/business-metrics\.json$/);
});

test('materializeAgenticDataPipeline builds staged snapshots and writes artifacts', async () => {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-data-pipeline-test-'));
  try {
    const snapshot = await materializeAgenticDataPipeline({
      feedbackDir,
      write: true,
      recordWorkflowRun: false,
      telemetryEvents: [
        { receivedAt: '2026-03-30T11:00:00.000Z', eventType: 'landing_page_view' },
        { receivedAt: '2026-03-30T11:05:00.000Z', eventType: 'checkout_start' },
      ],
      telemetryAnalytics: createStubTelemetry(),
      billingSummary: createStubBilling(),
    });

    assert.equal(snapshot.semantic.metrics.bookedRevenueCents, 4900);
    assert.equal(snapshot.semantic.metrics.pipelineWarnings, 0);
    assert.equal(snapshot.staging.dims.sources[0].key, 'producthunt');
    assert.equal(snapshot.lineage.incremental.mode, 'refresh');
    assert.equal(fs.existsSync(snapshot.paths.telemetryRawPath), true);
    assert.equal(fs.existsSync(snapshot.paths.catalogPath), true);
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('materializeAgenticDataPipeline reruns stay idempotent and mark noop when sources do not change', async () => {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-data-pipeline-test-'));
  try {
    const options = {
      feedbackDir,
      write: true,
      recordWorkflowRun: false,
      telemetryEvents: [{ receivedAt: '2026-03-30T11:00:00.000Z', eventType: 'landing_page_view' }],
      telemetryAnalytics: createStubTelemetry(),
      billingSummary: createStubBilling(),
    };
    const first = await materializeAgenticDataPipeline(options);
    const second = await materializeAgenticDataPipeline(options);

    assert.equal(second.snapshotId, first.snapshotId);
    assert.equal(second.lineage.incremental.mode, 'noop');
    assert.deepEqual(second.lineage.incremental.changedSources, []);
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('buildReconciliation warns on data quality drift', () => {
  const reconciliation = buildReconciliation({
    ...createStubTelemetry(),
    visitors: {
      ...createStubTelemetry().visitors,
      attributionCoverageRate: 0.25,
    },
    ctas: {
      ...createStubTelemetry().ctas,
      checkoutStarts: 0,
    },
  }, createStubBilling({
    revenue: {
      paidCustomers: 2,
      bookedRevenueCents: 4900,
    },
    dataQuality: {
      unreconciledPaidEvents: 1,
    },
  }));

  assert.equal(reconciliation.status, 'warning');
  assert.equal(reconciliation.warningCount, 3);
});

test('buildDataPipelineMaterializeCommand and buildAgenticDataPipelineJobSpec produce managed automation surfaces', () => {
  const command = buildDataPipelineMaterializeCommand({
    feedbackDir: '/tmp/thumbgate-feedback',
    outDir: '/tmp/thumbgate-pipeline',
    window: '30d',
    recordWorkflowRun: false,
  });
  const jobSpec = buildAgenticDataPipelineJobSpec({
    feedbackDir: '/tmp/thumbgate-feedback',
    outDir: '/tmp/thumbgate-pipeline',
    window: '30d',
    recordWorkflowRun: false,
  });

  assert.match(command, /agentic-data-pipeline\.js/);
  assert.match(command, /materialize/);
  assert.equal(jobSpec.id, 'agentic-data-pipeline');
  assert.equal(jobSpec.stages[0].name, 'materialize_pipeline');
  assert.match(jobSpec.stages[0].command, /agentic-data-pipeline\.js/);
});
