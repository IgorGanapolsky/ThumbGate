'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ENTITY_TYPES,
  RELATION_TYPES,
  canonicalSchema,
  normalizeEntity,
  classifyEntity,
  buildGraph,
  traverseOneHop,
  ingestionBudget,
  dumpGraph,
} = require('../scripts/graphrag-schema-first-multi-hop');

const LESSONS = [
  {
    id: 'L1',
    title: 'payment incident: double charge on checkout',
    domain: 'checkout',
    rootCause: 'retry storm',
    tags: ['stripe', 'payment'],
    receipt: 'CI run 33193632534',
  },
  {
    id: 'L2',
    title: 'acme corporation rate-limit outage',
    domain: 'acme corp',
    rootCause: 'missing backoff',
    tags: ['vendor'],
  },
];

test('schema enumerates every entity and relation type', () => {
  const s = canonicalSchema();
  assert.deepEqual(s.entityTypes, [...ENTITY_TYPES]);
  assert.deepEqual(s.relationTypes, [...RELATION_TYPES]);
  assert.equal(s.modeled, false);
  assert.equal(new URL(s.source).hostname, 'thenewstack.io');
});

test('alias folding kills the Acme Corp / Acme Corporation / Ame problem', () => {
  assert.equal(normalizeEntity('Acme Corporation'), normalizeEntity('acme corp'));
  assert.equal(normalizeEntity('  Foo   LLC '), 'foo');
  assert.equal(normalizeEntity('x'), null); // degenerate mention refused
  assert.equal(normalizeEntity(null), null);
});

test('classifier keeps entities inside the schema', () => {
  assert.equal(classifyEntity('thumbgate'), 'tool');
  assert.equal(classifyEntity('spend guard gate'), 'guard');
  assert.equal(classifyEntity('stripe outage incident'), 'incident');
  assert.equal(classifyEntity('some unknown vendor'), 'vendor');
  assert.equal(classifyEntity('anything', { type: 'receipt' }), 'receipt');
});

test('buildGraph folds aliases into one node, not three', () => {
  const lessons = [
    { id: 'A', title: 'outage one', domain: 'acme corp', tags: [] },
    { id: 'B', title: 'outage two', domain: 'acme corporation', tags: [] },
    { id: 'C', title: 'outage three', domain: 'ACME', tags: [] },
  ];
  const g = buildGraph(lessons);
  const acme = g.nodes.filter((n) => n.id === 'acme');
  assert.equal(acme.length, 1, 'alias variants must collapse to one canonical node');
  assert.deepEqual(acme[0].sources.sort(), ['A', 'B', 'C']);
});

test('multi-hop query returns typed one-hop context, not flat chunks', () => {
  const g = buildGraph(LESSONS);
  const hops = traverseOneHop(g, 'acme rate limit outage');
  assert.ok(hops.length > 0, 'must find the Acme entry point');
  const top = hops[0];
  assert.ok(RELATION_TYPES.includes(top.relation));
  assert.equal(typeof top.entity, 'string');
  assert.equal(typeof top.neighbor, 'string');
  assert.ok(top.entryScore >= 1);
});

test('multi-hop beats flat recall: related tag arrives via typed edge', () => {
  const g = buildGraph(LESSONS);
  const hops = traverseOneHop(g, 'payment incident double charge');
  const relations = hops.map((h) => h.relation);
  assert.ok(relations.includes('governed_by'), 'stripe/payment tag hops in over governed_by');
  assert.ok(relations.includes('evidenced_by'), 'receipt hops in over evidenced_by');
});

test('self-loops and unknown relations are refused', () => {
  const g = buildGraph(LESSONS);
  // domain node equals rootCause would self-loop; structure forbids it
  for (const e of g.edges) assert.notEqual(e.from, e.to);
});

test('ingestion budget is modeled and bounded', () => {
  const b = ingestionBudget(100);
  assert.equal(b.modeled, true);
  assert.equal(b.maxExtractions, 400);
  assert.ok(b.estimatedCostUsd > 0);
  const b2 = ingestionBudget(100, { entitiesPerLesson: 1 });
  assert.equal(b2.maxExtractions, 100);
});

test('dumpGraph is a human-readable audit surface', () => {
  const g = buildGraph(LESSONS);
  const dumped = JSON.parse(dumpGraph(g));
  assert.equal(dumped.nodeCount, g.nodes.length);
  assert.equal(dumped.edgeCount, g.edges.length);
  assert.equal(dumped.schemaId, 'graphrag-canonical-v1');
});

test('empty inputs fail closed, not crash', () => {
  const g = buildGraph([]);
  assert.deepEqual(g.nodes, []);
  assert.deepEqual(traverseOneHop(g, 'anything'), []);
});
