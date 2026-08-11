#!/usr/bin/env node
'use strict';

/**
 * Qwen3.8-Max & Alibaba Cloud Token Plan Cost Optimizer
 *
 * Computes model cost comparison and output token cash savings across:
 * - Qwen3.8-Max ($2.00/M input, $6.00/M output)
 * - Claude Sonnet 4.6 ($3.00/M input, $15.00/M output)
 * - Claude Sonnet 5 post-promo ($3.00/M input, $15.00/M output)
 * - Gemini 2.5 Pro ($2.50/M input, $15.00/M output)
 */

const PRICING_TABLE = Object.freeze({
  'qwen3.8-max': { inputPerM: 2.00, outputPerM: 6.00, label: 'Qwen3.8-Max (OpenRouter / Model Studio)' },
  'claude-sonnet-5-intro': { inputPerM: 2.00, outputPerM: 10.00, label: 'Claude Sonnet 5 (Intro)' },
  'claude-sonnet-4.6': { inputPerM: 3.00, outputPerM: 15.00, label: 'Claude Sonnet 4.6' },
  'claude-sonnet-5-standard': { inputPerM: 3.00, outputPerM: 15.00, label: 'Claude Sonnet 5 (Post-Aug 31)' },
  'gemini-2.5-pro': { inputPerM: 2.50, outputPerM: 15.00, label: 'Gemini 2.5 Pro' },
  'gemini-2.5-flash': { inputPerM: 0.30, outputPerM: 2.50, label: 'Gemini 2.5 Flash' },
});

function calculateTokenCost(modelKey, inputTokensM = 1, outputTokensM = 1) {
  const model = PRICING_TABLE[modelKey];
  if (!model) {
    throw new Error(`Unknown model key: ${modelKey}`);
  }
  const inputCost = inputTokensM * model.inputPerM;
  const outputCost = outputTokensM * model.outputPerM;
  return {
    modelKey,
    label: model.label,
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
  };
}

function calculateQwenSavingsVsClaude(options = {}) {
  const inputM = options.inputTokensM || 1;
  const outputM = options.outputTokensM || 1;
  const useTokenPlanPromo = Boolean(options.useTokenPlanPromo);

  const qwenBase = calculateTokenCost('qwen3.8-max', inputM, outputM);
  const claudeStandard = calculateTokenCost('claude-sonnet-4.6', inputM, outputM);

  let qwenEffectiveTotal = qwenBase.totalCost;
  if (useTokenPlanPromo) {
    // 2x usage multiplier promo under Alibaba Cloud Token Plan
    qwenEffectiveTotal = qwenBase.totalCost * 0.5;
  }

  const rawSavingsUsd = claudeStandard.totalCost - qwenEffectiveTotal;
  const savingsPercent = Number(((rawSavingsUsd / claudeStandard.totalCost) * 100).toFixed(1));

  return {
    inputTokensM: inputM,
    outputTokensM: outputM,
    useTokenPlanPromo,
    qwenCostUsd: Number(qwenEffectiveTotal.toFixed(2)),
    claudeCostUsd: Number(claudeStandard.totalCost.toFixed(2)),
    savingsUsd: Number(rawSavingsUsd.toFixed(2)),
    savingsPercent,
    recommendation: savingsPercent > 50
      ? 'ROUTE_HIGH_VOLUME_TO_QWEN38_MAX'
      : 'EVALUATE_HYBRID_ROUTING',
  };
}

function calculateCostPerSuccessfulOutcome(options = {}) {
  const {
    modelKey,
    inputTokensM = 1,
    outputTokensM = 1,
    successRate,
    sampleSize,
    costMultiplier = 1,
    minimumSampleSize = 20,
  } = options;

  if (!Number.isFinite(successRate) || successRate <= 0 || successRate > 1) {
    throw new Error('successRate must be greater than 0 and less than or equal to 1');
  }
  if (!Number.isInteger(sampleSize) || sampleSize < 0) {
    throw new Error('sampleSize must be a non-negative integer');
  }
  if (!Number.isFinite(costMultiplier) || costMultiplier <= 0 || costMultiplier > 1) {
    throw new Error('costMultiplier must be greater than 0 and less than or equal to 1');
  }

  const tokenCost = calculateTokenCost(modelKey, inputTokensM, outputTokensM);
  const effectiveCostUsd = tokenCost.totalCost * costMultiplier;

  return {
    modelKey,
    sampleSize,
    successRate,
    telemetryQualified: sampleSize >= minimumSampleSize,
    effectiveCostUsd: Number(effectiveCostUsd.toFixed(4)),
    costPerSuccessfulOutcomeUsd: Number((effectiveCostUsd / successRate).toFixed(4)),
  };
}

function recommendQwenByCostPerSuccess(options = {}) {
  const {
    inputTokensM = 1,
    outputTokensM = 1,
    incumbentModelKey = 'claude-sonnet-4.6',
    incumbentSuccessRate,
    incumbentSampleSize,
    qwenSuccessRate,
    qwenSampleSize,
    minimumSampleSize = 20,
    minimumSavingsPercent = 15,
    verifiedTokenPlanMultiplier = 1,
  } = options;

  const incumbent = calculateCostPerSuccessfulOutcome({
    modelKey: incumbentModelKey,
    inputTokensM,
    outputTokensM,
    successRate: incumbentSuccessRate,
    sampleSize: incumbentSampleSize,
    minimumSampleSize,
  });
  const qwen = calculateCostPerSuccessfulOutcome({
    modelKey: 'qwen3.8-max',
    inputTokensM,
    outputTokensM,
    successRate: qwenSuccessRate,
    sampleSize: qwenSampleSize,
    costMultiplier: verifiedTokenPlanMultiplier,
    minimumSampleSize,
  });

  if (!incumbent.telemetryQualified || !qwen.telemetryQualified) {
    return {
      recommendation: 'HOLD_INCUMBENT',
      reason: 'INSUFFICIENT_OUTCOME_TELEMETRY',
      incumbent,
      qwen,
    };
  }

  const savingsPercent = Number((
    ((incumbent.costPerSuccessfulOutcomeUsd - qwen.costPerSuccessfulOutcomeUsd)
      / incumbent.costPerSuccessfulOutcomeUsd) * 100
  ).toFixed(1));

  return {
    recommendation: savingsPercent >= minimumSavingsPercent
      ? 'ROUTE_HIGH_VOLUME_TO_QWEN38_MAX'
      : 'HOLD_INCUMBENT',
    reason: savingsPercent >= minimumSavingsPercent
      ? 'LOWER_VERIFIED_COST_PER_SUCCESS'
      : 'SAVINGS_BELOW_THRESHOLD',
    savingsPercent,
    minimumSavingsPercent,
    incumbent,
    qwen,
  };
}

module.exports = {
  PRICING_TABLE,
  calculateTokenCost,
  calculateQwenSavingsVsClaude,
  calculateCostPerSuccessfulOutcome,
  recommendQwenByCostPerSuccess,
};
