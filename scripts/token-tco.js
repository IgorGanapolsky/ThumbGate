'use strict';

function computeCostPerMillionTokens(input = {}) {
  const gpuDollarsPerHour = Number(input.gpuDollarsPerHour || 0);
  const tokensPerSecond = Number(input.tokensPerSecond || 0);
  if (gpuDollarsPerHour <= 0 || tokensPerSecond <= 0) return Infinity;
  const tokensPerHour = tokensPerSecond * 60 * 60;
  return Number(((gpuDollarsPerHour / tokensPerHour) * 1000000).toFixed(6));
}

function evaluateInferenceTco(input = {}) {
  let costPerMillionTokens = computeCostPerMillionTokens(input);
  if (input.costPerMillionTokens !== undefined) {
    costPerMillionTokens = Number(input.costPerMillionTokens);
  }
  const tokensPerRun = Number(input.tokensPerRun || 0);
  const runsPerDay = Number(input.runsPerDay || 0);
  const usefulBlocksPerDay = Number(input.usefulBlocksPerDay || 0);
  const minutesSavedPerBlock = Number(input.minutesSavedPerBlock || 16);
  const laborDollarsPerHour = Number(input.laborDollarsPerHour || 100);

  const dailyTokenCost = Number(((costPerMillionTokens / 1000000) * tokensPerRun * runsPerDay).toFixed(4));
  const dailyValue = Number(((usefulBlocksPerDay * minutesSavedPerBlock / 60) * laborDollarsPerHour).toFixed(4));
  const roi = dailyTokenCost > 0 ? Number((dailyValue / dailyTokenCost).toFixed(2)) : Infinity;
  const issues = [];

  if (!Number.isFinite(costPerMillionTokens)) issues.push('missing_token_tco_inputs');
  if (!tokensPerRun) issues.push('missing_tokens_per_run');
  if (!runsPerDay) issues.push('missing_runs_per_day');
  if (!usefulBlocksPerDay) issues.push('missing_useful_blocks_per_day');

  return {
    decision: issues.length ? 'warn' : 'allow',
    issues,
    costPerMillionTokens,
    dailyTokenCost,
    dailyValue,
    roi,
    metric: 'cost_per_useful_blocked_failure',
  };
}

/**
 * Calculate Revolut-style inference savings and productivity ROI.
 * Based on Revolut's real-world rollout across 2,000 engineers:
 * - Commercial frontier: $3.00 - $15.00 / M tokens (default $3.00/M for code)
 * - Self-hosted open-weight (e.g. GLM-5.1/5.3 / Qwen on B200 / H100): $0.30 / M tokens
 * - Lead time productivity: +70%
 * - Coding time productivity: +60%
 * - Elimination of token rationing / developer hoarding
 */
function calculateRevolutInferenceSavings(input = {}) {
  const developerCount = Number(input.developerCount || 2000);
  // Revolut heavy engineers were spending $1,000 - $10,000/mo on commercial AI tokens.
  // Blended average of ~$1,000/dev/mo (~300M tokens/dev/mo at commercial $3.33/M input/output).
  const monthlyTokensPerDev = Number(input.monthlyTokensPerDev || 300000000); // 300M tokens/dev/mo
  const commercialCostPerM = Number(input.commercialCostPerM || 3.333333); // ~$3.33/M commercial Claude/Codex
  const selfHostedCostPerM = Number(input.selfHostedCostPerM || 0.30); // $0.30/M self-hosted GLM-5.1/5.3
  const monthlyGpuAmortization = Number(input.monthlyGpuAmortization || 120000); // 56 B200 GPUs amortized
  const leadTimeImprovementPct = Number(input.leadTimeImprovementPct || 70); // +70% lead time
  const codingTimeImprovementPct = Number(input.codingTimeImprovementPct || 60); // +60% coding time
  const blendedHourlyRate = Number(input.blendedHourlyRate || 100);

  const totalMonthlyTokens = developerCount * monthlyTokensPerDev;
  const totalTokensM = totalMonthlyTokens / 1000000;

  const monthlyCommercialCost = Math.round(totalTokensM * commercialCostPerM);
  const monthlySelfHostedInferenceCost = Math.round(totalTokensM * selfHostedCostPerM);
  const totalMonthlySelfHostedCost = monthlySelfHostedInferenceCost + monthlyGpuAmortization;

  const monthlyCostSavings = monthlyCommercialCost - totalMonthlySelfHostedCost;
  const annualCostSavings = monthlyCostSavings * 12;
  const rawInferenceReductionPct = Number((((commercialCostPerM - selfHostedCostPerM) / commercialCostPerM) * 100).toFixed(1));
  const netCostReductionPct = monthlyCommercialCost > 0
    ? Number(((monthlyCostSavings / monthlyCommercialCost) * 100).toFixed(1))
    : 0;

  // Productivity gains from unconstrained tokens (60% coding time boost on ~60 hrs/mo coding)
  const monthlyCodingHoursPerDev = 60; // 15 hrs/wk * 4 wks
  const productiveHoursGainedPerDevMonthly = monthlyCodingHoursPerDev * (codingTimeImprovementPct / 100);
  const totalMonthlyProductiveHoursGained = developerCount * productiveHoursGainedPerDevMonthly;
  const monthlyProductivityValue = totalMonthlyProductiveHoursGained * blendedHourlyRate;
  const annualProductivityValue = monthlyProductivityValue * 12;

  const totalAnnualValue = annualCostSavings + annualProductivityValue;
  const paybackMonths = monthlyCostSavings > 0
    ? Number(((monthlyGpuAmortization * 12) / monthlyCostSavings).toFixed(1))
    : 0;

  return {
    organization: input.organization || 'Revolut Benchmark',
    developerCount,
    monthlyTokensPerDev,
    totalMonthlyTokensM: totalTokensM,
    economics: {
      commercialCostPerM,
      selfHostedCostPerM,
      rawInferenceReductionPct, // ~91.0% (10x inference savings)
      monthlyCommercialCost,
      monthlySelfHostedCost: totalMonthlySelfHostedCost,
      monthlyCostSavings,
      annualCostSavings,
      netCostReductionPct, // ~85% including GPU hardware amortization
      paybackMonths,
    },
    productivity: {
      leadTimeImprovementPct,
      codingTimeImprovementPct,
      monthlyProductiveHoursGained: totalMonthlyProductiveHoursGained,
      monthlyProductivityValue,
      annualProductivityValue,
    },
    totalAnnualValue,
    summary: `Revolut benchmark: Slashed raw inference costs by ${rawInferenceReductionPct}% (net ${netCostReductionPct}% including GPU hardware, saving $${(annualCostSavings / 1e6).toFixed(2)}M/yr for ${developerCount.toLocaleString()} engineers) with ${paybackMonths} months GPU cluster payback, gaining +${codingTimeImprovementPct}% coding productivity and +${leadTimeImprovementPct}% lead time velocity by eliminating token rationing.`,
  };
}

module.exports = {
  computeCostPerMillionTokens,
  evaluateInferenceTco,
  calculateRevolutInferenceSavings,
};
