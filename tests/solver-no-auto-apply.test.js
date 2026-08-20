'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  optimizeModelRouting,
  optimizeRuleSelection,
  stampDecisionGovernance,
  isRepeatableSolve,
} = require('../scripts/gurobi-optimizer');
const proof = require('../scripts/budget-aware-gates-proof');

const ROOT = path.resolve(__dirname, '..');

function assertGovernance(result, { expectRepeatable } = {}) {
  assert.equal(result.autoApply, false);
  assert.equal(result.humanOversightRequired, true);
  assert.equal(result.capturedRevenueUsd, 0);
  if (typeof expectRepeatable === 'boolean') {
    assert.equal(result.repeatable, expectRepeatable);
    assert.equal(result.plausibleOnly, !expectRepeatable);
  }
}

test('stampDecisionGovernance never auto-applies and never invents cash', () => {
  const stamped = stampDecisionGovernance({
    success: true,
    selected: 'x',
    solver: 'gurobi',
    status: 'OPTIMAL',
  });
  assertGovernance(stamped, { expectRepeatable: true });
  assert.equal(isRepeatableSolve(stamped), true);

  const heuristic = stampDecisionGovernance({
    success: true,
    selected: 'y',
    solver: 'node-fallback-heuristic',
  });
  assertGovernance(heuristic, { expectRepeatable: false });
});

test('routing and knapsack receipts carry governance on every path', () => {
  const empty = optimizeModelRouting([]);
  assert.equal(empty.success, false);
  assertGovernance(empty, { expectRepeatable: false });

  const emptyRules = optimizeRuleSelection([]);
  assert.equal(emptyRules.success, false);
  assertGovernance(emptyRules, { expectRepeatable: false });

  const fallback = optimizeModelRouting(
    [
      { id: 'cheap', score: 8, cost: 0.001, latency_ms: 100 },
      { id: 'pricey', score: 9, cost: 0.05, latency_ms: 900 },
    ],
    { maxBudgetUsd: 0.01, maxLatencyMs: 500 },
    { pythonBin: '/no/such/gurobi-python' }
  );
  assert.equal(fallback.solver, 'node-fallback-heuristic');
  assertGovernance(fallback, { expectRepeatable: false });

  const live = optimizeModelRouting(
    [{ id: 'only-local', score: 7.1, cost: 0, latency_ms: 90 }],
    { maxBudgetUsd: 0.01, maxLatencyMs: 500 }
  );
  assert.equal(live.success, true);
  assertGovernance(live);
  if (live.solver === 'gurobi' && live.status === 'OPTIMAL') {
    assert.equal(live.repeatable, true);
    assert.equal(live.plausibleOnly, false);
  } else {
    assert.equal(live.repeatable, false);
    assert.equal(live.plausibleOnly, true);
  }
});

test('PreToolUse hook and gates-engine do not load solver selections', () => {
  const hook = fs.readFileSync(path.join(ROOT, 'scripts', 'hook-pre-tool-use.js'), 'utf8');
  const gates = fs.readFileSync(path.join(ROOT, 'scripts', 'gates-engine.js'), 'utf8');
  assert.doesNotMatch(hook, /gurobi-optimizer|optimizeModelRouting|optimizeRuleSelection/);
  assert.doesNotMatch(gates, /gurobi-optimizer|optimizeModelRouting|optimizeRuleSelection/);
});

test('budget-aware proof is simulation-only and does not auto-apply', () => {
  const report = proof.runBudgetAwareGatesProof({ skipProbe: true });
  assert.equal(report.autoApply, false);
  assert.equal(report.humanOversightRequired, true);
  assert.equal(report.capturedRevenueUsd, 0);
  assert.equal(report.mode, 'simulation');
  assert.match(JSON.stringify(report.buyerNarrative), /does not yet load selections/);
});
