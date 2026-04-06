#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function resolveProofPaths() {
  const proofDir = process.env.THUMBGATE_PROOF_DIR || path.join(ROOT, 'proof');
  return {
    proofDir,
    reportJson: path.join(proofDir, 'predictive-insights-report.json'),
    reportMd: path.join(proofDir, 'predictive-insights-report.md'),
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
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
    latestSeenAt: '2026-03-30T12:00:00.000Z',
    visitors: {
      uniqueVisitors: 18,
      attributionCoverageRate: 1,
      byCreator: { reach_vb: 10, buildwithai: 8 },
      bySource: { producthunt: 11, youtube: 7 },
      byTrafficChannel: { producthunt: 11, youtube: 7 },
    },
    ctas: {
      checkoutStarts: 4,
      byCreator: { reach_vb: 3, buildwithai: 1 },
      bySource: { producthunt: 3, youtube: 1 },
      byTrafficChannel: { producthunt: 3, youtube: 1 },
      checkoutStartsByCreator: { reach_vb: 3, buildwithai: 1 },
      checkoutStartsBySource: { producthunt: 3, youtube: 1 },
      checkoutStartsByTrafficChannel: { producthunt: 3, youtube: 1 },
    },
    buyerLoss: {
      totalSignals: 2,
      reasonsByCode: { too_expensive: 1 },
    },
    pricing: {
      pricingInterestEvents: 5,
    },
  };
}

function buildStubBilling() {
  return {
    signups: {
      uniqueLeads: 2,
    },
    revenue: {
      paidCustomers: 1,
      bookedRevenueCents: 1900,
    },
    pipeline: {
      workflowSprintLeads: { total: 2, byCreator: { reach_vb: 1, buildwithai: 1 } },
      qualifiedWorkflowSprintLeads: { total: 1, byCreator: { reach_vb: 1 } },
    },
    attribution: {
      acquisitionByCreator: { reach_vb: 1, buildwithai: 1 },
      acquisitionBySource: { producthunt: 1, youtube: 1 },
      paidByCreator: { reach_vb: 1 },
      paidBySource: { producthunt: 1 },
      bookedRevenueByCreatorCents: { reach_vb: 1900 },
      bookedRevenueBySourceCents: { producthunt: 1900 },
    },
    dataQuality: {
      unreconciledPaidEvents: 0,
    },
    keys: {
      active: 2,
      totalUsage: 180,
    },
  };
}

function buildStubStaging() {
  return {
    sourceHashes: {
      telemetry: 'predictive-proof-telemetry',
      billing: 'predictive-proof-billing',
    },
    dims: {
      creators: [
        {
          key: 'reach_vb',
          pageViews: 10,
          checkoutStarts: 3,
          acquisitionLeads: 1,
          paidCustomers: 1,
          bookedRevenueCents: 1900,
          workflowSprintLeads: 1,
          qualifiedWorkflowSprintLeads: 1,
        },
        {
          key: 'buildwithai',
          pageViews: 8,
          checkoutStarts: 1,
          acquisitionLeads: 1,
          paidCustomers: 0,
          bookedRevenueCents: 0,
          workflowSprintLeads: 1,
          qualifiedWorkflowSprintLeads: 0,
        },
      ],
      sources: [
        {
          key: 'producthunt',
          pageViews: 11,
          checkoutStarts: 3,
          acquisitionLeads: 1,
          paidCustomers: 1,
          bookedRevenueCents: 1900,
        },
        {
          key: 'youtube',
          pageViews: 7,
          checkoutStarts: 1,
          acquisitionLeads: 1,
          paidCustomers: 0,
          bookedRevenueCents: 0,
        },
      ],
    },
    facts: {
      funnel: [{ key: 'predictive-proof-funnel' }],
      revenue: [{ key: 'predictive-proof-revenue' }],
      quality: [{ key: 'predictive-proof-quality' }],
    },
    reconciliation: {
      status: 'healthy',
      warningCount: 0,
      warnings: [],
    },
  };
}

async function run() {
  const { proofDir, reportJson, reportMd } = resolveProofPaths();
  const {
    buildBenchmarks,
    buildPredictiveInsights,
    detectPredictiveAnomalies,
    scoreDimensionForecasts,
    scoreUpgradePropensity,
  } = require('./predictive-insights');
  const { formatReport } = require('./analytics-report');
  const { buildSemanticSnapshot } = require('./agentic-data-pipeline');
  const { buildVerifyPlan, recordVerifyWorkflowRun } = require('./verify-run');

  const telemetryAnalytics = buildStubTelemetry();
  const billingSummary = buildStubBilling();
  const stagingModel = buildStubStaging();
  const gateStats = { blocked: 12 };
  const team = { activeAgents: 4 };
  const results = { passed: 0, failed: 0, requirements: {} };

  const checks = [
    {
      id: 'PREDICT-01',
      desc: 'benchmarks derive funnel priors from telemetry, billing, and staged dimensions',
      fn: () => {
        const benchmarks = buildBenchmarks({ telemetryAnalytics, billingSummary, stagingModel });
        if (benchmarks.uniqueVisitors !== 18 || benchmarks.checkoutStarts !== 4) {
          throw new Error('Expected funnel priors for visitors and checkout starts');
        }
        if (benchmarks.revenuePerPaidCents !== 1900) {
          throw new Error('Expected revenue per paid customer prior');
        }
      },
    },
    {
      id: 'PREDICT-02',
      desc: 'upgrade propensity scores surface ranked Pro and Team drivers',
      fn: () => {
        const propensity = scoreUpgradePropensity({
          telemetryAnalytics,
          billingSummary,
          stagingModel,
          gateStats,
          team,
        });
        if (propensity.pro.band === 'very_low') {
          throw new Error('Expected non-trivial Pro propensity');
        }
        if (!propensity.team.drivers.length) {
          throw new Error('Expected ranked Team drivers');
        }
      },
    },
    {
      id: 'PREDICT-03',
      desc: 'dimension forecasts rank creator and source revenue opportunities',
      fn: () => {
        const benchmarks = buildBenchmarks({ telemetryAnalytics, billingSummary, stagingModel });
        const creatorForecasts = scoreDimensionForecasts(stagingModel.dims.creators, benchmarks, 'key');
        if (creatorForecasts[0].key !== 'buildwithai') {
          throw new Error('Expected creator opportunity ranking to favor under-monetized creator');
        }
        if (creatorForecasts[0].opportunityRevenueCents <= 0) {
          throw new Error('Expected incremental creator opportunity');
        }
      },
    },
    {
      id: 'PREDICT-04',
      desc: 'anomaly detection flags pricing resistance and channel underperformance',
      fn: () => {
        const benchmarks = buildBenchmarks({ telemetryAnalytics, billingSummary, stagingModel });
        const anomalies = detectPredictiveAnomalies({
          telemetryAnalytics: {
            ...telemetryAnalytics,
            buyerLoss: { totalSignals: 3, reasonsByCode: { too_expensive: 2 } },
          },
          billingSummary,
          creatorForecasts: scoreDimensionForecasts(stagingModel.dims.creators, benchmarks, 'key'),
          sourceForecasts: scoreDimensionForecasts(stagingModel.dims.sources, benchmarks, 'key'),
        });
        if (!anomalies.some((entry) => entry.type === 'pricing_resistance')) {
          throw new Error('Expected pricing resistance anomaly');
        }
      },
    },
    {
      id: 'PREDICT-05',
      desc: 'dashboard, report, and semantic snapshot expose predictive insights without manual joins',
      fn: () => {
        const predictive = buildPredictiveInsights({
          telemetryAnalytics,
          billingSummary,
          stagingModel,
          gateStats,
          team,
        });
        const report = formatReport(
          { downloads: [{ day: '2026-03-24', downloads: 42 }] },
          { downloads: 42 },
          { stargazers_count: 5, forks_count: 1, open_issues_count: 0, subscribers_count: 1 },
          { time: { created: '2026-03-01T00:00:00.000Z', modified: '2026-03-24T00:00:00.000Z' } },
          telemetryAnalytics,
          billingSummary,
        );
        const semanticSnapshot = buildSemanticSnapshot({
          window: telemetryAnalytics.window,
          snapshotId: 'predictive-proof',
          telemetryAnalytics,
          billingSummary,
          stagingModel,
          gateStats,
          team,
        });

        if (!report.includes('Predictive Insights')) {
          throw new Error('Expected analytics report predictive section');
        }
        if (semanticSnapshot.metrics.predictedBookedRevenueCents !== predictive.revenueForecast.predictedBookedRevenueCents) {
          throw new Error('Expected semantic snapshot predictive revenue metric');
        }
      },
    },
    {
      id: 'PREDICT-06',
      desc: 'verify:full includes the predictive proof lane and records its artifact',
      fn: () => {
        const commands = buildVerifyPlan('full')
          .map((step) => [step.command, ...(step.args || [])].join(' '))
          .join('\n');
        if (!commands.includes('prove:predictive-insights')) {
          throw new Error('Expected verify:full to include prove:predictive-insights');
        }

        const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-predictive-proof-'));
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-predictive-proof-cwd-'));
        try {
          const entry = recordVerifyWorkflowRun('full', cwd, feedbackDir);
          if (!entry.proofArtifacts.some((artifact) => artifact.endsWith(path.join('proof', 'predictive-insights-report.json')))) {
            throw new Error('Expected workflow run predictive artifact');
          }
        } finally {
          fs.rmSync(feedbackDir, { recursive: true, force: true });
          fs.rmSync(cwd, { recursive: true, force: true });
        }
      },
    },
  ];

  console.log('Predictive Insights - Proof Gate\n');
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
    phase: '16-predictive-insights',
    generatedAt: new Date().toISOString(),
    passed: results.passed,
    failed: results.failed,
    requirements: results.requirements,
  };
  fs.writeFileSync(reportJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const markdown = [
    '# Predictive Insights Proof Report',
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

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
