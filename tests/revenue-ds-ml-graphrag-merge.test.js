'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  wilsonConfidenceInterval,
  analyzeRevenueFunnelDataScience,
  scoreVisitorPropensityAndBandit,
  queryCommercialGraphRag,
  parseMergeAttributionAndMirrorIntent,
  provisionWorkforceHarnessPolicy,
  evaluateVllmOct2026ServingSteal,
  evaluateOpenHandsAgentControlPlaneSteal,
} = require('../scripts/revenue-ds-ml-graphrag-engine');
const { inspectTenPillarReleaseOps } = require('../scripts/release-ops-control-plane');

test('Data Science: Wilson 95% confidence interval and discrete-time checkout abandonment hazard', () => {
  const ci = wilsonConfidenceInterval(41, 86);
  assert.equal(ci.proportion, 0.476744);
  assert.ok(ci.lower95 > 0.37 && ci.lower95 < 0.40);
  assert.ok(ci.upper95 > 0.56 && ci.upper95 < 0.59);

  const report = analyzeRevenueFunnelDataScience({
    visitors: 13485,
    ctaClicks: 606,
    checkoutStarts: 86,
    cancelPageViews: 41,
    paidOrders: 1,
    externalCustomerOrders: 0,
  });
  assert.equal(report.ok, true);
  assert.equal(report.stripeCancelAbandonmentRatePct, 47.67);
  assert.equal(
    report.prescription,
    'route_cancel_and_price_sensitive_cohorts_to_one_time_downsells_999_and_49'
  );
  assert.equal(report.realExternalCustomerRevenueCents, 0);
  assert.equal(report.externalCustomerRevenueObserved, false);
  assert.ok(report.bayesianPosteriors.checkoutCancelHazard.posteriorMean > 0.45);
});

test('Machine Learning: Contextual Thompson Sampling Bandit + Calibrated Logistic Propensity', () => {
  const cancelCohort = scoreVisitorPropensityAndBandit({
    visitorId: 'visitor_cancel_01',
    intent: 'cancel expensive subscription',
    cancelledCheckout: true,
  });
  assert.equal(cancelCohort.ok, true);
  assert.ok(['playbook_999', 'bundle_49'].includes(cancelCohort.selectedOffer.skuId));
  assert.ok(cancelCohort.calibrationBrierScore < 0.05);

  const enterpriseCohort = scoreVisitorPropensityAndBandit({
    visitorId: 'visitor_ent_01',
    intent: 'workforce scim dlp team cost controls',
    cancelledCheckout: false,
    teamSignal: true,
  });
  assert.equal(enterpriseCohort.selectedOffer.skuId, 'team_79');
  assert.equal(enterpriseCohort.selectedOffer.checkoutPath, '/go/team-direct');
});

test('Agentic GraphRAG: 2-hop BFS traversal + Reciprocal Rank Fusion (RRF k=60)', () => {
  const grag = queryCommercialGraphRag({
    query: 'monolithic agent 102 tools spaghetti loops',
    visitorId: 'graphrag_test_01',
  });
  assert.equal(grag.ok, true);
  assert.equal(grag.graphNodeCount, 12);
  assert.ok(grag.graphEdgeCount >= 18);
  assert.ok(grag.multiHopReachableCount >= 4);
  assert.ok(grag.topGraphRagHits.length >= 3);
  assert.ok(grag.recommendedOffer.checkoutPath.startsWith('/go/'));
});

test('Merge.dev Steals: 14-param paid-search attribution mirror and 5-step Workforce Harness Auto-Provisioner', () => {
  const lp = parseMergeAttributionAndMirrorIntent({
    utm_keyword: 'merge.dev workforce cost controls',
    utm_matchtype: 'p',
    utm_source: 'google',
    utm_medium: 'paid-search',
    campaign_id: '14005688838',
    ad_group_id: '125537758632',
    gclid: 'CjwKCAjwxpvXBhASEiwAue4B4Y',
  });
  assert.equal(lp.ok, true);
  assert.equal(lp.noindex, true);
  assert.equal(lp.capturedParamCount, 7);
  assert.match(lp.mirroredIntent.headline, /Lower Your Team’s AI & MCP Token Spend/);
  assert.equal(lp.mirroredIntent.primaryCta.skuId, 'team_79');

  const malformedLp = parseMergeAttributionAndMirrorIntent({
    utm_source: 'github\\u0026utm_medium=readme\\u0026utm_campaign=readme_gpt\\',
  });
  assert.equal(malformedLp.capturedAttribution.utm_source, 'github');
  assert.equal(malformedLp.capturedAttribution.utm_medium, 'readme');
  assert.equal(malformedLp.capturedAttribution.utm_campaign, 'readme_gpt');

  const provisioned = provisionWorkforceHarnessPolicy({
    userId: 'dev_01',
    teamId: 'team_alpha',
    scimRole: 'triage-router',
    requestedModel: 'claude-opus-5-5-high', // unapproved for triage-router -> auto-fallback
    currentSpendUsd: 12.0,
    estimatedTurnCostUsd: 0.05,
    prompt: 'Here is leaked key sk_live_ABCDEF1234567890abcd and ghp_1234567890abcdefghij123456',
  });
  assert.equal(provisioned.ok, true);
  assert.equal(provisioned.attribution.modelFallbackApplied, true);
  assert.equal(provisioned.attribution.effectiveModel, 'gemini-3-flash');
  assert.ok(provisioned.harnessConfig.maxScopedToolsCount <= 4);
  assert.equal(provisioned.dlpAudit.redacted, true);
  assert.equal(provisioned.dlpAudit.hitCount, 2);
  assert.ok(!provisioned.dlpAudit.sanitizedPrompt.includes('sk_live_'));
});

test('vLLM Oct 2026 Serving Steal: DSpark speculative decoding, cross-layer KV sharing, and NIXL P/D admission burst cap', () => {
  const plan = evaluateVllmOct2026ServingSteal({
    promptTokens: 64000,
    concurrentSessions: 32,
    newAdmissionsThisStep: 7,
    maxNewKvLoadsPerStep: 4,
    kvPrecision: 'nvfp4_fp8_ds_mla',
    speculativeMethod: 'dspark',
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.vllmRelease, 'v0.32.0');
  assert.equal(plan.kvCacheConfig.kvConsumerLayers, 9);
  assert.equal(plan.kvCacheConfig.kvMemoryReductionPct, 12.5);
  assert.equal(plan.speculativeDecoding.expectedAcceptedTokensPerStep, 2.9);
  assert.equal(plan.speculativeDecoding.estimatedC1TpotMs, 2.95);
  assert.equal(plan.disaggregatedServing.prefillTopology, 'TP1xPCP4xDCP4');
  assert.equal(plan.disaggregatedServing.decodeTopology, 'TP4xDCP4_WideEP_EPLB');
  assert.equal(plan.disaggregatedServing.admissionControl.admissionBurstCapped, true);
  assert.equal(plan.disaggregatedServing.admissionControl.admittedThisStep, 4);
  assert.equal(plan.disaggregatedServing.admissionControl.deferredAdmissions, 3);
});

test('OpenHands Agent Control Plane Steal: 6-stage SDLC pipeline, 5-gate governance, and /.well-known/api-catalog hook', () => {
  const oh = evaluateOpenHandsAgentControlPlaneSteal({
    templateId: 'stripe_cancel_recovery_closer',
    actorId: 'agent_operator_01',
    runtimeTarget: 'lemonade_server_lemond',
  });
  assert.equal(oh.ok, true);
  assert.deepEqual(oh.lifecycleStages, ['Signal', 'Plan', 'Execute', 'Validate', 'Ship', 'Monitor']);
  assert.equal(oh.fiveGateControlPlane.whereExecutes.sandboxIsolated, true);
  assert.equal(oh.fiveGateControlPlane.whatTheySpend.withinBudget, true);
  assert.equal(oh.fiveGateControlPlane.whatTheyChange.auditTrailSigned, true);
  assert.equal(oh.monetizationHook.apiCatalogPath, '/.well-known/api-catalog');
  assert.ok(['playbook_999', 'bundle_49'].includes(oh.monetizationHook.recommendedOffer.skuId));
});

test('10-Pillar Release Control Plane + Revenue Intelligence Scorecard all reach 10/10 (A+)', () => {
  const ops = inspectTenPillarReleaseOps({ liveGit: false });
  assert.equal(ops.ok, true);
  assert.equal(ops.overallGrade, 'A+ (10/10)');
  assert.equal(ops.pillarsReadyCount, 10);
  for (const p of Object.values(ops.pillars)) {
    assert.equal(p.score, '10/10');
    assert.equal(p.grade, 'A+');
  }
  for (const sub of Object.values(ops.revenueIntelligenceScorecard)) {
    assert.equal(sub.status, 'READY');
    assert.equal(sub.score, '10/10');
    assert.equal(sub.grade, 'A+');
  }
});
