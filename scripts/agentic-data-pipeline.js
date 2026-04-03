#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { getFeedbackPaths } = require('./feedback-loop');
const {
  TELEMETRY_FILE_NAME,
  getTelemetryAnalytics,
  loadTelemetryEvents,
} = require('./telemetry-analytics');
const {
  filterEntriesForWindow,
  resolveAnalyticsWindow,
  serializeAnalyticsWindow,
} = require('./analytics-window');
const { appendWorkflowRun } = require('./workflow-runs');
const { buildPredictiveInsights } = require('./predictive-insights');

const PIPELINE_DIRNAME = 'agentic-data-pipeline';
const DEFAULT_JOB_ID = 'agentic-data-pipeline';

function loadBillingModule() {
  return require('./billing');
}

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return filePath;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const fields = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${fields.join(',')}}`;
  }

  return JSON.stringify(value);
}

function hashValue(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function resolvePipelinePaths(options = {}) {
  const feedbackDir = options.feedbackDir || getFeedbackPaths().FEEDBACK_DIR;
  const rootDir = path.resolve(options.outDir || path.join(feedbackDir, PIPELINE_DIRNAME));

  return {
    rootDir,
    rawDir: path.join(rootDir, 'raw'),
    stagingDir: path.join(rootDir, 'staging'),
    semanticDir: path.join(rootDir, 'semantic'),
    lineageDir: path.join(rootDir, 'lineage'),
    telemetryRawPath: path.join(rootDir, 'raw', 'telemetry-snapshot.json'),
    billingRawPath: path.join(rootDir, 'raw', 'billing-snapshot.json'),
    stagingPath: path.join(rootDir, 'staging', 'model.json'),
    semanticPath: path.join(rootDir, 'semantic', 'business-metrics.json'),
    lineagePath: path.join(rootDir, 'lineage', 'report.json'),
    catalogPath: path.join(rootDir, 'catalog.json'),
  };
}

function buildWindowLabel(window) {
  const serialized = serializeAnalyticsWindow(window);
  return [serialized.window, serialized.startLocalDate, serialized.endLocalDate]
    .filter(Boolean)
    .join(':');
}

function serializeStableWindow(window) {
  const serialized = serializeAnalyticsWindow(window);
  return {
    window: serialized.window,
    timeZone: serialized.timeZone,
    bounded: serialized.bounded,
    startLocalDate: serialized.startLocalDate,
    endLocalDate: serialized.endLocalDate,
  };
}

function deriveSnapshotId(window, sourceHashes) {
  const label = buildWindowLabel(window).replace(/[^a-zA-Z0-9:_-]/g, '_');
  return [
    'adp',
    label || 'lifetime',
    sourceHashes.telemetry.slice(0, 10),
    sourceHashes.billing.slice(0, 10),
  ].join('_');
}

function summarizeRange(entries = [], key) {
  const timestamps = entries
    .map((entry) => normalizeText(entry && entry[key]))
    .filter(Boolean)
    .sort();

  return {
    firstSeenAt: timestamps[0] || null,
    lastSeenAt: timestamps[timestamps.length - 1] || null,
  };
}

function sanitizeBillingSummary(summary = {}) {
  return {
    generatedAt: normalizeText(summary.generatedAt),
    window: summary.window || null,
    coverage: summary.coverage || {},
    signups: summary.signups || {},
    revenue: summary.revenue || {},
    pipeline: summary.pipeline || {},
    attribution: summary.attribution || {},
    trafficMetrics: summary.trafficMetrics || {},
    operatorGeneratedAcquisition: summary.operatorGeneratedAcquisition || {},
    dataQuality: summary.dataQuality || {},
    keys: summary.keys || {},
  };
}

function buildRawSnapshots({
  feedbackDir,
  window,
  telemetryEvents,
  telemetryAnalytics,
  billingSummary,
}) {
  const telemetryPath = path.join(feedbackDir, TELEMETRY_FILE_NAME);
  const telemetryRange = summarizeRange(telemetryEvents, 'receivedAt');
  const rawTelemetry = {
    sourceId: 'telemetry_events',
    sourceType: 'jsonl',
    sourcePath: telemetryPath,
    window: serializeAnalyticsWindow(window),
    totalWindowedEvents: telemetryEvents.length,
    ...telemetryRange,
    latestSeenAt: telemetryAnalytics.latestSeenAt || null,
    byClientType: telemetryAnalytics.byClientType || {},
    byEventType: telemetryAnalytics.byEventType || {},
    visitors: telemetryAnalytics.visitors || {},
    ctas: telemetryAnalytics.ctas || {},
    buyerLoss: telemetryAnalytics.buyerLoss || {},
    seo: telemetryAnalytics.seo || {},
    recent: telemetryAnalytics.recent || [],
  };

  const rawBilling = {
    sourceId: 'billing_summary',
    sourceType: 'computed_summary',
    sourcePath: 'scripts/billing.js#getBillingSummary',
    window: serializeAnalyticsWindow(window),
    summary: sanitizeBillingSummary(billingSummary),
  };
  const telemetryHashInput = {
    sourceId: rawTelemetry.sourceId,
    sourceType: rawTelemetry.sourceType,
    sourcePath: rawTelemetry.sourcePath,
    window: serializeStableWindow(window),
    totalWindowedEvents: rawTelemetry.totalWindowedEvents,
    firstSeenAt: rawTelemetry.firstSeenAt,
    lastSeenAt: rawTelemetry.lastSeenAt,
    latestSeenAt: rawTelemetry.latestSeenAt,
    byClientType: rawTelemetry.byClientType,
    byEventType: rawTelemetry.byEventType,
    visitors: rawTelemetry.visitors,
    ctas: rawTelemetry.ctas,
    buyerLoss: rawTelemetry.buyerLoss,
    seo: rawTelemetry.seo,
    recent: rawTelemetry.recent,
  };
  const billingHashInput = {
    sourceId: rawBilling.sourceId,
    sourceType: rawBilling.sourceType,
    sourcePath: rawBilling.sourcePath,
    window: serializeStableWindow(window),
    summary: {
      ...rawBilling.summary,
      generatedAt: null,
      window: rawBilling.summary.window
        ? serializeStableWindow(rawBilling.summary.window)
        : null,
    },
  };

  return {
    telemetry: {
      ...rawTelemetry,
      sourceHash: hashValue(telemetryHashInput),
    },
    billing: {
      ...rawBilling,
      sourceHash: hashValue(billingHashInput),
    },
  };
}

function mergeDimensionCounters(metricCounters = {}) {
  const metrics = Object.keys(metricCounters);
  const rows = new Map();

  for (const metric of metrics) {
    const counter = metricCounters[metric] || {};
    for (const [rawKey, rawValue] of Object.entries(counter)) {
      const key = normalizeText(rawKey) || 'unknown';
      const value = Number(rawValue || 0);
      const row = rows.get(key) || { key };
      row[metric] = value;
      rows.set(key, row);
    }
  }

  return Array.from(rows.values())
    .map((row) => {
      const completed = { ...row };
      for (const metric of metrics) {
        if (!Number.isFinite(completed[metric])) {
          completed[metric] = 0;
        }
      }
      completed.total = metrics.reduce((sum, metric) => sum + Number(completed[metric] || 0), 0);
      return completed;
    })
    .sort((left, right) => {
      if (right.total !== left.total) return right.total - left.total;
      return left.key.localeCompare(right.key);
    });
}

function buildFunnelFacts(telemetryAnalytics, billingSummary) {
  const uniqueVisitors = Number(telemetryAnalytics.visitors?.uniqueVisitors || 0);
  const checkoutStarts = Number(telemetryAnalytics.ctas?.checkoutStarts || 0);
  const acquisitionLeads = Number(billingSummary.signups?.uniqueLeads || 0);
  const paidCustomers = Number(billingSummary.revenue?.paidCustomers || 0);

  return [
    { stage: 'visitor', count: uniqueVisitors, upstreamStage: null },
    { stage: 'checkout_start', count: checkoutStarts, upstreamStage: 'visitor' },
    { stage: 'acquisition', count: acquisitionLeads, upstreamStage: 'checkout_start' },
    { stage: 'paid', count: paidCustomers, upstreamStage: 'acquisition' },
  ];
}

function buildRevenueFacts(billingSummary) {
  const bookedRevenueCents = Number(billingSummary.revenue?.bookedRevenueCents || 0);
  return [
    { metric: 'bookedRevenueCents', value: bookedRevenueCents },
    { metric: 'paidCustomers', value: Number(billingSummary.revenue?.paidCustomers || 0) },
    { metric: 'activeProKeys', value: Number(billingSummary.keys?.active || 0) },
    { metric: 'totalUsage', value: Number(billingSummary.keys?.totalUsage || 0) },
  ];
}

function buildQualityFacts(telemetryAnalytics, billingSummary) {
  return [
    { metric: 'attributionCoverageRate', value: Number(telemetryAnalytics.visitors?.attributionCoverageRate || 0) },
    { metric: 'acquisitionIdCoverageRate', value: Number(telemetryAnalytics.visitors?.acquisitionIdCoverageRate || 0) },
    { metric: 'unreconciledPaidEvents', value: Number(billingSummary.dataQuality?.unreconciledPaidEvents || 0) },
  ];
}

function buildReconciliation(telemetryAnalytics, billingSummary) {
  const paidCustomers = Number(billingSummary.revenue?.paidCustomers || 0);
  const checkoutStarts = Number(telemetryAnalytics.ctas?.checkoutStarts || 0);
  const unreconciledPaidEvents = Number(billingSummary.dataQuality?.unreconciledPaidEvents || 0);
  const attributionCoverageRate = Number(telemetryAnalytics.visitors?.attributionCoverageRate || 0);
  const visitorEvents = Number(telemetryAnalytics.visitors?.pageViews || 0);

  const checks = [
    {
      id: 'unreconciled_paid_events_zero',
      severity: 'warning',
      status: unreconciledPaidEvents === 0 ? 'pass' : 'warn',
      expected: 0,
      actual: unreconciledPaidEvents,
      message: unreconciledPaidEvents === 0
        ? 'All paid events are reconciled.'
        : 'Paid events remain unreconciled and need billing follow-up.',
    },
    {
      id: 'paid_customers_not_ahead_of_checkout_starts',
      severity: 'warning',
      status: paidCustomers > checkoutStarts ? 'warn' : 'pass',
      expected: `paidCustomers <= checkoutStarts (${checkoutStarts})`,
      actual: paidCustomers,
      message: paidCustomers > checkoutStarts
        ? 'Paid customers exceed tracked checkout starts; replay telemetry or validate attribution gaps.'
        : 'Paid customers stay within tracked checkout starts.',
    },
    {
      id: 'telemetry_attribution_coverage',
      severity: 'warning',
      status: visitorEvents === 0 || attributionCoverageRate >= 0.5 ? 'pass' : 'warn',
      expected: '>= 0.5',
      actual: attributionCoverageRate,
      message: visitorEvents === 0 || attributionCoverageRate >= 0.5
        ? 'Telemetry attribution coverage is acceptable for semantic rollups.'
        : 'Telemetry attribution coverage is low; acquisition breakdowns may undercount.',
    },
  ];

  const warningCount = checks.filter((check) => check.status === 'warn').length;
  return {
    status: warningCount > 0 ? 'warning' : 'healthy',
    warningCount,
    passCount: checks.length - warningCount,
    checks,
  };
}

function buildStagingModel({
  window,
  snapshotId,
  rawSnapshots,
  telemetryAnalytics,
  billingSummary,
  telemetryEvents,
}) {
  const dims = {
    sources: mergeDimensionCounters({
      pageViews: telemetryAnalytics.visitors?.bySource,
      checkoutStarts: telemetryAnalytics.ctas?.checkoutStartsBySource,
      acquisitionLeads: billingSummary.attribution?.acquisitionBySource,
      paidCustomers: billingSummary.attribution?.paidBySource,
      bookedRevenueCents: billingSummary.attribution?.bookedRevenueBySourceCents,
    }),
    campaigns: mergeDimensionCounters({
      pageViews: telemetryAnalytics.visitors?.byCampaign,
      checkoutStarts: telemetryAnalytics.ctas?.checkoutStartsByCampaign,
      acquisitionLeads: billingSummary.attribution?.acquisitionByCampaign,
      paidCustomers: billingSummary.attribution?.paidByCampaign,
      bookedRevenueCents: billingSummary.attribution?.bookedRevenueByCampaignCents,
    }),
    trafficChannels: mergeDimensionCounters({
      pageViews: telemetryAnalytics.visitors?.byTrafficChannel,
      checkoutStarts: telemetryAnalytics.ctas?.checkoutStartsByTrafficChannel,
    }),
    creators: mergeDimensionCounters({
      pageViews: telemetryAnalytics.visitors?.byCreator,
      checkoutStarts: telemetryAnalytics.ctas?.checkoutStartsByCreator,
      acquisitionLeads: billingSummary.attribution?.acquisitionByCreator,
      paidCustomers: billingSummary.attribution?.paidByCreator,
      bookedRevenueCents: billingSummary.attribution?.bookedRevenueByCreatorCents,
      workflowSprintLeads: billingSummary.pipeline?.workflowSprintLeads?.byCreator,
      qualifiedWorkflowSprintLeads: billingSummary.pipeline?.qualifiedWorkflowSprintLeads?.byCreator,
    }),
    communities: mergeDimensionCounters({
      pageViews: telemetryAnalytics.visitors?.byCommunity,
      acquisitionLeads: billingSummary.attribution?.acquisitionByCommunity,
      paidCustomers: billingSummary.attribution?.paidByCommunity,
      bookedRevenueCents: billingSummary.attribution?.bookedRevenueByCommunityCents,
    }),
    offerCodes: mergeDimensionCounters({
      pageViews: telemetryAnalytics.visitors?.byOfferCode,
      acquisitionLeads: billingSummary.attribution?.acquisitionByOfferCode,
      paidCustomers: billingSummary.attribution?.paidByOfferCode,
      bookedRevenueCents: billingSummary.attribution?.bookedRevenueByOfferCodeCents,
    }),
  };

  const reconciliation = buildReconciliation(telemetryAnalytics, billingSummary);

  return {
    generatedAt: new Date().toISOString(),
    snapshotId,
    window: serializeAnalyticsWindow(window),
    sourceHashes: {
      telemetry: rawSnapshots.telemetry.sourceHash,
      billing: rawSnapshots.billing.sourceHash,
    },
    rawCounts: {
      telemetryWindowedEvents: telemetryEvents.length,
      billingSnapshots: 1,
    },
    dims,
    facts: {
      funnel: buildFunnelFacts(telemetryAnalytics, billingSummary),
      revenue: buildRevenueFacts(billingSummary),
      quality: buildQualityFacts(telemetryAnalytics, billingSummary),
    },
    reconciliation,
  };
}

function buildSemanticSnapshot({
  window,
  snapshotId,
  telemetryAnalytics,
  billingSummary,
  stagingModel,
  gateStats = {},
  team = {},
}) {
  const uniqueVisitors = Number(telemetryAnalytics.visitors?.uniqueVisitors || 0);
  const checkoutStarts = Number(telemetryAnalytics.ctas?.checkoutStarts || 0);
  const acquisitionLeads = Number(billingSummary.signups?.uniqueLeads || 0);
  const paidCustomers = Number(billingSummary.revenue?.paidCustomers || 0);
  const bookedRevenueCents = Number(billingSummary.revenue?.bookedRevenueCents || 0);
  const attributionCoverageRate = Number(telemetryAnalytics.visitors?.attributionCoverageRate || 0);
  const unreconciledPaidEvents = Number(billingSummary.dataQuality?.unreconciledPaidEvents || 0);
  const predictive = buildPredictiveInsights({
    telemetryAnalytics,
    billingSummary,
    stagingModel,
    gateStats,
    team,
  });

  return {
    generatedAt: new Date().toISOString(),
    snapshotId,
    window: serializeAnalyticsWindow(window),
    metrics: {
      uniqueVisitors,
      checkoutStarts,
      acquisitionLeads,
      paidCustomers,
      bookedRevenueCents,
      bookedRevenueFormatted: `$${(bookedRevenueCents / 100).toFixed(2)}`,
      conversionRate: uniqueVisitors > 0 ? Number((paidCustomers / uniqueVisitors).toFixed(4)) : 0,
      leadToPaidRate: acquisitionLeads > 0 ? Number((paidCustomers / acquisitionLeads).toFixed(4)) : 0,
      activeProKeys: Number(billingSummary.keys?.active || 0),
      totalUsage: Number(billingSummary.keys?.totalUsage || 0),
      attributionCoverageRate,
      unreconciledPaidEvents,
      pipelineWarnings: stagingModel.reconciliation.warningCount,
      predictedBookedRevenueCents: predictive.revenueForecast.predictedBookedRevenueCents,
      incrementalRevenueOpportunityCents: predictive.revenueForecast.incrementalOpportunityCents,
      proUpgradeScore: predictive.upgradePropensity.pro.score,
      teamUpgradeScore: predictive.upgradePropensity.team.score,
      predictiveAnomalyCount: predictive.anomalySummary.count,
    },
    attribution: billingSummary.attribution || {},
    status: {
      isPostFirstDollar: paidCustomers > 0 || bookedRevenueCents > 0,
      hasActivePipeline: checkoutStarts > 0 || acquisitionLeads > 0,
      reconciliationStatus: stagingModel.reconciliation.status,
      predictiveStatus: predictive.anomalySummary.severity,
    },
    dataQuality: {
      attributionCoverageRate,
      unreconciledPaidEvents,
      reconciliation: stagingModel.reconciliation,
    },
    predictive,
    pipeline: {
      snapshotId,
      sourceHashes: stagingModel.sourceHashes,
      dimensions: Object.fromEntries(
        Object.entries(stagingModel.dims).map(([name, rows]) => [name, rows.length])
      ),
      facts: Object.fromEntries(
        Object.entries(stagingModel.facts).map(([name, rows]) => [name, rows.length])
      ),
      reconciliationStatus: stagingModel.reconciliation.status,
      warningCount: stagingModel.reconciliation.warningCount,
    },
  };
}

function buildLineageReport({
  window,
  snapshotId,
  paths,
  rawSnapshots,
  stagingModel,
  semanticSnapshot,
}) {
  const previous = readJson(paths.lineagePath);
  const changedSources = [];
  if (!previous || previous.sourceHashes?.telemetry !== rawSnapshots.telemetry.sourceHash) {
    changedSources.push('telemetry');
  }
  if (!previous || previous.sourceHashes?.billing !== rawSnapshots.billing.sourceHash) {
    changedSources.push('billing');
  }

  return {
    generatedAt: new Date().toISOString(),
    snapshotId,
    previousSnapshotId: previous && previous.snapshotId ? previous.snapshotId : null,
    window: serializeAnalyticsWindow(window),
    sourceHashes: {
      telemetry: rawSnapshots.telemetry.sourceHash,
      billing: rawSnapshots.billing.sourceHash,
    },
    incremental: {
      mode: previous && changedSources.length === 0 ? 'noop' : 'refresh',
      changedSources,
    },
    stages: [
      {
        stage: 'raw',
        inputs: [
          rawSnapshots.telemetry.sourcePath,
          rawSnapshots.billing.sourcePath,
        ],
        outputs: [
          paths.telemetryRawPath,
          paths.billingRawPath,
        ],
        rowCount: rawSnapshots.telemetry.totalWindowedEvents + 1,
      },
      {
        stage: 'staging',
        inputs: [
          paths.telemetryRawPath,
          paths.billingRawPath,
        ],
        outputs: [paths.stagingPath],
        rowCount: Object.values(stagingModel.dims).reduce((sum, rows) => sum + rows.length, 0)
          + Object.values(stagingModel.facts).reduce((sum, rows) => sum + rows.length, 0),
      },
      {
        stage: 'semantic',
        inputs: [paths.stagingPath],
        outputs: [paths.semanticPath],
        rowCount: Object.keys(semanticSnapshot.metrics || {}).length,
      },
    ],
    reconciliation: stagingModel.reconciliation,
  };
}

function buildCatalog(paths, rawSnapshots, stagingModel, semanticSnapshot, lineageReport) {
  return {
    generatedAt: new Date().toISOString(),
    snapshotId: semanticSnapshot.snapshotId,
    entries: [
      {
        id: 'raw_telemetry',
        stage: 'raw',
        path: paths.telemetryRawPath,
        exists: fs.existsSync(paths.telemetryRawPath),
        rowCount: rawSnapshots.telemetry.totalWindowedEvents,
        sourceHash: rawSnapshots.telemetry.sourceHash,
        description: 'Windowed telemetry snapshot for staged analytics.',
      },
      {
        id: 'raw_billing',
        stage: 'raw',
        path: paths.billingRawPath,
        exists: fs.existsSync(paths.billingRawPath),
        rowCount: 1,
        sourceHash: rawSnapshots.billing.sourceHash,
        description: 'Computed billing summary snapshot for staged analytics.',
      },
      {
        id: 'staging_model',
        stage: 'staging',
        path: paths.stagingPath,
        exists: fs.existsSync(paths.stagingPath),
        rowCount: Object.values(stagingModel.dims).reduce((sum, rows) => sum + rows.length, 0)
          + Object.values(stagingModel.facts).reduce((sum, rows) => sum + rows.length, 0),
        sourceHash: hashValue(stagingModel),
        description: 'Normalized dimensions, facts, and reconciliation checks.',
      },
      {
        id: 'semantic_metrics',
        stage: 'semantic',
        path: paths.semanticPath,
        exists: fs.existsSync(paths.semanticPath),
        rowCount: Object.keys(semanticSnapshot.metrics || {}).length,
        sourceHash: hashValue(semanticSnapshot),
        description: 'Business metrics ready for gates, dashboards, and operators.',
      },
      {
        id: 'lineage_report',
        stage: 'lineage',
        path: paths.lineagePath,
        exists: fs.existsSync(paths.lineagePath),
        rowCount: lineageReport.stages.length,
        sourceHash: hashValue(lineageReport),
        description: 'Incremental lineage and reconciliation report.',
      },
    ],
  };
}

function writePipelineArtifacts(paths, rawSnapshots, stagingModel, semanticSnapshot, lineageReport) {
  ensureDir(paths.rawDir);
  ensureDir(paths.stagingDir);
  ensureDir(paths.semanticDir);
  ensureDir(paths.lineageDir);

  writeJson(paths.telemetryRawPath, rawSnapshots.telemetry);
  writeJson(paths.billingRawPath, rawSnapshots.billing);
  writeJson(paths.stagingPath, stagingModel);
  writeJson(paths.semanticPath, semanticSnapshot);
  writeJson(paths.lineagePath, lineageReport);
}

function recordPipelineWorkflowRun(feedbackDir, paths, semanticSnapshot, lineageReport) {
  return appendWorkflowRun({
    workflowId: 'agentic_data_pipeline_materialize',
    workflowName: 'Agentic data pipeline materialization',
    owner: 'cto',
    runtime: 'node',
    status: 'passed',
    customerType: 'internal_dogfood',
    teamId: 'internal_repo',
    reviewed: true,
    reviewedBy: 'automation',
    proofBacked: true,
    source: 'agentic-data-pipeline',
    proofArtifacts: [
      paths.semanticPath,
      paths.lineagePath,
      paths.catalogPath,
    ],
    metadata: {
      snapshotId: semanticSnapshot.snapshotId,
      incrementalMode: lineageReport.incremental.mode,
      window: semanticSnapshot.window,
    },
  }, feedbackDir);
}

async function materializeAgenticDataPipeline(options = {}) {
  const feedbackDir = options.feedbackDir || getFeedbackPaths().FEEDBACK_DIR;
  const window = resolveAnalyticsWindow(options);
  const paths = resolvePipelinePaths({
    feedbackDir,
    outDir: options.outDir,
  });
  const telemetryEvents = Array.isArray(options.telemetryEvents)
    ? filterEntriesForWindow(options.telemetryEvents, window, (entry) => entry.receivedAt || entry.timestamp)
    : filterEntriesForWindow(loadTelemetryEvents(feedbackDir), window, (entry) => entry.receivedAt || entry.timestamp);
  const telemetryAnalytics = options.telemetryAnalytics || getTelemetryAnalytics(feedbackDir, window);
  let billingSummary = options.billingSummary;
  if (!billingSummary) {
    const { getBillingSummary, getBillingSummaryLive } = loadBillingModule();
    billingSummary = options.liveBilling
      ? await getBillingSummaryLive(window)
      : getBillingSummary(window);
  }

  const rawSnapshots = buildRawSnapshots({
    feedbackDir,
    window,
    telemetryEvents,
    telemetryAnalytics,
    billingSummary,
  });
  const snapshotId = deriveSnapshotId(window, {
    telemetry: rawSnapshots.telemetry.sourceHash,
    billing: rawSnapshots.billing.sourceHash,
  });
  const stagingModel = buildStagingModel({
    window,
    snapshotId,
    rawSnapshots,
    telemetryAnalytics,
    billingSummary,
    telemetryEvents,
  });
  const semanticSnapshot = buildSemanticSnapshot({
    window,
    snapshotId,
    telemetryAnalytics,
    billingSummary,
    stagingModel,
    gateStats: options.gateStats || {},
    team: options.team || {},
  });
  const lineageReport = buildLineageReport({
    window,
    snapshotId,
    paths,
    rawSnapshots,
    stagingModel,
    semanticSnapshot,
  });
  if (options.write !== false) {
    writePipelineArtifacts(paths, rawSnapshots, stagingModel, semanticSnapshot, lineageReport);
  }

  const catalog = buildCatalog(paths, rawSnapshots, stagingModel, semanticSnapshot, lineageReport);
  if (options.write !== false) {
    writeJson(paths.catalogPath, catalog);
  }

  const workflowRun = options.recordWorkflowRun === false || options.write === false
    ? null
    : recordPipelineWorkflowRun(feedbackDir, paths, semanticSnapshot, lineageReport);

  return {
    generatedAt: semanticSnapshot.generatedAt,
    window: semanticSnapshot.window,
    snapshotId,
    raw: rawSnapshots,
    staging: stagingModel,
    semantic: semanticSnapshot,
    lineage: lineageReport,
    catalog,
    paths,
    workflowRun,
  };
}

function buildDataPipelineMaterializeCommand(options = {}) {
  const scriptPath = path.join(__dirname, 'agentic-data-pipeline.js');
  const args = [scriptPath, 'materialize'];

  if (options.feedbackDir) {
    args.push('--feedback-dir', path.resolve(options.feedbackDir));
  }
  if (options.outDir) {
    args.push('--out-dir', path.resolve(options.outDir));
  }
  if (options.window) {
    args.push('--window', options.window);
  }
  if (options.liveBilling) {
    args.push('--live-billing');
  }
  if (options.recordWorkflowRun === false) {
    args.push('--no-record-workflow-run');
  }

  return `const { spawnSync } = require('node:child_process'); const result = spawnSync(process.execPath, [${args.map((entry) => JSON.stringify(entry)).join(', ')}], { cwd: ${JSON.stringify(path.join(__dirname, '..'))}, stdio: 'inherit' }); if (result.status !== 0) process.exit(result.status || 1);`;
}

function buildAgenticDataPipelineJobSpec(options = {}) {
  return {
    id: options.jobId || DEFAULT_JOB_ID,
    tags: ['data-pipeline', 'semantic-layer', 'automation'],
    skill: 'agentic-data-pipeline',
    autoResume: true,
    stages: [
      {
        name: 'materialize_pipeline',
        command: buildDataPipelineMaterializeCommand(options),
        workingDirectory: path.join(__dirname, '..'),
      },
    ],
  };
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      args._.push(value);
      continue;
    }

    const key = value.slice(2);
    if (key === 'live-billing' || key === 'json') {
      args[key] = true;
      continue;
    }
    if (key === 'no-write') {
      args.write = false;
      continue;
    }
    if (key === 'no-record-workflow-run') {
      args.recordWorkflowRun = false;
      continue;
    }

    args[key] = argv[index + 1];
    index += 1;
  }
  return args;
}

async function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const command = args._[0] || 'materialize';

  if (command !== 'materialize') {
    throw new Error(`Unsupported command: ${command}`);
  }

  const result = await materializeAgenticDataPipeline({
    feedbackDir: args['feedback-dir'],
    outDir: args['out-dir'],
    window: args.window,
    liveBilling: Boolean(args['live-billing']),
    write: args.write !== false,
    recordWorkflowRun: args.recordWorkflowRun !== false,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  const lines = [
    'Agentic Data Pipeline',
    '',
    `Snapshot: ${result.snapshotId}`,
    `Window: ${result.window.window}`,
    `Incremental mode: ${result.lineage.incremental.mode}`,
    `Reconciliation: ${result.lineage.reconciliation.status} (${result.lineage.reconciliation.warningCount} warning(s))`,
    `Semantic metrics: ${Object.keys(result.semantic.metrics).length}`,
  ];
  console.log(lines.join('\n'));
  return result;
}

module.exports = {
  PIPELINE_DIRNAME,
  DEFAULT_JOB_ID,
  buildAgenticDataPipelineJobSpec,
  buildDataPipelineMaterializeCommand,
  buildReconciliation,
  buildStagingModel,
  buildSemanticSnapshot,
  materializeAgenticDataPipeline,
  resolvePipelinePaths,
  runCli,
};

if (require.main === module) {
  runCli().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
