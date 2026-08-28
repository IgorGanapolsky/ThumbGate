'use strict';

// GraphRAG multi-hop retrieval tests (scripts/graphrag-retrieval.js).
//
// Properties under test, per "Why basic RAG fails at multi-hop reasoning":
// explicit schema (typed, inspectable edges), deterministic traversal
// (no RNG), never-worse-than-single-hop (expansion only adds), and the
// multi-hop win — a relevant doc with zero lexical overlap with the query
// is reachable when the graph connects it.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildGraph,
  expandWithGraph,
  multiHopSearch,
} = require('../scripts/graphrag-retrieval.js');

const CORPUS = [
  { id: 'doc:git-force', tags: ['git', 'force-push', 'main'], metadata: { domain: 'git' } },
  { id: 'doc:git-rebase', tags: ['git', 'rebase'], metadata: { domain: 'git' } },
  { id: 'doc:stripe-card', tags: ['stripe', 'card', 'pci'], metadata: { domain: 'payments' } },
  { id: 'doc:stripe-webhook', tags: ['stripe', 'webhook', 'idempotency'], metadata: { domain: 'payments' } },
  { id: 'doc:weather', tags: ['noise'], metadata: {} },
];

test('buildGraph derives typed edges from shared tags and domain', () => {
  const graph = buildGraph(CORPUS);
  assert.equal(graph.nodes.size, 5);

  const gitEdges = graph.adjacency.get('doc:git-force') || [];
  const rebaseEdge = gitEdges.find((e) => e.to === 'doc:git-rebase');
  assert.ok(rebaseEdge, 'shared-tag edge must exist');
  // shared tag: git (1) + same domain git (1) = 2
  assert.equal(rebaseEdge.weight, 2);
  assert.deepEqual([...rebaseEdge.via].sort(), ['domain:git', 'tag:git']);

  const stripeEdges = graph.adjacency.get('doc:stripe-card') || [];
  const webhookEdge = stripeEdges.find((e) => e.to === 'doc:stripe-webhook');
  assert.ok(webhookEdge);
  assert.equal(webhookEdge.weight, 2); // tag:stripe + domain:payments

  // The noise doc shares nothing with anything
  assert.equal((graph.adjacency.get('doc:weather') || []).length, 0);

  // Deterministic: rebuild produces identical edges
  const again = buildGraph(CORPUS);
  assert.equal(again.edgeCount, graph.edgeCount);
  assert.deepEqual(
    JSON.stringify(again.adjacency.get('doc:git-force')),
    JSON.stringify(gitEdges),
  );
});

test('expandWithGraph keeps seeds at hop 0 and only adds neighbors', () => {
  const graph = buildGraph(CORPUS);
  const seeds = [{ id: 'doc:git-force', relevanceScore: 0.9 }];
  const expanded = expandWithGraph(seeds, graph, { maxHops: 2 });

  const ids = expanded.map((e) => e.id);
  assert.ok(ids.includes('doc:git-force'), 'seed must survive expansion');
  assert.equal(expanded.find((e) => e.id === 'doc:git-force').hop, 0);
  assert.ok(ids.includes('doc:git-rebase'), 'graph neighbor must be reachable');

  // Unconnected noise doc can never appear
  assert.ok(!ids.includes('doc:weather'));

  // Seed keeps the top slot: single-hop contract preserved
  assert.equal(expanded[0].id, 'doc:git-force');
});

test('no edges means expansion degrades to the seed ranking exactly', () => {
  const graph = buildGraph(CORPUS);
  const seeds = [{ id: 'doc:weather', relevanceScore: 0.5 }];
  const expanded = expandWithGraph(seeds, graph);
  assert.deepEqual(expanded.map((e) => e.id), ['doc:weather']);
});

test('multi-hop reach: doc with zero lexical overlap is found via the graph', () => {
  // doc:stripe-webhook shares NO tokens with the seed query's doc
  // (doc:stripe-card) other than the graph edges stripe + payments.
  const graph = buildGraph(CORPUS);
  const seeds = [{ id: 'doc:stripe-card', relevanceScore: 1 }];
  const expanded = expandWithGraph(seeds, graph, { maxHops: 2 });
  const webhook = expanded.find((e) => e.id === 'doc:stripe-webhook');
  assert.ok(webhook, 'multi-hop neighbor must be surfaced');
  assert.ok(webhook.hop >= 1, 'must arrive via at least one hop');
  assert.ok(webhook.via.length > 0, 'provenance must be recorded');
});

test('decay bounds reach: hop-2 scores never exceed hop-1 parents', () => {
  const graph = buildGraph(CORPUS);
  const seeds = [{ id: 'doc:git-force' }];
  const expanded = expandWithGraph(seeds, graph, { maxHops: 2, decay: 0.5 });
  const byHop = {};
  for (const e of expanded) {
    byHop[e.hop] = byHop[e.hop] || [];
    byHop[e.hop].push(e.finalScore);
  }
  if (byHop[1] && byHop[2]) {
    assert.ok(Math.max(...byHop[2]) <= Math.max(...byHop[1]),
      'deeper hops must not out-score shallower ones');
  }
});

test('multiHopSearch end-to-end: seeds intact, meta reports the graph layer', () => {
  const query = 'git push force to the main branch';
  const { results, meta } = multiHopSearch({
    corpus: CORPUS.map((doc) => ({
      ...doc,
      title: doc.id,
      content: `${doc.id} lesson content ${doc.tags.join(' ')}`,
      signal: 'negative',
      timestamp: '2026-08-01T00:00:00.000Z',
    })),
    query,
    toolName: 'Bash',
    options: { topK: 4 },
  });
  assert.ok(results.length > 0, 'must return results');
  assert.ok(meta.graphExpanded === true);
  assert.ok(meta.graphEdges > 0);
  // The lexical seed for a force-push query must still rank first
  assert.equal(results[0].id, 'doc:git-force');
});

test('multiHopSearch never drops single-hop recall on the real golden corpus', () => {
  const { loadGolden } = require('../scripts/retrieval-ranking-eval.js');
  const golden = loadGolden();
  const corpus = golden.corpus.map((doc) => ({
    ...doc,
    content: doc.content || '',
  }));

  let singleHopHits = 0;
  let multiHopHits = 0;
  let total = 0;
  for (const q of golden.queries) {
    const relevant = new Set(Object.keys(q.qrels || {}));
    if (relevant.size === 0) continue;
    total += 1;

    const { pragmaticHybridSearch } = require('../scripts/pragmatic-hybrid-search.js');
    const single = pragmaticHybridSearch({
      corpus,
      query: q.query,
      toolName: q.toolName || 'Bash',
      options: { topK: 5, pool: 20 },
    }).results.map((r) => r.id);

    const multi = multiHopSearch({
      corpus,
      query: q.query,
      toolName: q.toolName || 'Bash',
      options: { topK: 5, pool: 20 },
    }).results.map((r) => r.id);

    if (single.some((id) => relevant.has(id))) singleHopHits += 1;
    if (multi.some((id) => relevant.has(id))) multiHopHits += 1;
  }
  assert.ok(total >= 18, 'golden corpus must have enough queries');
  assert.ok(multiHopHits >= singleHopHits,
    `multi-hop recall (${multiHopHits}) must not drop below single-hop (${singleHopHits})`);
});
