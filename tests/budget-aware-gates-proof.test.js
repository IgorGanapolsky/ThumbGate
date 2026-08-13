'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const proof = require('../scripts/budget-aware-gates-proof');

test('runBudgetAwareGatesProof returns schema and both paths', () => {
  const report = proof.runBudgetAwareGatesProof({ skipProbe: true });
  assert.equal(report.schema, 'thumbgate.budget_aware_gates_proof.v1');
  assert.ok(report.modelRouting.heuristic.selected);
  assert.ok(report.modelRouting.optimized.selected);
  assert.ok(Array.isArray(report.ruleKnapsack.heuristic.selected));
  assert.ok(Array.isArray(report.ruleKnapsack.optimized.selected));
  assert.ok(report.ruleKnapsack.heuristic.count > 0);
  assert.ok(report.ruleKnapsack.optimized.count > 0);
  // Low-value noise rule should often be dropped under tight budget
  assert.ok(report.ruleKnapsack.droppedLowValue.includes('low-value-noise-rule')
    || report.ruleKnapsack.optimized.count < proof.DEMO_RULES.length);
});

test('routing respects budget — premium over-budget model not selected', () => {
  const report = proof.runBudgetAwareGatesProof({ skipProbe: true });
  assert.notEqual(report.modelRouting.optimized.selected, 'claude-opus');
  assert.notEqual(report.modelRouting.heuristic.selected, 'claude-opus');
  const pick = report.modelRouting.optimized.candidate;
  assert.ok(pick);
  assert.ok(pick.cost <= proof.DEFAULT_BUDGETS.maxBudgetUsd);
  assert.ok(pick.latency_ms <= proof.DEFAULT_BUDGETS.maxLatencyMs);
});

test('buyer narrative includes disclaimers (no false Gurobi partnership)', () => {
  const report = proof.runBudgetAwareGatesProof({ skipProbe: true });
  const text = JSON.stringify(report.buyerNarrative);
  assert.match(text, /No Gurobi partnership/);
  assert.match(text, /Budget-aware enforcement/);
  assert.match(text, /SIMULATION/);
  assert.equal(report.mode, 'simulation');
  assert.ok(!/partner logo|official partner|powered exclusively by Gurobi/i.test(text));
});

test('optimized routing stays budget-compliant and error labels are not success', () => {
  const report = proof.runBudgetAwareGatesProof({ skipProbe: true });
  assert.ok(report.modelRouting.optimized.budgetCompliant);
  assert.notEqual(report.modelRouting.optimized.selected, 'claude-opus');
  const label = String(report.probe.solverLabel || '');
  // Error-fallback labels must never flip gurobiAvailable true via prefix match alone.
  if (/gurobi-error|error-fallback/i.test(label)) {
    assert.equal(report.probe.gurobiAvailable, false);
  }
  // When a raw solver error label was coerced away, report stays honest.
  if (/gurobi-error|error-fallback/i.test(String(report.probe.rawSolverLabel || ''))) {
    assert.equal(report.probe.gurobiAvailable, false);
  }
});

test('mainCli --write without .json suffix still preserves distinct json+md', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-budget-proof-'));
  const out = path.join(dir, 'report');
  proof.mainCli(['--write', out, '--json']);
  assert.ok(fs.existsSync(`${out}.json`));
  assert.ok(fs.existsSync(`${out}.md`));
  const parsed = JSON.parse(fs.readFileSync(`${out}.json`, 'utf8'));
  assert.equal(parsed.schema, 'thumbgate.budget_aware_gates_proof.v1');
});

test('formatMarkdown is non-empty and includes tables', () => {
  const report = proof.runBudgetAwareGatesProof({ skipProbe: true });
  const md = proof.formatMarkdown(report);
  assert.match(md, /Budget-aware gates proof/);
  assert.match(md, /Model routing/);
  assert.match(md, /Rule knapsack/);
  assert.match(md, /Disclaimers/);
});

test('mainCli --write emits json and md', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-budget-proof-'));
  const out = path.join(dir, 'proof.json');
  proof.mainCli(['--write', out, '--json']);
  assert.ok(fs.existsSync(out));
  assert.ok(fs.existsSync(out.replace(/\.json$/, '.md')));
  const parsed = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(parsed.schema, 'thumbgate.budget_aware_gates_proof.v1');
});

test('greedy heuristic is deterministic on demo fixtures', () => {
  const a = proof.greedyHeuristicRouting(proof.DEMO_MODEL_CANDIDATES, proof.DEFAULT_BUDGETS);
  const b = proof.greedyHeuristicRouting(proof.DEMO_MODEL_CANDIDATES, proof.DEFAULT_BUDGETS);
  assert.equal(a.selected, b.selected);
  const r1 = proof.greedyHeuristicRules(proof.DEMO_RULES, proof.DEFAULT_BUDGETS);
  const r2 = proof.greedyHeuristicRules(proof.DEMO_RULES, proof.DEFAULT_BUDGETS);
  assert.deepEqual(r1.selected_rules, r2.selected_rules);
});
