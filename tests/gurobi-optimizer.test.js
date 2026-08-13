'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  optimizeModelRouting,
  optimizeRuleSelection,
  resolvePythonBin,
  probeGurobi,
} = require('../scripts/gurobi-optimizer.js');

test('Gurobi Optimizer - Node.js integration', async (t) => {
  await t.test('resolves a python interpreter path', () => {
    const bin = resolvePythonBin();
    assert.ok(typeof bin === 'string' && bin.length > 0);
  });

  await t.test('optimizes model routing under budget+latency (correct selection)', () => {
    const candidates = [
      { id: 'c1', score: 7.0, cost: 0.001, latency_ms: 100 },
      { id: 'c2', score: 9.5, cost: 0.020, latency_ms: 1500 },
      { id: 'c3', score: 8.8, cost: 0.005, latency_ms: 300 },
    ];

    const result = optimizeModelRouting(candidates, { maxBudgetUsd: 0.01, maxLatencyMs: 500 });
    assert.equal(result.success, true);
    // Feasible under constraints: c1, c3 — max score is c3
    assert.equal(result.selected, 'c3');
    assert.ok(
      result.solver === 'gurobi'
        || result.solver === 'heuristic-fallback'
        || result.solver === 'node-fallback-heuristic'
        || String(result.solver || '').includes('gurobi'),
      `unexpected solver: ${result.solver}`
    );
    if (result.solver === 'gurobi') {
      assert.equal(result.status, 'OPTIMAL');
      assert.equal(result.objective, 8.8);
    }
  });

  await t.test('optimizes prevention rule selection via 0-1 knapsack', () => {
    const rules = [
      { id: 'r1', risk_mitigation: 90, eval_time_ms: 5, token_footprint: 100 },
      { id: 'r2', risk_mitigation: 70, eval_time_ms: 10, token_footprint: 150 },
      { id: 'r3', risk_mitigation: 95, eval_time_ms: 25, token_footprint: 300 },
    ];

    const result = optimizeRuleSelection(rules, { maxEvalTimeMs: 30.0, maxTokenFootprint: 450 });
    assert.equal(result.success, true);
    const selected = [...(result.selected_rules || [])].sort();
    assert.ok(selected.every((id) => ['r1', 'r2', 'r3'].includes(id)));

    const byId = Object.fromEntries(rules.map((r) => [r.id, r]));
    const totalTime = selected.reduce((s, id) => s + byId[id].eval_time_ms, 0);
    const totalTokens = selected.reduce((s, id) => s + byId[id].token_footprint, 0);
    assert.ok(totalTime <= 30.0);
    assert.ok(totalTokens <= 450);

    // When real Gurobi is available, expect the proven optimal set.
    if (result.solver === 'gurobi') {
      assert.deepEqual(selected, ['r1', 'r3']);
      assert.equal(result.objective, 185.0);
      assert.equal(result.status, 'OPTIMAL');
    }
  });

  await t.test('handles empty inputs gracefully', () => {
    const rRes = optimizeModelRouting([]);
    assert.equal(rRes.success, false);

    const ruleRes = optimizeRuleSelection([]);
    assert.equal(ruleRes.success, false);
  });

  await t.test('probeGurobi reports interpreter + solver path', () => {
    const probe = probeGurobi();
    assert.equal(typeof probe.ok, 'boolean');
    assert.ok(probe.python);
    // On this Mac with gurobipy installed, probe should prefer gurobi.
    // CI without gurobipy still reports ok=true via heuristic.
    assert.equal(probe.ok, true);
  });
});

test('Gurobi Optimizer - node fallback when python fails', async (t) => {
  await t.test('optimizeModelRouting falls back when python binary missing', () => {
    const prev = process.env.GUROBI_PYTHON;
    process.env.GUROBI_PYTHON = '/nonexistent/gurobi-python-bin';
    // Re-require after env change is hard; instead call with force via child is heavy.
    // Direct API still works: if python path is broken, catch returns node-fallback.
    delete require.cache[require.resolve('../scripts/gurobi-optimizer.js')];
    const mod = require('../scripts/gurobi-optimizer.js');
    const result = mod.optimizeModelRouting(
      [
        { id: 'c1', score: 7.0, cost: 0.001, latency_ms: 100 },
        { id: 'c3', score: 8.8, cost: 0.005, latency_ms: 300 },
      ],
      { maxBudgetUsd: 0.01, maxLatencyMs: 500 }
    );
    assert.equal(result.success, true);
    assert.equal(result.selected, 'c3');
    if (prev === undefined) delete process.env.GUROBI_PYTHON;
    else process.env.GUROBI_PYTHON = prev;
    delete require.cache[require.resolve('../scripts/gurobi-optimizer.js')];
  });

  await t.test('optimizeRuleSelection falls back when python binary missing', () => {
    process.env.GUROBI_PYTHON = '/nonexistent/gurobi-python-bin';
    delete require.cache[require.resolve('../scripts/gurobi-optimizer.js')];
    const mod = require('../scripts/gurobi-optimizer.js');
    const result = mod.optimizeRuleSelection(
      [
        { id: 'r1', risk_mitigation: 90, eval_time_ms: 5, token_footprint: 100 },
        { id: 'r3', risk_mitigation: 95, eval_time_ms: 25, token_footprint: 300 },
      ],
      { maxEvalTimeMs: 30, maxTokenFootprint: 450 }
    );
    assert.equal(result.success, true);
    assert.ok(Array.isArray(result.selected_rules));
    delete process.env.GUROBI_PYTHON;
    delete require.cache[require.resolve('../scripts/gurobi-optimizer.js')];
  });
});
