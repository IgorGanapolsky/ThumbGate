'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_SPARSE_PATCH_FRACTION,
  applySparseSurgicalParameterPatch,
  auditTrueApiUnitEconomics,
  evaluateRsiHumanGovernanceGate,
  evaluateTransactionalAgentCommerce,
  harmonizeAaifGatewayEnvelope,
  routeByGdpxEfficiency,
  scoreEnterpriseAndGeoReadiness,
} = require('../scripts/rsi-economics-governor');

test('Pillar 1A: auditTrueApiUnitEconomics detects $14k-on-$200/mo flat-rate subsidy trap vs healthy unsubsidized ROI', () => {
  const subsidized = auditTrueApiUnitEconomics({
    flatRatePlanMonthlyUsd: 200,
    trueApiComputeMonthlyUsd: 14000,
    tasksCompletedMonthly: 200,
    humanMinutesSavedPerTask: 20,
    humanHourlyUsd: 75,
  });
  assert.equal(subsidized.subsidyMultiplier, 70);
  assert.equal(subsidized.subsidyDependent, true);
  assert.equal(subsidized.beatsHumanLaborAtTrueCost, false);
  assert.equal(subsidized.verdict, 'SUBSIDY_TRAP_UNPROFITABLE_AT_TRUE_COST');

  const healthy = auditTrueApiUnitEconomics({
    flatRatePlanMonthlyUsd: 200,
    trueApiComputeMonthlyUsd: 800,
    tasksCompletedMonthly: 50,
    humanMinutesSavedPerTask: 30,
    humanHourlyUsd: 75,
    downstreamSmbRevenueMonthlyUsd: 1200,
  });
  assert.equal(healthy.subsidyDependent, false);
  assert.equal(healthy.beatsHumanLaborAtTrueCost, true);
  assert.equal(healthy.verdict, 'HEALTHY_UNSUBSIDIZED_UNIT_ECONOMICS');
});

test('Pillar 1B: routeByGdpxEfficiency routes from $51/task Opus 5.5 to $16/task Gemini 4 Carbon and provides GrokBot rate-limit failover', () => {
  const routed = routeByGdpxEfficiency({
    baselineModelId: 'opus-5.5',
    minGdpxScore: 87.0,
    maxCostPerTaskUsd: 20.0,
    rateLimitedProvider: 'grokbot',
    requiredConnector: 'stripe',
  });

  assert.equal(routed.selectedModel, 'gemini-4-carbon');
  assert.equal(routed.selectedCostPerTaskUsd, 16.0);
  assert.equal(routed.savingsPerTaskUsd, 35.0);
  assert.equal(routed.costReductionRatio, 3.19);
  assert.ok(routed.scoreRetentionPct >= 99.0);
  assert.equal(routed.recommendedFailover.id, 'meta-muse');
});

test('Pillar 2A: applySparseSurgicalParameterPatch enforces MIT 0.016% (0.00016) gradient-free direct weight surgery bound', () => {
  const modelState = {
    modelId: 'qwen-3.5-0.8b',
    totalParameters: 800_000_000,
    weights: { 'attn.loop_suppressor.0': 0.12 },
  };

  // Surgical edit of 128,000 parameters = exactly 0.016% (0.00016) -> allowed
  const surgical = applySparseSurgicalParameterPatch(modelState, {
    diagnosticianModel: 'gpt-6-astra',
    pathology: 'reasoning_repetition_loop',
    edits: [{ layerKey: 'attn.loop_suppressor.0', delta: -0.045, parameterCount: 128_000 }],
  });
  assert.equal(surgical.applied, true);
  assert.equal(surgical.gradientFree, true);
  assert.equal(surgical.editedFraction, MAX_SPARSE_PATCH_FRACTION);
  assert.equal(surgical.patchedWeights['attn.loop_suppressor.0'], 0.075);

  // Dense edit of 500,000 parameters (0.0625% > 0.016%) -> rejected
  const dense = applySparseSurgicalParameterPatch(modelState, {
    edits: [{ layerKey: 'attn.loop_suppressor.0', delta: 0.5, parameterCount: 500_000 }],
  });
  assert.equal(dense.applied, false);
  assert.match(dense.reason, /exceeding MIT 0\.016% ceiling/);
});

test('Pillar 2B: evaluateRsiHumanGovernanceGate enforces Anthropic S-1 human-in-the-loop approval on safety/reward mutations', () => {
  const unapproved = evaluateRsiHumanGovernanceGate({
    targetSurface: 'scripts/gates-engine.js',
    touchesSafetyGate: true,
    editedFraction: 0.00005,
    humanApproved: false,
  });
  assert.equal(unapproved.decision, 'block');
  assert.equal(unapproved.gate, 'anthropic-s1-rsi-human-in-the-loop');

  const approvedWithReceipt = evaluateRsiHumanGovernanceGate({
    targetSurface: 'scripts/gates-engine.js',
    touchesSafetyGate: true,
    editedFraction: 0.00005,
    humanApproved: true,
    approvedBy: 'igor',
    interpretabilityReceipt: {
      rationale: 'Verified H-Net byte de-obfuscation on git-reset-hard with 8/8 unit tests passing.',
    },
  });
  assert.equal(approvedWithReceipt.decision, 'allow');
});

test('Pillar 3: scoreEnterpriseAndGeoReadiness scores enterprise gateway/connectors and GEO zero-click citation signals', () => {
  const result = scoreEnterpriseAndGeoReadiness({
    content: '# ThumbGate PreToolUse Governance Gateway\nRun `npx thumbgate` to enforce Stripe & GitHub policy receipts with 99.4% GDPX parity.',
    connectors: ['stripe', 'github'],
    hasLlmsTxt: true,
  });
  assert.equal(result.enterpriseScore, 100);
  assert.equal(result.geoScore, 100);
  assert.equal(result.combinedScore, 100);
});


test('Pillar 4 (Mazin Gilbert AAIF): harmonizeAaifGatewayEnvelope and evaluateTransactionalAgentCommerce enforce stateless MCP and 5-step commerce', () => {
  const harmonized = harmonizeAaifGatewayEnvelope({
    protocolVersion: '2026-07-28',
    stateless: true,
    idempotencyKey: 'idem_123',
    capabilityScope: ['catalog:read', 'payment:authorize'],
  });
  assert.equal(harmonized.harmonized, true);
  assert.equal(harmonized.gatewayAdapter, 'solo-agentgateway');
  assert.equal(harmonized.routerAdapter, 'envoy-agent-router');

  const okPayment = evaluateTransactionalAgentCommerce({
    step: 'authorize_payment',
    amountUsd: 19,
    maxAuthorizedUsd: 50,
    merchantId: 'merchant_thumbgate',
    idempotencyKey: 'idem_123',
  });
  assert.equal(okPayment.allowed, true);
  assert.equal(okPayment.nextStep, 'verify_fulfillment');

  const overBudget = evaluateTransactionalAgentCommerce({
    step: 'authorize_payment',
    amountUsd: 500,
    maxAuthorizedUsd: 50,
    merchantId: 'merchant_thumbgate',
    idempotencyKey: 'idem_123',
  });
  assert.equal(overBudget.allowed, false);

  const unsafePhysicalAi = evaluateTransactionalAgentCommerce({
    step: 'discover_catalog',
    physicalAiAppliance: true,
    failSafeState: null,
    humanOverrideEnabled: false,
  });
  assert.equal(unsafePhysicalAi.allowed, false);
});