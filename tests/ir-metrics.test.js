'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  recallAtK,
  precisionAtK,
  reciprocalRank,
  mrrAtK,
  ndcgAtK,
  scoreRanking,
  aggregateRankingScores,
} = require('../scripts/ir-metrics');

const ranked = [
  { id: 'a' },
  { id: 'b' },
  { id: 'c' },
  { id: 'd' },
];

test('recallAtK is fraction of relevant docs found in top-k', () => {
  const qrels = { a: 2, c: 1, z: 2 };
  // relevant = a,c,z (3). top-2 has a only → 1/3
  assert.ok(Math.abs(recallAtK(ranked, qrels, 2) - 1 / 3) < 1e-9);
  // top-3 has a,c → 2/3
  assert.ok(Math.abs(recallAtK(ranked, qrels, 3) - 2 / 3) < 1e-9);
});

test('precisionAtK uses fixed k denominator', () => {
  const qrels = { a: 1, b: 1 };
  assert.equal(precisionAtK(ranked, qrels, 4), 0.5);
  assert.equal(precisionAtK([], qrels, 5), 0);
});

test('MRR is 1/rank of first relevant', () => {
  const qrels = { c: 2 };
  assert.equal(reciprocalRank(ranked, qrels), 1 / 3);
  assert.equal(mrrAtK(ranked, qrels, 2), 0); // c not in top-2
  assert.equal(mrrAtK(ranked, qrels, 3), 1 / 3);
});

test('nDCG@k rewards higher grades earlier', () => {
  const qrels = { a: 2, b: 1 };
  const perfect = ndcgAtK([{ id: 'a' }, { id: 'b' }], qrels, 2);
  const swapped = ndcgAtK([{ id: 'b' }, { id: 'a' }], qrels, 2);
  assert.ok(perfect > swapped);
  assert.ok(perfect <= 1 + 1e-9);
  assert.ok(perfect >= 0.99); // ideal order
});

test('scoreRanking and aggregateRankingScores produce means', () => {
  const qrels = { a: 2 };
  const one = scoreRanking(ranked, qrels, { kValues: [1, 5] });
  assert.equal(one.mrr, 1);
  assert.equal(one['recall@1'], 1);
  const agg = aggregateRankingScores([one, one], { kValues: [1, 5] });
  assert.equal(agg.mrr, 1);
  assert.equal(agg.queries, 2);
});
