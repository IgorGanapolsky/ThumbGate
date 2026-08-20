'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  optimizeModelRouting,
  optimizeRuleSelection,
  optimizeFleetDispatch,
  createCertifiedReceipt,
  resolvePythonBin,
  probeGurobi,
  isCertifiedSolve,
  stampReceipt,
  parseSolverStdout,
  mainCli,
} = require('../scripts/gurobi-optimizer.js');

test('Gurobi Optimizer - Node.js integration', async (t) => {
  await t.test('resolves a python interpreter path', () => {
    const bin = resolvePythonBin();
    assert.ok(typeof bin === 'string' && bin.length > 0);
  });

  await t.test('resolvePythonBin prefers GUROBI_PYTHON when present on disk', () => {
    const self = process.execPath; // always exists
    const bin = resolvePythonBin({ GUROBI_PYTHON: self }, '/tmp');
    assert.equal(bin, self);
  });

  await t.test('resolvePythonBin falls through missing paths to python3', () => {
    const bin = resolvePythonBin(
      { GUROBI_PYTHON: '/no/such/python-bin-xyz', PYTHON_BIN: '/also/missing' },
      '/tmp/no-hermes-home'
    );
    assert.equal(bin, 'python3');
  });

  await t.test('optimizes model routing under budget+latency (correct selection)', () => {
    const candidates = [
      { id: 'c1', score: 7.0, cost: 0.001, latency_ms: 100 },
      { id: 'c2', score: 9.5, cost: 0.020, latency_ms: 1500 },
      { id: 'c3', score: 8.8, cost: 0.005, latency_ms: 300 },
    ];

    const result = optimizeModelRouting(candidates, { maxBudgetUsd: 0.01, maxLatencyMs: 500 });
    assert.equal(result.success, true);
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
      assert.equal(result.certified, true);
      assert.equal(isCertifiedSolve(result), true);
    } else {
      assert.equal(result.certified, false);
      assert.equal(isCertifiedSolve(result), false);
    }
    assert.equal(result.capturedRevenueUsd, 0);
  });

  await t.test('infeasible routing is fail-closed and returns IIS, not a high-score violator', () => {
    const result = optimizeModelRouting(
      [
        { id: 'expensive', score: 99, cost: 10, latency_ms: 10 },
        { id: 'slow', score: 80, cost: 0, latency_ms: 50000 },
      ],
      { maxBudgetUsd: 0.01, maxLatencyMs: 5 }
    );
    assert.equal(result.success, false);
    assert.equal(result.selected, null);
    assert.equal(result.certified, false);
    assert.equal(isCertifiedSolve(result), false);
    assert.equal(result.capturedRevenueUsd, 0);
    assert.equal(result.status, 'INFEASIBLE');
    assert.ok(Array.isArray(result.iis));
    assert.ok(result.iis.some((name) => /Budget|Latency|SelectOne/i.test(String(name))));
  });

  await t.test('stampReceipt refuses to certify heuristics', () => {
    const stamped = stampReceipt({
      success: true,
      selected: 'x',
      solver: 'heuristic-fallback',
      status: 'HEURISTIC',
    });
    assert.equal(stamped.certified, false);
    assert.equal(stamped.capturedRevenueUsd, 0);
    assert.equal(stamped.proof, 'heuristic');
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
    assert.equal(typeof probe.gurobi, 'boolean');
    // ok means a real Gurobi solve; heuristic/error fallbacks are unavailable
    assert.equal(probe.ok, Boolean(probe.gurobi));
    if (probe.ok) {
      assert.match(String(probe.solver || ''), /^gurobi/);
    }
  });

  await t.test('node fallback when python binary is unusable', () => {
    const candidates = [
      { id: 'c1', score: 7.0, cost: 0.001, latency_ms: 100 },
      { id: 'c3', score: 8.8, cost: 0.005, latency_ms: 300 },
    ];
    const routing = optimizeModelRouting(
      candidates,
      { maxBudgetUsd: 0.01, maxLatencyMs: 500 },
      { pythonBin: '/nonexistent/gurobi-python-bin' }
    );
    assert.equal(routing.success, true);
    assert.equal(routing.selected, 'c3');
    assert.equal(routing.solver, 'node-fallback-heuristic');

    const rules = optimizeRuleSelection(
      [
        { id: 'r1', risk_mitigation: 90, eval_time_ms: 5, token_footprint: 100 },
        { id: 'r3', risk_mitigation: 95, eval_time_ms: 25, token_footprint: 300 },
      ],
      { maxEvalTimeMs: 30, maxTokenFootprint: 450 },
      { pythonBin: '/nonexistent/gurobi-python-bin' }
    );
    assert.equal(rules.success, true);
    assert.equal(rules.solver, 'node-fallback-knapsack');
    assert.ok(Array.isArray(rules.selected_rules));
  });

  await t.test('optimizes fleet dispatch under concurrency, RAM, and CPU constraints', () => {
    const jobs = [
      { id: 'job-e2e', priority: 10, ram_mb: 8192, cpu_cores: 4 },
      { id: 'job-lint', priority: 5, ram_mb: 2048, cpu_cores: 2 },
      { id: 'job-audit', priority: 8, ram_mb: 4096, cpu_cores: 2 },
      { id: 'job-heavy-train', priority: 6, ram_mb: 32768, cpu_cores: 8 },
    ];
    const res = optimizeFleetDispatch(jobs, { maxRamMb: 16384, maxCpuCores: 8, maxConcurrency: 3 });
    assert.equal(res.success, true);
    assert.ok(Array.isArray(res.selected_jobs));
    assert.ok(res.selected_jobs.includes('job-e2e'));
    assert.ok(res.selected_jobs.includes('job-audit'));
    // Heavy train requires 32GB RAM so it must NOT be selected under 16GB cap
    assert.equal(res.selected_jobs.includes('job-heavy-train'), false);

    const receipt = createCertifiedReceipt(res, 'fleet-dispatch');
    assert.equal(receipt.certified, true);
    assert.ok(receipt.receiptId.startsWith('opt_rcpt_'));
    assert.ok(receipt.signatureSha256);
  });

  await t.test('parseSolverStdout ignores Gurobi license banner prefix', () => {
    const parsed = parseSolverStdout(
      'Restricted license - for non-production use only - expires 2027-11-29\n{"success":true,"selected":"x"}\n'
    );
    assert.equal(parsed.success, true);
    assert.equal(parsed.selected, 'x');
    assert.throws(() => parseSolverStdout('Restricted license only'), /no JSON object/);
  });

  await t.test('rule knapsack uses Gurobi when available (density trap)', () => {
    const rules = [
      { id: 'dense-small', risk_mitigation: 10, eval_time_ms: 6, token_footprint: 6 },
      { id: 'pair-a', risk_mitigation: 8, eval_time_ms: 5, token_footprint: 5 },
      { id: 'pair-b', risk_mitigation: 8, eval_time_ms: 5, token_footprint: 5 },
    ];
    const result = optimizeRuleSelection(rules, { maxEvalTimeMs: 10, maxTokenFootprint: 10 });
    assert.equal(result.success, true);
    if (result.solver === 'gurobi') {
      assert.deepEqual([...(result.selected_rules || [])].sort(), ['pair-a', 'pair-b']);
      assert.equal(result.objective, 16);
      assert.equal(result.status, 'OPTIMAL');
    } else {
      assert.ok(
        String(result.solver || '').includes('heuristic') || String(result.solver || '').includes('fallback'),
        `unexpected solver: ${result.solver}`
      );
    }
  });

  await t.test('mainCli returns probe + routing payload', () => {
    const out = mainCli();
    assert.equal(typeof out.probe.ok, 'boolean');
    assert.equal(out.routing.success, true);
    assert.ok(out.routing.selected);
  });

  await t.test('module path identity for CLI entry', () => {
    // Keep the path-resolve CLI guard from being dead code in reports:
    // invoke the script as a process with a tiny timeout budget.
    const { execFileSync } = require('node:child_process');
    const script = path.join(__dirname, '..', 'scripts', 'gurobi-optimizer.js');
    const stdout = execFileSync(process.execPath, [script], {
      encoding: 'utf8',
      timeout: 15000,
      env: process.env,
    });
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.routing.success, true);
  });
});
