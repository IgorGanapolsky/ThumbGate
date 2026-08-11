'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PRICING_TABLE,
  calculateTokenCost,
  calculateQwenSavingsVsClaude,
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
