'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  computeTokenSavings,
  formatDollars,
  formatTokens,
  blendedPricePer1M,
  DEFAULT_MODEL_PRICES,
  DEFAULT_MODEL_MIX,
  DEFAULT_AVG_INPUT_TOKENS_PER_BLOCK,
  DEFAULT_AVG_OUTPUT_TOKENS_PER_BLOCK,
} = require('../scripts/token-savings');

describe('token-savings', () => {
  describe('computeTokenSavings', () => {
    it('returns zero when nothing is blocked', () => {
      const r = computeTokenSavings({});
      assert.equal(r.blockedCalls, 0);
      assert.equal(r.deflectedBots, 0);
      assert.equal(r.tokensSavedTotal, 0);
      assert.equal(r.dollarsSaved, 0);
      assert.equal(r.dollarsSavedDisplay, '$0.00');
      assert.equal(r.tokensSavedDisplay, '0');
    });

    it('linearly scales with blockedCalls', () => {
      const a = computeTokenSavings({ blockedCalls: 1 });
      const b = computeTokenSavings({ blockedCalls: 10 });
      // 10x calls = 10x tokens (and 10x dollars within FP tolerance)
      assert.equal(b.tokensSavedTotal, a.tokensSavedTotal * 10);
      assert.ok(Math.abs(b.dollarsSaved - a.dollarsSaved * 10) < 1e-9);
    });

    it('treats deflectedBots equivalently to blockedCalls by default', () => {
      const a = computeTokenSavings({ blockedCalls: 5 });
      const b = computeTokenSavings({ deflectedBots: 5 });
      assert.equal(a.tokensSavedTotal, b.tokensSavedTotal);
      assert.equal(a.dollarsSaved, b.dollarsSaved);
    });

    it('uses the documented defaults', () => {
      const r = computeTokenSavings({ blockedCalls: 1 });
      assert.equal(r.tokensSavedInput, DEFAULT_AVG_INPUT_TOKENS_PER_BLOCK);
      assert.equal(r.tokensSavedOutput, DEFAULT_AVG_OUTPUT_TOKENS_PER_BLOCK);
      assert.equal(r.tokensSavedTotal, DEFAULT_AVG_INPUT_TOKENS_PER_BLOCK + DEFAULT_AVG_OUTPUT_TOKENS_PER_BLOCK);
    });

    it('honors a custom model mix', () => {
      // Pure Opus at $15/$75 vs default Sonnet-heavy blend
      const opusOnly = computeTokenSavings({
        blockedCalls: 100,
        modelMix: { 'claude-opus-4-6': 1 },
      });
      const sonnetHeavy = computeTokenSavings({ blockedCalls: 100 });
      assert.ok(opusOnly.dollarsSaved > sonnetHeavy.dollarsSaved,
        'Opus-only mix should cost more, so saving more');
    });

    it('honors custom avg tokens per block', () => {
      const small = computeTokenSavings({
        blockedCalls: 10,
        avgInputTokensPerBlock: 100,
        avgOutputTokensPerBlock: 50,
      });
      assert.equal(small.tokensSavedInput, 1000);
      assert.equal(small.tokensSavedOutput, 500);
      assert.equal(small.tokensSavedTotal, 1500);
    });

    it('rejects negative inputs gracefully', () => {
      const r = computeTokenSavings({ blockedCalls: -42, deflectedBots: -1 });
      assert.equal(r.blockedCalls, 0);
      assert.equal(r.deflectedBots, 0);
      assert.equal(r.tokensSavedTotal, 0);
    });

    it('falls back gracefully when modelMix has no priced models', () => {
      const r = computeTokenSavings({
        blockedCalls: 100,
        modelMix: { 'fictional-model': 1 },
      });
      // Token count still scales; dollars defaults to 0 because no price
      assert.ok(r.tokensSavedTotal > 0);
      assert.equal(r.dollarsSaved, 0);
    });

    it('produces sensible Sonnet-blended dollar estimate for 100 blocks', () => {
      // 100 blocks * (2000 in + 600 out) = 200K input + 60K output
      // Sonnet $3 in / $15 out ≈ $0.60 + $0.90 = $1.50 (ish, blended is slightly higher)
      const r = computeTokenSavings({ blockedCalls: 100 });
      assert.ok(r.dollarsSaved > 1.0 && r.dollarsSaved < 5.0,
        `expected $1-$5 saved for 100 blocks under default mix, got $${r.dollarsSaved}`);
    });
  });

  describe('blendedPricePer1M', () => {
    it('matches single-model price when mix is 100% one model', () => {
      const r = blendedPricePer1M({ 'claude-sonnet-4-5': 1 }, DEFAULT_MODEL_PRICES);
      assert.equal(r.input, 3.0);
      assert.equal(r.output, 15.0);
    });

    it('renormalizes when weights do not sum to 1', () => {
      const r = blendedPricePer1M({ 'claude-sonnet-4-5': 2, 'claude-opus-4-6': 2 }, DEFAULT_MODEL_PRICES);
      // 50/50 of $3+$15 → $9 input
      assert.equal(r.input, 9.0);
      assert.equal(r.output, 45.0);
    });

    it('returns zero when weights sum to zero', () => {
      const r = blendedPricePer1M({}, DEFAULT_MODEL_PRICES);
      assert.equal(r.input, 0);
      assert.equal(r.output, 0);
    });
  });

  describe('formatDollars', () => {
    it('formats sub-dollar amounts to 2 decimals', () => {
      assert.equal(formatDollars(0.47), '$0.47');
      assert.equal(formatDollars(0.02), '$0.02');
    });
    it('keeps tiny amounts visible', () => {
      assert.equal(formatDollars(0.0042), '$0.0042');
    });
    it('rounds large amounts', () => {
      assert.equal(formatDollars(127), '$127');
      assert.equal(formatDollars(12.5), '$12.5');
    });
    it('handles bad input', () => {
      assert.equal(formatDollars(NaN), '$0.00');
      assert.equal(formatDollars(undefined), '$0.00');
    });
  });

  describe('formatTokens', () => {
    it('formats thousands as K', () => {
      assert.equal(formatTokens(1500), '2K');
      assert.equal(formatTokens(127000), '127K');
    });
    it('formats millions as M', () => {
      assert.equal(formatTokens(2_500_000), '2.5M');
    });
    it('formats billions as B', () => {
      assert.equal(formatTokens(3_200_000_000), '3.2B');
    });
    it('handles small values', () => {
      assert.equal(formatTokens(42), '42');
      assert.equal(formatTokens(0), '0');
    });
  });

  describe('integration: dashboard hero counter scenario', () => {
    it('produces the kind of numbers we want to put on the landing page', () => {
      // A modest team: 250 blocks/week + 80 bot deflections/week
      const r = computeTokenSavings({
        blockedCalls: 250,
        deflectedBots: 80,
      });
      // Should be a few dollars/week of savings
      assert.ok(r.dollarsSaved > 2, `expected >$2/wk, got ${r.dollarsSavedDisplay}`);
      assert.ok(r.dollarsSaved < 50, `expected <$50/wk, got ${r.dollarsSavedDisplay}`);
      assert.match(r.dollarsSavedDisplay, /^\$\d/);
      assert.match(r.tokensSavedDisplay, /K|M/);
    });
  });
});
