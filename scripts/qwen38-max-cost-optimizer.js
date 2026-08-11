#!/usr/bin/env node
'use strict';

/**
 * Qwen3.8-Max & Alibaba Cloud Token Plan Cost Optimizer
 *
 * Pricing sources (2026): OpenRouter Qwen3.8-Max, Claude platform pricing
 * (Sonnet 5 intro through 2026-08-31 then $3/$15), Gemini 2.5 tiered ranges.
 * Token Plan 2x promo modeled as 0.5× effective cost when useTokenPlanPromo.
 */

const PRICING_TABLE = Object.freeze({
  'qwen3.8-max': {
    inputPerM: 2.00,
    outputPerM: 6.00,
    label: 'Qwen3.8-Max (OpenRouter / Model Studio)',
    contextWindow: 1_000_000,
  },
  // Token Plan list prices from Alibaba Model Studio (approx mid of published ranges).
  'qwen3.7-plus': { inputPerM: 0.64, outputPerM: 2.56, label: 'Qwen3.7-Plus (Model Studio)' },
  'qwen3.6-flash': { inputPerM: 0.50, outputPerM: 2.50, label: 'Qwen3.6-Flash (Model Studio)' },
  'claude-sonnet-5-intro': {
    inputPerM: 2.00,
    outputPerM: 10.00,
    label: 'Claude Sonnet 5 (Intro through 2026-08-31)',
  },
  'claude-sonnet-4.6': { inputPerM: 3.00, outputPerM: 15.00, label: 'Claude Sonnet 4.6' },
  'claude-sonnet-5-standard': {
    inputPerM: 3.00,
    outputPerM: 15.00,
    label: 'Claude Sonnet 5 (Post-Aug 31, 2026)',
  },
  // Conservative (high) end of Gemini 2.5 Pro published range for apples-to-apples "worst case Gemini".
  'gemini-2.5-pro': {
    inputPerM: 2.50,
    outputPerM: 15.00,
    label: 'Gemini 2.5 Pro (high tier of $1.25–2.50 / $10–15)',
    inputPerMLow: 1.25,
    outputPerMLow: 10.00,
  },
  'gemini-2.5-flash': { inputPerM: 0.30, outputPerM: 2.50, label: 'Gemini 2.5 Flash' },
});

/** After this date Claude Sonnet 5 uses standard $3/$15 (not intro $2/$10). */
const CLAUDE_SONNET_5_INTRO_ENDS = '2026-09-01';

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

function applyTokenPlanPromo(totalCostUsd, useTokenPlanPromo) {
  if (!useTokenPlanPromo) return Number(totalCostUsd);
  // Limited-time 2x usage-per-credit → model as 0.5× effective $ for same work.
  return Number(totalCostUsd) * 0.5;
}

function calculateQwenSavingsVsClaude(options = {}) {
  const inputM = options.inputTokensM || 1;
  const outputM = options.outputTokensM || 1;
  const useTokenPlanPromo = Boolean(options.useTokenPlanPromo);
  const claudeKey = options.claudeModelKey || 'claude-sonnet-4.6';

  const qwenBase = calculateTokenCost('qwen3.8-max', inputM, outputM);
  const claude = calculateTokenCost(claudeKey, inputM, outputM);

  const qwenEffectiveTotal = applyTokenPlanPromo(qwenBase.totalCost, useTokenPlanPromo);
  const rawSavingsUsd = claude.totalCost - qwenEffectiveTotal;
  const savingsPercent = Number(((rawSavingsUsd / claude.totalCost) * 100).toFixed(1));

  return {
    inputTokensM: inputM,
    outputTokensM: outputM,
    useTokenPlanPromo,
    claudeModelKey: claudeKey,
    qwenCostUsd: Number(qwenEffectiveTotal.toFixed(2)),
    claudeCostUsd: Number(claude.totalCost.toFixed(2)),
    savingsUsd: Number(rawSavingsUsd.toFixed(2)),
    savingsPercent,
    recommendation: savingsPercent > 50
      ? 'ROUTE_HIGH_VOLUME_TO_QWEN38_MAX'
      : 'EVALUATE_HYBRID_ROUTING',
  };
}

/**
 * Full stack snapshot for the dual-lane policy (volume → Qwen, quality → Claude/Gemini).
 */
function compareStackPricing(options = {}) {
  const inputM = options.inputTokensM || 1;
  const outputM = options.outputTokensM || 1;
  const useTokenPlanPromo = Boolean(options.useTokenPlanPromo);
  const asOf = options.asOf || new Date().toISOString().slice(0, 10);

  const rows = [
    'qwen3.8-max',
    'qwen3.7-plus',
    'qwen3.6-flash',
    'claude-sonnet-5-intro',
    'claude-sonnet-5-standard',
    'claude-sonnet-4.6',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
  ].map((key) => {
    const base = calculateTokenCost(key, inputM, outputM);
    const effective = key.startsWith('qwen')
      ? applyTokenPlanPromo(base.totalCost, useTokenPlanPromo)
      : base.totalCost;
    return {
      modelKey: key,
      label: base.label,
      inputCost: base.inputCost,
      outputCost: base.outputCost,
      totalCost: base.totalCost,
      effectiveCost: Number(effective.toFixed(4)),
    };
  });

  const qwen = rows.find((r) => r.modelKey === 'qwen3.8-max');
  const claudePost = rows.find((r) => r.modelKey === 'claude-sonnet-5-standard');
  const outputSavingsVsClaudePost = claudePost.outputCost > 0
    ? Number((((claudePost.outputCost - qwen.outputCost) / claudePost.outputCost) * 100).toFixed(1))
    : 0;

  return {
    asOf,
    inputTokensM: inputM,
    outputTokensM: outputM,
    useTokenPlanPromo,
    claudeSonnet5IntroEnds: CLAUDE_SONNET_5_INTRO_ENDS,
    claudeSonnet5OnIntroPricing: asOf < CLAUDE_SONNET_5_INTRO_ENDS,
    rows,
    highlights: {
      qwenOutputPerM: PRICING_TABLE['qwen3.8-max'].outputPerM,
      claudeStandardOutputPerM: PRICING_TABLE['claude-sonnet-5-standard'].outputPerM,
      outputTokenSavingsPercentVsClaudeStandard: outputSavingsVsClaudePost,
      note: 'Qwen3.8-Max $6/M output vs Claude $15/M is the primary cash lever; Token Plan promo stacks further.',
    },
  };
}

/**
 * Practical dual-stack policy from cost analysis:
 * - high-volume / bulk / automation → Qwen (Flash for gates, Max for long agentic)
 * - high-stakes reasoning / architecture / quality-critical → Claude or Gemini
 * - local preferred when privacyRoute=local or sensitive
 */
function recommendCostQualitySplit(task = {}, options = {}) {
  const tags = Array.isArray(task.tags) ? task.tags.map((t) => String(t).toLowerCase()) : [];
  const type = String(task.type || task.workload || '').toLowerCase();
  const risk = String(task.riskLevel || 'medium').toLowerCase();
  const costPrimary = task.costPriority === 'primary'
    || tags.includes('cost-sensitive')
    || tags.includes('high-volume')
    || tags.includes('bulk')
    || tags.includes('automation')
    || Boolean(task.highVolume);
  const qualityCritical = risk === 'high'
    || tags.includes('architecture')
    || tags.includes('reasoning-critical')
    || tags.includes('quality-critical')
    || type.includes('architecture')
    || type.includes('complex-debugging');
  const longHorizon = tags.includes('long-horizon')
    || type.includes('long-trace')
    || Boolean(task.longHorizon)
    || (Number(task.contextTokens) || 0) >= 128000;
  const sensitive = task.privacyRoute === 'local'
    || Boolean(task.sensitive)
    || tags.includes('pii')
    || tags.includes('secrets');

  const useTokenPlanPromo = Boolean(options.useTokenPlanPromo);
  const volume = {
    inputTokensM: options.inputTokensM || 1,
    outputTokensM: options.outputTokensM || 1,
  };
  const vsClaude = calculateQwenSavingsVsClaude({
    ...volume,
    useTokenPlanPromo,
    claudeModelKey: options.claudeModelKey || 'claude-sonnet-5-standard',
  });

  if (sensitive) {
    return {
      lane: 'local-or-private',
      primaryProvider: 'local',
      primaryModel: options.localModel || null,
      fallbackProvider: null,
      reason: 'Sensitive / privacyRoute=local — do not send bulk payloads to Model Studio without explicit allow.',
      savings: vsClaude,
      requiresBudgetApproval: false,
    };
  }

  if (qualityCritical && !costPrimary) {
    return {
      lane: 'quality',
      primaryProvider: options.qualityProvider || 'anthropic',
      primaryModel: options.qualityModel || 'claude-sonnet-5-standard',
      fallbackProvider: 'gemini',
      fallbackModel: 'gemini-2.5-pro',
      reason: 'High-stakes reasoning — keep Claude/Gemini; do not force Qwen solely for price.',
      savings: vsClaude,
      requiresBudgetApproval: false,
    };
  }

  if (costPrimary || longHorizon) {
    const qwenTier = recommendQwenTier(
      longHorizon ? 'long-trace-review' : (type.includes('gate') || type.includes('pretool') ? 'pretool-gating' : 'cheap-fast-path'),
      volume,
    );
    return {
      lane: 'cost-volume',
      primaryProvider: 'model-studio',
      primaryModel: qwenTier.modelKey,
      candidateId: qwenTier.modelKey === 'qwen3.8-max'
        ? 'alibaba/qwen3.8-max'
        : qwenTier.modelKey === 'qwen3.6-flash'
          ? 'alibaba/qwen3.6-flash'
          : 'alibaba/qwen3.7-plus',
      fallbackProvider: options.qualityProvider || 'anthropic',
      fallbackModel: options.qualityModel || 'claude-sonnet-5-standard',
      reason: longHorizon
        ? 'Long / high-output agentic work: Qwen3.8-Max for output-token savings; keep Claude as quality fallback.'
        : 'High-volume cost-sensitive work: route to Qwen under Token Plan; escalate quality-critical to Claude/Gemini.',
      savings: vsClaude,
      requiresBudgetApproval: true,
      qwenTier,
    };
  }

  return {
    lane: 'balanced',
    primaryProvider: 'model-studio',
    primaryModel: 'qwen3.7-plus',
    candidateId: 'alibaba/qwen3.7-plus',
    fallbackProvider: 'anthropic',
    fallbackModel: 'claude-sonnet-5-standard',
    reason: 'Default: Plus for coding throughput; quality fallback on failure or high risk.',
    savings: vsClaude,
    requiresBudgetApproval: true,
  };
}

module.exports = {
  PRICING_TABLE,
  CLAUDE_SONNET_5_INTRO_ENDS,
  calculateTokenCost,
  calculateQwenSavingsVsClaude,
  recommendQwenTier,
  compareStackPricing,
  recommendCostQualitySplit,
  applyTokenPlanPromo,
};
