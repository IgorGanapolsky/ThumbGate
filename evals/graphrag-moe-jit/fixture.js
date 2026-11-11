'use strict';

// Deterministic in-memory graph for the ReAct GraphRAG eval. No database, no network.

const SCHEMA = Object.freeze({
  labels: ['Gate', 'Lesson', 'FailureClass', 'File'],
  relationships: ['PREVENTS', 'GATED_BY', 'LEARNED_FROM'],
});

const NODES = Object.freeze([
  { id: 'gate:force-push', label: 'Gate', name: 'block force-push to main' },
  { id: 'fc:history-rewrite', label: 'FailureClass', name: 'shared history rewrite' },
  { id: 'lesson:42', label: 'Lesson', name: 'never force-push main' },
  { id: 'scripts/gates-engine.js', label: 'File', name: 'gates-engine' },
]);

const EDGES = Object.freeze([
  { from: 'gate:force-push', rel: 'PREVENTS', to: 'fc:history-rewrite' },
  { from: 'gate:force-push', rel: 'LEARNED_FROM', to: 'lesson:42' },
  { from: 'scripts/gates-engine.js', rel: 'GATED_BY', to: 'gate:force-push' },
]);

function neighbors(fromId, rel) {
  return EDGES.filter((e) => e.from === fromId && e.rel === rel).map((e) => NODES.find((n) => n.id === e.to));
}

module.exports = { SCHEMA, NODES, EDGES, neighbors };
