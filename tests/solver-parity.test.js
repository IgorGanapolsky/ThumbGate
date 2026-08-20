'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const parity = require('../scripts/solver-parity');

const ACCEPTANCE = parity.DEFAULT_ACCEPTANCE_PATH;

test('loadAcceptanceSet pins frozen schema and five cases', () => {
  const set = parity.loadAcceptanceSet(ACCEPTANCE);
  assert.equal(set.schema, 'thumbgate.solver_acceptance_set.v1');
  assert.equal(set.capturedRevenueUsd, 0);
  assert.equal(set.cases.length, 5);
  assert.deepEqual(
    set.cases.map((c) => c.id),
    [
      'routing_empty',
      'routing_single_feasible',
      'routing_budget_filter',
      'rules_greedy_density',
      'rules_knapsack_gap',
    ]
  );
});

test('loadAcceptanceSet rejects missing file and wrong schema', () => {
  assert.throws(() => parity.loadAcceptanceSet('/no/such/acceptance-set.json'), /not found/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-parity-'));
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, JSON.stringify({ schema: 'nope', cases: [{ id: 'x' }] }));
  assert.throws(() => parity.loadAcceptanceSet(bad), /schema must be/);
});

test('independent heuristic is deterministic and fail-closed on empty', () => {
  const set = parity.loadAcceptanceSet();
  const routing = set.cases.find((c) => c.id === 'routing_budget_filter');
  const a = parity.independentHeuristicRouting(routing.candidates, routing.budgets);
  const b = parity.independentHeuristicRouting(routing.candidates, routing.budgets);
  assert.equal(a.selected, 'qwen-flash');
  assert.equal(a.selected, b.selected);
  assert.equal(a.solver, 'independent-greedy-heuristic');

  const empty = parity.independentHeuristicRouting([], routing.budgets);
  assert.equal(empty.success, false);
  assert.equal(empty.selected, null);

  const noneFeasible = parity.independentHeuristicRouting(
    [{ id: 'opus', score: 99, cost: 9, latency_ms: 9000 }],
    routing.budgets
  );
  assert.equal(noneFeasible.success, false);
  assert.equal(noneFeasible.selected, null);
});

test('independent knapsack pins frozen density order and the gap fixture', () => {
  const set = parity.loadAcceptanceSet();
  const density = set.cases.find((c) => c.id === 'rules_greedy_density');
  const picked = parity.independentHeuristicRules(density.rules, density.budgets);
  assert.deepEqual(picked.selected_rules, ['spend-guard', 'secret-egress']);
  assert.ok(!picked.selected_rules.includes('low-value-noise-rule'));

  const gap = set.cases.find((c) => c.id === 'rules_knapsack_gap');
  const greedy = parity.independentHeuristicRules(gap.rules, gap.budgets);
  assert.deepEqual(greedy.selected_rules, ['dense-small']);
  assert.equal(greedy.total_mitigation, 10);
});

test('runParity passes the frozen set like-for-like', () => {
  const report = parity.runParity({ skipProbe: true });
  assert.equal(report.schema, parity.REPORT_SCHEMA);
  assert.equal(report.mode, 'parity');
  assert.equal(report.capturedRevenueUsd, 0);
  assert.equal(report.process.doNotGradeOwnHomework, true);
  assert.equal(report.process.affiliation, 'none');
  assert.equal(report.summary.ok, true, JSON.stringify(report.cases.map((c) => ({
    id: c.id,
    ok: c.ok,
    failures: c.failures,
  })), null, 2));
  assert.equal(report.summary.total, 5);
  assert.equal(report.summary.failed, 0);
});

test('budget filter never selects over-budget models on either engine', () => {
  const report = parity.runParity({ skipProbe: true });
  const row = report.cases.find((c) => c.id === 'routing_budget_filter');
  assert.ok(row.ok, row.failures.join('; '));
  assert.equal(row.heuristic.selected, 'qwen-flash');
  assert.notEqual(row.heuristic.selected, 'claude-opus');
  assert.notEqual(row.solver.selected, 'claude-opus');
  assert.notEqual(row.solver.selected, 'claude-sonnet');
});

test('knapsack gap: heuristic stays greedy; Gurobi (when present) takes the pair', () => {
  const report = parity.runParity({ skipProbe: true });
  const row = report.cases.find((c) => c.id === 'rules_knapsack_gap');
  assert.ok(row.ok, row.failures.join('; '));
  assert.deepEqual(row.heuristic.selected_rules, ['dense-small']);
  if (parity.isSuccessfulGurobiLabel(row.solver.solver)) {
    assert.deepEqual([...row.solver.selected_rules].sort(), ['pair-a', 'pair-b']);
    assert.ok(row.metrics.gap > 0);
    assert.equal(row.independentEngines, true);
    assert.equal(row.homeworkGrade, 'independent-solver');
  } else {
    assert.deepEqual(row.solver.selected_rules, ['dense-small']);
    assert.equal(row.homeworkGrade, 'solver-fell-back-to-heuristic');
  }
});

test('report never invents cash or Gurobi affiliation', () => {
  const report = parity.runParity({ skipProbe: true });
  const blob = JSON.stringify(report);
  assert.equal(report.capturedRevenueUsd, 0);
  assert.ok(report.cases.every((c) => c.capturedRevenueUsd === 0));
  assert.match(blob, /No Gurobi partnership/);
  assert.ok(!/official partner|powered exclusively by Gurobi|\$499|commercially available/i.test(blob));
});

test('formatReport includes process table and disclaimers', () => {
  const report = parity.runParity({ skipProbe: true });
  const md = parity.formatReport(report);
  assert.match(md, /Solver parity/);
  assert.match(md, /do not grade your own homework/);
  assert.match(md, /capturedRevenueUsd=0/);
  assert.match(md, /Not Gurobi product copy/);
  assert.match(md, /routing_budget_filter/);
});

test('mainCli --json and --write emit a passing report', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-parity-out-'));
  const out = path.join(dir, 'parity.json');
  const code = parity.mainCli(['--json', '--write', out]);
  assert.equal(code, 0);
  assert.ok(fs.existsSync(out));
  assert.ok(fs.existsSync(out.replace(/\.json$/, '.md')));
  const parsed = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(parsed.summary.ok, true);
  assert.equal(parsed.capturedRevenueUsd, 0);
});

test('forcing a missing python still satisfies frozen heuristic pins', () => {
  const report = parity.runParity({
    skipProbe: true,
    solverOpts: { pythonBin: '/no/such/gurobi-python' },
  });
  assert.equal(report.summary.ok, true, JSON.stringify(report.cases.filter((c) => !c.ok), null, 2));
  const gap = report.cases.find((c) => c.id === 'rules_knapsack_gap');
  assert.equal(gap.homeworkGrade, 'solver-fell-back-to-heuristic');
  assert.deepEqual(gap.solver.selected_rules, ['dense-small']);
});

test('probeGurobi returns gurobi false when solver is an error fallback', () => {
  const { probeGurobi } = require('../scripts/gurobi-optimizer');
  const probe = probeGurobi({ pythonBin: '/no/such/python' });
  assert.equal(probe.gurobi, false);
});

