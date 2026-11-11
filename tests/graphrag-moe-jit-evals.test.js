'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const runner = require('../evals/graphrag-moe-jit/runner');
const { SCHEMA, createGraph, call } = require('../evals/graphrag-moe-jit/fixture');
const { EXPERTS } = require('../scripts/agentic-prompt-pipelines');

const allow = async () => ({ decision: 'allow', reason: '' });
const Q1 = "MATCH (g:Gate)-[:PREVENTS]->(f:FailureClass {name: 'shared history rewrite'}) RETURN g.id AS gate LIMIT 5";
const Q2 = "MATCH (g:Gate {id: 'gate:force-push'})-[:LEARNED_FROM]->(l:Lesson) RETURN l.name AS lesson LIMIT 5";
const HAPPY_TURNS = [
  call('get_graph_schema', ''),
  call('execute_cypher_query', Q1),
  call('execute_cypher_query', Q2),
  '<thought>both hops observed</thought><final_answer>gate:force-push, learned from "never force-push main"</final_answer>',
];

test('schema-first gate rejects undeclared labels, relationships, untyped and backtick patterns', () => {
  assert.equal(runner.checkSchemaFirstCypher(Q1, SCHEMA).ok, true);
  assert.equal(runner.checkSchemaFirstCypher('MATCH (g:Gate)-[:PREVENTS|LEARNED_FROM*1..2]->(x) WHERE x:Lesson RETURN x', SCHEMA).ok, true);
  assert.equal(runner.checkSchemaFirstCypher("MATCH (g:Gate {name: 'Customer:Secret'}) RETURN g", SCHEMA).ok, true,
    'labels inside string literals are data');

  const cases = [
    ['MATCH (c:Customer) RETURN c', /unknown_label:Customer/],
    ['MATCH (g:Gate)-[:OWNS]->(l:Lesson) RETURN l', /unknown_relationship:OWNS/],
    ['MATCH (g:Gate) WHERE g:Secret RETURN g', /unknown_label:Secret/],
    ['MATCH (n) RETURN n', /no_typed_node_pattern/],
    ['MATCH (n:`Gate`) RETURN n', /backtick_identifier/],
  ];
  for (const [q, reason] of cases) {
    const r = runner.checkSchemaFirstCypher(q, SCHEMA);
    assert.equal(r.ok, false, q);
    assert.match(r.reason, reason);
  }
  assert.match(runner.checkSchemaFirstCypher(Q1, null).reason, /no_schema/);
});

test('ReAct traversal answers a two-hop question with gate_check before every query', async () => {
  const graph = createGraph();
  const seen = [];
  const r = await runner.runEvalCase({ query: 'Which gate prevents history rewrites and what lesson taught it?', turns: HAPPY_TURNS, graph },
    { gateCheck: async (tool, input) => { seen.push([tool, input.cypher]); return allow(); } });
  assert.equal(r.traversal.status, 'answered');
  assert.match(r.traversal.answer, /never force-push main/);
  assert.deepEqual(seen, [['graph_query', Q1], ['graph_query', Q2]]);
  assert.deepEqual(graph.executed, [Q1, Q2]);
  assert.equal(r.traversal.failedAttempts, 0);
});

test('read-only deny check (pipeline guard) stops writes before the schema gate or gate_check', async () => {
  let gateCalls = 0;
  const graph = createGraph();
  const writes = [
    "MATCH (g:Gate) SET g.name = 'x' RETURN g",
    'CREATE (g:Gate) RETURN g',
    "CALL apoc.periodic.iterate('MATCH (n) RETURN n', 'DETACH DELETE n', {})",
  ];
  const r = await runner.runEvalCase({
    query: 'try to write',
    turns: [call('get_graph_schema', ''), ...writes.map((w) => call('execute_cypher_query', w))],
    graph,
  }, { gateCheck: async () => { gateCalls += 1; return allow(); } });
  assert.equal(r.traversal.status, 'halted');
  assert.equal(r.traversal.failedAttempts, 3);
  assert.equal(gateCalls, 0, 'a write must be denied before gate_check is asked');
  assert.deepEqual(graph.executed, []);
});

test('3-attempt fail-safe: schema-first denials count as failed attempts and halt the traversal', async () => {
  const graph = createGraph();
  const r = await runner.runEvalCase({
    query: 'who owns the gate?',
    turns: [
      call('execute_cypher_query', Q1), // before the schema: pipeline schema-first rule
      call('get_graph_schema', ''),
      call('execute_cypher_query', 'MATCH (t:Team)-[:OWNS]->(g:Gate) RETURN t LIMIT 5'),
      call('execute_cypher_query', 'MATCH (g:Gate)-[:OWNED_BY]->(t:Lesson) RETURN t LIMIT 5'),
      '<final_answer>should never be reached</final_answer>',
    ],
    graph,
  }, { gateCheck: allow });
  assert.equal(r.traversal.status, 'halted');
  assert.equal(r.traversal.failedAttempts, 3);
  assert.match(r.traversal.missingLink, /No valid path after 3 failed attempts/);
  assert.deepEqual(graph.executed, []);
});

test('gate_check warn, block and error all fail closed; the query never runs', async () => {
  for (const decision of ['warn', 'block', 'error']) {
    const graph = createGraph();
    const r = await runner.runEvalCase({
      query: 'q',
      turns: [call('get_graph_schema', ''), call('execute_cypher_query', Q1), call('execute_cypher_query', Q1), call('execute_cypher_query', Q1)],
      graph,
    }, { gateCheck: async () => ({ decision, reason: `[GATE:test] ${decision}` }) });
    assert.equal(r.traversal.status, 'halted', decision);
    assert.equal(r.traversal.failedAttempts, 3);
    assert.deepEqual(graph.executed, [], `${decision} must not run the query`);
    assert.deepEqual(r.gateLog.map((g) => g.decision), [decision, decision, decision]);
  }
});

test('semantic search is gated too', async () => {
  const graph = createGraph();
  const r = await runner.runEvalCase({
    query: 'q',
    turns: [call('semantic_vector_search', 'force push'), '<final_answer>lesson:42</final_answer>'],
    graph,
  }, { gateCheck: async () => ({ decision: 'block', reason: 'no' }) });
  assert.deepEqual(graph.executed, []);
  assert.equal(r.traversal.failedAttempts, 1);
  assert.deepEqual(r.gateLog, [{ input: { semantic_search: 'force push' }, decision: 'block' }]);
});

test('JIT compactor trims to budget without a model and the dual-stack router picks a stack deterministically', async () => {
  const noise = Array.from({ length: 400 }, (_, i) => `2026-11-11T10:00:${String(i % 60).padStart(2, '0')}Z INFO heartbeat ok seq=${i}`).join('\n');
  const rawContext = `${noise}\nError: ECONNRESET while reading gate:force-push\n    at runQuery (graph.js:10:3)`;
  const r = await runner.runEvalCase({ query: 'why did the gate lookup fail?', turns: HAPPY_TURNS, graph: createGraph(), rawContext, tokenBudget: 200 },
    { gateCheck: allow });
  assert.ok(r.trim.stats.outputTokens < r.trim.stats.inputTokens, 'context must shrink');
  assert.match(r.trim.context, /ECONNRESET/, 'anchor lines survive compaction');
  assert.match(r.trim.context, /at runQuery/);
  assert.ok(Object.values(EXPERTS).includes(r.route.primary_expert));
  assert.ok(['rule', 'fallback'].includes(r.route.source), 'no LLM router call in the eval');

  const again = await runner.runEvalCase({ query: 'why did the gate lookup fail?', turns: HAPPY_TURNS, graph: createGraph(), rawContext, tokenBudget: 200 },
    { gateCheck: allow });
  assert.deepEqual([again.route.primary_expert, again.trim.context], [r.route.primary_expert, r.trim.context]);

  const logs = Array.from({ length: 50 }, (_, i) => `2026-11-11 10:00:0${i % 10} ERROR worker ${i} timed out`).join('\n');
  const logRoute = await runner.runEvalCase({ query: 'summarise', turns: HAPPY_TURNS, graph: createGraph(), rawContext: logs, tokenBudget: 100000 },
    { gateCheck: allow });
  assert.equal(logRoute.route.primary_expert, EXPERTS.GEMINI);
});

test('end to end through the real stdio MCP gate_check', { timeout: 90000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-graphrag-'));
  const client = runner.createStdioGateClient({
    env: { HOME: home, THUMBGATE_HOME: path.join(home, '.thumbgate'), THUMBGATE_STRICT_ENFORCEMENT: '1' },
  });
  try {
    const graph = createGraph();
    const r = await runner.runEvalCase({ query: 'two-hop', turns: HAPPY_TURNS, graph }, { gateCheck: client.gateCheck });
    assert.equal(r.traversal.status, 'answered', JSON.stringify(r.gateLog));
    assert.deepEqual(r.gateLog.map((g) => g.decision), ['allow', 'allow']);
    assert.deepEqual(graph.executed, [Q1, Q2]);

    // The same client gets a real block for a destructive call, so the verdicts are not canned.
    const blocked = await client.gateCheck('Bash', { command: 'rm -rf /' });
    assert.equal(blocked.decision, 'block');
  } finally {
    await client.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
