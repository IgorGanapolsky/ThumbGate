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
  // Token Plan list prices from Alibaba Model Studio (approx mid of published ranges).
  'qwen3.7-plus': { inputPerM: 0.64, outputPerM: 2.56, label: 'Qwen3.7-Plus (Model Studio)' },
  'qwen3.6-flash': { inputPerM: 0.50, outputPerM: 2.50, label: 'Qwen3.6-Flash (Model Studio)' },
  'claude-sonnet-5-intro': { inputPerM: 2.00, outputPerM: 10.00, label: 'Claude Sonnet 5 (Intro)' },
  'claude-sonnet-4.6': { inputPerM: 3.00, outputPerM: 15.00, label: 'Claude Sonnet 4.6' },
  'claude-sonnet-5-standard': { inputPerM: 3.00, outputPerM: 15.00, label: 'Claude Sonnet 5 (Post-Aug 31)' },
  'gemini-2.5-pro': { inputPerM: 2.50, outputPerM: 15.00, label: 'Gemini 2.5 Pro' },
  'gemini-2.5-flash': { inputPerM: 0.30, outputPerM: 2.50, label: 'Gemini 2.5 Flash' },
});

/**
 * Recommend flash vs plus vs max for a workload (pairs with adapters/qwen resolveQwenRoleRoute).
 */
function recommendQwenTier(workload, options = {}) {
  const id = String(workload || 'pretool-gating').toLowerCase();
  if (id.includes('long') || id.includes('claw') || id.includes('autonomous')) {
    return {
      modelKey: 'qwen3.8-max',
      reason: 'Long-horizon / claw-style work benefits from flagship reasoning.',
      costSample: calculateTokenCost('qwen3.8-max', options.inputTokensM || 1, options.outputTokensM || 1),
    };
  }
  if (id.includes('cheap') || id.includes('pretool') || id.includes('gate') || id.includes('flash')) {
    return {
      modelKey: 'qwen3.6-flash',
      reason: 'Gate and triage paths should stay on Flash under Token Plan.',
      costSample: calculateTokenCost('qwen3.6-flash', options.inputTokensM || 1, options.outputTokensM || 1),
    };
  }
  return {
    modelKey: 'qwen3.7-plus',
    reason: 'Default balanced coding / vision path.',
    costSample: calculateTokenCost('qwen3.7-plus', options.inputTokensM || 1, options.outputTokensM || 1),
  };
}

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

module.exports = {
  PRICING_TABLE,
  calculateTokenCost,
  calculateQwenSavingsVsClaude,
  recommendQwenTier,
};
