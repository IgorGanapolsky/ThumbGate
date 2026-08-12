#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
const SCRIPT_PATH = path.join(__dirname, 'gurobi_optimizer.py');

/**
 * Optimizes model candidate routing via Gurobi MILP solver.
 * Falls back to deterministic heuristic if Gurobi is unavailable.
 */
function optimizeModelRouting(candidates, { maxBudgetUsd = 1.0, maxLatencyMs = 5000.0 } = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { success: false, selected: null, error: 'Candidates must be a non-empty array' };
  }

  const payload = JSON.stringify({
    candidates,
    max_budget_usd: maxBudgetUsd,
    max_latency_ms: maxLatencyMs
  });

  try {
    const stdout = execFileSync(PYTHON_BIN, [SCRIPT_PATH, '--mode', 'routing', '--input', payload], {
      encoding: 'utf8',
      timeout: 10000
    });
    return JSON.parse(stdout);
  } catch (err) {
    // Fallback heuristic if Python / Gurobi fails
    const valid = candidates.filter((c) => (c.cost || 0) <= maxBudgetUsd && (c.latency_ms || 0) <= maxLatencyMs);
    const pool = valid.length > 0 ? valid : candidates;
    const best = pool.reduce((prev, curr) => ((curr.score || 0) > (prev.score || 0) ? curr : prev), pool[0]);
    return {
      success: true,
      selected: best.id,
      solver: 'node-fallback-heuristic',
      objective: best.score || 0,
      error: err.message
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

  const payload = JSON.stringify({
    rules,
    max_eval_time_ms: maxEvalTimeMs,
    max_token_footprint: maxTokenFootprint
  });

  try {
    const stdout = execFileSync(PYTHON_BIN, [SCRIPT_PATH, '--mode', 'rules', '--input', payload], {
      encoding: 'utf8',
      timeout: 10000
    });
    return JSON.parse(stdout);
  } catch (err) {
    // Fallback greedy knapsack
    const sorted = [...rules].sort((a, b) => (b.risk_mitigation || 0) / Math.max(b.eval_time_ms || 0.1, 0.1) - (a.risk_mitigation || 0) / Math.max(a.eval_time_ms || 0.1, 0.1));
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
      error: err.message
    };
  }
}

module.exports = {
  optimizeModelRouting,
  optimizeRuleSelection
};

if (require.main === module) {
  const sampleCandidates = [
    { id: 'qwen-3b', score: 8.2, cost: 0.001, latency_ms: 120 },
    { id: 'claude-3-5', score: 9.8, cost: 0.015, latency_ms: 1200 },
    { id: 'local-vllm', score: 8.9, cost: 0.0, latency_ms: 250 }
  ];

  const routingRes = optimizeModelRouting(sampleCandidates, { maxBudgetUsd: 0.01, maxLatencyMs: 500 });
  console.log('Model Routing Optimization Result:', JSON.stringify(routingRes, null, 2));
}
