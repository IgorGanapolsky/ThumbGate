'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildBenchmarks,
  buildPredictiveInsights,
  detectPredictiveAnomalies,
  scoreDimensionForecasts,
  scoreUpgradePropensity,
} = require('../scripts/predictive-insights');

function createTelemetry() {
  return {
    visitors: {
      uniqueVisitors: 120,
      attributionCoverageRate: 0.82,
    },
    ctas: {
      checkoutStarts: 12,
    },
    buyerLoss: {
      totalSignals: 4,
      reasonsByCode: {
        too_expensive: 3,
      },
    },
    pricing: {
      pricingInterestEvents: 9,
    },
  };
}

function createBilling() {
  return {
    signups: {
      uniqueLeads: 8,
    },
    revenue: {
      paidCustomers: 3,
      bookedRevenueCents: 5700,
    },
    keys: {
      active: 4,
      totalUsage: 180,
    },
    pipeline: {
      workflowSprintLeads: {
        total: 4,
      },
      qualifiedWorkflowSprintLeads: {
        total: 2,
      },
    },
    dataQuality: {
      unreconciledPaidEvents: 0,
    },
  };
}

function createStaging() {
  return {
    dims: {
      creators: [
        {
          key: 'reach_vb',
          pageViews: 40,
          checkoutStarts: 5,
          acquisitionLeads: 3,
          paidCustomers: 1,
          bookedRevenueCents: 1900,
          workflowSprintLeads: 2,
          qualifiedWorkflowSprintLeads: 1,
        },
        {
          key: 'agentbuilder',
          pageViews: 24,
          checkoutStarts: 4,
          acquisitionLeads: 2,
          paidCustomers: 0,
          bookedRevenueCents: 0,
          workflowSprintLeads: 1,
          qualifiedWorkflowSprintLeads: 1,
        },
      ],
      sources: [
        {
          key: 'producthunt',
          pageViews: 50,
          checkoutStarts: 6,
          acquisitionLeads: 4,
          paidCustomers: 1,
          bookedRevenueCents: 1900,
        },
        {
          key: 'creator',
          pageViews: 30,
          checkoutStarts: 5,
          acquisitionLeads: 3,
          paidCustomers: 0,
          bookedRevenueCents: 0,
        },
      ],
    },
  };
}

test('buildBenchmarks derives core funnel and revenue priors', () => {
  const benchmarks = buildBenchmarks({
    telemetryAnalytics: createTelemetry(),
    billingSummary: createBilling(),
    stagingModel: createStaging(),
  });

  assert.equal(benchmarks.revenuePerPaidCents, 1900);
  assert.equal(benchmarks.creatorCount, 2);
  assert.equal(benchmarks.qualifiedCreatorCount, 2);
  assert.equal(benchmarks.checkoutToPaidRate, 0.25);
});

test('scoreUpgradePropensity emits pro and team scores with ranked drivers', () => {
  const insights = scoreUpgradePropensity({
    telemetryAnalytics: createTelemetry(),
    billingSummary: createBilling(),
    stagingModel: createStaging(),
    gateStats: { blocked: 11 },
    team: { activeAgents: 4 },
  });

  assert.equal(insights.pro.band, 'very_high');
  assert.equal(insights.team.band, 'high');
  assert.ok(insights.pro.score > 0.6);
  assert.ok(insights.team.score > 0.5);
  assert.equal(insights.pro.drivers.length, 3);
  assert.equal(insights.team.drivers.length, 3);
});

test('scoreDimensionForecasts ranks dimensions by opportunity revenue', () => {
  const forecasts = scoreDimensionForecasts(
    createStaging().dims.creators,
    buildBenchmarks({
      telemetryAnalytics: createTelemetry(),
      billingSummary: createBilling(),
      stagingModel: createStaging(),
    })
  );

  assert.equal(forecasts[0].key, 'agentbuilder');
  assert.ok(forecasts[0].opportunityRevenueCents >= forecasts[1].opportunityRevenueCents);
  assert.equal(forecasts[0].band, 'high');
});

test('detectPredictiveAnomalies flags channel underperformance and pricing resistance', () => {
  const creatorForecasts = scoreDimensionForecasts(
    createStaging().dims.creators,
    buildBenchmarks({
      telemetryAnalytics: createTelemetry(),
      billingSummary: createBilling(),
      stagingModel: createStaging(),
    })
  );
  const sourceForecasts = scoreDimensionForecasts(
    createStaging().dims.sources,
    buildBenchmarks({
      telemetryAnalytics: createTelemetry(),
      billingSummary: createBilling(),
      stagingModel: createStaging(),
    })
  );
  const anomalies = detectPredictiveAnomalies({
    telemetryAnalytics: createTelemetry(),
    billingSummary: createBilling(),
    creatorForecasts,
    sourceForecasts,
  });

  assert.ok(anomalies.some((entry) => entry.type === 'pricing_resistance'));
  assert.equal(anomalies.length, 1);
});

test('buildPredictiveInsights returns aggregate forecast, top opportunities, and anomaly summary', () => {
  const insights = buildPredictiveInsights({
    telemetryAnalytics: createTelemetry(),
    billingSummary: createBilling(),
    stagingModel: createStaging(),
    gateStats: { blocked: 11 },
    team: { activeAgents: 4 },
  });

  assert.equal(insights.modelVersion, 'predictive-insights-v1');
  assert.ok(insights.revenueForecast.predictedBookedRevenueCents >= 5700);
  assert.ok(insights.topCreators.length > 0);
  assert.ok(insights.topSources.length > 0);
  assert.equal(insights.anomalySummary.count, insights.anomalies.length);
});
