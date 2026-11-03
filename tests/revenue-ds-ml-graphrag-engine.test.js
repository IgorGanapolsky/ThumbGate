'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LIVE_SKU_CATALOG,
  wilsonConfidenceInterval,
  analyzeRevenueFunnelDataScience,
  scoreVisitorPropensityAndBandit,
  computeBrierScore,
  reciprocalRankFusion,
  queryCommercialGraphRag,
  parseMergeAttributionAndMirrorIntent,
  provisionWorkforceHarnessPolicy,
} = require('../scripts/revenue-ds-ml-graphrag-engine');

const {
  inspectTenPillarReleaseOps,
} = require('../scripts/release-ops-control-plane');

test('Data Science: Wilson 95% confidence intervals and funnel drop-off hazard analysis', () => {
  const ci = wilsonConfidenceInterval(41, 86, 1.96);
  assert.equal(ci.trials, 86);
  assert.equal(ci.successes, 41);
  assert.ok(ci.proportion > 0.47 && ci.proportion < 0.48);
  assert.ok(ci.lower95 < ci.proportion && ci.upper95 > ci.proportion);

  const ds = analyzeRevenueFunnelDataScience();
  assert.equal(ds.ok, true);
  assert.equal(ds.primaryBottleneck, 'checkout_uncompleted_total');
  assert.ok(ds.stripeCancelAbandonmentRatePct > 40);
  assert.equal(
    ds.prescription,
    'route_cancel_and_price_sensitive_cohorts_to_one_time_downsells_999_and_49'
  );
});

test('Machine Learning: Contextual logistic propensity + Thompson-Sampling Beta bandit + Brier score', () => {
  const brier = computeBrierScore([
    { prob: 0.9, outcome: 1 },
    { prob: 0.1, outcome: 0 },
  ]);
  assert.equal(brier, 0.01);

  const cancelDecision = scoreVisitorPropensityAndBandit({
    visitorId: 'visitor_cancel_1',
    intent: 'token burn cost controls',
    cancelledCheckout: true,
  });
  assert.equal(cancelDecision.ok, true);
  assert.ok(
    ['bundle_49', 'playbook_999'].includes(cancelDecision.selectedOffer.skuId),
    `Expected one-time downsell SKU for cancelled checkout, got ${cancelDecision.selectedOffer.skuId}`
  );
  assert.ok(cancelDecision.calibrationBrierScore < 0.05);
  assert.ok(cancelDecision.temporalDecayWeight > 0 && cancelDecision.temporalDecayWeight <= 1);
});

test('Agentic / Graph RAG: 2-hop BFS traversal + Reciprocal Rank Fusion (RRF k=60)', () => {
  const fused = reciprocalRankFusion(
    [
      [{ id: 'offer:bundle-49' }, { id: 'offer:pro-19' }],
      [{ id: 'offer:bundle-49' }, { id: 'cap:smart-orchestration-dag' }],
    ],
    60
  );
  assert.equal(fused[0].id, 'offer:bundle-49');

  const grag = queryCommercialGraphRag({
    query: 'monolithic agent 102 tools spaghetti loops',
  });
  assert.equal(grag.ok, true);
  assert.ok(grag.graphNodeCount >= 10);
  assert.ok(grag.graphEdgeCount >= 12);
  assert.ok(grag.multiHopReachableCount >= 3);
  assert.ok(grag.recommendedOffer && LIVE_SKU_CATALOG[grag.recommendedOffer.skuId]);
});

test('Smart Orchestration & Workforce Governance: Merge attribution mirror + SCIM role DLP & budget cutoff', () => {
  const lp = parseMergeAttributionAndMirrorIntent({
    utm_keyword: 'workforce team token spend',
    utm_source: 'google',
    gclid: 'test_gclid_123',
  });
  assert.equal(lp.ok, true);
  assert.equal(lp.noindex, true);
  assert.ok(lp.mirroredIntent.headline.includes('Lower Your Team'));

  const policy = provisionWorkforceHarnessPolicy({
    userId: 'u_1',
    teamId: 't_1',
    scimRole: 'engineer',
    currentSpendUsd: 10,
    estimatedTurnCostUsd: 0.05,
    prompt: 'Here is a leaked key sk_live_1234567890abcdef and ghp_1234567890abcdefghij123456',
  });
  assert.equal(policy.ok, true);
  assert.equal(policy.dlpAudit.redacted, true);
  assert.equal(policy.dlpAudit.hitCount, 2);
  assert.ok(!policy.dlpAudit.sanitizedPrompt.includes('sk_live_1234567890abcdef'));
  assert.ok(policy.harnessConfig.maxScopedToolsCount <= 4);
});

test('Release Ops Control Plane: 10/10 pillars ready', () => {
  const report = inspectTenPillarReleaseOps({ liveGit: true });
  assert.equal(report.ok, true);
  assert.equal(report.pillarsReadyCount, 10);
  assert.equal(report.totalPillarsCount, 10);
  assert.equal(report.overallGrade, 'A+ (10/10)');
});

test('vLLM Oct/Nov 2026 Serving Steal: HiSparse MNNVL crash guard, +43.9% cached-prefix prefill, heterogeneous EPLB, and 826 tok/s specialized decode', () => {
  const { evaluateVllmOct2026ServingSteal } = require('../scripts/revenue-ds-ml-graphrag-engine');
  const lowLatencyPlan = evaluateVllmOct2026ServingSteal({
    promptTokens: 64000,
    concurrentSessions: 2,
    batchSize: 2,
    temperature: 1.5,
    hostPoolGib: 440,
    singleNodeTp: true,
    allReduceBackend: 'mnnvl',
  });

  assert.equal(lowLatencyPlan.ok, true);
  assert.equal(lowLatencyPlan.vllmNextReleaseCandidate, 'v0.33.0rc3');
  assert.equal(lowLatencyPlan.hiSparseHostKvOffload.steadyStateMaxTokens, 11250000);
  assert.equal(lowLatencyPlan.hiSparseHostKvOffload.crossLayerKvHostTokenBonusPct, 14.3);
  assert.equal(
    lowLatencyPlan.hiSparseHostKvOffload.mnnvlCrashGuardStatus,
    'FAIL_MNNVL_HISPARSE_CRASH_RISK_VLLM_64327'
  );
  assert.equal(lowLatencyPlan.speculativeDecoding.draftSampleMethod, 'probabilistic');
  assert.equal(lowLatencyPlan.speculativeDecoding.expectedAcceptedTokensPerStep, 2.45);
  assert.equal(lowLatencyPlan.cachedPrefixPrefillOptimization.combinedNewTokenPrefillGainAt64kPct, 43.9);
  assert.equal(lowLatencyPlan.cachedPrefixPrefillOptimization.prefillThroughputAt64kTokPerSecPerGpu, 102500);
  assert.equal(lowLatencyPlan.disaggregatedServing.eplbTargetBalancedness, 0.94);
  assert.equal(lowLatencyPlan.disaggregatedServing.eplbDraftBalancedness, 0.89);
  assert.equal(lowLatencyPlan.disaggregatedServing.lowLatencySpecializedDecode.enabled, true);
  assert.equal(lowLatencyPlan.disaggregatedServing.lowLatencySpecializedDecode.singleUserP90TokensPerSec, 826);
  assert.equal(lowLatencyPlan.disaggregatedServing.lowLatencySpecializedDecode.stickyFaultTimeoutSec, 10);
});
