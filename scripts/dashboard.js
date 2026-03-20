#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { aggregateFailureDiagnostics } = require('./failure-diagnostics');
const { getBillingSummary, loadFunnelLedger, loadResolvedRevenueEvents } = require('./billing');
const { getTelemetryAnalytics, loadTelemetryEvents } = require('./telemetry-analytics');
const { getAutoGatesPath } = require('./auto-promote-gates');
const { summarizeDelegation } = require('./delegation-runtime');
const { filterEntriesForWindow, resolveAnalyticsWindow } = require('./analytics-window');
const { resolveHostedBillingConfig } = require('./hosted-config');
const { generateAgentReadinessReport } = require('./agent-readiness');
const { summarizeWorkflowRuns } = require('./workflow-runs');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_GATES_PATH = path.join(PROJECT_ROOT, 'config', 'gates', 'default.json');
const LANDING_PAGE_PATH = path.join(PROJECT_ROOT, 'public', 'index.html');

// ---------------------------------------------------------------------------
// Data readers
// ---------------------------------------------------------------------------

function readJSONL(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) return [];
  return raw.split('\n').map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function pickFirstText(...values) {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) return normalized;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Approval rate + trend
// ---------------------------------------------------------------------------

function computeApprovalStats(entries) {
  const total = entries.length;
  const positive = entries.filter((e) => e.signal === 'positive').length;
  const negative = entries.filter((e) => e.signal === 'negative').length;
  const approvalRate = total > 0 ? Math.round((positive / total) * 100) : 0;

  // 7-day trend
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const recentEntries = entries.filter((e) => {
    const ts = e.timestamp ? new Date(e.timestamp).getTime() : 0;
    return ts >= sevenDaysAgo;
  });
  const recentPositive = recentEntries.filter((e) => e.signal === 'positive').length;
  const recentRate = recentEntries.length > 0
    ? Math.round((recentPositive / recentEntries.length) * 100)
    : approvalRate;

  let trendDirection = 'stable';
  const diff = recentRate - approvalRate;
  if (diff > 5) trendDirection = 'improving';
  else if (diff < -5) trendDirection = 'declining';

  return {
    total,
    positive,
    negative,
    approvalRate,
    recentRate,
    trendDirection,
  };
}

// ---------------------------------------------------------------------------
// Gate enforcement stats
// ---------------------------------------------------------------------------

function computeGateStats() {
  const autoGatesPath = getAutoGatesPath();
  const statsPath = path.join(
    process.env.HOME || '/tmp',
    '.rlhf',
    'gate-stats.json'
  );
  const stats = readJsonFile(statsPath) || { blocked: 0, warned: 0, passed: 0, byGate: {} };

  // Count manual vs auto-promoted gates
  const defaultGates = readJsonFile(DEFAULT_GATES_PATH);
  const autoGates = readJsonFile(autoGatesPath);
  const manualCount = defaultGates && Array.isArray(defaultGates.gates) ? defaultGates.gates.length : 0;
  const autoCount = autoGates && Array.isArray(autoGates.gates) ? autoGates.gates.length : 0;
  const totalGates = manualCount + autoCount;

  // Top blocked gate
  let topBlocked = null;
  let topBlockedCount = 0;
  if (stats.byGate) {
    for (const [gateId, gateStat] of Object.entries(stats.byGate)) {
      const blocked = gateStat.blocked || 0;
      if (blocked > topBlockedCount) {
        topBlockedCount = blocked;
        topBlocked = gateId;
      }
    }
  }

  return {
    totalGates,
    manualCount,
    autoCount,
    blocked: stats.blocked || 0,
    warned: stats.warned || 0,
    passed: stats.passed || 0,
    topBlocked,
    topBlockedCount,
    byGate: stats.byGate || {},
  };
}

// ---------------------------------------------------------------------------
// Prevention impact
// ---------------------------------------------------------------------------

function computePreventionImpact(feedbackDir, gateStats) {
  const autoGatesPath = getAutoGatesPath();
  const preventionRulesPath = path.join(feedbackDir, 'prevention-rules.md');
  let ruleCount = 0;
  if (fs.existsSync(preventionRulesPath)) {
    const content = fs.readFileSync(preventionRulesPath, 'utf-8');
    const headers = content.match(/^## /gm);
    ruleCount = headers ? headers.length : 0;
  }

  // Estimate time saved: ~16 min per blocked action (conservative)
  const estimatedMinutesSaved = gateStats.blocked * 16;
  const estimatedHoursSaved = (estimatedMinutesSaved / 60).toFixed(1);

  // Last auto-promotion
  const autoGates = readJsonFile(autoGatesPath);
  let lastPromotion = null;
  if (autoGates && Array.isArray(autoGates.promotionLog) && autoGates.promotionLog.length > 0) {
    const sorted = autoGates.promotionLog
      .filter((p) => p.timestamp)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    if (sorted.length > 0) {
      const last = sorted[0];
      const daysAgo = Math.round((Date.now() - new Date(last.timestamp).getTime()) / (1000 * 60 * 60 * 24));
      lastPromotion = { id: last.gateId || last.id || 'unknown', daysAgo };
    }
  }

  return {
    estimatedHoursSaved,
    ruleCount,
    lastPromotion,
  };
}

// ---------------------------------------------------------------------------
// Session trend (last N sessions)
// ---------------------------------------------------------------------------

function computeSessionTrend(entries, windowCount) {
  if (entries.length < 10) return { bars: '', percentage: 0 };
  const windowSize = Math.max(1, Math.floor(entries.length / windowCount));
  const windows = [];
  for (let i = 0; i + windowSize <= entries.length; i += windowSize) {
    const slice = entries.slice(i, i + windowSize);
    const pos = slice.filter((e) => e.signal === 'positive').length;
    windows.push(Math.round((pos / slice.length) * 100));
  }
  const recent = windows.slice(-windowCount);
  const avg = recent.length > 0 ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) : 0;
  const filledBlocks = Math.round((avg / 100) * windowCount);
  const bars = '\u2588'.repeat(filledBlocks) + '\u2591'.repeat(windowCount - filledBlocks);
  return { bars, percentage: avg };
}

// ---------------------------------------------------------------------------
// System health
// ---------------------------------------------------------------------------

function computeSystemHealth(feedbackDir, gateStats) {
  const feedbackLogPath = path.join(feedbackDir, 'feedback-log.jsonl');
  const memoryLogPath = path.join(feedbackDir, 'memory-log.jsonl');

  const feedbackCount = readJSONL(feedbackLogPath).length;
  const memoryCount = readJSONL(memoryLogPath).length;

  return {
    feedbackCount,
    memoryCount,
    gateConfigLoaded: gateStats.totalGates > 0,
    gateCount: gateStats.totalGates,
    mcpServerRunning: true, // If dashboard is running, server is available
  };
}

function safeRate(numerator, denominator) {
  if (!denominator) return 0;
  return Number((numerator / denominator).toFixed(4));
}

function resolveJourneyKey(entry = {}) {
  const metadata = entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {};
  const attribution = entry.attribution && typeof entry.attribution === 'object' ? entry.attribution : {};
  return pickFirstText(
    entry.acquisitionId,
    metadata.acquisitionId,
    attribution.acquisitionId,
    entry.traceId,
    metadata.traceId,
    entry.installId,
    metadata.installId,
    entry.visitorId,
    metadata.visitorId,
    entry.sessionId,
    metadata.sessionId,
    entry.orderId,
    entry.evidence
  );
}

function countCoverage(entries, resolver) {
  if (!entries.length) return 0;
  const matched = entries.filter((entry) => resolver(entry)).length;
  return safeRate(matched, entries.length);
}

function computeAnalyticsSummary(feedbackDir, options = {}) {
  const analyticsWindow = resolveAnalyticsWindow(options.analyticsWindow || options);
  const telemetryEntries = filterEntriesForWindow(
    loadTelemetryEvents(feedbackDir),
    analyticsWindow,
    (entry) => entry && (entry.receivedAt || entry.timestamp)
  );
  const telemetry = getTelemetryAnalytics(feedbackDir, analyticsWindow);
  const billing = options.billingSummary || getBillingSummary(analyticsWindow);
  const funnelEntries = filterEntriesForWindow(
    loadFunnelLedger(),
    analyticsWindow,
    (entry) => entry && entry.timestamp
  );
  const paidOrderEntries = filterEntriesForWindow(
    loadResolvedRevenueEvents(),
    analyticsWindow,
    (entry) => entry && entry.timestamp
  ).filter((entry) => entry && entry.status === 'paid');
  const northStar = summarizeWorkflowRuns(feedbackDir);
  const uniqueVisitors = telemetry.visitors.uniqueVisitors;
  const ctaClicks = telemetry.ctas.totalClicks;
  const checkoutStarts = telemetry.ctas.checkoutStarts || 0;
  const acquisitionLeads = billing.signups ? billing.signups.uniqueLeads || 0 : 0;
  const paidOrders = billing.revenue ? billing.revenue.paidOrders || 0 : 0;
  const checkoutStartEntries = telemetryEntries.filter((entry) => {
    const eventType = entry.eventType || entry.event;
    return eventType === 'checkout_start' || eventType === 'checkout_bootstrap';
  });
  const acquisitionEntries = funnelEntries.filter((entry) => entry && entry.stage === 'acquisition');
  const checkoutKeys = new Set(checkoutStartEntries.map(resolveJourneyKey).filter(Boolean));
  const acquisitionKeys = new Set(acquisitionEntries.map(resolveJourneyKey).filter(Boolean));
  const matchedAcquisitionKeys = new Set([...checkoutKeys].filter((key) => acquisitionKeys.has(key)));
  const matchedPaidOrders = paidOrderEntries.filter((entry) => {
    const key = resolveJourneyKey(entry);
    return key && checkoutKeys.has(key);
  }).length;
  const unmatchedCheckoutStarts = checkoutStartEntries.filter((entry) => {
    const key = resolveJourneyKey(entry);
    return !key || !acquisitionKeys.has(key);
  }).length;
  const paidWithoutAcquisition = paidOrderEntries.filter((entry) => {
    const key = resolveJourneyKey(entry);
    return !key || !acquisitionKeys.has(key);
  }).length;
  const stitchedJourneyEntries = [...checkoutStartEntries, ...acquisitionEntries, ...paidOrderEntries];

  return {
    window: telemetry.window || analyticsWindow,
    telemetry,
    funnel: {
      visitors: uniqueVisitors,
      sessions: telemetry.visitors ? telemetry.visitors.uniqueSessions || 0 : 0,
      pageViews: telemetry.visitors ? telemetry.visitors.pageViews || 0 : 0,
      ctaClicks,
      checkoutStarts,
      acquisitionLeads,
      paidOrders,
      visitorToLeadRate: safeRate(acquisitionLeads, uniqueVisitors),
      visitorToPaidRate: safeRate(paidOrders, uniqueVisitors),
      ctaToLeadRate: safeRate(acquisitionLeads, ctaClicks),
      ctaToPaidRate: safeRate(paidOrders, ctaClicks),
      topTrafficChannel: telemetry.visitors ? telemetry.visitors.topTrafficChannel || null : null,
      checkoutConversionByTrafficChannel: telemetry.ctas ? telemetry.ctas.conversionByTrafficChannel || {} : {},
    },
    buyerLoss: telemetry.buyerLoss || {
      totalSignals: 0,
      reasonsByCode: {},
      cancellationReasons: {},
      abandonmentReasons: {},
      topReason: null,
    },
    pricing: telemetry.pricing || {
      pricingInterestEvents: 0,
      interestByLevel: {},
    },
    seo: telemetry.seo || {
      landingViews: 0,
      bySurface: {},
      byQuery: {},
      topSurface: null,
      topQuery: null,
    },
    revenue: billing.revenue || {
      paidProviderEvents: 0,
      paidOrders: 0,
      bookedRevenueCents: 0,
      amountKnownOrders: 0,
      amountUnknownOrders: 0,
      amountKnownCoverageRate: 0,
    },
    attribution: billing.attribution || {
      acquisitionBySource: {},
      acquisitionByCampaign: {},
      paidBySource: {},
      paidByCampaign: {},
      bookedRevenueBySourceCents: {},
      bookedRevenueByCampaignCents: {},
      bookedRevenueByCtaId: {},
      bookedRevenueByLandingPath: {},
      bookedRevenueByReferrerHost: {},
      conversionBySource: {},
      conversionByCampaign: {},
    },
    pipeline: billing.pipeline || {
      workflowSprintLeads: { total: 0, bySource: {} },
      qualifiedWorkflowSprintLeads: { total: 0, bySource: {} },
    },
    northStar,
    trafficMetrics: billing.trafficMetrics || {
      visitors: 0,
      sessions: 0,
      pageViews: 0,
      ctaClicks: 0,
      checkoutStarts: 0,
      buyerLossFeedback: 0,
      seoLandingViews: 0,
    },
    operatorGeneratedAcquisition: billing.operatorGeneratedAcquisition || {
      totalEvents: 0,
      uniqueLeads: 0,
      bySource: {},
    },
    dataQuality: billing.dataQuality || {
      telemetryCoverage: 0,
      attributionCoverage: 0,
      amountKnownCoverage: 0,
      unreconciledPaidEvents: 0,
    },
    reconciliation: {
      telemetryCheckoutStarts: checkoutStarts,
      uniqueCheckoutStarters: telemetry.ctas.uniqueCheckoutStarters,
      matchedAcquisitions: matchedAcquisitionKeys.size,
      matchedPaidOrders,
      unmatchedCheckoutStarts,
      paidWithoutAcquisition,
      paidWithoutAmount: paidOrderEntries.filter((entry) => !entry.amountKnown).length,
    },
    identityCoverage: {
      visitorIdCoverage: telemetry.visitors.visitorIdCoverageRate,
      sessionIdCoverage: telemetry.visitors.sessionIdCoverageRate,
      acquisitionIdCoverage: countCoverage(
        stitchedJourneyEntries,
        (entry) => pickFirstText(entry.acquisitionId, entry.metadata && entry.metadata.acquisitionId)
      ),
      amountKnownCoverage: billing.revenue ? billing.revenue.amountKnownCoverageRate || 0 : 0,
    },
  };
}

function computeSecretGuardStats(diagnosticEntries) {
  const secretEntries = diagnosticEntries.filter((entry) => {
    if (entry.source === 'secret_guard') return true;
    const violations = entry.diagnosis && Array.isArray(entry.diagnosis.violations)
      ? entry.diagnosis.violations
      : [];
    return violations.some((violation) => String(violation.constraintId || '').startsWith('security:'));
  });

  const byConstraint = {};
  for (const entry of secretEntries) {
    const violations = entry.diagnosis && Array.isArray(entry.diagnosis.violations)
      ? entry.diagnosis.violations
      : [];
    for (const violation of violations) {
      const key = String(violation.constraintId || 'security:unknown');
      byConstraint[key] = (byConstraint[key] || 0) + 1;
    }
  }

  const topConstraint = Object.entries(byConstraint)
    .sort((a, b) => b[1] - a[1])[0] || null;

  return {
    blocked: secretEntries.length,
    topConstraint: topConstraint ? { key: topConstraint[0], count: topConstraint[1] } : null,
    recent: secretEntries
      .slice(-5)
      .reverse()
      .map((entry) => ({
        step: entry.step || null,
        source: entry.source || null,
        timestamp: entry.timestamp || null,
      })),
  };
}

function computeObservabilityStats(diagnosticEntries, diagnostics, secretGuard, telemetry = null) {
  const bySource = {};
  let latestEventAt = null;

  for (const entry of diagnosticEntries) {
    const key = String(entry.source || 'unknown');
    bySource[key] = (bySource[key] || 0) + 1;
    if (!latestEventAt || String(entry.timestamp || '') > latestEventAt) {
      latestEventAt = entry.timestamp || null;
    }
  }

  const topSource = Object.entries(bySource).sort((a, b) => b[1] - a[1])[0] || null;

  return {
    diagnosticEvents: diagnosticEntries.length,
    bySource,
    topSource: topSource ? { key: topSource[0], count: topSource[1] } : null,
    latestEventAt,
    topRootCause: diagnostics.categories[0] || null,
    secretGuardBlocks: secretGuard.blocked,
    telemetryIngestErrors: diagnosticEntries.filter((entry) => entry.source === 'telemetry_ingest').length,
    checkoutApiFailuresByCode: telemetry && telemetry.ctas ? telemetry.ctas.failuresByCode || {} : {},
    buyerLossSignals: telemetry && telemetry.buyerLoss ? telemetry.buyerLoss.totalSignals || 0 : 0,
    topBuyerLossReason: telemetry && telemetry.buyerLoss ? telemetry.buyerLoss.topReason || null : null,
    seoLandingViews: telemetry && telemetry.seo ? telemetry.seo.landingViews || 0 : 0,
  };
}

function computeInstrumentationReadiness(analytics, billing) {
  const landingPage = fs.existsSync(LANDING_PAGE_PATH)
    ? fs.readFileSync(LANDING_PAGE_PATH, 'utf-8')
    : '';
  const runtimeConfig = resolveHostedBillingConfig();
  const coverage = billing && billing.coverage ? billing.coverage : {};
  const telemetry = analytics.telemetry || {};
  const visitors = telemetry.visitors || {};
  const cli = telemetry.cli || {};

  return {
    plausibleConfigured: /plausible\.io\/js\/script\.js/.test(landingPage),
    ga4Configured: Boolean(runtimeConfig.gaMeasurementId),
    googleSearchConsoleConfigured: Boolean(runtimeConfig.googleSiteVerification),
    softwareApplicationSchemaPresent: /"@type": "SoftwareApplication"/.test(landingPage),
    faqSchemaPresent: /"@type": "FAQPage"/.test(landingPage),
    telemetryEventsPresent: (telemetry.totalEvents || 0) > 0,
    uniqueVisitorsTracked: visitors.uniqueVisitors || 0,
    cliInstallsTracked: cli.uniqueInstalls || 0,
    funnelEventsPresent: (analytics.reconciliation.telemetryCheckoutStarts || 0) > 0,
    seoSignalsPresent: (analytics.seo.landingViews || 0) > 0,
    buyerLossSignalsPresent: (analytics.buyerLoss.totalSignals || 0) > 0,
    trafficAttributionCoverage: visitors.attributionCoverageRate || 0,
    bookedRevenueTrackingEnabled: Boolean(coverage.tracksBookedRevenue),
    paidOrderTrackingEnabled: Boolean(coverage.tracksPaidOrders),
    invoiceTrackingEnabled: Boolean(coverage.tracksInvoices),
    attributionTrackingEnabled: Boolean(coverage.tracksAttribution),
  };
}

// ---------------------------------------------------------------------------
// Full dashboard data
// ---------------------------------------------------------------------------

function generateDashboard(feedbackDir, options = {}) {
  const analyticsWindow = resolveAnalyticsWindow(options.analyticsWindow || options);
  const feedbackLogPath = path.join(feedbackDir, 'feedback-log.jsonl');
  const diagnosticLogPath = path.join(feedbackDir, 'diagnostic-log.jsonl');
  const entries = readJSONL(feedbackLogPath);
  const diagnosticEntries = readJSONL(diagnosticLogPath);
  const billingSummary = options.billingSummary || getBillingSummary(analyticsWindow);

  const approval = computeApprovalStats(entries);
  const gateStats = computeGateStats();
  const prevention = computePreventionImpact(feedbackDir, gateStats);
  const trend = computeSessionTrend(entries, 10);
  const health = computeSystemHealth(feedbackDir, gateStats);
  const diagnostics = aggregateFailureDiagnostics([...entries, ...diagnosticEntries]);
  const secretGuard = computeSecretGuardStats(diagnosticEntries);
  const analytics = computeAnalyticsSummary(feedbackDir, {
    analyticsWindow,
    billingSummary,
  });
  const observability = computeObservabilityStats(diagnosticEntries, diagnostics, secretGuard, analytics.telemetry);
  const instrumentation = computeInstrumentationReadiness(analytics, billingSummary);
  const delegation = summarizeDelegation(feedbackDir);
  const readiness = generateAgentReadinessReport({ projectRoot: PROJECT_ROOT });

  return {
    operational: {
      source: options.billingSource || 'local',
      fallbackReason: options.billingFallbackReason || null,
      window: analytics.window || analyticsWindow,
    },
    approval,
    gateStats,
    prevention,
    trend,
    health,
    diagnostics,
    delegation,
    secretGuard,
    analytics,
    observability,
    instrumentation,
    readiness,
  };
}

// ---------------------------------------------------------------------------
// Rich CLI output
// ---------------------------------------------------------------------------

function printDashboard(data) {
  const {
    approval,
    gateStats,
    prevention,
    trend,
    health,
    diagnostics,
    delegation,
    secretGuard,
    analytics,
    observability,
    instrumentation,
    readiness,
  } = data;

  const trendArrow = approval.trendDirection === 'improving' ? '\u2191'
    : approval.trendDirection === 'declining' ? '\u2193'
    : '\u2192';

  console.log('');
  console.log('\uD83D\uDCCA RLHF Dashboard');
  console.log('\u2550'.repeat(46));
  console.log(`  Approval Rate    : ${approval.approvalRate}% \u2192 ${approval.recentRate}% (7-day trend ${trendArrow})`);
  console.log(`  Total Signals    : ${approval.total} (${approval.positive} positive, ${approval.negative} negative)`);

  console.log('');
  console.log('\uD83D\uDEE1\uFE0F  Gate Enforcement');
  console.log(`  Active Gates     : ${gateStats.totalGates} (${gateStats.manualCount} manual, ${gateStats.autoCount} auto-promoted)`);
  console.log(`  Actions Blocked  : ${gateStats.blocked}`);
  console.log(`  Actions Warned   : ${gateStats.warned}`);
  if (gateStats.topBlocked) {
    console.log(`  Top Blocked      : ${gateStats.topBlocked} (${gateStats.topBlockedCount}\u00D7)`);
  }

  console.log('');
  console.log('\u26A1 Prevention Impact');
  console.log(`  Estimated Saves  : ${prevention.estimatedHoursSaved} hours`);
  console.log(`  Rules Active     : ${prevention.ruleCount} prevention rules`);
  if (prevention.lastPromotion) {
    console.log(`  Last Promotion   : ${prevention.lastPromotion.id} (${prevention.lastPromotion.daysAgo} days ago)`);
  }

  console.log('');
  console.log('🎯 North Star');
  console.log(`  Weekly Proof Runs: ${analytics.northStar.weeklyActiveProofBackedWorkflowRuns}`);
  console.log(`  Weekly Teams     : ${analytics.northStar.weeklyTeamsRunningProofBackedWorkflows}`);
  console.log(`  Reviewed Runs    : ${analytics.northStar.reviewedRuns}`);
  console.log(`  Paid Team Runs   : ${analytics.northStar.paidTeamRuns}`);
  console.log(`  Named Pilots     : ${analytics.northStar.namedPilotAgreements}`);
  console.log(`  Status           : ${analytics.northStar.northStarReached ? 'tracking' : 'not_started'}`);
  console.log(`  Customer Proof   : ${analytics.northStar.customerProofReached ? 'present' : 'missing'}`);
  if (analytics.northStar.latestRun) {
    console.log(`  Latest Run       : ${analytics.northStar.latestRun.workflowId} @ ${analytics.northStar.latestRun.timestamp}`);
  }

  console.log('');
  console.log('\uD83E\uDD1D Delegation');
  console.log(`  Attempts         : ${delegation.attemptCount}`);
  console.log(`  Outcomes         : ${delegation.acceptedCount} accepted / ${delegation.rejectedCount} rejected / ${delegation.abortedCount} aborted`);
  console.log(`  Verification Fail: ${Math.round((delegation.verificationFailureRate || 0) * 100)}%`);
  console.log(`  Avoided Starts   : ${delegation.avoidedDelegationCount}`);

  console.log('');
  console.log('\uD83D\uDCBC Growth Analytics');
  console.log(`  Unique Visitors  : ${analytics.trafficMetrics.visitors}`);
  console.log(`  Sessions         : ${analytics.trafficMetrics.sessions}`);
  console.log(`  Page Views       : ${analytics.trafficMetrics.pageViews}`);
  console.log(`  CTA Clicks       : ${analytics.trafficMetrics.ctaClicks}`);
  console.log(`  Leads            : ${analytics.funnel.acquisitionLeads}`);
  console.log(`  Sprint Leads     : ${analytics.pipeline.workflowSprintLeads.total}`);
  console.log(`  Qualified Leads  : ${analytics.pipeline.qualifiedWorkflowSprintLeads.total}`);
  console.log(`  Paid Provider Ev.: ${analytics.revenue.paidProviderEvents}`);
  console.log(`  Paid Orders      : ${analytics.funnel.paidOrders}`);
  console.log(`  Visitor \u2192 Paid  : ${analytics.funnel.visitorToPaidRate}`);
  console.log(`  Booked Revenue   : $${(analytics.revenue.bookedRevenueCents / 100).toFixed(2)}`);
  console.log(`  Matched Journeys : ${analytics.reconciliation.matchedPaidOrders}/${analytics.reconciliation.telemetryCheckoutStarts}`);
  console.log(`  Buyer Loss       : ${analytics.buyerLoss.totalSignals}`);
  if (analytics.telemetry.visitors.topSource) {
    console.log(`  Top Source       : ${analytics.telemetry.visitors.topSource.key} (${analytics.telemetry.visitors.topSource.count}\u00D7)`);
  }
  if (analytics.funnel.topTrafficChannel) {
    console.log(`  Traffic Channel  : ${analytics.funnel.topTrafficChannel.key} (${analytics.funnel.topTrafficChannel.count}\u00D7)`);
  }
  if (analytics.buyerLoss.topReason) {
    console.log(`  Top Loss Reason  : ${analytics.buyerLoss.topReason.key} (${analytics.buyerLoss.topReason.count}\u00D7)`);
  }
  if (analytics.seo.topSurface) {
    console.log(`  SEO Surface      : ${analytics.seo.topSurface.key} (${analytics.seo.topSurface.count}\u00D7)`);
  }

  console.log('');
  console.log('\uD83D\uDCE1 Tracking Readiness');
  console.log(`  Plausible        : ${instrumentation.plausibleConfigured ? 'configured' : 'missing'}`);
  console.log(`  GA4              : ${instrumentation.ga4Configured ? 'configured' : 'missing'}`);
  console.log(`  Search Console   : ${instrumentation.googleSearchConsoleConfigured ? 'configured' : 'missing'}`);
  console.log(`  Telemetry Events : ${instrumentation.telemetryEventsPresent ? instrumentation.uniqueVisitorsTracked : 0} visitors`);
  console.log(`  SEO Signals      : ${instrumentation.seoSignalsPresent ? analytics.seo.landingViews : 0}`);
  console.log(`  Buyer Loss       : ${instrumentation.buyerLossSignalsPresent ? analytics.buyerLoss.totalSignals : 0}`);
  console.log(`  Attribution      : ${Math.round((instrumentation.trafficAttributionCoverage || 0) * 100)}% page-view coverage`);
  console.log(`  Revenue Tracking : ${instrumentation.bookedRevenueTrackingEnabled ? 'booked revenue enabled' : 'disabled'}`);
  console.log(`  Amount Coverage  : ${Math.round((analytics.dataQuality.amountKnownCoverage || 0) * 100)}%`);
  console.log(`  Unreconciled Paid: ${analytics.dataQuality.unreconciledPaidEvents}`);

  console.log('');
  console.log('🧭 Agent Readiness');
  console.log(`  Overall          : ${readiness.overallStatus}`);
  console.log(`  Runtime          : ${readiness.runtime.mode}`);
  console.log(`  Bootstrap        : ${readiness.bootstrap.requiredPresent}/${readiness.bootstrap.requiredCount} required files`);
  console.log(`  MCP Tier         : ${readiness.permissions.profile} (${readiness.permissions.tier})`);
  if (readiness.warnings[0]) {
    console.log(`  Top Warning      : ${readiness.warnings[0]}`);
  }

  console.log('');
  console.log('\uD83D\uDD10 Secret Guard');
  console.log(`  Blocks Recorded  : ${secretGuard.blocked}`);
  if (secretGuard.topConstraint) {
    console.log(`  Top Constraint   : ${secretGuard.topConstraint.key} (${secretGuard.topConstraint.count}\u00D7)`);
  }

  console.log('');
  console.log('\uD83D\uDCC8 Trend (last 10 sessions)');
  const trendLabel = approval.trendDirection === 'improving' ? 'improving'
    : approval.trendDirection === 'declining' ? 'declining'
    : 'stable';
  console.log(`  ${trend.bars} ${trend.percentage}% \u2192 ${trendLabel}`);

  console.log('');
  console.log('\uD83D\uDD27 System Health');
  console.log(`  Feedback Log     : ${health.feedbackCount} entries`);
  console.log(`  Memory Store     : ${health.memoryCount} memories`);
  console.log(`  Gate Config      : ${health.gateConfigLoaded ? 'loaded' : 'not found'} (${health.gateCount} gates)`);
  console.log(`  MCP Server       : running`);
  if (diagnostics.totalDiagnosed > 0) {
    console.log(`  Failure Diagnoses: ${diagnostics.totalDiagnosed}`);
    if (diagnostics.categories[0]) {
      console.log(`  Top Root Cause   : ${diagnostics.categories[0].key} (${diagnostics.categories[0].count}\u00D7)`);
    }
  }

  console.log('');
  console.log('\uD83D\uDCE1 Observability');
  console.log(`  Diagnostic Events: ${observability.diagnosticEvents}`);
  console.log(`  Secret Blocks    : ${observability.secretGuardBlocks}`);
  console.log(`  Telemetry Errors : ${observability.telemetryIngestErrors}`);
  console.log(`  Buyer Loss       : ${observability.buyerLossSignals}`);
  console.log(`  SEO Views        : ${observability.seoLandingViews}`);
  if (observability.topSource) {
    console.log(`  Top Source       : ${observability.topSource.key} (${observability.topSource.count}\u00D7)`);
  }
  if (observability.topBuyerLossReason) {
    console.log(`  Top Loss Reason  : ${observability.topBuyerLossReason.key} (${observability.topBuyerLossReason.count}\u00D7)`);
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Exports + CLI
// ---------------------------------------------------------------------------

module.exports = {
  generateDashboard,
  printDashboard,
  computeApprovalStats,
  computeGateStats,
  computePreventionImpact,
  computeSessionTrend,
  computeSystemHealth,
  computeAnalyticsSummary,
  computeSecretGuardStats,
  computeObservabilityStats,
  readJSONL,
  readJsonFile,
};

if (require.main === module) {
  const { getFeedbackPaths } = require('./feedback-loop');
  const { FEEDBACK_DIR } = getFeedbackPaths();
  const data = generateDashboard(FEEDBACK_DIR);
  printDashboard(data);
}
