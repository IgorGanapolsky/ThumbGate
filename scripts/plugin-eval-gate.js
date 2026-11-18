#!/usr/bin/env node
'use strict';
// Release gate for the `claude plugin eval` suite (evals/plugin).
// Fails when the mean WITH-plugin score is below the baseline (the last accepted release).
// Runs only from .github/workflows/plugin-eval.yml on `v*` tags; never on every push.
//
//   node scripts/plugin-eval-gate.js --results evals/plugin/results.json [--baseline evals/plugin/baseline.json] [--table]
//   exit 0 pass, 1 score dropped, 2 unreadable or empty input

const fs = require('fs');
const path = require('path');

const EPSILON = 1e-9;

function meanWithScore(results) {
  const cases = results && Array.isArray(results.cases) ? results.cases : [];
  if (cases.length === 0) return null;
  return cases.reduce((sum, c) => sum + Number(c.with || 0), 0) / cases.length;
}

// Accepts either the committed summary (cases[].with) or the raw `claude plugin eval --json`
// output (cases[].arms / aggregates) and returns the summary shape.
function normalizeResults(raw) {
  const cases = raw && Array.isArray(raw.cases) ? raw.cases : [];
  if (cases.length === 0 || !cases[0].arms) return raw;
  return {
    ...raw,
    cases: cases.map((c) => ({
      name: c.name,
      with: c.aggregates.score,
      without: c.aggregates.scoreWithout ?? 0,
      delta: c.aggregates.delta ?? 0,
      pass3: (c.arms.with || []).length > 0 && c.arms.with.every((r) => r.passed),
      withPassed: (c.arms.with || []).filter((r) => r.passed).length,
      runs: (c.arms.with || []).length,
    })),
  };
}

function evaluateGate(rawResults, baseline) {
  const results = normalizeResults(rawResults);
  const withScore = meanWithScore(results);
  if (withScore === null) return { ok: false, withScore: null, regressed: [], reason: 'results have no cases; refusing to pass an empty run' };
  if (!baseline || typeof baseline.withScore !== 'number') return { ok: false, withScore, regressed: [], reason: 'baseline has no withScore' };
  const before = baseline.cases || {};
  const regressed = results.cases
    .filter((c) => typeof before[c.name] === 'number' && Number(c.with) < before[c.name] - EPSILON)
    .map((c) => ({ name: c.name, before: before[c.name], now: Number(c.with) }));
  const ok = withScore + EPSILON >= baseline.withScore;
  return {
    ok,
    withScore,
    baseline: baseline.withScore,
    regressed,
    reason: ok
      ? `WITH score ${withScore.toFixed(4)} is at or above the baseline ${baseline.withScore.toFixed(4)}`
      : `WITH score ${withScore.toFixed(4)} is below the baseline ${baseline.withScore.toFixed(4)}`,
  };
}

function signed(n) {
  const fixed = n.toFixed(2);
  return n > 0 ? `+${fixed}` : fixed === '-0.00' ? '0.00' : fixed;
}

function renderTable(results) {
  const rows = (results.cases || []).map((c) => `| ${c.name} | ${Number(c.with).toFixed(2)} | ${Number(c.without).toFixed(2)} | ${signed(Number(c.delta))} | ${c.pass3 ? 'yes' : 'no'} |`);
  return ['| case | WITH | W/OUT | Delta | pass^3 |', '|---|---|---|---|---|', ...rows].join('\n');
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function main(argv = process.argv.slice(2)) {
  const arg = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
  const root = path.join(__dirname, '..', 'evals', 'plugin');
  const results = readJson(arg('--results', path.join(root, 'results.json')));
  const baseline = readJson(arg('--baseline', path.join(root, 'baseline.json')));
  if (!results || !baseline) {
    process.stderr.write('plugin-eval-gate: cannot read results or baseline\n');
    return 2;
  }
  if (argv.includes('--table')) process.stdout.write(`${renderTable(normalizeResults(results))}\n`);
  const verdict = evaluateGate(results, baseline);
  process.stdout.write(`${verdict.ok ? 'PASS' : 'FAIL'}: ${verdict.reason}\n`);
  for (const c of verdict.regressed) process.stdout.write(`  dropped: ${c.name} ${c.before} -> ${c.now}\n`);
  if (verdict.withScore === null) return 2;
  return verdict.ok ? 0 : 1;
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) process.exit(main());

module.exports = { evaluateGate, renderTable, meanWithScore, normalizeResults, main };
