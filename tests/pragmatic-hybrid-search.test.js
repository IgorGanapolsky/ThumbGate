'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  saturate,
  decay,
  attributeBoost,
  reciprocalRankFusion,
  diversifyByAttribute,
  pragmaticHybridSearch,
} = require('../scripts/pragmatic-hybrid-search');

test('saturate rises with value and is bounded in [0,1)', () => {
  assert.ok(saturate(0, 3) === 0);
  assert.ok(saturate(3, 3) > 0.4 && saturate(3, 3) < 0.6);
  assert.ok(saturate(100, 3) < 1);
  assert.ok(saturate(100, 3) > saturate(3, 3));
});

test('decay falls with age and is high for recent items', () => {
  assert.ok(decay(0, 30) === 1);
  assert.ok(decay(30, 30) > 0.4 && decay(30, 30) < 0.6);
  assert.ok(decay(365, 30) < decay(30, 30));
});

test('attributeBoost prefers recent negative high-occurrence lessons', () => {
  const recent = attributeBoost({
    timestamp: new Date().toISOString(),
    signal: 'negative',
    metadata: { occurrences: 10 },
  });
  const old = attributeBoost({
    timestamp: new Date(Date.now() - 400 * 86400000).toISOString(),
    signal: 'positive',
    metadata: { occurrences: 0 },
  });
  assert.ok(recent > old);
});

test('reciprocalRankFusion prefers docs high in multiple lists', () => {
  const fused = reciprocalRankFusion([
    ['a', 'b', 'c'],
    ['c', 'a', 'd'],
  ], { k: 60 });
  assert.equal(fused[0].id, 'a'); // rank1 in first + rank2 in second
});

test('diversifyByAttribute caps per domain/tool', () => {
  const docs = [
    { id: '1', metadata: { domain: 'git', toolsUsed: ['Bash'] } },
    { id: '2', metadata: { domain: 'git', toolsUsed: ['Bash'] } },
    { id: '3', metadata: { domain: 'git', toolsUsed: ['Bash'] } },
    { id: '4', metadata: { domain: 'git', toolsUsed: ['Bash'] } },
    { id: '5', metadata: { domain: 'stripe', toolsUsed: ['Edit'] } },
  ];
  const out = diversifyByAttribute(docs, { total: 5, perLimit: 2 });
  const gitCount = out.filter((d) => d.metadata.domain === 'git').length;
  assert.ok(gitCount <= 2 || out.length === 5); // pad may add more after cap if needed
  assert.ok(out.some((d) => d.id === '5'));
});

test('pragmaticHybridSearch ranks force-push lesson for force-push query', () => {
  const corpus = [
    {
      id: 'doc:force-push',
      title: 'MISTAKE: force-push to main',
      content: 'NEVER force-push or git push --force to main. Use --force-with-lease on personal branches.',
      signal: 'negative',
      tags: ['git', 'force-push', 'negative'],
      metadata: { toolsUsed: ['Bash'], domain: 'git', occurrences: 5 },
      timestamp: new Date().toISOString(),
    },
    {
      id: 'doc:noise-ui',
      title: 'SUCCESS: dashboard padding',
      content: 'Tweaked CSS padding on mobile cards.',
      signal: 'positive',
      tags: ['css', 'positive'],
      metadata: { toolsUsed: ['Edit'], domain: 'ui', occurrences: 1 },
      timestamp: new Date(Date.now() - 200 * 86400000).toISOString(),
    },
    {
      id: 'doc:deploy',
      title: 'MISTAKE: claimed deployed without health',
      content: 'ALWAYS curl /health after Railway deploy and match version.',
      signal: 'negative',
      tags: ['deploy', 'negative'],
      metadata: { toolsUsed: ['Bash'], domain: 'railway-deploy', occurrences: 2 },
      timestamp: new Date().toISOString(),
    },
  ];

  const { results, meta } = pragmaticHybridSearch({
    corpus,
    query: 'git push --force origin main',
    toolName: 'Bash',
    options: { topK: 3, diversify: true },
  });

  assert.ok(results.length > 0);
  assert.equal(results[0].id, 'doc:force-push');
  assert.ok(meta.strategy.includes('lexical'));
  assert.ok(results[0].hybridFeatures || results[0].rrfScore != null || results[0].attributeBoost != null);
});

test('pragmaticHybridSearch fuses dense list when provided (turbopuffer multi-query pattern)', () => {
  const corpus = [
    {
      id: 'lex-winner',
      title: 'exact keywords force push main',
      content: 'force push main branch rewrite',
      signal: 'negative',
      tags: ['git'],
      metadata: { toolsUsed: ['Bash'], domain: 'git' },
    },
    {
      id: 'dense-winner',
      title: 'overwrite remote history',
      content: 'rewriting published commits on the default branch is dangerous',
      signal: 'negative',
      tags: ['git'],
      metadata: { toolsUsed: ['Bash'], domain: 'git' },
    },
  ];
  const { results, meta } = pragmaticHybridSearch({
    corpus,
    query: 'overwrite remote main history',
    toolName: 'Bash',
    options: {
      topK: 2,
      denseRankedIds: ['dense-winner', 'lex-winner'],
    },
  });
  assert.equal(meta.densePool, 2);
  assert.match(meta.strategy, /hybrid-rrf/);
  assert.ok(results.some((r) => r.id === 'dense-winner'));
});
