'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const runner = require('../evals/graphrag-moe-jit/runner');
const fixture = require('../evals/graphrag-moe-jit/fixture');

const allowAll = async () => ({ decision: 'allow', reason: '' });

test('read-only deny check rejects every write clause and write procedure', () => {
  const writes = [
    'CREATE (g:Gate {id: "x"})',
    'MATCH (g:Gate) MERGE (g)-[:PREVENTS]->(f:FailureClass)',
    'MATCH (g:Gate) DETACH DELETE g',
    'MATCH (g:Gate) SET g.name = "y"',
    'MATCH (g:Gate) REMOVE g.name',
    'DROP INDEX gate_idx',
    'LOAD CSV FROM "file:///x.csv" AS row RETURN row',
    'CALL apoc.periodic.iterate("MATCH (n) RETURN n", "DELETE n", {})',
    'CALL dbms.security.createUser("a", "b", false)',
    'MATCH (g:Gate) CALL { MATCH (l:Lesson) RETURN l } RETURN g',
    'MATCH (g:Gate) FOREACH (x IN [1] | SET g.n = x)',
  ];
  for (const q of writes) {
    const r = runner.readOnlyCypherCheck(q);
    assert.equal(r.allowed, false, `must deny: ${q}`);
    assert.match(r.reason, /read-only deny/);
  }
  assert.equal(runner.readOnlyCypherCheck('').allowed, false);
  assert.equal(runner.readOnlyCypherCheck('CALL db.labels()').allowed, true);
  // Keywords inside string literals and comments are data, not clauses.
  const literal = runner.readOnlyCypherCheck('MATCH (g:Gate {name: "CREATE SET"}) // DELETE later\nRETURN g');
  assert.equal(literal.allowed, true);
});

test('schema-first gate rejects undeclared labels, relationships, untyped and backtick patterns', () => {
  const ok = runner.schemaFirstCypherGate('MATCH (g:Gate)-[:PREVENTS|LEARNED_FROM*1..2]->(f) WHERE f:FailureClass RETURN g, f', fixture.SCHEMA);
  assert.equal(ok.allowed, true, ok.reason);
  assert.deepEqual(ok.labels.sort(), ['FailureClass', 'Gate']);

  const badLabel = runner.schemaFirstCypherGate('MATCH (c:Customer) RETURN c', fixture.SCHEMA);
  assert.equal(badLabel.allowed, false);
  assert.match(badLabel.reason, /unknown labels Customer/);

  const badRel = runner.schemaFirstCypherGate('MATCH (g:Gate)-[:OWNS]->(f:File) RETURN f', fixture.SCHEMA);
  assert.match(badRel.reason, /unknown relationships OWNS/);

  const badWhere = runner.schemaFirstCypherGate('MATCH (g:Gate) WHERE g:Secret RETURN g', fixture.SCHEMA);
  assert.match(badWhere.reason, /unknown labels Secret/);

  assert.match(runner.schemaFirstCypherGate('MATCH (n) RETURN n', fixture.SCHEMA).reason, /no typed node pattern/);
  assert.match(runner.schemaFirstCypherGate('MATCH (n:`Gate`) RETURN n', fixture.SCHEMA).reason, /backtick/);
  assert.match(runner.schemaFirstCypherGate('MATCH (g:Gate) RETURN g', null).reason, /no declared schema/);
});

test('topological order respects dependencies and fails closed on cycles and unknown deps', () => {
  const order = runner.topologicalOrder([
    { id: 'c', dependsOn: ['a', 'b'] },
    { id: 'a' },
    { id: 'b', dependsOn: ['a'] },
  ]);
  assert.deepEqual(order, { ok: true, order: ['a', 'b', 'c'] });
  assert.match(runner.topologicalOrder([{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }]).reason, /cycle/);
  assert.match(runner.topologicalOrder([{ id: 'a', dependsOn: ['zz'] }]).reason, /unknown step zz/);
  assert.match(runner.topologicalOrder([{ id: 'a' }, { id: 'a' }]).reason, /duplicate/);
});

test('dual-stack router is deterministic and escalates high-risk retries to frontier', () => {
  const cheap = runner.routeStep({ taskType: 'extraction' }, { contextTokens: 100, attempt: 1 });
  assert.equal(cheap.stack, 'local');
  assert.equal(runner.routeStep({ taskType: 'extraction' }, { contextTokens: 100, attempt: 1 }).tier, cheap.tier);
  assert.equal(runner.routeStep({ taskType: 'architecture' }, { contextTokens: 100, attempt: 1 }).stack, 'frontier');
  const retried = runner.routeStep({ taskType: 'extraction', riskLevel: 'high' }, { contextTokens: 100, attempt: 3 });
  assert.equal(retried.stack, 'frontier');
  assert.match(retried.reason, /high risk/);
});

test('JIT compactor keeps pinned items, fills by priority, and stays within budget', () => {
  const items = [
    { id: 'goal', text: 'g'.repeat(40), pinned: true },
    { id: 'low', text: 'l'.repeat(400), priority: 1 },
    { id: 'high', text: 'h'.repeat(200), priority: 5 },
  ];
  const c = runner.compactContext(items, 70);
  assert.deepEqual(c.items.map((i) => i.id), ['goal', 'high']);
  assert.deepEqual(c.dropped, ['low']);
  assert.ok(c.usedTokens <= 70);

  const tight = runner.compactContext([{ id: 'goal', text: 'x'.repeat(400), pinned: true }], 20);
  assert.equal(tight.items[0].truncated, true);
  assert.ok(tight.usedTokens <= 20, `used ${tight.usedTokens}`);
});

function graphSteps(overrides = {}) {
  return [
    {
      id: 'find-gate',
      goal: 'find the gate that prevents history rewrites',
      taskType: 'extraction',
      plan: () => 'MATCH (g:Gate)-[:PREVENTS]->(f:FailureClass) RETURN g',
      act: () => fixture.NODES.filter((n) => n.label === 'Gate' && fixture.neighbors(n.id, 'PREVENTS').length),
      accept: (obs) => Array.isArray(obs) && obs.length > 0,
      ...overrides['find-gate'],
    },
    {
      id: 'find-lesson',
      dependsOn: ['find-gate'],
      goal: 'find the lesson the gate was learned from',
      taskType: 'extraction',
      context: [{ id: 'noise', text: 'n'.repeat(20000), priority: 0 }],
      budgetTokens: 500,
      plan: () => 'MATCH (g:Gate)-[:LEARNED_FROM]->(l:Lesson) RETURN l',
      act: ({ observations }) => fixture.neighbors(observations['find-gate'][0].id, 'LEARNED_FROM'),
      accept: (obs) => obs.length === 1,
      ...overrides['find-lesson'],
    },
  ];
}

test('ReAct loop runs steps in order, compacts context, and records state transitions', async () => {
  const seen = [];
  const report = await runner.runGraphRagEval({
    steps: graphSteps(),
    schema: fixture.SCHEMA,
    gateCheck: async (tool, input) => { seen.push([tool, input.step]); return allowAll(); },
  });
  assert.equal(report.status, 'passed');
  assert.deepEqual(report.order, ['find-gate', 'find-lesson']);
  assert.deepEqual(seen, [['graph_query', 'find-gate'], ['graph_query', 'find-lesson']]);
  assert.equal(report.observations['find-lesson'][0].id, 'lesson:42');
  const h = report.results['find-lesson'].history[0];
  assert.deepEqual(h.states, ['THOUGHT', 'COMPACT', 'ROUTE', 'GATE', 'ACT', 'OBSERVE']);
  assert.deepEqual(h.dropped, ['noise']);
  assert.ok(h.usedTokens <= 500);
  assert.equal(h.stack, 'local');
});

test('planner can revise a denied query on retry (ReAct observe -> rethink)', async () => {
  const report = await runner.runGraphRagEval({
    steps: graphSteps({
      'find-gate': {
        plan: ({ attempt, lastError }) => (attempt === 1
          ? 'MATCH (g:Gate) SET g.seen = true RETURN g'
          : (assert.match(lastError, /read-only deny: SET/), 'MATCH (g:Gate)-[:PREVENTS]->(f:FailureClass) RETURN g')),
      },
    }),
    schema: fixture.SCHEMA,
    gateCheck: allowAll,
  });
  assert.equal(report.status, 'passed');
  assert.equal(report.results['find-gate'].attempts, 2);
});

test('3-attempt fail-safe: a step that keeps failing stops at 3 and dependents are skipped', async () => {
  let acts = 0;
  const report = await runner.runGraphRagEval({
    steps: graphSteps({ 'find-gate': { act: () => { acts++; throw new Error('graph store offline'); } } }),
    schema: fixture.SCHEMA,
    gateCheck: allowAll,
    maxAttempts: 10, // capped at 3 regardless
  });
  assert.equal(report.status, 'failed');
  assert.equal(acts, 3);
  assert.equal(report.results['find-gate'].state, 'FAILED');
  assert.match(report.results['find-gate'].reason, /fail-closed after 3 attempts: act failed: graph store offline/);
  assert.equal(report.results['find-lesson'].state, 'SKIPPED');
  assert.match(report.results['find-lesson'].reason, /upstream step find-gate/);
  // High-risk retries would escalate; low-risk extraction stays on the local stack.
  assert.ok(report.results['find-gate'].history.every((a) => a.stack === 'local'));
});

test('gate_check warn, block and error all fail closed; act never runs', async () => {
  for (const decision of ['warn', 'block', 'error']) {
    let acted = false;
    const report = await runner.runGraphRagEval({
      steps: graphSteps({ 'find-gate': { act: () => { acted = true; return []; } } }),
      schema: fixture.SCHEMA,
      gateCheck: async () => ({ decision, reason: `[GATE:test] ${decision}` }),
    });
    assert.equal(report.status, 'failed');
    assert.equal(acted, false, `${decision} must not run the query`);
    assert.match(report.results['find-gate'].reason, new RegExp(`gate_check ${decision}`));
  }
});

test('cycle in the plan fails closed before any gate call', async () => {
  let calls = 0;
  const report = await runner.runGraphRagEval({
    steps: graphSteps({ 'find-gate': { dependsOn: ['find-lesson'] } }),
    schema: fixture.SCHEMA,
    gateCheck: async () => { calls++; return { decision: 'allow' }; },
  });
  assert.equal(report.status, 'failed');
  assert.match(report.reason, /fail-closed before execution: dependency cycle/);
  assert.equal(calls, 0);
});

test('end to end through the real stdio MCP gate_check', { timeout: 90000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-graphrag-'));
  const client = runner.createStdioGateClient({
    env: { HOME: home, THUMBGATE_HOME: path.join(home, '.thumbgate'), THUMBGATE_STRICT_ENFORCEMENT: '1' },
  });
  try {
    const report = await runner.runGraphRagEval({ steps: graphSteps(), schema: fixture.SCHEMA, gateCheck: client.gateCheck });
    assert.equal(report.status, 'passed', JSON.stringify(report.results));
    assert.equal(report.observations['find-lesson'][0].id, 'lesson:42');

    // A destructive call through the same stdio client is blocked, proving the verdict is real.
    const blocked = await client.gateCheck('Bash', { command: 'rm -rf /' });
    assert.equal(blocked.decision, 'block');
  } finally {
    await client.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
