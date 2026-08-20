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
  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length === 0) {
    return {
      success: false,
      selected: null,
      solver: 'pure-greedy-heuristic',
      objective: 0,
      candidate: null,
      reason: 'no_candidates',
    };
  }
  const valid = list.filter(
    (c) => (c.cost || 0) <= maxBudgetUsd && (c.latency_ms || 0) <= maxLatencyMs
  );
  const pool = valid.length > 0 ? valid : list;
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
  const list = Array.isArray(rules) ? rules : [];
  if (list.length === 0) {
    return {
      success: false,
      selected_rules: [],
      solver: 'pure-greedy-knapsack',
      used_time_ms: 0,
      used_tokens: 0,
      total_mitigation: 0,
      reason: 'no_rules',
    };
  }
  const sorted = [...list].sort(
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

  // When Gurobi error-falls-back to unconstrained top score, replace with
  // budget-valid heuristic so buyer narrative never claims compliance for
  // over-budget selections (e.g. claude-opus at $0.06 under a $0.01 cap).
  const routingPick = coerceBudgetCompliantRouting(solverRouting, heuristicRouting, budgets);
  const rulesPick = coerceBudgetCompliantRules(solverRules, heuristicRules, budgets);

  const routingHeuristicScore = heuristicRouting.objective || 0;
  const routingSolverScore = routingPick.objective != null
    ? routingPick.objective
    : (findCandidate(routingPick.selected)?.score || 0);
  const rulesHeuristicMitigation = heuristicRules.total_mitigation
    || sumMitigation(DEMO_RULES, heuristicRules.selected_rules);
  const rulesSolverMitigation = rulesPick.total_mitigation != null
    ? rulesPick.total_mitigation
    : sumMitigation(DEMO_RULES, rulesPick.selected_rules || []);

  const solverIsGurobi = isSuccessfulGurobiLabel(routingPick.solver)
    || isSuccessfulGurobiLabel(rulesPick.solver)
    || (probe.gurobi === true && !isGurobiErrorFallback(solverRouting.solver)
      && !isGurobiErrorFallback(solverRules.solver));

  const report = {
    schema: 'thumbgate.budget_aware_gates_proof.v1',
    mode: 'simulation',
    autoApply: false,
    humanOversightRequired: true,
    capturedRevenueUsd: 0,
    generatedAt: new Date().toISOString(),
    latencyMs: Date.now() - started,
    budgets,
    probe: {
      ok: probe.ok,
      gurobiAvailable: Boolean(
        (probe.gurobi === true && !isGurobiErrorFallback(solverRouting.solver)
          && !isGurobiErrorFallback(solverRules.solver))
        || isSuccessfulGurobiLabel(routingPick.solver)
        || isSuccessfulGurobiLabel(rulesPick.solver)
      ),
      solverLabel: routingPick.solver || null,
      rawSolverLabel: solverRouting.solver || null,
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
        selected: routingPick.selected,
        score: routingSolverScore,
        solver: routingPick.solver,
        candidate: findCandidate(routingPick.selected),
        budgetCompliant: isRoutingWithinBudget(findCandidate(routingPick.selected), budgets),
      },
      scoreDelta: routingSolverScore - routingHeuristicScore,
      sameSelection: heuristicRouting.selected === routingPick.selected,
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
        selected: rulesPick.selected_rules || [],
        count: (rulesPick.selected_rules || []).length,
        mitigation: rulesSolverMitigation,
        usedTimeMs: rulesPick.used_time_ms,
        usedTokens: rulesPick.used_tokens,
        solver: rulesPick.solver,
      },
      mitigationDelta: rulesSolverMitigation - rulesHeuristicMitigation,
      droppedLowValue: DEMO_RULES
        .map((r) => r.id)
        .filter((id) => !(rulesPick.selected_rules || []).includes(id)),
    },
    buyerNarrative: {
      headline: 'Budget-aware enforcement simulation — fixture knapsack, not live rule loader',
      bullets: [
        `SIMULATION: model routing under $${budgets.maxBudgetUsd} / ${budgets.maxLatencyMs}ms budget selects ${routingPick.selected} (solver=${routingPick.solver}).`,
        `SIMULATION: prevention-rule knapsack keeps ${ (rulesPick.selected_rules || []).length } of ${DEMO_RULES.length} fixture rules under ${budgets.maxEvalTimeMs}ms / ${budgets.maxTokenFootprint} tokens.`,
        `Risk-mitigation score (fixtures): heuristic ${rulesHeuristicMitigation.toFixed(1)} → optimized ${rulesSolverMitigation.toFixed(1)} (Δ ${ (rulesSolverMitigation - rulesHeuristicMitigation).toFixed(1) }).`,
        solverIsGurobi
          ? 'MILP solver path succeeded on this host (free-pip Gurobi or compatible). Heuristics remain the CI/fallback path.'
          : 'Running on deterministic heuristic fallback — same API, fail-open when solver unavailable.',
      ],
      disclaimers: [
        'This proof is a sales-safe SIMULATION on fixed demo fixtures. Production PreToolUse does not yet load selections from optimizeRuleSelection/optimizeModelRouting.',
        'ThumbGate product claim is budget-aware gates as an architecture; this script proves the selection math, not live enforcement wiring.',
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

function isGurobiErrorFallback(label) {
  const s = String(label || '').toLowerCase();
  return s.includes('gurobi-error')
    || s.includes('error-fallback')
    || /gurobi.*(?:error|unavailable|license)/.test(s);
}

function isSuccessfulGurobiLabel(label) {
  const s = String(label || '').toLowerCase();
  if (!s) return false;
  if (isGurobiErrorFallback(s)) return false;
  // Accept exact successful labels only (not every gurobi* string).
  return s === 'gurobi' || s === 'gurobipy' || s === 'gurobi-milp' || s.startsWith('gurobi-ok');
}

function isRoutingWithinBudget(candidate, budgets) {
  if (!candidate) return false;
  return (candidate.cost || 0) <= budgets.maxBudgetUsd
    && (candidate.latency_ms || 0) <= budgets.maxLatencyMs;
}

function coerceBudgetCompliantRouting(solverRouting, heuristicRouting, budgets) {
  const cand = findCandidate(solverRouting && solverRouting.selected);
  if (
    cand
    && isRoutingWithinBudget(cand, budgets)
    && !isGurobiErrorFallback(solverRouting && solverRouting.solver)
  ) {
    return solverRouting;
  }
  return {
    ...heuristicRouting,
    solver: heuristicRouting.solver
      || (isGurobiErrorFallback(solverRouting && solverRouting.solver)
        ? 'heuristic-after-gurobi-error'
        : 'heuristic-budget-coerce'),
    coercedFrom: solverRouting && solverRouting.selected,
  };
}

function coerceBudgetCompliantRules(solverRules, heuristicRules, budgets) {
  const selected = (solverRules && solverRules.selected_rules) || [];
  if (!selected.length || isGurobiErrorFallback(solverRules && solverRules.solver)) {
    return {
      ...heuristicRules,
      solver: heuristicRules.solver || 'heuristic-after-gurobi-error',
      coercedFrom: selected,
    };
  }
  // Soft check: if used budgets exceed caps, fall back to heuristic.
  const usedTime = solverRules.used_time_ms;
  const usedTokens = solverRules.used_tokens;
  if (
    (usedTime != null && usedTime > budgets.maxEvalTimeMs)
    || (usedTokens != null && usedTokens > budgets.maxTokenFootprint)
  ) {
    return {
      ...heuristicRules,
      solver: heuristicRules.solver || 'heuristic-budget-coerce',
      coercedFrom: selected,
    };
  }
  return solverRules;
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
    const jsonPath = /\.json$/i.test(abs) ? abs : `${abs}.json`;
    const mdPath = jsonPath.replace(/\.json$/i, '.md');
    fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    if (mdPath !== jsonPath) {
      fs.writeFileSync(mdPath, formatMarkdown(report), 'utf8');
    }
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatMarkdown(report));
  }

  return report;
}

// Path-based main check (Sonar S3403: require.main === module is unreliable under CJS).
if (
  process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(__filename)
) {
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
