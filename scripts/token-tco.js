'use strict';

function computeCostPerMillionTokens(input = {}) {
  const gpuDollarsPerHour = Number(input.gpuDollarsPerHour || 0);
  const tokensPerSecond = Number(input.tokensPerSecond || 0);
  if (gpuDollarsPerHour <= 0 || tokensPerSecond <= 0) return Infinity;
  const tokensPerHour = tokensPerSecond * 60 * 60;
  return Number(((gpuDollarsPerHour / tokensPerHour) * 1000000).toFixed(6));
}

function evaluateInferenceTco(input = {}) {
  const costPerMillionTokens = input.costPerMillionTokens !== undefined
    ? Number(input.costPerMillionTokens)
    : computeCostPerMillionTokens(input);
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

module.exports = {
  computeCostPerMillionTokens,
  evaluateInferenceTco,
};
