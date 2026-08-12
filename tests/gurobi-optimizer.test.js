'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { optimizeModelRouting, optimizeRuleSelection } = require('../scripts/gurobi-optimizer.js');

test('Gurobi Optimizer - Node.js integration', async (t) => {
  await t.test('optimizes model routing via Gurobi MILP solver', () => {
    const candidates = [
      { id: 'c1', score: 7.0, cost: 0.001, latency_ms: 100 },
      { id: 'c2', score: 9.5, cost: 0.020, latency_ms: 1500 },
      { id: 'c3', score: 8.8, cost: 0.005, latency_ms: 300 }
    ];

    const result = optimizeModelRouting(candidates, { maxBudgetUsd: 0.01, maxLatencyMs: 500 });
    assert.equal(result.success, true);
    assert.equal(result.selected, 'c3');
    assert.equal(result.solver, 'gurobi');
    assert.equal(result.status, 'OPTIMAL');
  });

  await t.test('optimizes prevention rule selection via 0-1 Knapsack MILP', () => {
    const rules = [
      { id: 'r1', risk_mitigation: 90, eval_time_ms: 5, token_footprint: 100 },
      { id: 'r2', risk_mitigation: 70, eval_time_ms: 10, token_footprint: 150 },
      { id: 'r3', risk_mitigation: 95, eval_time_ms: 25, token_footprint: 300 }
    ];

    const result = optimizeRuleSelection(rules, { maxEvalTimeMs: 30.0, maxTokenFootprint: 450 });
    assert.equal(result.success, true);
    assert.deepEqual(result.selected_rules.sort(), ['r1', 'r3']);
    assert.equal(result.solver, 'gurobi');
    assert.equal(result.status, 'OPTIMAL');
  });

  await t.test('handles empty inputs gracefully', () => {
    const rRes = optimizeModelRouting([]);
    assert.equal(rRes.success, false);

    const ruleRes = optimizeRuleSelection([]);
    assert.equal(ruleRes.success, false);
  });
});
