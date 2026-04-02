#!/usr/bin/env node
'use strict';

function toNumber(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function safeRate(numerator, denominator, precision = 4) {
  if (!denominator) return 0;
  return Number((toNumber(numerator) / toNumber(denominator)).toFixed(precision));
}

function clamp01(value) {
  return Math.max(0, Math.min(1, toNumber(value)));
}

function normalizeCapped(value, cap) {
  const capped = toNumber(cap);
  if (!capped || capped <= 0) return 0;
  return clamp01(toNumber(value) / capped);
}

function sumCounter(counter = {}) {
  return Object.values(counter).reduce((sum, value) => sum + toNumber(value), 0);
}

function summarizeSeverity(anomalies = []) {
  if (anomalies.some((entry) => entry.severity === 'critical')) return 'critical';
  if (anomalies.some((entry) => entry.severity === 'warning')) return 'warning';
  return 'healthy';
}

function toBand(score) {
  if (score >= 0.8) return 'very_high';
  if (score >= 0.6) return 'high';
  if (score >= 0.4) return 'medium';
  if (score >= 0.2) return 'low';
  return 'very_low';
}

function weightedAverage(entries = []) {
  const active = entries.filter((entry) => entry && Number.isFinite(entry.value) && entry.weight > 0);
  const totalWeight = active.reduce((sum, entry) => sum + entry.weight, 0);
  if (!totalWeight) return 0;
  return active.reduce((sum, entry) => sum + (entry.value * entry.weight), 0) / totalWeight;
}

function smoothedRate(successes, trials, priorRate = 0, priorWeight = 8) {
  const trialCount = Math.max(0, toNumber(trials));
  const successCount = Math.max(0, toNumber(successes));
  const boundedPrior = clamp01(priorRate);
  return safeRate(successCount + (boundedPrior * priorWeight), trialCount + priorWeight, 6);
}

function countQualifiedCreators(rows = []) {
  return rows.filter((row) => {
    return toNumber(row.workflowSprintLeads) > 0
      || toNumber(row.qualifiedWorkflowSprintLeads) > 0
      || toNumber(row.bookedRevenueCents) > 0
      || toNumber(row.checkoutStarts) > 0;
  }).length;
}

function buildBenchmarks({ telemetryAnalytics = {}, billingSummary = {}, stagingModel = {} } = {}) {
  const uniqueVisitors = toNumber(telemetryAnalytics.visitors && telemetryAnalytics.visitors.uniqueVisitors);
  const checkoutStarts = toNumber(telemetryAnalytics.ctas && telemetryAnalytics.ctas.checkoutStarts);
  const acquisitionLeads = toNumber(billingSummary.signups && billingSummary.signups.uniqueLeads);
  const paidCustomers = toNumber(billingSummary.revenue && billingSummary.revenue.paidCustomers);
  const bookedRevenueCents = toNumber(billingSummary.revenue && billingSummary.revenue.bookedRevenueCents);
  const revenuePerPaidCents = paidCustomers > 0
    ? Math.max(1, Math.round(bookedRevenueCents / paidCustomers))
    : 1900;
  const creatorRows = Array.isArray(stagingModel.dims && stagingModel.dims.creators)
    ? stagingModel.dims.creators
    : [];

  return {
    uniqueVisitors,
    checkoutStarts,
    acquisitionLeads,
    paidCustomers,
    bookedRevenueCents,
    revenuePerPaidCents,
    visitorToCheckoutRate: safeRate(checkoutStarts, uniqueVisitors, 6),
    visitorToLeadRate: safeRate(acquisitionLeads, uniqueVisitors, 6),
    visitorToPaidRate: safeRate(paidCustomers, uniqueVisitors, 6),
    checkoutToLeadRate: safeRate(acquisitionLeads, checkoutStarts, 6),
    checkoutToPaidRate: safeRate(paidCustomers, checkoutStarts, 6),
    leadToPaidRate: safeRate(paidCustomers, acquisitionLeads, 6),
    creatorCount: creatorRows.length,
    qualifiedCreatorCount: countQualifiedCreators(creatorRows),
  };
}

function buildOpportunityForecast(row, benchmarks, labelKey) {
  const pageViews = toNumber(row.pageViews);
  const checkoutStarts = toNumber(row.checkoutStarts);
  const acquisitionLeads = toNumber(row.acquisitionLeads);
  const paidCustomers = toNumber(row.paidCustomers);
  const bookedRevenueCents = toNumber(row.bookedRevenueCents);
  const workflowSprintLeads = toNumber(row.workflowSprintLeads);
  const qualifiedWorkflowSprintLeads = toNumber(row.qualifiedWorkflowSprintLeads);

  const visitorToPaid = smoothedRate(
    paidCustomers,
    pageViews,
    benchmarks.visitorToPaidRate,
    12
  );
  const checkoutToPaid = smoothedRate(
    paidCustomers,
    checkoutStarts,
    benchmarks.checkoutToPaidRate,
    8
  );
  const leadToPaid = smoothedRate(
    paidCustomers,
    acquisitionLeads,
    benchmarks.leadToPaidRate,
    6
  );

  const predictedPaidCustomers = Math.max(
    paidCustomers,
    weightedAverage([
      { value: pageViews * visitorToPaid, weight: pageViews > 0 ? 0.2 : 0 },
      { value: checkoutStarts * checkoutToPaid, weight: checkoutStarts > 0 ? 0.45 : 0 },
      { value: acquisitionLeads * leadToPaid, weight: acquisitionLeads > 0 ? 0.35 : 0 },
    ])
  );
  const predictedBookedRevenueCents = Math.round(predictedPaidCustomers * benchmarks.revenuePerPaidCents);
  const opportunityRevenueCents = Math.max(0, predictedBookedRevenueCents - bookedRevenueCents);
  const sampleVolume = pageViews + checkoutStarts + (acquisitionLeads * 2) + (workflowSprintLeads * 3);
  const confidence = clamp01(Math.log1p(sampleVolume) / Math.log1p(40));
  const momentumScore = clamp01(weightedAverage([
    { value: normalizeCapped(pageViews, 50), weight: 0.2 },
    { value: normalizeCapped(checkoutStarts, 12), weight: 0.35 },
    { value: normalizeCapped(acquisitionLeads, 6), weight: 0.25 },
    { value: normalizeCapped(qualifiedWorkflowSprintLeads, 3), weight: 0.2 },
  ]));

  return {
    key: row.key || 'unknown',
    label: row[labelKey] || row.key || 'unknown',
    pageViews,
    checkoutStarts,
    acquisitionLeads,
    paidCustomers,
    bookedRevenueCents,
    workflowSprintLeads,
    qualifiedWorkflowSprintLeads,
    predictedPaidCustomers: Number(predictedPaidCustomers.toFixed(2)),
    predictedBookedRevenueCents,
    opportunityRevenueCents,
    confidence: Number(confidence.toFixed(4)),
    momentumScore: Number(momentumScore.toFixed(4)),
    band: toBand(clamp01((confidence * 0.45) + (momentumScore * 0.55))),
  };
}

function scoreDimensionForecasts(rows = [], benchmarks = {}, labelKey = 'key') {
  return rows
    .map((row) => buildOpportunityForecast(row, benchmarks, labelKey))
    .filter((row) => row.pageViews > 0 || row.checkoutStarts > 0 || row.acquisitionLeads > 0 || row.bookedRevenueCents > 0)
    .sort((left, right) => {
      if (right.opportunityRevenueCents !== left.opportunityRevenueCents) {
        return right.opportunityRevenueCents - left.opportunityRevenueCents;
      }
      if (right.predictedBookedRevenueCents !== left.predictedBookedRevenueCents) {
        return right.predictedBookedRevenueCents - left.predictedBookedRevenueCents;
      }
      return String(left.key).localeCompare(String(right.key));
    });
}

function summarizeDrivers(drivers = []) {
  return drivers
    .sort((left, right) => right.impact - left.impact)
    .filter((driver) => driver.impact > 0)
    .slice(0, 3)
    .map((driver) => ({
      key: driver.key,
      label: driver.label,
      impact: Number(driver.impact.toFixed(4)),
      rawValue: driver.rawValue,
    }));
}

function scoreUpgradePropensity({ telemetryAnalytics = {}, billingSummary = {}, stagingModel = {}, gateStats = {}, team = {} } = {}) {
  const benchmarks = buildBenchmarks({ telemetryAnalytics, billingSummary, stagingModel });
  const pricingSignals = toNumber(telemetryAnalytics.pricing && telemetryAnalytics.pricing.pricingInterestEvents);
  const tooExpensiveSignals = toNumber(telemetryAnalytics.buyerLoss && telemetryAnalytics.buyerLoss.reasonsByCode && telemetryAnalytics.buyerLoss.reasonsByCode.too_expensive);
  const workflowSprintLeads = toNumber(billingSummary.pipeline && billingSummary.pipeline.workflowSprintLeads && billingSummary.pipeline.workflowSprintLeads.total);
  const qualifiedWorkflowSprintLeads = toNumber(billingSummary.pipeline && billingSummary.pipeline.qualifiedWorkflowSprintLeads && billingSummary.pipeline.qualifiedWorkflowSprintLeads.total);
  const activeProKeys = toNumber(billingSummary.keys && billingSummary.keys.active);
  const totalUsage = toNumber(billingSummary.keys && billingSummary.keys.totalUsage);
  const blockedActions = toNumber(gateStats.blocked);
  const activeAgents = toNumber(team.activeAgents);

  const proDrivers = [
    { key: 'checkoutStarts', label: 'checkout starts', impact: normalizeCapped(benchmarks.checkoutStarts, 12) * 0.28, rawValue: benchmarks.checkoutStarts },
    { key: 'acquisitionLeads', label: 'captured leads', impact: normalizeCapped(benchmarks.acquisitionLeads, 6) * 0.2, rawValue: benchmarks.acquisitionLeads },
    { key: 'visitorToCheckoutRate', label: 'visitor → checkout rate', impact: normalizeCapped(benchmarks.visitorToCheckoutRate, 0.08) * 0.18, rawValue: benchmarks.visitorToCheckoutRate },
    { key: 'pricingInterest', label: 'pricing intent', impact: normalizeCapped(pricingSignals, 8) * 0.14, rawValue: pricingSignals },
    { key: 'totalUsage', label: 'usage depth', impact: normalizeCapped(totalUsage, 300) * 0.12, rawValue: totalUsage },
    { key: 'blockedActions', label: 'blocked mistakes', impact: normalizeCapped(blockedActions, 30) * 0.08, rawValue: blockedActions },
  ];
  const proPenalty = normalizeCapped(tooExpensiveSignals, 6) * 0.12;
  const proScore = clamp01(proDrivers.reduce((sum, driver) => sum + driver.impact, 0) - proPenalty);

  const teamDrivers = [
    { key: 'qualifiedWorkflowSprintLeads', label: 'qualified workflow sprint leads', impact: normalizeCapped(qualifiedWorkflowSprintLeads, 3) * 0.3, rawValue: qualifiedWorkflowSprintLeads },
    { key: 'workflowSprintLeads', label: 'workflow sprint leads', impact: normalizeCapped(workflowSprintLeads, 5) * 0.22, rawValue: workflowSprintLeads },
    { key: 'activeProKeys', label: 'active Pro keys', impact: normalizeCapped(activeProKeys, 5) * 0.16, rawValue: activeProKeys },
    { key: 'qualifiedCreators', label: 'qualified creators/channels', impact: normalizeCapped(benchmarks.qualifiedCreatorCount, 4) * 0.12, rawValue: benchmarks.qualifiedCreatorCount },
    { key: 'activeAgents', label: 'active agents', impact: normalizeCapped(activeAgents, 6) * 0.12, rawValue: activeAgents },
    { key: 'leadToPaidRate', label: 'lead → paid rate', impact: normalizeCapped(benchmarks.leadToPaidRate, 0.5) * 0.08, rawValue: benchmarks.leadToPaidRate },
  ];
  const teamScore = clamp01(teamDrivers.reduce((sum, driver) => sum + driver.impact, 0));

  return {
    pro: {
      score: Number(proScore.toFixed(4)),
      band: toBand(proScore),
      confidence: Number(clamp01(Math.log1p(benchmarks.uniqueVisitors + benchmarks.checkoutStarts + pricingSignals) / Math.log1p(80)).toFixed(4)),
      drivers: summarizeDrivers(proDrivers),
      pricingResistanceSignals: tooExpensiveSignals,
    },
    team: {
      score: Number(teamScore.toFixed(4)),
      band: toBand(teamScore),
      confidence: Number(clamp01(Math.log1p(workflowSprintLeads + qualifiedWorkflowSprintLeads + activeProKeys + activeAgents) / Math.log1p(24)).toFixed(4)),
      drivers: summarizeDrivers(teamDrivers),
    },
  };
}

function detectPredictiveAnomalies({ telemetryAnalytics = {}, billingSummary = {}, creatorForecasts = [], sourceForecasts = [] } = {}) {
  const anomalies = [];
  const uniqueVisitors = toNumber(telemetryAnalytics.visitors && telemetryAnalytics.visitors.uniqueVisitors);
  const checkoutStarts = toNumber(telemetryAnalytics.ctas && telemetryAnalytics.ctas.checkoutStarts);
  const paidCustomers = toNumber(billingSummary.revenue && billingSummary.revenue.paidCustomers);
  const attributionCoverageRate = toNumber(telemetryAnalytics.visitors && telemetryAnalytics.visitors.attributionCoverageRate);
  const unreconciledPaidEvents = toNumber(billingSummary.dataQuality && billingSummary.dataQuality.unreconciledPaidEvents);
  const tooExpensiveSignals = toNumber(telemetryAnalytics.buyerLoss && telemetryAnalytics.buyerLoss.reasonsByCode && telemetryAnalytics.buyerLoss.reasonsByCode.too_expensive);
  const buyerLossSignals = toNumber(telemetryAnalytics.buyerLoss && telemetryAnalytics.buyerLoss.totalSignals);

  if (checkoutStarts >= 3 && paidCustomers === 0) {
    anomalies.push({
      type: 'conversion_stall',
      severity: checkoutStarts >= 8 ? 'critical' : 'warning',
      message: 'Checkout starts are arriving without paid conversions.',
      evidence: `checkoutStarts=${checkoutStarts}, paidCustomers=${paidCustomers}`,
    });
  }

  if (uniqueVisitors >= 10 && attributionCoverageRate < 0.6) {
    anomalies.push({
      type: 'attribution_blindspot',
      severity: attributionCoverageRate < 0.35 ? 'critical' : 'warning',
      message: 'Attribution coverage is too low for reliable predictive routing.',
      evidence: `uniqueVisitors=${uniqueVisitors}, attributionCoverageRate=${attributionCoverageRate}`,
    });
  }

  if (unreconciledPaidEvents > 0) {
    anomalies.push({
      type: 'billing_reconciliation',
      severity: unreconciledPaidEvents >= 3 ? 'critical' : 'warning',
      message: 'Paid events are waiting on reconciliation, which weakens revenue forecasts.',
      evidence: `unreconciledPaidEvents=${unreconciledPaidEvents}`,
    });
  }

  if (buyerLossSignals >= 3 && safeRate(tooExpensiveSignals, buyerLossSignals, 4) >= 0.5) {
    anomalies.push({
      type: 'pricing_resistance',
      severity: 'warning',
      message: 'Price sensitivity dominates current loss reasons.',
      evidence: `tooExpensiveSignals=${tooExpensiveSignals}, buyerLossSignals=${buyerLossSignals}`,
    });
  }

  const underperformingCreator = creatorForecasts.find((row) => row.checkoutStarts >= 2 && row.bookedRevenueCents === 0 && row.opportunityRevenueCents >= 1500);
  if (underperformingCreator) {
    anomalies.push({
      type: 'creator_underperformance',
      severity: 'warning',
      message: `Creator ${underperformingCreator.key} is generating intent without revenue conversion.`,
      evidence: `checkouts=${underperformingCreator.checkoutStarts}, opportunityRevenueCents=${underperformingCreator.opportunityRevenueCents}`,
    });
  }

  const underperformingSource = sourceForecasts.find((row) => row.checkoutStarts >= 3 && row.bookedRevenueCents === 0 && row.opportunityRevenueCents >= 1900);
  if (underperformingSource) {
    anomalies.push({
      type: 'channel_underperformance',
      severity: 'warning',
      message: `Channel ${underperformingSource.key} is leaking revenue between checkout and paid.`,
      evidence: `checkouts=${underperformingSource.checkoutStarts}, opportunityRevenueCents=${underperformingSource.opportunityRevenueCents}`,
    });
  }

  return anomalies;
}

function buildPredictiveInsights({ telemetryAnalytics = {}, billingSummary = {}, stagingModel = {}, gateStats = {}, team = {} } = {}) {
  const benchmarks = buildBenchmarks({ telemetryAnalytics, billingSummary, stagingModel });
  const creators = scoreDimensionForecasts(stagingModel.dims && stagingModel.dims.creators ? stagingModel.dims.creators : [], benchmarks);
  const sources = scoreDimensionForecasts(stagingModel.dims && stagingModel.dims.sources ? stagingModel.dims.sources : [], benchmarks);
  const upgradePropensity = scoreUpgradePropensity({ telemetryAnalytics, billingSummary, stagingModel, gateStats, team });
  const anomalies = detectPredictiveAnomalies({
    telemetryAnalytics,
    billingSummary,
    creatorForecasts: creators,
    sourceForecasts: sources,
  });

  const aggregatePredictedBookedRevenueCents = Math.max(
    benchmarks.bookedRevenueCents,
    Math.round(weightedAverage([
      { value: benchmarks.uniqueVisitors * smoothedRate(benchmarks.paidCustomers, benchmarks.uniqueVisitors, benchmarks.visitorToPaidRate, 12) * benchmarks.revenuePerPaidCents, weight: benchmarks.uniqueVisitors > 0 ? 0.2 : 0 },
      { value: benchmarks.checkoutStarts * smoothedRate(benchmarks.paidCustomers, benchmarks.checkoutStarts, benchmarks.checkoutToPaidRate, 8) * benchmarks.revenuePerPaidCents, weight: benchmarks.checkoutStarts > 0 ? 0.45 : 0 },
      { value: benchmarks.acquisitionLeads * smoothedRate(benchmarks.paidCustomers, benchmarks.acquisitionLeads, benchmarks.leadToPaidRate, 6) * benchmarks.revenuePerPaidCents, weight: benchmarks.acquisitionLeads > 0 ? 0.35 : 0 },
    ]))
  );

  return {
    generatedAt: new Date().toISOString(),
    modelVersion: 'predictive-insights-v1',
    benchmarks,
    upgradePropensity,
    revenueForecast: {
      predictedBookedRevenueCents: aggregatePredictedBookedRevenueCents,
      incrementalOpportunityCents: Math.max(0, aggregatePredictedBookedRevenueCents - benchmarks.bookedRevenueCents),
      confidence: Number(clamp01((upgradePropensity.pro.confidence + upgradePropensity.team.confidence) / 2).toFixed(4)),
      band: toBand(clamp01((upgradePropensity.pro.score * 0.55) + (upgradePropensity.team.score * 0.45))),
    },
    topCreators: creators.slice(0, 5),
    topSources: sources.slice(0, 5),
    anomalies,
    anomalySummary: {
      count: anomalies.length,
      severity: summarizeSeverity(anomalies),
    },
  };
}

module.exports = {
  buildBenchmarks,
  buildPredictiveInsights,
  detectPredictiveAnomalies,
  scoreDimensionForecasts,
  scoreUpgradePropensity,
};
