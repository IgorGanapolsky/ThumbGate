'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateHybridAblation,
} = require('../scripts/retrieval-hybrid-ablation');

test('production retrieval path shows measured hybrid lift over lexical on paraphrases', async () => {
  const result = await evaluateHybridAblation();
  assert.equal(result.passed, true);
  assert.equal(result.summary.mode, 'deterministic-semantic-fixture');
  assert.ok(result.summary.hybrid['recall@3'] >= 0.9);
  assert.ok(result.summary.lift.mrr > 0);
  assert.ok(result.summary.lift.ndcgAt3 > 0);
  assert.ok(result.hybridRows.every((row) => row.retrieval.densePool > 0));
  assert.ok(result.hybridRows.every((row) => row.retrieval.rerankApplied === true));
});
