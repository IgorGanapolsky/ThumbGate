#!/usr/bin/env node
'use strict';

/**
 * Frozen solver acceptance-set + independent-engine parity.
 *
 * Process stolen from Gurobi Phase One Champion Kit evaluation/migration
 * playbooks — not their product, branding, PDFs, or sales theater:
 *   1. Freeze the acceptance set before engines run
 *   2. Compare like-for-like (same fixtures, same budgets, same host)
 *   3. Do not grade your own homework (status-quo heuristic vs solver)
 *
 * ECI: existing-surface maintenance. No enterprise SKU, no $499 pitch,
 * no captured cash, no Gurobi affiliation.
 *
 * Usage:
 *   node scripts/solver-parity.js
 *   node scripts/solver-parity.js --json
 *   node scripts/solver-parity.js --acceptance tests/fixtures/solver-acceptance-set.json
 *   npm run solver:parity
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  optimizeModelRouting,
  optimizeRuleSelection,
  probeGurobi,
} = require('./gurobi-optimizer');

const DEFAULT_ACCEPTANCE_PATH = path.join(
  __dirname,
  '..',
  'tests',
  'fixtures',
  'solver-acceptance-set.json'
);

const SCHEMA = 'thumbgate.solver_acceptance_set.v1';
const REPORT_SCHEMA = 'thumbgate.solver_parity_report.v1';

function loadAcceptanceSet(filePath = DEFAULT_ACCEPTANCE_PATH) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`acceptance set not found: ${abs}`);
  }
  const parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (!parsed || parsed.schema !== SCHEMA) {
    throw new Error(`acceptance set schema must be ${SCHEMA}`);
  }
  if (!Array.isArray(parsed.cases) || parsed.cases.length === 0) {
    throw new Error('acceptance set must include a non-empty cases array');
  }
  return parsed;
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
  return s === 'gurobi'
    || s === 'gurobipy'
    || s === 'gurobi-milp'
    || s.startsWith('gurobi-ok');
}

function isHeuristicSolver(label) {
  const s = String(label || '').toLowerCase();
  return s.includes('heuristic') || s.includes('knapsack') || s.includes('fallback');
}

function feasibleRoutingIds(candidates, budgets) {
  const list = Array.isArray(candidates) ? candidates : [];
  const { maxBudgetUsd, maxLatencyMs } = budgets || {};
  return list
    .filter((c) => (c.cost || 0) <= maxBudgetUsd && (c.latency_ms || 0) <= maxLatencyMs)
    .map((c) => c.id);
}

function independentHeuristicRouting(candidates, budgets) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length === 0) {
    return {
      success: false,
      selected: null,
      solver: 'independent-greedy-heuristic',
      objective: 0,
      reason: 'no_candidates',
    };
  }
  const valid = list.filter(
    (c) => (c.cost || 0) <= budgets.maxBudgetUsd && (c.latency_ms || 0) <= budgets.maxLatencyMs
  );
  if (valid.length === 0) {
    return {
      success: false,
      selected: null,
      solver: 'independent-greedy-heuristic',
      objective: 0,
      reason: 'no_feasible_candidates',
      violations: list.map((c) => c.id),
    };
  }
  const best = valid.reduce(
    (prev, curr) => ((curr.score || 0) > (prev.score || 0) ? curr : prev),
    valid[0]
  );
  return {
    success: true,
    selected: best.id,
    solver: 'independent-greedy-heuristic',
    objective: best.score || 0,
  };
}

function independentHeuristicRules(rules, budgets) {
  const list = Array.isArray(rules) ? rules : [];
  if (list.length === 0) {
    return {
      success: false,
      selected_rules: [],
      solver: 'independent-greedy-knapsack',
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
    if (curTime + t <= budgets.maxEvalTimeMs && curTokens + tok <= budgets.maxTokenFootprint) {
      selected.push(r.id);
      curTime += t;
      curTokens += tok;
      mitigation += r.risk_mitigation || 0;
    }
  }
  return {
    success: true,
    selected_rules: selected,
    solver: 'independent-greedy-knapsack',
    used_time_ms: curTime,
    used_tokens: curTokens,
    total_mitigation: mitigation,
  };
}

function sumMitigation(rules, ids) {
  const set = new Set(ids || []);
  return (rules || [])
    .filter((r) => set.has(r.id))
    .reduce((s, r) => s + (r.risk_mitigation || 0), 0);
}

function rulesWithinBudget(rules, ids, budgets) {
  const set = new Set(ids || []);
  const used = (rules || []).filter((r) => set.has(r.id));
  const time = used.reduce((s, r) => s + (r.eval_time_ms || 0), 0);
  const tokens = used.reduce((s, r) => s + (r.token_footprint || 0), 0);
  return {
    time,
    tokens,
    ok: time <= budgets.maxEvalTimeMs && tokens <= budgets.maxTokenFootprint,
  };
}

function sameIdList(a, b) {
  const left = [...(a || [])].map(String).sort();
  const right = [...(b || [])].map(String).sort();
  if (left.length !== right.length) return false;
  return left.every((id, i) => id === right[i]);
}

function nowMs() {
  return Date.now();
}

function evaluateRoutingCase(testCase, solverOpts) {
  const budgets = testCase.budgets || {};
  const candidates = testCase.candidates || [];
  const expect = testCase.expect || {};
  const failures = [];

  const hStart = nowMs();
  const heuristic = independentHeuristicRouting(candidates, budgets);
  const heuristicMs = nowMs() - hStart;
  const heuristic2 = independentHeuristicRouting(candidates, budgets);
  const stable = heuristic.selected === heuristic2.selected
    && heuristic.success === heuristic2.success;

  const sStart = nowMs();
  const solver = optimizeModelRouting(candidates, {
    maxBudgetUsd: budgets.maxBudgetUsd,
    maxLatencyMs: budgets.maxLatencyMs,
  }, solverOpts || {});
  const solverMs = nowMs() - sStart;

  const feasible = feasibleRoutingIds(candidates, budgets);
  const gurobi = isSuccessfulGurobiLabel(solver.solver);
  const heuristicEngine = isHeuristicSolver(solver.solver) && !gurobi;

  if (typeof expect.success === 'boolean' && heuristic.success !== expect.success) {
    failures.push(`heuristic.success=${heuristic.success} expected ${expect.success}`);
  }
  if (Object.prototype.hasOwnProperty.call(expect, 'selected')) {
    if (heuristic.selected !== expect.selected) {
      failures.push(`heuristic.selected=${heuristic.selected} expected ${expect.selected}`);
    }
  }
  if (expect.heuristicSelected && heuristic.selected !== expect.heuristicSelected) {
    failures.push(
      `heuristic.selected=${heuristic.selected} expected ${expect.heuristicSelected}`
    );
  }
  if (expect.success === false) {
    if (solver.success && solver.selected) {
      failures.push(`solver.success=${solver.success} with selected=${solver.selected} on empty/infeasible fixture`);
    }
  }
  if (expect.success === true && candidates.length > 0 && !solver.success) {
    failures.push(`solver.success=false expected true (${solver.error || solver.reason || 'no reason'})`);
  }
  if (expect.feasibleMustHold && heuristic.success && heuristic.selected) {
    if (!feasible.includes(heuristic.selected)) {
      failures.push(`heuristic selected infeasible ${heuristic.selected}`);
    }
  }
  if (expect.feasibleMustHold && solver.success && solver.selected && !heuristicEngine) {
    if (!feasible.includes(solver.selected)) {
      failures.push(`solver selected infeasible ${solver.selected}`);
    }
  }
  if (expect.feasibleMustHold && solver.success && solver.selected && heuristicEngine) {
    if (!feasible.includes(solver.selected)) {
      failures.push(`heuristic-fallback solver selected infeasible ${solver.selected}`);
    }
  }
  for (const banned of expect.neverSelected || []) {
    if (heuristic.selected === banned) {
      failures.push(`heuristic selected banned ${banned}`);
    }
    if (solver.selected === banned) {
      failures.push(`solver selected banned ${banned}`);
    }
  }
  if (!stable) {
    failures.push('heuristic was not stable across two runs');
  }

  return {
    id: testCase.id,
    stage: testCase.stage || 'benchmarking',
    kind: 'routing',
    ok: failures.length === 0,
    failures,
    independentEngines: gurobi,
    homeworkGrade: gurobi ? 'independent-solver' : 'solver-fell-back-to-heuristic',
    metrics: {
      heuristicWallMs: heuristicMs,
      solverWallMs: solverMs,
      heuristicObjective: heuristic.objective || 0,
      solverObjective: solver.objective || 0,
      gap: (solver.objective || 0) - (heuristic.objective || 0),
      sameSelection: heuristic.selected === solver.selected,
      stable,
    },
    heuristic,
    solver: {
      success: solver.success,
      selected: solver.selected || null,
      solver: solver.solver || null,
      status: solver.status || null,
      objective: solver.objective,
    },
    capturedRevenueUsd: 0,
  };
}

function evaluateRulesCase(testCase, solverOpts) {
  const budgets = testCase.budgets || {};
  const rules = testCase.rules || [];
  const expect = testCase.expect || {};
  const failures = [];

  const hStart = nowMs();
  const heuristic = independentHeuristicRules(rules, budgets);
  const heuristicMs = nowMs() - hStart;
  const heuristic2 = independentHeuristicRules(rules, budgets);
  const stable = sameIdList(heuristic.selected_rules, heuristic2.selected_rules);

  const sStart = nowMs();
  const solver = optimizeRuleSelection(rules, {
    maxEvalTimeMs: budgets.maxEvalTimeMs,
    maxTokenFootprint: budgets.maxTokenFootprint,
  }, solverOpts || {});
  const solverMs = nowMs() - sStart;

  const gurobi = isSuccessfulGurobiLabel(solver.solver);
  const heuristicEngine = isHeuristicSolver(solver.solver) && !gurobi;
  const solverIds = solver.selected_rules || [];
  const heuristicBudget = rulesWithinBudget(rules, heuristic.selected_rules, budgets);
  const solverBudget = rulesWithinBudget(rules, solverIds, budgets);

  if (expect.heuristicSelected
    && !sameIdList(heuristic.selected_rules, expect.heuristicSelected)) {
    failures.push(
      `heuristic selected [${(heuristic.selected_rules || []).join(',')}] `
      + `expected [${expect.heuristicSelected.join(',')}]`
    );
  }
  if (expect.withinBudget && !heuristicBudget.ok) {
    failures.push(
      `heuristic exceeded budget time=${heuristicBudget.time} tokens=${heuristicBudget.tokens}`
    );
  }
  if (expect.withinBudget && solver.success && !solverBudget.ok) {
    failures.push(
      `solver exceeded budget time=${solverBudget.time} tokens=${solverBudget.tokens}`
    );
  }
  for (const banned of expect.neverSelected || []) {
    if ((heuristic.selected_rules || []).includes(banned)) {
      failures.push(`heuristic selected banned ${banned}`);
    }
    if (solverIds.includes(banned)) {
      failures.push(`solver selected banned ${banned}`);
    }
  }
  if (gurobi && expect.solverWhenGurobi
    && !sameIdList(solverIds, expect.solverWhenGurobi)) {
    failures.push(
      `gurobi selected [${solverIds.join(',')}] expected [${expect.solverWhenGurobi.join(',')}]`
    );
  }
  if (heuristicEngine && expect.solverWhenHeuristic
    && !sameIdList(solverIds, expect.solverWhenHeuristic)) {
    failures.push(
      `heuristic-fallback selected [${solverIds.join(',')}] `
      + `expected [${expect.solverWhenHeuristic.join(',')}]`
    );
  }
  if (!stable) {
    failures.push('heuristic was not stable across two runs');
  }

  const solverMitigation = sumMitigation(rules, solverIds);
  return {
    id: testCase.id,
    stage: testCase.stage || 'benchmarking',
    kind: 'rules',
    ok: failures.length === 0,
    failures,
    independentEngines: gurobi,
    homeworkGrade: gurobi ? 'independent-solver' : 'solver-fell-back-to-heuristic',
    metrics: {
      heuristicWallMs: heuristicMs,
      solverWallMs: solverMs,
      heuristicObjective: heuristic.total_mitigation || 0,
      solverObjective: solverMitigation,
      gap: solverMitigation - (heuristic.total_mitigation || 0),
      sameSelection: sameIdList(heuristic.selected_rules, solverIds),
      stable,
    },
    heuristic,
    solver: {
      success: solver.success,
      selected_rules: solverIds,
      solver: solver.solver || null,
      status: solver.status || null,
      objective: solver.objective,
      used_time_ms: solver.used_time_ms,
      used_tokens: solver.used_tokens,
    },
    capturedRevenueUsd: 0,
  };
}

function evaluateCase(testCase, solverOpts) {
  if (testCase.kind === 'rules') {
    return evaluateRulesCase(testCase, solverOpts);
  }
  return evaluateRoutingCase(testCase, solverOpts);
}

function runParity(options = {}) {
  const started = Date.now();
  const acceptancePath = options.acceptancePath || DEFAULT_ACCEPTANCE_PATH;
  const acceptance = options.acceptance || loadAcceptanceSet(acceptancePath);
  const solverOpts = options.solverOpts || {};
  const probe = options.skipProbe ? { ok: null, gurobi: false, python: null } : probeGurobi(solverOpts);

  const cases = (acceptance.cases || []).map((c) => evaluateCase(c, solverOpts));
  const failed = cases.filter((c) => !c.ok);
  const gurobiUsed = cases.some((c) => c.independentEngines) || probe.gurobi === true;

  return {
    schema: REPORT_SCHEMA,
    mode: 'parity',
    generatedAt: new Date().toISOString(),
    latencyMs: Date.now() - started,
    acceptancePath: path.resolve(acceptancePath),
    frozenAt: acceptance.frozenAt || null,
    capturedRevenueUsd: 0,
    probe: {
      ok: probe.ok,
      gurobiAvailable: Boolean(gurobiUsed),
      python: probe.python || null,
    },
    process: {
      freezeAcceptanceSet: true,
      likeForLike: true,
      doNotGradeOwnHomework: true,
      stages: ['discovery', 'benchmarking', 'decision'],
      affiliation: 'none',
      source: 'Phase One evaluation process — not Gurobi product copy',
    },
    summary: {
      total: cases.length,
      passed: cases.length - failed.length,
      failed: failed.length,
      ok: failed.length === 0,
    },
    cases,
    disclaimers: [
      'Independent heuristic is the status-quo baseline. Solver is a separate engine.',
      'When Gurobi is unavailable the Node/Python path falls back to a heuristic — that is not an independent check.',
      'No Gurobi partnership, co-sell, or affiliation is claimed.',
      'capturedRevenueUsd is always 0 — a solve is not cash collected.',
      'This is existing-surface maintenance (routing + knapsack). Not an enterprise SKU.',
    ],
  };
}

function formatReport(report) {
  const lines = [
    '# Solver parity — frozen acceptance set',
    '',
    `Generated: ${report.generatedAt}`,
    `Frozen at: ${report.frozenAt || 'unknown'}`,
    `Result: ${report.summary.ok ? 'PASS' : 'FAIL'} `
      + `${report.summary.passed}/${report.summary.total}`,
    '',
    'Process: freeze acceptance set → like-for-like engines → do not grade your own homework.',
    'Not Gurobi product copy. No affiliation. capturedRevenueUsd=0.',
    '',
    '| Case | Stage | Kind | Independent engines | Heuristic | Solver | Gap | Wall ms (h/s) |',
    '|------|-------|------|---------------------|-----------|--------|-----|---------------|',
  ];
  for (const c of report.cases) {
    const hPick = c.kind === 'rules'
      ? (c.heuristic.selected_rules || []).join('+') || '—'
      : (c.heuristic.selected || '—');
    const sPick = c.kind === 'rules'
      ? (c.solver.selected_rules || []).join('+') || '—'
      : (c.solver.selected || '—');
    lines.push(
      `| ${c.ok ? 'ok' : 'FAIL'} ${c.id} | ${c.stage} | ${c.kind} | ${c.homeworkGrade} | `
      + `${hPick} | ${sPick} | ${Number(c.metrics.gap).toFixed(1)} | `
      + `${c.metrics.heuristicWallMs}/${c.metrics.solverWallMs} |`
    );
    if (!c.ok) {
      for (const f of c.failures) {
        lines.push(`|  └ ${f} | | | | | | | |`);
      }
    }
  }
  lines.push(
    '',
    '## Disclaimers',
    '',
    ...report.disclaimers.map((d) => `- ${d}`),
    ''
  );
  return lines.join('\n');
}

function mainCli(argv = process.argv.slice(2)) {
  const json = argv.includes('--json');
  const accIdx = argv.indexOf('--acceptance');
  const acceptancePath = accIdx >= 0 ? argv[accIdx + 1] : DEFAULT_ACCEPTANCE_PATH;
  const writeIdx = argv.indexOf('--write');
  const writePath = writeIdx >= 0 ? argv[writeIdx + 1] : null;

  const report = runParity({ acceptancePath });

  if (writePath) {
    const abs = path.resolve(writePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const jsonPath = /\.json$/i.test(abs) ? abs : `${abs}.json`;
    const mdPath = jsonPath.replace(/\.json$/i, '.md');
    fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    if (mdPath !== jsonPath) {
      fs.writeFileSync(mdPath, formatReport(report), 'utf8');
    }
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
  REPORT_SCHEMA,
  DEFAULT_ACCEPTANCE_PATH,
  loadAcceptanceSet,
  independentHeuristicRouting,
  independentHeuristicRules,
  evaluateCase,
  runParity,
  formatReport,
  mainCli,
  isSuccessfulGurobiLabel,
};

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  process.exitCode = mainCli();
}
