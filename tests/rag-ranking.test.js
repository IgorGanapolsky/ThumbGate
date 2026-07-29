'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  bm25Rank,
  expandSafetyQuery,
  reciprocalRankFusion,
  rerankCandidates,
  rewriteQuery,
} = require('../scripts/rag-ranking');

const candidates = [
  {
    id: 'exact',
    title: 'Railway deployment health',
    context: 'Verify the Railway deployment build SHA and health endpoint before saying production is ready.',
    source: 'document',
    isCurrent: true,
    trustLevel: 'trusted',
    timestamp: '2026-07-29T00:00:00.000Z',
  },
  {
    id: 'tangential',
    title: 'General health',
    context: 'Healthy teams plan quarterly deployment retrospectives.',
    source: 'feedback',
    isCurrent: true,
    trustLevel: 'trusted',
    timestamp: '2026-07-29T00:00:00.000Z',
  },
  {
    id: 'stale',
    title: 'Old Railway notes',
    context: 'Railway deployment health endpoint and build SHA.',
    source: 'document',
    isCurrent: false,
    trustLevel: 'trusted',
    timestamp: '2024-01-01T00:00:00.000Z',
  },
];

test('BM25 rewards rare exact terms and phrase evidence', () => {
  const ranked = bm25Rank('Railway deployment build SHA health', candidates);
  const exact = ranked.find((entry) => entry.id === 'exact');
  const tangential = ranked.find((entry) => entry.id === 'tangential');
  assert.ok(exact.bm25Score > tangential.bm25Score);
});

test('RRF combines lexical and semantic ranks without mixing raw score scales', () => {
  const fused = reciprocalRankFusion([
    [{ id: 'a' }, { id: 'b' }],
    [{ id: 'b' }, { id: 'c' }],
  ]);
  assert.equal(fused[0].id, 'b');
  assert.deepEqual(fused[0].retrievalRanks, [
    { list: 0, rank: 2 },
    { list: 1, rank: 1 },
  ]);
});

test('RRF preserves lexical and vector evidence for cross-signal reranking', () => {
  const fused = reciprocalRankFusion([
    [{ id: 'shared', bm25Score: 4.2, context: 'deployment proof' }],
    [{ id: 'shared', vectorScore: 0.91, vectorDistance: 0.09 }],
  ]);
  assert.equal(fused.length, 1);
  assert.equal(fused[0].bm25Score, 4.2);
  assert.equal(fused[0].vectorScore, 0.91);
  assert.equal(fused[0].vectorDistance, 0.09);

  const reranked = rerankCandidates('deployment proof', fused);
  assert.equal(reranked[0].rerankFeatures.normalizedBm25, 1);
  assert.equal(reranked[0].rerankFeatures.normalizedVector, 1);
});

test('cross-signal vector evidence breaks an otherwise symmetric lexical/RRF tie', () => {
  const shared = {
    context: 'production deployment evidence',
    isCurrent: true,
    trustLevel: 'trusted',
    timestamp: '2026-07-29T00:00:00.000Z',
  };
  const fused = reciprocalRankFusion([
    [
      { ...shared, id: 'lexical-only', bm25Score: 1 },
      { ...shared, id: 'hybrid-winner', bm25Score: 1 },
    ],
    [
      { ...shared, id: 'hybrid-winner', vectorScore: 0.95, vectorDistance: 0.05 },
      { ...shared, id: 'lexical-only', vectorScore: 0.2, vectorDistance: 0.8 },
    ],
  ]);
  const reranked = rerankCandidates('production deployment evidence', fused, {
    nowMs: Date.parse('2026-07-29T12:00:00.000Z'),
  });
  assert.equal(reranked[0].id, 'hybrid-winner');
  assert.ok(reranked[0].rerankScore > reranked[1].rerankScore);
});

test('bounded reranking promotes complete current evidence and suppresses stale rows', () => {
  const lexical = bm25Rank('Railway deployment build SHA health', candidates);
  const fused = reciprocalRankFusion([lexical]);
  const reranked = rerankCandidates('Railway deployment build SHA health', fused, {
    nowMs: Date.parse('2026-07-29T12:00:00.000Z'),
  });
  assert.equal(reranked[0].id, 'exact');
  assert.equal(reranked.find((entry) => entry.id === 'stale').rerankScore, 0);
});

test('query rewriting expands ambiguous follow-ups but preserves exact identifiers', () => {
  const rewritten = rewriteQuery(
    'How do I fix that?',
    'The Railway production deployment failed its build SHA health verification.',
  );
  assert.equal(rewritten.applied, true);
  assert.match(rewritten.rewritten, /railway/);
  assert.match(rewritten.rewritten, /deployment/);

  const exact = rewriteQuery(
    'Why did PR TG-184 fail at /v1/health?',
    'The Railway production deployment failed.',
  );
  assert.equal(exact.applied, false);
  assert.equal(exact.rewritten, exact.original);
});

test('deterministic safety expansion improves implied-risk recall without rewriting exact identifiers', () => {
  const database = expandSafetyQuery('Drop the users table in production');
  assert.equal(database.applied, true);
  assert.match(database.rewritten, /backup/);
  assert.match(database.rewritten, /rollback/);

  const unbounded = expandSafetyQuery('UPDATE customers for every row');
  assert.match(unbounded.rewritten, /restrictive/);
  assert.match(unbounded.rewritten, /where/);

  const exact = expandSafetyQuery('Why did TG-184 fail at /v1/health?');
  assert.equal(exact.applied, false);
});
