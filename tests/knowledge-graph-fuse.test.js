'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  fuseKnowledgeGraph,
  evaluateFusionAblation,
  reciprocalRankFusion,
  resolveEntities,
  edgeIsActive,
} = require('../scripts/knowledge-graph-fuse');

const graph = {
  nodes: [
    { id: 'claim', name: 'CLM-1042' },
    { id: 'triage', aliases: ['Level 1'] },
    { id: 'policy' },
    { id: 'endorsement' },
  ],
  edges: [
    { from: 'claim', to: 'triage', type: 'APPLIES_TO', validFrom: '2026-02-01' },
    { from: 'triage', to: 'policy', type: 'EXPLAINED_BY', validFrom: '2026-02-01' },
    { from: 'triage', to: 'endorsement', type: 'CONTRADICTS', validFrom: '2026-01-01' },
  ],
};

test('caller wiki-first / search-only modes are rejected', () => {
  const denied = fuseKnowledgeGraph({ mode: 'wiki_first', searchHits: [{ id: 'claim' }], ...graph });
  assert.equal(denied.decision, 'deny');
  assert.ok(denied.issues.includes('caller_mode_rejected'));
});

test('always-fused pipeline expands search anchors one to two hops', () => {
  const fused = fuseKnowledgeGraph({ searchHits: [{ id: 'claim', score: 1 }], ...graph });
  assert.equal(fused.pipeline, 'always_fused');
  assert.ok(fused.fusedIds.includes('claim'));
  assert.ok(fused.fusedIds.includes('triage'));
  assert.ok(fused.fusedIds.includes('policy'));
  assert.ok(fused.paths.some((path) => path.type === 'APPLIES_TO'));
  assert.equal(fused.timeIsFilter, true);
});

test('time filters edges; expired relationships do not expand', () => {
  const asOf = fuseKnowledgeGraph({
    searchHits: [{ id: 'claim' }],
    ...graph,
    edges: [
      { from: 'claim', to: 'triage', type: 'APPLIES_TO', validFrom: '2026-03-01' },
    ],
    asOf: '2026-02-15T00:00:00.000Z',
  });
  assert.equal(asOf.paths.length, 0);
  assert.deepEqual(asOf.fusedIds, ['claim']);
});

test('malformed temporal bounds fail closed instead of activating the edge', () => {
  assert.equal(
    edgeIsActive({ validFrom: 'bad' }, '2026-02-15T00:00:00.000Z'),
    false,
  );
  assert.equal(
    edgeIsActive({ validFrom: '2026-01-01', validTo: 'not-a-date' }, '2026-02-15T00:00:00.000Z'),
    false,
  );
  const fused = fuseKnowledgeGraph({
    searchHits: [{ id: 'claim' }],
    nodes: graph.nodes,
    edges: [{ from: 'claim', to: 'triage', type: 'APPLIES_TO', validFrom: 'bad' }],
    asOf: '2026-02-15T00:00:00.000Z',
  });
  assert.equal(fused.paths.length, 0);
  assert.deepEqual(fused.fusedIds, ['claim']);
});

test('contradicts edges decline to settle instead of picking a side', () => {
  const fused = fuseKnowledgeGraph({ searchHits: [{ id: 'claim' }], ...graph });
  assert.equal(fused.answerAllowed, false);
  assert.ok(fused.contradictions.length >= 1);
  assert.match(fused.claimBoundary, /declines to settle/);
});

test('two-threshold resolution auto-merges aliases, reviews the gray zone, and does not call an LLM', () => {
  const canonical = [{ id: 'acv', name: 'Actual cash value', aliases: ['ACV'] }];
  const alias = resolveEntities(['ACV'], canonical);
  assert.equal(alias[0].decision, 'auto_merge');
  const gray = resolveEntities(
    ['cash settlement basis'],
    canonical,
    { similarity: () => 0.84 },
  );
  assert.equal(gray[0].decision, 'review');
  assert.equal(gray[0].reason, 'gray_zone_requires_adjudication');
  const fresh = resolveEntities(['unrelated concept'], canonical, { similarity: () => 0.1 });
  assert.equal(fresh[0].decision, 'new_entity');
});

test('ablation is the acceptance test and requires enough golden cases', () => {
  const thin = evaluateFusionAblation({ cases: [{ searchHits: [{ id: 'claim' }], expectedNodeIds: ['claim'] }] });
  assert.equal(thin.decision, 'deny');
  assert.ok(thin.issues.includes('insufficient_golden_cases'));

  const cases = Array.from({ length: 6 }, () => ({
    searchHits: [{ id: 'claim' }],
    expectedNodeIds: ['claim', 'triage'],
    expectedPathTypes: ['APPLIES_TO'],
    nodes: graph.nodes,
    edges: graph.edges,
  }));
  const ablation = evaluateFusionAblation({ cases });
  assert.equal(ablation.decision, 'allow');
  assert.ok(ablation.metrics.fusedRecall >= 0.95);
  assert.ok(ablation.metrics.precision >= 0.15);
  assert.equal(ablation.metrics.perCaseRecall, 1);
  assert.match(ablation.claimBoundary, /not Cosmos Gremlin/);

  const weak = evaluateFusionAblation({
    cases: Array.from({ length: 6 }, () => ({
      searchHits: [{ id: 'claim' }],
      expectedNodeIds: ['missing-policy', 'missing-endorsement'],
      nodes: graph.nodes,
      edges: graph.edges,
    })),
  });
  assert.equal(weak.decision, 'deny');
  assert.ok(weak.issues.includes('recall_below_0.95'));
  assert.ok(weak.issues.includes('per_case_recall_not_100'));
});

test('RRF is deterministic', () => {
  assert.deepEqual(
    reciprocalRankFusion([['a', 'b'], ['b', 'c']]).map((row) => row.id),
    reciprocalRankFusion([['a', 'b'], ['b', 'c']]).map((row) => row.id),
  );
});

test('CLI rejected caller mode exits 2 without crashing formatText', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kgf-'));
  const graphPath = path.join(dir, 'wiki.json');
  fs.writeFileSync(graphPath, JSON.stringify({
    mode: 'wiki_first',
    nodes: [{ id: 'claim' }],
    edges: [],
    searchHits: [{ id: 'claim' }],
  }));
  const cli = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'knowledge-graph-fuse.js'),
    '--graph', graphPath,
  ], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(cli.status, 2, cli.stderr + cli.stdout);
  assert.match(cli.stdout, /decision=deny/);
  assert.doesNotMatch(cli.stderr + cli.stdout, /TypeError/);
});

test('supplied graph without cases fail-closes ablation on insufficient golden cases', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kgf-'));
  const graphPath = path.join(dir, 'empty-cases.json');
  fs.writeFileSync(graphPath, JSON.stringify({
    nodes: [{ id: 'claim' }],
    edges: [],
    searchHits: [{ id: 'claim' }],
  }));
  const cli = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'knowledge-graph-fuse.js'),
    '--graph', graphPath,
    '--ablate',
    '--json',
  ], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(cli.status, 2, cli.stderr + cli.stdout);
  const payload = JSON.parse(cli.stdout);
  assert.ok(payload.ablation.issues.includes('insufficient_golden_cases'));
});

test('CLI demo declines to settle the seeded contradiction and does not claim Azure', () => {
  const cli = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'knowledge-graph-fuse.js'),
    '--ablate',
  ], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /always_fused|pipeline=always_fused/);
  assert.match(cli.stdout, /answerAllowed=false/);
  assert.doesNotMatch(cli.stdout, /Cosmos DB for Apache Gremlin is live/);
});
