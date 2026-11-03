'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  ontology,
  createGraph,
  registerEntity,
  resolveEntity,
  proposeFact,
  constraintViolationRate,
  classifyRoute,
  retrieve,
  validateReadQuery,
  applyChanges,
  scoreGrounding,
} = require('../scripts/bounded-graph-route');

function entity(graph, spec) {
  const result = registerEntity(graph, spec);
  assert.equal(result.ok, true, result.reason);
  return result.id;
}

test('ontology stays inside the bounded class and relation counts and states four rules', () => {
  const spec = ontology();
  assert.match(spec.source, /emDutDLIiow/);
  assert.ok(spec.classes.length >= spec.bounds.minClasses);
  assert.ok(spec.classes.length <= spec.bounds.maxClasses);
  assert.equal(spec.classes.length, 12);
  assert.ok(spec.relations.length >= spec.bounds.minRelations);
  assert.ok(spec.relations.length <= spec.bounds.maxRelations);
  assert.equal(spec.relations.length, 11);
  for (const item of spec.classes) {
    assert.equal(typeof item.definition, 'string');
    assert.ok(item.definition.length > 10);
    assert.equal(typeof item.systemOfRecord, 'string');
    assert.ok(item.systemOfRecord.length > 0);
  }
  for (const item of spec.relations) {
    assert.ok(spec.classes.some((entry) => entry.name === item.from));
    assert.ok(spec.classes.some((entry) => entry.name === item.to));
    assert.match(item.cardinality, /^(1|n)\.\.(1|n)$/);
    assert.equal(item.direction, `${item.from}->${item.to}`);
  }
});

test('an illegal extraction increments the violation rate and writes no edge', () => {
  const graph = createGraph();
  entity(graph, { id: 'q1', type: 'question', label: 'Which gate fired?' });
  entity(graph, { id: 'g1', type: 'gate', label: 'Spend gate' });
  const refused = proposeFact(graph, { relation: 'asks_about', from: 'q1', to: 'g1' });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'endpoint_class');
  assert.equal(graph.edges.length, 0);
  entity(graph, { id: 'lesson-1', type: 'lesson', label: 'Spend lesson' });
  const kept = proposeFact(graph, { relation: 'asks_about', from: 'q1', to: 'lesson-1' });
  assert.equal(kept.ok, true);
  assert.equal(graph.edges.length, 1);
  assert.equal(constraintViolationRate(graph), 0.5);
});

test('Apex Labs, Apex Laboratories LTD, and Vendor ID 20417 resolve to one node', () => {
  const graph = createGraph();
  entity(graph, {
    id: 'vendor-20417',
    type: 'vendor',
    label: 'Apex Labs',
    aliases: ['Apex Laboratories LTD', 'Vendor ID 20417'],
  });
  assert.equal(resolveEntity(graph, 'Apex Labs'), 'vendor-20417');
  assert.equal(resolveEntity(graph, 'Apex Laboratories LTD'), 'vendor-20417');
  assert.equal(resolveEntity(graph, 'Vendor ID 20417'), 'vendor-20417');
  assert.equal(graph.nodes.size, 1);
});

test('the router sends the four question shapes to vector, local, hybrid, and global', () => {
  const graph = createGraph();
  entity(graph, {
    id: 'vendor-20417',
    type: 'vendor',
    label: 'Apex Labs',
    aliases: ['Apex Laboratories LTD', 'Vendor ID 20417'],
  });
  assert.equal(classifyRoute(graph, 'What does the refund paragraph say?'), 'vector');
  assert.equal(classifyRoute(graph, 'What do we know about Apex Labs?'), 'local');
  assert.equal(classifyRoute(graph, 'Why was the deploy blocked by the spend gate?'), 'hybrid');
  assert.equal(classifyRoute(graph, 'Summarize lessons across all repos'), 'global');
});

test('a write query and an unknown relation are rejected before execution', () => {
  const allowed = validateReadQuery({
    op: 'read',
    relation: 'blocked_by',
    fromClass: 'incident',
    toClass: 'gate',
  });
  assert.equal(allowed.ok, true);
  assert.equal(validateReadQuery({ op: 'read', cypher: 'MATCH (n) CREATE (m)' }).ok, false);
  assert.equal(validateReadQuery({ op: 'read', relation: 'invented_link' }).ok, false);
  assert.equal(validateReadQuery({ op: 'write', relation: 'blocked_by' }).ok, false);
  assert.equal(validateReadQuery({
    op: 'read',
    relation: 'blocked_by',
    fromClass: 'lesson',
    toClass: 'gate',
  }).reason, 'schema_path');

  const graph = createGraph();
  const refused = proposeFact(graph, { relation: 'invented_link', from: 'a', to: 'b' });
  assert.equal(refused.ok, false);
  assert.equal(graph.edges.length, 0);
});

test('an expired edge is not traversed and a private node is omitted', () => {
  const graph = createGraph();
  entity(graph, { id: 'incident-1', type: 'incident', label: 'Deploy incident', passage: 'Deploy incident text' });
  entity(graph, { id: 'gate-1', type: 'gate', label: 'Spend gate', passage: 'Spend gate text' });
  entity(graph, { id: 'tool-1', type: 'tool', label: 'Deploy tool', passage: 'Deploy tool text' });
  entity(graph, {
    id: 'secret-source',
    type: 'source',
    label: 'Hidden source',
    passage: 'private fact',
    acl: ['owner'],
  });
  entity(graph, {
    id: 'public-source',
    type: 'source',
    label: 'Public source',
    passage: 'public fact',
  });
  proposeFact(graph, {
    relation: 'blocked_by',
    from: 'incident-1',
    to: 'gate-1',
    validFrom: '2020-01-01',
    validTo: '2021-01-01',
  });
  proposeFact(graph, {
    relation: 'caused_by',
    from: 'incident-1',
    to: 'tool-1',
    validFrom: '2020-01-01',
  });

  const hopped = retrieve(graph, {
    query: 'Why was Deploy incident caused?',
    asOf: '2024-01-01',
    reader: 'stranger',
  });
  assert.equal(hopped.mode, 'hybrid');
  assert.ok(hopped.nodes.some((node) => node.id === 'tool-1'));
  assert.equal(hopped.nodes.some((node) => node.id === 'gate-1'), false);
  assert.equal(hopped.edges.some((edge) => edge.relation === 'blocked_by'), false);
  assert.equal(hopped.nodes.some((node) => node.id === 'secret-source'), false);

  const lookedUp = retrieve(graph, {
    query: 'What does the paragraph say about fact?',
    reader: 'stranger',
  });
  assert.equal(lookedUp.mode, 'vector');
  assert.deepEqual(lookedUp.nodes.map((node) => node.id), ['public-source']);
  assert.equal(lookedUp.edges.length, 0);

  const ownerView = retrieve(graph, {
    query: 'What does the paragraph say about fact?',
    reader: 'owner',
    mode: 'vector',
  });
  assert.deepEqual(ownerView.nodes.map((node) => node.id), ['secret-source']);
});

test('a change retires one edge and leaves the other node in place', () => {
  const graph = createGraph();
  entity(graph, { id: 'repo-1', type: 'repo', label: 'ThumbGate repo' });
  entity(graph, { id: 'actor-1', type: 'actor', label: 'Session actor' });
  entity(graph, { id: 'lesson-9', type: 'lesson', label: 'Untouched lesson' });
  proposeFact(graph, { relation: 'owned_by', from: 'repo-1', to: 'actor-1', validFrom: '2024-01-01' });
  const result = applyChanges(graph, [{
    op: 'retire_edge',
    relation: 'owned_by',
    from: 'repo-1',
    to: 'actor-1',
    validTo: '2024-06-01',
  }]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.dropped, []);
  assert.equal(graph.nodes.has('lesson-9'), true);
  assert.equal(graph.nodes.size, 3);
  assert.equal(graph.edges[0].validTo, '2024-06-01');
  const later = retrieve(graph, {
    query: 'What do we know about ThumbGate repo?',
    asOf: '2025-01-01',
  });
  assert.equal(later.mode, 'local');
  assert.equal(later.edges.length, 0);
});

test('grounding distinguishes a true citation from a mis-citation', () => {
  const retrieval = {
    nodes: [
      { id: 's1', passage: 'The gate blocked the deploy.' },
      { id: 's2', passage: 'Unrelated note.' },
    ],
  };
  const scores = scoreGrounding(retrieval, [
    { text: 'The gate blocked the deploy.', sourceId: 's1' },
    { text: 'The gate blocked the deploy.', sourceId: 's2' },
  ]);
  assert.equal(scores.faithfulness, 1);
  assert.equal(scores.citationAccuracy, 0.5);
});

test('global mode summarizes a community without a clustering library', () => {
  const graph = createGraph();
  entity(graph, { id: 'l1', type: 'lesson', label: 'Beta lesson', communityId: 'lessons' });
  entity(graph, { id: 'l2', type: 'lesson', label: 'Alpha lesson', communityId: 'lessons' });
  const result = retrieve(graph, { query: 'Summarize lessons across all repos' });
  assert.equal(result.mode, 'global');
  assert.equal(result.communities.length, 1);
  assert.equal(result.communities[0].summary, 'Alpha lesson; Beta lesson');
  const source = fs.readFileSync(path.join(__dirname, '../scripts/bounded-graph-route.js'), 'utf8');
  assert.equal(/leiden/i.test(source), false);
});

test('the ontology command prints the class list', () => {
  const result = spawnSync(process.execPath, ['scripts/bounded-graph-route.js', '--ontology'], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.classes.length, 12);
  assert.equal(body.relations.length, 11);
});
