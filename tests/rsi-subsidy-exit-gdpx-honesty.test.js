'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const {
  MIT_SURGICAL_WEIGHT_FRACTION,
  auditTrueApiUnitEconomics,
  routeByGdpxEfficiency,
  evaluatePersonalAgentFunnel,
  analyzeMitSparseWeightEdit,
  enforceRsiHitlGovernance,
  auditGeoCitationReadiness,
  runDoctor,
} = require('../scripts/rsi-subsidy-exit-gdpx-honesty');

test('1. End-of-Subsidy Unit Economics catches $14k compute burn on $200/mo plan and passes profitable true-API workflows', () => {
  const subsidized = auditTrueApiUnitEconomics({
    flatSubscriptionFeeUsd: 200,
    trueApiComputeBurnUsd: 14000,
    monthlyTasksCompleted: 280,
    revenueGeneratedUsd: 1500,
    humanLaborEquivalentUsd: 6000,
  });
  assert.equal(subsidized.ok, false);
  assert.equal(subsidized.verdict, 'FAIL_SUBSIDY_ILLUSION');
  assert.equal(subsidized.subsidyMultiplier, 70);
  assert.equal(subsidized.trueContributionProfitUsd, -12500);

  const healthy = auditTrueApiUnitEconomics({
    flatSubscriptionFeeUsd: 200,
    trueApiComputeBurnUsd: 400,
    monthlyTasksCompleted: 100,
    revenueGeneratedUsd: 2400,
    humanLaborEquivalentUsd: 3500,
  });
  assert.equal(healthy.ok, true);
  assert.equal(healthy.verdict, 'PASS_TRUE_UNIT_ECONOMICS');
  assert.equal(healthy.trueContributionProfitUsd, 2000);
  assert.equal(healthy.beatsHumanLaborAtTrueCost, true);
});

test('2. SemiAnalysis GDPX router shifts $51/task Opus 5.5 to $16/task Gemini 4 Carbon (68.63% savings)', () => {
  const route = routeByGdpxEfficiency({
    requestedModel: 'opus-5.5',
    minGdpxScore: 93.0,
  });
  assert.equal(route.selectedModel, 'gemini-4-carbon');
  assert.equal(route.costPerTaskUsd, 16);
  assert.equal(route.savingsPerTaskUsd, 35);
  assert.equal(route.savingsPct, 68.63);
  assert.ok(route.capabilityRetentionPct >= 98.5);
});

test('3. Personal Agent ToF Funnel enforces SMB connectors and rate-limit failover (Nous Hermes / Meta Muse)', () => {
  const funnel = evaluatePersonalAgentFunnel({
    hasDownstreamB2bSku: true,
    smbConnectors: ['stripe', 'quickbooks', 'canva'],
    primaryPlatformRateLimited: true,
    primaryPlatform: 'grokbot',
  });
  assert.equal(funnel.ok, true);
  assert.equal(funnel.verdict, 'PASS_TOF_SMB_FUNNEL');
  assert.equal(funnel.recommendedFailover.id, 'nous-hermes');
});

test('4. MIT Direct Sparse Weight-Editing validates 0.016% gradient-free surgical intervention on Qwen 3.5 0.8B', () => {
  const analysis = analyzeMitSparseWeightEdit({
    studentModel: 'qwen-3.5-0.8b',
    totalParameters: 800_000_000,
    editedParameters: 128_000,
    preEditLoopRate: 0.40,
    postEditLoopRate: 0.04,
    usedGradientsOrRl: false,
  });
  assert.equal(analysis.ok, true);
  assert.equal(analysis.editedFraction, MIT_SURGICAL_WEIGHT_FRACTION);
  assert.equal(analysis.editedPct, 0.016);
  assert.equal(analysis.loopReductionPct, 90);
  assert.equal(analysis.classification, 'MIT_DIRECT_SPARSE_WEIGHT_EDIT');
});

test('5. Anthropic S-1 HITL RSI Governance blocks unapproved weight/gate mutations and allows verified HITL steps', () => {
  const blocked = enforceRsiHitlGovernance({
    mutationType: 'surgical_weight_edit',
    humanSupervisorApproved: false,
    interpretabilityDiffHash: '',
    isolatedVerifierPassed: true,
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.verdict, 'BLOCK_UNGUARDED_RSI_MUTATION');
  assert.ok(blocked.missingControls.includes('human_supervisor_approval'));

  const allowed = enforceRsiHitlGovernance({
    mutationType: 'surgical_weight_edit',
    humanSupervisorApproved: true,
    interpretabilityDiffHash: 'sha256:9f86d081884c7d659a2feaa0c55ad015',
    isolatedVerifierPassed: true,
    editedFraction: 0.00016,
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.verdict, 'ALLOW_GOVERNED_RSI_STEP');
});

test('6. GEO Citation Readiness and CLI --json doctor exit 0', () => {
  const geo = auditGeoCitationReadiness(
    '# GDPX Benchmark\n**Summary:** Saves 68.6% ($16 vs $51) with <1ms gating at https://thumbgate.co'
  );
  assert.equal(geo.ok, true);
  assert.equal(geo.geoScore, 100);

  const scriptPath = path.resolve(__dirname, '../scripts/rsi-subsidy-exit-gdpx-honesty.js');
  const raw = execFileSync(process.execPath, [scriptPath, '--json'], { encoding: 'utf8' });
  const parsed = JSON.parse(raw);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.verdict, 'PASS');
  assert.equal(runDoctor().ok, true);
});
