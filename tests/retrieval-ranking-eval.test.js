'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateRankingGolden,
  rankCorpusForQuery,
  loadGolden,
} = require('../scripts/retrieval-ranking-eval');

test('golden corpus loads with qrels and thresholds', () => {
  const g = loadGolden();
  assert.ok(g.corpus.length >= 30);
  assert.ok(g.queries.length >= 100);
  assert.ok(g.thresholds.minMrr >= 0.6);
  assert.ok(g.thresholds.minRecallAt5 >= 0.8);
});

test('rankCorpusForQuery puts force-push doc first for exact force-push query', () => {
  const g = loadGolden();
  const q = g.queries.find((x) => x.id === 'exact-force-push');
  const { ranked } = rankCorpusForQuery(g.corpus, q, { topK: 5 });
  assert.equal(ranked[0].id, 'doc:force-push');
});

test('evaluateRankingGolden passes release thresholds on the gate scoring stack', () => {
  const result = evaluateRankingGolden();
  assert.equal(result.passed, true, result.failures.join('; '));
  assert.ok(result.summary.mrr >= 0.6);
  assert.ok(result.summary['recall@5'] >= 0.8);
  assert.ok(result.summary['ndcg@5'] >= 0.58);
  assert.ok(result.summary['precision@5'] >= 0.25);
  assert.ok(result.perQuery.length >= 100);
});

test('evaluateRankingGolden fails saturation check when every query hits 1.000', () => {
  const g = loadGolden();
  const trivial = {
    ...g,
    queries: [g.queries.find((x) => x.id === 'exact-force-push')],
    thresholds: { minQueries: 1, minMrr: 0.6, minRecallAt5: 0.8 },
  };
  trivial.queries[0] = { ...trivial.queries[0], qrels: { 'doc:force-push': 2 } };
  const result = evaluateRankingGolden({ golden: trivial });
  assert.equal(result.passed, false);
  assert.ok(result.failures.some((f) => f.startsWith('saturated:')));
});

test('evaluateRankingGolden fails closed when retrieval returns empty lists', () => {
  const golden = loadGolden();
  // Empty corpus → no ranked hits → metrics collapse
  const result = evaluateRankingGolden({
    golden: { ...golden, corpus: [], thresholds: { minMrr: 0.55, minRecallAt5: 0.75, minNdcgAt5: 0.55, minQueries: 1 } },
  });
  assert.equal(result.passed, false);
  assert.ok(result.summary.mrr === 0 || result.failures.length > 0);
});
