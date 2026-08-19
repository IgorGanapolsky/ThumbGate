#!/usr/bin/env node
'use strict';

/**
 * Gurobi Optimization Engine bridge (Node → gurobipy).
 *
 * System-wide runtime (Fabrizio Ellis / free pip path, 2026-08-12):
 *   GUROBI_PYTHON / ~/.hermes/gurobi-venv/bin/python / python3
 *   fleet CLI: gurobi-fleet  | MCP: gurobi-mcp
 *
 * Solves MILP for model routing and prevention-rule knapsack selection.
 * Fail-open to deterministic heuristics when gurobipy is unavailable (CI).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPT_PATH = path.join(__dirname, 'gurobi_optimizer.py');

function resolvePythonBin(env = process.env, homeDir = os.homedir()) {
  const candidates = [
    env.GUROBI_PYTHON,
    env.PYTHON_BIN,
    path.join(homeDir, '.hermes', 'gurobi-venv', 'bin', 'python'),
    path.join(homeDir, '.hermes', 'gurobi-venv', 'bin', 'python3'),
    'python3',
  ].filter(Boolean);

  for (const bin of candidates) {
    if (bin === 'python3' || bin === 'python') return bin;
    try {
      if (fs.existsSync(bin)) return bin;
    } catch {
      /* continue */
    }
  }
  return 'python3';
}

function parseSolverStdout(stdout) {
  const text = String(stdout || '');
  const start = text.indexOf('{');
  if (start < 0) {
    throw new SyntaxError('solver stdout contained no JSON object');
  }
  return JSON.parse(text.slice(start));
}

function runPythonMode(mode, payload, timeoutMs = 10000, pythonBin = resolvePythonBin()) {
  const stdout = execFileSync(
    pythonBin,
    [SCRIPT_PATH, '--mode', mode, '--input', JSON.stringify(payload)],
    {
      encoding: 'utf8',
      timeout: timeoutMs,
      env: {
        ...process.env,
        PYTHONPATH: [
          path.join(os.homedir(), '.hermes', 'gurobi'),
          process.env.PYTHONPATH || '',
        ].filter(Boolean).join(path.delimiter),
      },
    }
  );
  return parseSolverStdout(stdout);
}

/**
 * Decision-intelligence governance stamp (Beyond LLMs process, not Gurobi product).
 * Understanding = heuristic (plausible). Computation = OPTIMAL MILP (repeatable).
 * Action stays human-oversight — solver picks never auto-apply to PreToolUse.
 */
function isRepeatableSolve(result) {
  const solver = String((result && result.solver) || '').toLowerCase();
  return solver === 'gurobi' && String((result && result.status) || '') === 'OPTIMAL';
}

function stampDecisionGovernance(result) {
  const body = result && typeof result === 'object' ? { ...result } : {};
  const repeatable = isRepeatableSolve(body);
  body.autoApply = false;
  body.humanOversightRequired = true;
  body.capturedRevenueUsd = 0;
  body.repeatable = repeatable;
  body.plausibleOnly = !repeatable;
  body.certified = repeatable && body.success === true;
  if (body.certified) {
    body.proof = body.proof || 'gurobi-optimal';
  } else if (String(body.status || '').startsWith('INFEASIBLE')) {
    body.proof = body.proof || 'infeasible-iis';
  } else if (/heuristic|fallback/i.test(String(body.solver || ''))) {
    body.proof = body.proof || 'heuristic';
  } else {
    body.proof = body.proof || 'unproven';
  }
  return body;
}

const stampReceipt = stampDecisionGovernance;
const isCertifiedSolve = isRepeatableSolve;

/**
 * Optimizes model candidate routing via Gurobi MILP solver.
 * Falls back to deterministic heuristic if Gurobi is unavailable.
 */
function optimizeModelRouting(candidates, { maxBudgetUsd = 1.0, maxLatencyMs = 5000.0 } = {}, opts = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return stampDecisionGovernance({
      success: false,
      selected: null,
      error: 'Candidates must be a non-empty array',
    });
  }

  const pythonBin = opts.pythonBin || resolvePythonBin();
  try {
    return stampDecisionGovernance(runPythonMode('routing', {
      candidates,
      max_budget_usd: maxBudgetUsd,
      max_latency_ms: maxLatencyMs,
    }, opts.timeoutMs || 10000, pythonBin));
  } catch (err) {
    const valid = candidates.filter(
      (c) => (c.cost || 0) <= maxBudgetUsd && (c.latency_ms || 0) <= maxLatencyMs
    );
    if (valid.length === 0) {
      return stampDecisionGovernance({
        success: false,
        selected: null,
        solver: 'node-fallback-heuristic',
        status: 'INFEASIBLE',
        iis: ['BudgetLimit', 'LatencyLimit'],
        reason: 'no candidate satisfies budget and latency',
        error: err.message,
        python: pythonBin,
      });
    }
    const best = valid.reduce(
      (prev, curr) => ((curr.score || 0) > (prev.score || 0) ? curr : prev),
      valid[0]
    );
    return stampDecisionGovernance({
      success: true,
      selected: best.id,
      solver: 'node-fallback-heuristic',
      status: 'HEURISTIC',
      objective: best.score || 0,
      error: err.message,
      python: pythonBin,
    });
  }
}

/**
 * Optimizes active prevention rule selection via Gurobi 0-1 Knapsack solver.
 */
function optimizeRuleSelection(rules, { maxEvalTimeMs = 50.0, maxTokenFootprint = 1000 } = {}, opts = {}) {
  if (!Array.isArray(rules) || rules.length === 0) {
    return stampDecisionGovernance({
      success: false,
      selected_rules: [],
      error: 'Rules must be a non-empty array',
    });
  }

  const pythonBin = opts.pythonBin || resolvePythonBin();
  try {
    return stampDecisionGovernance(runPythonMode('rules', {
      rules,
      max_eval_time_ms: maxEvalTimeMs,
      max_token_footprint: maxTokenFootprint,
    }, opts.timeoutMs || 10000, pythonBin));
  } catch (err) {
    const sorted = [...rules].sort(
      (a, b) =>
        (b.risk_mitigation || 0) / Math.max(b.eval_time_ms || 0.1, 0.1)
        - (a.risk_mitigation || 0) / Math.max(a.eval_time_ms || 0.1, 0.1)
    );
    const selected = [];
    let curTime = 0;
    let curTokens = 0;
    for (const r of sorted) {
      const t = r.eval_time_ms || 0;
      const tok = r.token_footprint || 0;
      if (curTime + t <= maxEvalTimeMs && curTokens + tok <= maxTokenFootprint) {
        selected.push(r.id);
        curTime += t;
        curTokens += tok;
      }
    }
    return stampDecisionGovernance({
      success: true,
      selected_rules: selected,
      solver: 'node-fallback-knapsack',
      status: 'HEURISTIC',
      used_time_ms: curTime,
      used_tokens: curTokens,
      error: err.message,
      python: pythonBin,
    });
  }
}

function probeGurobi(opts = {}) {
  try {
    const res = optimizeModelRouting(
      [{ id: 'probe', score: 1, cost: 0, latency_ms: 1 }],
      { maxBudgetUsd: 1, maxLatencyMs: 10 },
      opts
    );
    return {
      ok: Boolean(res && res.success),
      solver: res.solver || null,
      python: res.python || resolvePythonBin(),
      gurobi: String(res.solver || '').startsWith('gurobi'),
    };
  } catch (err) {
    return { ok: false, error: err.message, python: resolvePythonBin(), gurobi: false };
  }
}

function mainCli() {
  const sampleCandidates = [
    { id: 'qwen-3b', score: 8.2, cost: 0.001, latency_ms: 120 },
    { id: 'claude-3-5', score: 9.8, cost: 0.015, latency_ms: 1200 },
    { id: 'local-vllm', score: 8.9, cost: 0.0, latency_ms: 250 },
  ];
  const routingRes = optimizeModelRouting(sampleCandidates, {
    maxBudgetUsd: 0.01,
    maxLatencyMs: 500,
  });
  return { probe: probeGurobi(), routing: routingRes };
}

module.exports = {
  optimizeModelRouting,
  optimizeRuleSelection,
  resolvePythonBin,
  probeGurobi,
  runPythonMode,
  parseSolverStdout,
  isRepeatableSolve,
  isCertifiedSolve,
  stampDecisionGovernance,
  stampReceipt,
  mainCli,
  get PYTHON_BIN() {
    return resolvePythonBin();
  },
};

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  console.log(JSON.stringify(mainCli(), null, 2));
}
