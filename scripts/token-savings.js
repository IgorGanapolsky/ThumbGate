'use strict';

/**
 * token-savings.js — estimate how much money ThumbGate's prevention
 * rules saved you in LLM tokens.
 *
 * Why this exists:
 *   The mission of ThumbGate is "stop paying for the same AI mistake
 *   twice." Every time a Pre-Action Gate blocks a known-bad tool call,
 *   the agent does NOT make a round-trip to the model. That's:
 *
 *     - input tokens you didn't spend (system prompt + tool defs +
 *       conversation history that would have been re-sent)
 *     - output tokens you didn't spend (the model's failed response
 *       and any retry loop it would have triggered)
 *
 *   A single blocked call typically saves 1.5k–3k input tokens and
 *   400–800 output tokens, depending on context size. We surface a
 *   conservative estimate on the dashboard as a live counter so the
 *   user can see exactly what their gates are worth.
 *
 * Defaults are intentionally conservative — the goal is "you almost
 * certainly saved at least this much," not "let's flatter ourselves."
 *
 * Pricing snapshot (USD per 1M tokens, retrieved 2026-04-15):
 *   Sonnet 4.5: $3 input, $15 output
 *   Opus 4.6:   $15 input, $75 output
 *   Haiku 4.5:  $0.80 input, $4 output
 *   GPT-4o:     $2.50 input, $10 output
 *
 * If the caller doesn't pass a modelMix, we assume a Sonnet-heavy
 * blend (80% Sonnet, 15% Opus, 5% Haiku) because that matches the
 * reality of most coding-agent users in 2026.
 */

const DEFAULT_MODEL_PRICES = Object.freeze({
  // USD per 1M tokens
  'claude-sonnet-4-5': { input: 3.0, output: 15.0 },
  'claude-opus-4-6': { input: 15.0, output: 75.0 },
  'claude-haiku-4-5': { input: 0.80, output: 4.0 },
  'gpt-4o': { input: 2.50, output: 10.0 },
});

const DEFAULT_MODEL_MIX = Object.freeze({
  'claude-sonnet-4-5': 0.80,
  'claude-opus-4-6': 0.15,
  'claude-haiku-4-5': 0.05,
});

// Average tokens a blocked tool call would have consumed if it had
// reached the model and been retried once. Conservative.
const DEFAULT_AVG_INPUT_TOKENS_PER_BLOCK = 2000;
const DEFAULT_AVG_OUTPUT_TOKENS_PER_BLOCK = 600;

function clampNumber(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function blendedPricePer1M(modelMix, modelPrices) {
  let input = 0;
  let output = 0;
  let totalWeight = 0;
  for (const [model, weight] of Object.entries(modelMix)) {
    const w = clampNumber(weight, 0);
    if (w <= 0) continue;
    const price = modelPrices[model];
    if (!price) continue;
    input += clampNumber(price.input, 0) * w;
    output += clampNumber(price.output, 0) * w;
    totalWeight += w;
  }
  if (totalWeight <= 0) {
    return { input: 0, output: 0 };
  }
  return {
    input: input / totalWeight,
    output: output / totalWeight,
  };
}

/**
 * @typedef {Object} TokenSavingsInput
 * @property {number} [blockedCalls=0]   gate-blocked tool calls
 * @property {number} [deflectedBots=0]  bot checkout deflections (PR #869)
 * @property {number} [avgInputTokensPerBlock]
 * @property {number} [avgOutputTokensPerBlock]
 * @property {Record<string, number>} [modelMix]    weighted model mix
 * @property {Record<string, {input:number,output:number}>} [modelPrices]
 *
 * @typedef {Object} TokenSavingsResult
 * @property {number} blockedCalls
 * @property {number} deflectedBots
 * @property {number} tokensSavedInput
 * @property {number} tokensSavedOutput
 * @property {number} tokensSavedTotal
 * @property {number} dollarsSaved
 * @property {string} dollarsSavedDisplay  e.g. "$0.47"
 * @property {string} tokensSavedDisplay   e.g. "127K"
 * @property {{input:number, output:number}} blendedPricePer1M
 * @property {Record<string,number>} modelMix
 */

/**
 * @param {TokenSavingsInput} input
 * @returns {TokenSavingsResult}
 */
function computeTokenSavings(input = {}) {
  const blockedCalls = clampNumber(input.blockedCalls, 0);
  const deflectedBots = clampNumber(input.deflectedBots, 0);
  const totalEvents = blockedCalls + deflectedBots;

  const avgInput = clampNumber(
    input.avgInputTokensPerBlock,
    DEFAULT_AVG_INPUT_TOKENS_PER_BLOCK,
  );
  const avgOutput = clampNumber(
    input.avgOutputTokensPerBlock,
    DEFAULT_AVG_OUTPUT_TOKENS_PER_BLOCK,
  );

  const modelMix = input.modelMix && Object.keys(input.modelMix).length
    ? input.modelMix
    : DEFAULT_MODEL_MIX;
  const modelPrices = input.modelPrices || DEFAULT_MODEL_PRICES;
  const blended = blendedPricePer1M(modelMix, modelPrices);

  const tokensSavedInput = totalEvents * avgInput;
  const tokensSavedOutput = totalEvents * avgOutput;
  const tokensSavedTotal = tokensSavedInput + tokensSavedOutput;

  const dollarsSaved = (tokensSavedInput * blended.input
    + tokensSavedOutput * blended.output) / 1_000_000;

  return {
    blockedCalls,
    deflectedBots,
    tokensSavedInput,
    tokensSavedOutput,
    tokensSavedTotal,
    dollarsSaved,
    dollarsSavedDisplay: formatDollars(dollarsSaved),
    tokensSavedDisplay: formatTokens(tokensSavedTotal),
    blendedPricePer1M: blended,
    modelMix: { ...modelMix },
  };
}

function formatDollars(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '$0.00';
  if (n >= 1000) return `$${Math.round(n).toLocaleString('en-US')}`;
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 10) return `$${n.toFixed(1)}`;
  if (n >= 0.01) return `$${n.toFixed(2)}`;
  if (n > 0) return `$${n.toFixed(4)}`;
  return '$0.00';
}

function formatTokens(count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(Math.round(n));
}

module.exports = {
  computeTokenSavings,
  formatDollars,
  formatTokens,
  blendedPricePer1M,
  DEFAULT_MODEL_PRICES,
  DEFAULT_MODEL_MIX,
  DEFAULT_AVG_INPUT_TOKENS_PER_BLOCK,
  DEFAULT_AVG_OUTPUT_TOKENS_PER_BLOCK,
};
