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

function resolvePythonBin() {
  const candidates = [
    process.env.GUROBI_PYTHON,
    process.env.PYTHON_BIN,
    path.join(os.homedir(), '.hermes', 'gurobi-venv', 'bin', 'python'),
    path.join(os.homedir(), '.hermes', 'gurobi-venv', 'bin', 'python3'),
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

const PYTHON_BIN = resolvePythonBin();

function runPythonMode(mode, payload, timeoutMs = 10000) {
  const stdout = execFileSync(
    PYTHON_BIN,
    [SCRIPT_PATH, '--mode', mode, '--input', JSON.stringify(payload)],
    {
      encoding: 'utf8',
      timeout: timeoutMs,
      env: {
        ...process.env,
        // Prefer the resolved interpreter's site-packages (gurobipy).
        PYTHONPATH: [
          path.join(os.homedir(), '.hermes', 'gurobi'),
          process.env.PYTHONPATH || '',
        ].filter(Boolean).join(path.delimiter),
      },
    }
  );
  return JSON.parse(stdout);
}

/**
 * Optimizes model candidate routing via Gurobi MILP solver.
 * Falls back to deterministic heuristic if Gurobi is unavailable.
 */
function optimizeModelRouting(candidates, { maxBudgetUsd = 1.0, maxLatencyMs = 5000.0 } = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { success: false, selected: null, error: 'Candidates must be a non-empty array' };
  }

  try {
    return runPythonMode('routing', {
      candidates,
      max_budget_usd: maxBudgetUsd,
      max_latency_ms: maxLatencyMs,
    });
  } catch (err) {
    const valid = candidates.filter(
      (c) => (c.cost || 0) <= maxBudgetUsd && (c.latency_ms || 0) <= maxLatencyMs
    );
    const pool = valid.length > 0 ? valid : candidates;
    const best = pool.reduce(
      (prev, curr) => ((curr.score || 0) > (prev.score || 0) ? curr : prev),
      pool[0]
    );
    return {
      success: true,
      selected: best.id,
      solver: 'node-fallback-heuristic',
      objective: best.score || 0,
      error: err.message,
      python: PYTHON_BIN,
    };
  }
}

/**
 * Optimizes active prevention rule selection via Gurobi 0-1 Knapsack solver.
 */
function optimizeRuleSelection(rules, { maxEvalTimeMs = 50.0, maxTokenFootprint = 1000 } = {}) {
  if (!Array.isArray(rules) || rules.length === 0) {
    return { success: false, selected_rules: [], error: 'Rules must be a non-empty array' };
  }

  try {
    return runPythonMode('rules', {
      rules,
      max_eval_time_ms: maxEvalTimeMs,
      max_token_footprint: maxTokenFootprint,
    });
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
    return {
      success: true,
      selected_rules: selected,
      solver: 'node-fallback-knapsack',
      used_time_ms: curTime,
      used_tokens: curTokens,
      error: err.message,
      python: PYTHON_BIN,
    };
  }
}

function probeGurobi() {
  try {
    const res = optimizeModelRouting(
      [{ id: 'probe', score: 1, cost: 0, latency_ms: 1 }],
      { maxBudgetUsd: 1, maxLatencyMs: 10 }
    );
    return {
      ok: Boolean(res && res.success),
      solver: res.solver || null,
      python: PYTHON_BIN,
      gurobi: String(res.solver || '').startsWith('gurobi'),
    };
  } catch (err) {
    return { ok: false, error: err.message, python: PYTHON_BIN, gurobi: false };
  }
}

module.exports = {
  optimizeModelRouting,
  optimizeRuleSelection,
  resolvePythonBin,
  probeGurobi,
  PYTHON_BIN,
};

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  const sampleCandidates = [
    { id: 'qwen-3b', score: 8.2, cost: 0.001, latency_ms: 120 },
    { id: 'claude-3-5', score: 9.8, cost: 0.015, latency_ms: 1200 },
    { id: 'local-vllm', score: 8.9, cost: 0.0, latency_ms: 250 },
  ];

  const routingRes = optimizeModelRouting(sampleCandidates, {
    maxBudgetUsd: 0.01,
    maxLatencyMs: 500,
  });
  console.log(JSON.stringify({ probe: probeGurobi(), routing: routingRes }, null, 2));
}
