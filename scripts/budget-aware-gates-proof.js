'use strict';

/**
 * Budget-aware gates proof — sales-safe demo of ThumbGate optimization
 *
 * Uses the Fabrizio Ellis free-pip Gurobi path (when available) to compare:
 *   1) Deterministic heuristic selection
 *   2) MILP solver selection (Gurobi via gurobi-optimizer.js, heuristic fallback in CI)
 *
 * What this proves for buyers:
 *   - ThumbGate does not load "every prevention rule always"
 *   - Model routing respects cost + latency budgets
 *   - Rule knapsacks maximize risk mitigation under eval-time/token budgets
 *
 * What this does NOT claim:
 *   - Gurobi partnership / co-sell / affiliation
 *   - Captured cash or revenue from the solve
 *   - That commercial Gurobi is required (free-pip + fail-open heuristics work)
 *
 * Usage:
 *   node scripts/budget-aware-gates-proof.js
 *   node scripts/budget-aware-gates-proof.js --json
 *   node scripts/budget-aware-gates-proof.js --write proof/budget-aware-gates.json
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  optimizeModelRouting,
  optimizeRuleSelection,
  probeGurobi,
} = require('./gurobi-optimizer');

/** Fixed demo workload — deterministic for CI and demos. */
const DEMO_MODEL_CANDIDATES = [
  { id: 'local-vllm-8b', score: 7.8, cost: 0.0, latency_ms: 180, notes: 'local free' },
  { id: 'qwen-flash', score: 8.4, cost: 0.002, latency_ms: 220, notes: 'cheap cloud' },
  { id: 'claude-sonnet', score: 9.6, cost: 0.018, latency_ms: 900, notes: 'premium' },
  { id: 'claude-opus', score: 9.9, cost: 0.06, latency_ms: 1400, notes: 'over budget' },
  { id: 'gpt-mini', score: 8.1, cost: 0.004, latency_ms: 350, notes: 'mid tier' },
];

const DEMO_RULES = [
  { id: 'secret-egress', risk_mitigation: 9.5, eval_time_ms: 4, token_footprint: 80 },
  { id: 'deny-network-egress', risk_mitigation: 7.0, eval_time_ms: 3, token_footprint: 60 },
  { id: 'task-scope-lease', risk_mitigation: 8.2, eval_time_ms: 6, token_footprint: 120 },
  { id: 'protected-file-approval', risk_mitigation: 8.8, eval_time_ms: 5, token_footprint: 100 },
  { id: 'spend-guard', risk_mitigation: 6.5, eval_time_ms: 2, token_footprint: 40 },
  { id: 'stealth-memory-injection', risk_mitigation: 9.0, eval_time_ms: 12, token_footprint: 200 },
  { id: 'claim-verification', risk_mitigation: 5.5, eval_time_ms: 15, token_footprint: 250 },
  { id: 'outbound-email-human', risk_mitigation: 7.5, eval_time_ms: 3, token_footprint: 50 },
  { id: 'branch-protection', risk_mitigation: 8.0, eval_time_ms: 4, token_footprint: 70 },
  { id: 'low-value-noise-rule', risk_mitigation: 1.0, eval_time_ms: 20, token_footprint: 300 },
];

const DEFAULT_BUDGETS = {
  maxBudgetUsd: 0.01,
  maxLatencyMs: 500,
  maxEvalTimeMs: 30,
  maxTokenFootprint: 600,
};

function greedyHeuristicRouting(candidates, { maxBudgetUsd, maxLatencyMs }) {
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
    solver: 'pure-greedy-heuristic',
    objective: best.score || 0,
    candidate: best,
  };
}

function greedyHeuristicRules(rules, { maxEvalTimeMs, maxTokenFootprint }) {
  const sorted = [...rules].sort(
    (a, b) =>
      (b.risk_mitigation || 0) / Math.max(b.eval_time_ms || 0.1, 0.1)
      - (a.risk_mitigation || 0) / Math.max(a.eval_time_ms || 0.1, 0.1)
  );
  const selected = [];
  let curTime = 0;
  let curTokens = 0;
  let mitigation = 0;
  for (const r of sorted) {
    const t = r.eval_time_ms || 0;
    const tok = r.token_footprint || 0;
    if (curTime + t <= maxEvalTimeMs && curTokens + tok <= maxTokenFootprint) {
      selected.push(r.id);
      curTime += t;
      curTokens += tok;
      mitigation += r.risk_mitigation || 0;
    }
  }
  return {
    success: true,
    selected_rules: selected,
    solver: 'pure-greedy-knapsack',
    used_time_ms: curTime,
    used_tokens: curTokens,
    total_mitigation: mitigation,
  };
}

function sumMitigation(rules, ids) {
  const set = new Set(ids || []);
  return rules
    .filter((r) => set.has(r.id))
    .reduce((s, r) => s + (r.risk_mitigation || 0), 0);
}

function findCandidate(id) {
  return DEMO_MODEL_CANDIDATES.find((c) => c.id === id) || null;
}

/**
 * Run the full proof suite.
 * @param {object} options
 * @returns {object} structured proof report
 */
function runBudgetAwareGatesProof(options = {}) {
  const budgets = { ...DEFAULT_BUDGETS, ...(options.budgets || {}) };
  const started = Date.now();

  const heuristicRouting = greedyHeuristicRouting(DEMO_MODEL_CANDIDATES, budgets);
  const solverRouting = optimizeModelRouting(DEMO_MODEL_CANDIDATES, {
    maxBudgetUsd: budgets.maxBudgetUsd,
    maxLatencyMs: budgets.maxLatencyMs,
  }, options.solverOpts || {});

  const heuristicRules = greedyHeuristicRules(DEMO_RULES, budgets);
  const solverRules = optimizeRuleSelection(DEMO_RULES, {
    maxEvalTimeMs: budgets.maxEvalTimeMs,
    maxTokenFootprint: budgets.maxTokenFootprint,
  }, options.solverOpts || {});

  const probe = options.skipProbe ? { ok: null, gurobi: false } : probeGurobi(options.solverOpts || {});

  const routingHeuristicScore = heuristicRouting.objective || 0;
  const routingSolverScore = solverRouting.objective || 0;
  const rulesHeuristicMitigation = heuristicRules.total_mitigation
    || sumMitigation(DEMO_RULES, heuristicRules.selected_rules);
  const rulesSolverMitigation = sumMitigation(
    DEMO_RULES,
    solverRules.selected_rules || []
  );

  const solverIsGurobi = String(solverRouting.solver || '').startsWith('gurobi')
    || String(solverRules.solver || '').startsWith('gurobi')
    || probe.gurobi === true;

  const report = {
    schema: 'thumbgate.budget_aware_gates_proof.v1',
    generatedAt: new Date().toISOString(),
    latencyMs: Date.now() - started,
    budgets,
    probe: {
      ok: probe.ok,
      gurobiAvailable: Boolean(probe.gurobi || solverIsGurobi),
      solverLabel: solverRouting.solver || null,
      python: probe.python || null,
    },
    modelRouting: {
      budgetUsd: budgets.maxBudgetUsd,
      maxLatencyMs: budgets.maxLatencyMs,
      heuristic: {
        selected: heuristicRouting.selected,
        score: routingHeuristicScore,
        solver: heuristicRouting.solver,
        candidate: findCandidate(heuristicRouting.selected),
      },
      optimized: {
        selected: solverRouting.selected,
        score: routingSolverScore,
        solver: solverRouting.solver,
        candidate: findCandidate(solverRouting.selected),
      },
      scoreDelta: routingSolverScore - routingHeuristicScore,
      sameSelection: heuristicRouting.selected === solverRouting.selected,
    },
    ruleKnapsack: {
      maxEvalTimeMs: budgets.maxEvalTimeMs,
      maxTokenFootprint: budgets.maxTokenFootprint,
      ruleCount: DEMO_RULES.length,
      heuristic: {
        selected: heuristicRules.selected_rules,
        count: (heuristicRules.selected_rules || []).length,
        mitigation: rulesHeuristicMitigation,
        usedTimeMs: heuristicRules.used_time_ms,
        usedTokens: heuristicRules.used_tokens,
        solver: heuristicRules.solver,
      },
      optimized: {
        selected: solverRules.selected_rules || [],
        count: (solverRules.selected_rules || []).length,
        mitigation: rulesSolverMitigation,
        usedTimeMs: solverRules.used_time_ms,
        usedTokens: solverRules.used_tokens,
        solver: solverRules.solver,
      },
      mitigationDelta: rulesSolverMitigation - rulesHeuristicMitigation,
      droppedLowValue: DEMO_RULES
        .map((r) => r.id)
        .filter((id) => !(solverRules.selected_rules || []).includes(id)),
    },
    buyerNarrative: {
      headline: 'Budget-aware enforcement — not “load every rule always”',
      bullets: [
        `Model routing under $${budgets.maxBudgetUsd} / ${budgets.maxLatencyMs}ms budget selects ${solverRouting.selected} (solver=${solverRouting.solver}).`,
        `Prevention-rule knapsack keeps ${ (solverRules.selected_rules || []).length } of ${DEMO_RULES.length} rules under ${budgets.maxEvalTimeMs}ms / ${budgets.maxTokenFootprint} tokens.`,
        `Risk-mitigation score: heuristic ${rulesHeuristicMitigation.toFixed(1)} → optimized ${rulesSolverMitigation.toFixed(1)} (Δ ${ (rulesSolverMitigation - rulesHeuristicMitigation).toFixed(1) }).`,
        solverIsGurobi
          ? 'MILP solver available (free-pip Gurobi path or compatible). Heuristics remain the CI/fallback path.'
          : 'Running on deterministic heuristic fallback — same API, fail-open when solver unavailable.',
      ],
      disclaimers: [
        'ThumbGate product claim is budget-aware gates; solver is an implementation detail.',
        'No Gurobi partnership, co-sell, or affiliation is claimed.',
        'capturedRevenueUsd is not computed here — optimization ≠ cash collected.',
      ],
    },
    fixtures: {
      candidates: DEMO_MODEL_CANDIDATES,
      rules: DEMO_RULES,
    },
  };

  return report;
}

function formatMarkdown(report) {
  const lines = [
    '# Budget-aware gates proof',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    report.buyerNarrative.headline,
    '',
    '## What buyers should hear',
    '',
    ...report.buyerNarrative.bullets.map((b) => `- ${b}`),
    '',
    '## Model routing',
    '',
    `| Path | Selected | Score | Solver |`,
    `|------|----------|-------|--------|`,
    `| Heuristic | ${report.modelRouting.heuristic.selected} | ${report.modelRouting.heuristic.score} | ${report.modelRouting.heuristic.solver} |`,
    `| Optimized | ${report.modelRouting.optimized.selected} | ${report.modelRouting.optimized.score} | ${report.modelRouting.optimized.solver} |`,
    '',
    '## Rule knapsack',
    '',
    `| Path | Rules | Mitigation | Time ms | Tokens |`,
    `|------|-------|------------|---------|--------|`,
    `| Heuristic | ${report.ruleKnapsack.heuristic.count} | ${report.ruleKnapsack.heuristic.mitigation.toFixed(1)} | ${report.ruleKnapsack.heuristic.usedTimeMs} | ${report.ruleKnapsack.heuristic.usedTokens} |`,
    `| Optimized | ${report.ruleKnapsack.optimized.count} | ${report.ruleKnapsack.optimized.mitigation.toFixed(1)} | ${report.ruleKnapsack.optimized.usedTimeMs ?? '—'} | ${report.ruleKnapsack.optimized.usedTokens ?? '—'} |`,
    '',
    '## Disclaimers',
    '',
    ...report.buyerNarrative.disclaimers.map((d) => `- ${d}`),
    '',
  ];
  return lines.join('\n');
}

function mainCli(argv = process.argv.slice(2)) {
  const json = argv.includes('--json');
  const writeIdx = argv.indexOf('--write');
  const writePath = writeIdx >= 0 ? argv[writeIdx + 1] : null;

  const report = runBudgetAwareGatesProof();

  if (writePath) {
    const abs = path.resolve(writePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    const mdPath = abs.replace(/\.json$/i, '.md');
    fs.writeFileSync(mdPath, formatMarkdown(report), 'utf8');
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatMarkdown(report));
  }

  return report;
}

if (require.main === module || (
  process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(__filename)
)) {
  mainCli();
}

module.exports = {
  DEMO_MODEL_CANDIDATES,
  DEMO_RULES,
  DEFAULT_BUDGETS,
  greedyHeuristicRouting,
  greedyHeuristicRules,
  runBudgetAwareGatesProof,
  formatMarkdown,
  mainCli,
};
