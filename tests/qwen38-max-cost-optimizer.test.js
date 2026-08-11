'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PRICING_TABLE,
  calculateTokenCost,
  calculateQwenSavingsVsClaude,
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

test('cost per successful outcome accounts for model quality', () => {
  const result = calculateCostPerSuccessfulOutcome({
    modelKey: 'qwen3.8-max',
    inputTokensM: 1,
    outputTokensM: 1,
    successRate: 0.8,
    sampleSize: 25,
  });

  assert.equal(result.telemetryQualified, true);
  assert.equal(result.effectiveCostUsd, 8);
  assert.equal(result.costPerSuccessfulOutcomeUsd, 10);
});

test('router fails closed when outcome telemetry is insufficient', () => {
  const result = recommendQwenByCostPerSuccess({
    incumbentSuccessRate: 0.9,
    incumbentSampleSize: 100,
    qwenSuccessRate: 0.8,
    qwenSampleSize: 5,
  });

  assert.equal(result.recommendation, 'HOLD_INCUMBENT');
  assert.equal(result.reason, 'INSUFFICIENT_OUTCOME_TELEMETRY');
});

test('router selects Qwen only when verified cost per success clears threshold', () => {
  const result = recommendQwenByCostPerSuccess({
    inputTokensM: 1,
    outputTokensM: 1,
    incumbentSuccessRate: 0.95,
    incumbentSampleSize: 100,
    qwenSuccessRate: 0.8,
    qwenSampleSize: 100,
    minimumSavingsPercent: 15,
  });

  assert.equal(result.recommendation, 'ROUTE_HIGH_VOLUME_TO_QWEN38_MAX');
  assert.equal(result.reason, 'LOWER_VERIFIED_COST_PER_SUCCESS');
  assert.equal(result.savingsPercent, 47.2);
});

test('router holds incumbent when lower quality erases raw token savings', () => {
  const result = recommendQwenByCostPerSuccess({
    inputTokensM: 1,
    outputTokensM: 1,
    incumbentSuccessRate: 0.95,
    incumbentSampleSize: 100,
    qwenSuccessRate: 0.3,
    qwenSampleSize: 100,
    minimumSavingsPercent: 15,
  });

  assert.equal(result.recommendation, 'HOLD_INCUMBENT');
  assert.equal(result.reason, 'SAVINGS_BELOW_THRESHOLD');
});
