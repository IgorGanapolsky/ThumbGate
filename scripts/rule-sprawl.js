#!/usr/bin/env node
'use strict';

/**
 * Rule-sprawl scorecard — prevention rules vs eval/token budget.
 *
 * Process steal from a New Stack alerting webinar pitch (not OpenSearch,
 * not PPL, not Unified Alert Manager, not TNS affiliation):
 *   - "Alert on everything" pays exponentially (load-all exceeds budget)
 *   - Limit what you load or accept blind spots — we knapsack instead
 *   - False-positive fatigue = low-value noise still in the load-all set
 *
 * ECI: existing knapsack surface. Not a new observability SKU.
 * Production PreToolUse does not yet load optimizeRuleSelection picks.
 *
 * Usage:
 *   node scripts/rule-sprawl.js
 *   node scripts/rule-sprawl.js --json
 *   npm run rule:sprawl
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  DEMO_RULES,
  DEFAULT_BUDGETS,
  greedyHeuristicRules,
} = require('./budget-aware-gates-proof');
const { optimizeRuleSelection } = require('./gurobi-optimizer');

const SCHEMA = 'thumbgate.rule_sprawl.v1';
const NOISE_MITIGATION = 2;

function costOf(rules, ids) {
  const list = Array.isArray(rules) ? rules : [];
  const used = ids
    ? list.filter((r) => ids.includes(r.id))
    : list;
  return {
    count: used.length,
    timeMs: used.reduce((s, r) => s + (r.eval_time_ms || 0), 0),
    tokens: used.reduce((s, r) => s + (r.token_footprint || 0), 0),
    mitigation: used.reduce((s, r) => s + (r.risk_mitigation || 0), 0),
  };
}

function withinBudget(cost, budgets) {
  return cost.timeMs <= budgets.maxEvalTimeMs
    && cost.tokens <= budgets.maxTokenFootprint;
}

function runRuleSprawl(options = {}) {
  const rules = Array.isArray(options.rules) && options.rules.length
    ? options.rules
    : DEMO_RULES;
  const budgets = {
    maxEvalTimeMs: options.maxEvalTimeMs ?? DEFAULT_BUDGETS.maxEvalTimeMs,
    maxTokenFootprint: options.maxTokenFootprint ?? DEFAULT_BUDGETS.maxTokenFootprint,
  };

  const loadAll = costOf(rules);
  const greedy = greedyHeuristicRules(rules, budgets);
  const solver = optimizeRuleSelection(rules, {
    maxEvalTimeMs: budgets.maxEvalTimeMs,
    maxTokenFootprint: budgets.maxTokenFootprint,
  }, options.solverOpts || {});

  const selectedIds = solver.selected_rules || greedy.selected_rules || [];
  const selected = costOf(rules, selectedIds);
  const noise = rules.filter((r) => (r.risk_mitigation || 0) < NOISE_MITIGATION);
  const noiseDropped = noise
    .map((r) => r.id)
    .filter((id) => !selectedIds.includes(id));
  const overBudgetIfLoadAll = !withinBudget(loadAll, budgets);
  const knapsackWithinBudget = withinBudget(selected, budgets);
  const sprawlRatio = selected.count === 0
    ? loadAll.count
    : Number((loadAll.count / selected.count).toFixed(2));

  const failures = [];
  if (!overBudgetIfLoadAll) {
    failures.push('load-all still fits the budget — fixture is not a sprawl case');
  }
  if (!knapsackWithinBudget) {
    failures.push(
      `knapsack exceeds budget time=${selected.timeMs} tokens=${selected.tokens}`
    );
  }
  if (selected.count >= loadAll.count) {
    failures.push('knapsack did not drop any rules');
  }
  if (noise.length && noiseDropped.length === 0) {
    failures.push('low-value noise still selected (false-positive fatigue)');
  }

  return {
    schema: SCHEMA,
    mode: 'simulation',
    generatedAt: new Date().toISOString(),
    autoApply: false,
    humanOversightRequired: true,
    reviewVolumeIsNotTheControl: true,
    capturedRevenueUsd: 0,
    affiliation: 'none',
    process: {
      source: 'New Stack alerting-at-scale process — not OpenSearch/PPL product',
      loadAllVsKnapsack: true,
      unifiedAlertManager: false,
    },
    budgets,
    loadAll,
    knapsack: {
      selected: selectedIds,
      solver: solver.solver || greedy.solver,
      ...selected,
    },
    sprawlRatio,
    overBudgetIfLoadAll,
    knapsackWithinBudget,
    noiseDropped,
    summary: {
      ok: failures.length === 0,
      failures,
    },
    disclaimers: [
      'SIMULATION on fixtures. Production PreToolUse does not load knapsack picks yet.',
      'Not OpenSearch, PPL, Unified Alert Manager, or a New Stack affiliation.',
      'Review volume is not the control — PreToolUse is. capturedRevenueUsd is 0.',
    ],
  };
}

function formatReport(report) {
  return [
    '# Rule sprawl vs eval budget',
    '',
    `Result: ${report.summary.ok ? 'PASS' : 'FAIL'}  sprawlRatio=${report.sprawlRatio}`,
    '',
    '| Path | Rules | Time ms | Tokens | Mitigation |',
    '|------|-------|---------|--------|------------|',
    `| Load-all | ${report.loadAll.count} | ${report.loadAll.timeMs} | ${report.loadAll.tokens} | ${report.loadAll.mitigation.toFixed(1)} |`,
    `| Knapsack | ${report.knapsack.count} | ${report.knapsack.timeMs} | ${report.knapsack.tokens} | ${report.knapsack.mitigation.toFixed(1)} |`,
    '',
    `Load-all exceeds budget: ${report.overBudgetIfLoadAll}`,
    `Noise dropped: ${(report.noiseDropped || []).join(', ') || '—'}`,
    `autoApply=${report.autoApply}  capturedRevenueUsd=${report.capturedRevenueUsd}`,
    '',
    ...report.disclaimers.map((d) => `- ${d}`),
    '',
  ].join('\n');
}

function mainCli(argv = process.argv.slice(2)) {
  const json = argv.includes('--json');
  const writeIdx = argv.indexOf('--write');
  const writePath = writeIdx >= 0 ? argv[writeIdx + 1] : null;
  const report = runRuleSprawl();

  if (writePath) {
    const abs = path.resolve(writePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const jsonPath = /\.json$/i.test(abs) ? abs : `${abs}.json`;
    fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatReport(report));
  }
  return report.summary.ok ? 0 : 1;
}

module.exports = {
  SCHEMA,
  NOISE_MITIGATION,
  costOf,
  runRuleSprawl,
  formatReport,
  mainCli,
};

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  process.exitCode = mainCli();
}
