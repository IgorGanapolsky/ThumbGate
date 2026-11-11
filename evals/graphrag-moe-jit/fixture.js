'use strict';

// Deterministic in-memory graph for the ReAct GraphRAG eval. No database, no network.

const SCHEMA = Object.freeze({
  labels: ['Gate', 'Lesson', 'FailureClass'],
  relationshipTypes: ['PREVENTS', 'LEARNED_FROM'],
  propertyKeys: ['id', 'name'],
});

// Exact query text -> rows. Anything else returns no rows.
const ROWS = Object.freeze({
  "MATCH (g:Gate)-[:PREVENTS]->(f:FailureClass {name: 'shared history rewrite'}) RETURN g.id AS gate LIMIT 5":
    [{ gate: 'gate:force-push' }],
  "MATCH (g:Gate {id: 'gate:force-push'})-[:LEARNED_FROM]->(l:Lesson) RETURN l.name AS lesson LIMIT 5":
    [{ lesson: 'never force-push main' }],
});

function createGraph({ executed = [] } = {}) {
  return {
    executed,
    async getGraphSchema() { return { ...SCHEMA }; },
    async executeCypher(cypher) {
      executed.push(cypher);
      return ROWS[cypher] || [];
    },
    async semanticSearch(term) {
      executed.push(`search:${term}`);
      return term.includes('force') ? [{ node: { id: 'lesson:42' }, score: 0.91 }] : [];
    },
  };
}

const call = (tool, input) => `<thought>next hop</thought><call>${JSON.stringify({ tool, input })}</call>`;

module.exports = { SCHEMA, ROWS, createGraph, call };
