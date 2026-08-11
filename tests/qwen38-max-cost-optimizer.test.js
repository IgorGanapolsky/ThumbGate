'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PRICING_TABLE,
  CLAUDE_SONNET_5_INTRO_ENDS,
  calculateTokenCost,
  calculateQwenSavingsVsClaude,
  recommendQwenTier,
  compareStackPricing,
  recommendCostQualitySplit,
  calculateCostPerSuccessfulOutcome,
  recommendQwenByCostPerSuccess,
} = require('../scripts/qwen38-max-cost-optimizer');

test('pricing table contains exact Qwen3.8-Max and Claude Sonnet pricing', () => {
  assert.equal(PRICING_TABLE['qwen3.8-max'].inputPerM, 2.00);
  assert.equal(PRICING_TABLE['qwen3.8-max'].outputPerM, 6.00);
  assert.equal(PRICING_TABLE['claude-sonnet-4.6'].inputPerM, 3.00);
  assert.equal(PRICING_TABLE['claude-sonnet-4.6'].outputPerM, 15.00);
});

test('calculateTokenCost computes total cost accurately', () => {
  const result = calculateTokenCost('qwen3.8-max', 10, 5);
  assert.equal(result.inputCost, 20.00);
  assert.equal(result.outputCost, 30.00);
  assert.equal(result.totalCost, 50.00);
});

test('calculateQwenSavingsVsClaude proves >50% cost reduction vs Claude Sonnet', () => {
  const savingsNoPromo = calculateQwenSavingsVsClaude({ inputTokensM: 10, outputTokensM: 10 });
  assert.equal(savingsNoPromo.savingsPercent > 50, true);
  assert.equal(savingsNoPromo.recommendation, 'ROUTE_HIGH_VOLUME_TO_QWEN38_MAX');

  const savingsWithPromo = calculateQwenSavingsVsClaude({ inputTokensM: 10, outputTokensM: 10, useTokenPlanPromo: true });
  assert.equal(savingsWithPromo.savingsPercent > 70, true);
});

test('recommendQwenTier maps gate work to flash and long-trace to max', () => {
  assert.equal(recommendQwenTier('pretool-gating').modelKey, 'qwen3.6-flash');
  assert.equal(recommendQwenTier('long-trace-review').modelKey, 'qwen3.8-max');
  assert.equal(recommendQwenTier('dashboard-analysis').modelKey, 'qwen3.7-plus');
  assert.ok(PRICING_TABLE['qwen3.6-flash'].inputPerM < PRICING_TABLE['qwen3.8-max'].inputPerM);
});

test('Qwen output $6/M beats Claude standard $15/M by >50%', () => {
  assert.equal(PRICING_TABLE['qwen3.8-max'].outputPerM, 6);
  assert.equal(PRICING_TABLE['claude-sonnet-5-standard'].outputPerM, 15);
  assert.equal(PRICING_TABLE['claude-sonnet-5-intro'].outputPerM, 10);
  assert.equal(CLAUDE_SONNET_5_INTRO_ENDS, '2026-09-01');
  const vsPost = calculateQwenSavingsVsClaude({
    inputTokensM: 1,
    outputTokensM: 1,
    claudeModelKey: 'claude-sonnet-5-standard',
  });
  assert.ok(vsPost.savingsPercent > 50);
  const stack = compareStackPricing({ inputTokensM: 10, outputTokensM: 5, useTokenPlanPromo: true });
  assert.ok(stack.highlights.outputTokenSavingsPercentVsClaudeStandard >= 50);
  assert.equal(stack.rows.find((r) => r.modelKey === 'qwen3.8-max').effectiveCost
    < stack.rows.find((r) => r.modelKey === 'claude-sonnet-5-standard').effectiveCost, true);
});

test('recommendCostQualitySplit routes volume to Qwen and quality to Claude', () => {
  const volume = recommendCostQualitySplit({
    tags: ['high-volume', 'bulk'],
    costPriority: 'primary',
  }, {
    useTokenPlanPromo: true,
    outcomeTelemetry: {
      incumbentSuccessRate: 0.95,
      incumbentSampleSize: 100,
      qwenSuccessRate: 0.8,
      qwenSampleSize: 100,
    },
  });
  assert.equal(volume.lane, 'cost-volume');
  assert.equal(volume.primaryProvider, 'model-studio');
  assert.match(volume.primaryModel, /^qwen3\./);

  const quality = recommendCostQualitySplit({
    riskLevel: 'high',
    tags: ['architecture', 'reasoning-critical'],
  });
  assert.equal(quality.lane, 'quality');
  assert.equal(quality.primaryProvider, 'anthropic');

  const privateLane = recommendCostQualitySplit({ privacyRoute: 'local', sensitive: true });
  assert.equal(privateLane.lane, 'local-or-private');
});

test('cost-volume routing fails closed without qualified outcome telemetry', () => {
  const plan = recommendCostQualitySplit({ highVolume: true, costPriority: 'primary' });
  assert.equal(plan.lane, 'quality');
  assert.equal(plan.primaryProvider, 'anthropic');
  assert.equal(plan.routingEvidence.reason, 'INSUFFICIENT_OUTCOME_TELEMETRY');
});

test('cost per successful outcome accounts for quality and sample size', () => {
  const qwen = calculateCostPerSuccessfulOutcome({
    modelKey: 'qwen3.8-max',
    successRate: 0.8,
    sampleSize: 25,
  });
  assert.equal(qwen.telemetryQualified, true);
  assert.equal(qwen.costPerSuccessfulOutcomeUsd, 10);

  const decision = recommendQwenByCostPerSuccess({
    incumbentSuccessRate: 0.95,
    incumbentSampleSize: 100,
    qwenSuccessRate: 0.8,
    qwenSampleSize: 100,
  });
  assert.equal(decision.recommendation, 'ROUTE_HIGH_VOLUME_TO_QWEN38_MAX');
  assert.equal(decision.savingsPercent, 47.2);
});
