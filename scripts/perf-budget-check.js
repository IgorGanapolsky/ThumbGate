#!/usr/bin/env node
'use strict';

/**
 * Performance-budget measurement for ThumbGate hot paths.
 *
 * "Instrument before optimizing; fix the largest measured bottleneck."
 * (Engineering directive, 2026-08-26.) This is the single tool that turns that
 * sentence into numbers. Budgets live in config/performance-budgets.json.
 *
 * Modes:
 *   --local   (default) hermetic micro-benchmarks of the PreToolUse hot path
 *             against synthetic fixtures in a temp dir. Safe for CI.
 *   --prod    timed probes of production endpoints. Post-deploy only — never
 *             a merge gate (the merge hasn't shipped yet).
 *   --json    machine-readable output.
 *
 * Exit code 1 when any measured p95 exceeds its budget (x ciHeadroomMultiplier
 * when CI=true). PRs that touch a file listed in hotPathFiles must paste this
 * script's output as benchmark evidence.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const BUDGETS = require('../config/performance-budgets.json');

const ITERATIONS = Number(process.env.THUMBGATE_PERF_ITERATIONS || 60);
const FIXTURE_ENTRIES = 400; // matches HYBRID_JSONL_READ_LIMIT

function percentile(samples, p) {
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function measure(fn, iterations = ITERATIONS) {
  // one warm-up pass so require/JIT cost does not pollute the samples
  fn();
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  return {
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    max: Math.max(...samples),
    iterations,
  };
}

function writeFixtureLog(filePath, entries) {
  const rows = [];
  for (let i = 0; i < entries; i++) {
    rows.push(JSON.stringify({
      id: `fb-perf-${i}`,
      signal: i % 3 === 0 ? 'negative' : 'positive',
      timestamp: new Date(Date.now() - i * 60_000).toISOString(),
      tool_name: ['Bash', 'Edit', 'Write', 'Read'][i % 4],
      context: `synthetic lesson ${i}: the command touched path segment ${i} and the reviewer asked for a narrower diff`,
      whatWentWrong: i % 3 === 0 ? `regression ${i} reached the branch without a focused test` : null,
      tags: ['perf-fixture'],
    }));
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${rows.join('\n')}\n`);
}

function runLocal() {
  const {
    buildHybridState,
    evaluatePretoolFromState,
    compileGuardArtifact,
    evaluateCompiledGuards,
  } = require('./hybrid-feedback-context');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-perf-'));
  const results = {};
  try {
    const feedbackLogPath = path.join(tmpDir, 'feedback-log.jsonl');
    const attributedFeedbackPath = path.join(tmpDir, 'attributed-feedback.jsonl');
    writeFixtureLog(feedbackLogPath, FIXTURE_ENTRIES);
    writeFixtureLog(attributedFeedbackPath, Math.floor(FIXTURE_ENTRIES / 4));

    const stateOpts = { feedbackLogPath, attributedFeedbackPath };
    results.hybrid_state_build_ms_p95 = measure(() => buildHybridState(stateOpts), Math.min(ITERATIONS, 25));

    const state = buildHybridState(stateOpts);
    results.pretool_eval_from_state_ms_p95 = measure(
      () => evaluatePretoolFromState(state, 'Bash', 'git status --porcelain && npm run lint')
    );

    const artifact = compileGuardArtifact(state);
    results.guard_artifact_compile_ms_p95 = measure(() => compileGuardArtifact(state), Math.min(ITERATIONS, 25));
    results.compiled_guard_eval_ms_p95 = measure(
      () => evaluateCompiledGuards(artifact, 'Bash', 'git status --porcelain && npm run lint')
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  return results;
}

async function timeFetch(url, timeoutMs) {
  const start = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'manual' });
    return { ms: performance.now() - start, status: response.status };
  } catch (error) {
    return { ms: performance.now() - start, status: 0, error: String(error && error.name) };
  } finally {
    clearTimeout(timer);
  }
}

async function runProd({ includeBilling }) {
  const results = {};
  for (const [key, spec] of Object.entries(BUDGETS.productionEndpoints)) {
    if (key === 'billing_summary_ms_p95' && !includeBilling) continue;
    const samples = [];
    let lastStatus = null;
    for (let i = 0; i < 5; i++) {
      const probe = await timeFetch(spec.url, Math.max(spec.budget * 4, 10_000));
      samples.push(probe.ms);
      lastStatus = probe.status;
    }
    results[key] = { p50: percentile(samples, 50), p95: percentile(samples, 95), max: Math.max(...samples), iterations: samples.length, status: lastStatus };
  }
  return results;
}

function evaluateAgainstBudgets(results, budgetSection) {
  const multiplier = process.env.CI ? Number(BUDGETS.ciHeadroomMultiplier || 1) : 1;
  const rows = [];
  let breaches = 0;
  for (const [key, spec] of Object.entries(budgetSection)) {
    const measured = results[key];
    if (!measured) continue;
    const limit = spec.budget * multiplier;
    const pass = measured.p95 <= limit;
    if (!pass) breaches += 1;
    rows.push({ key, p50: measured.p50, p95: measured.p95, budget: spec.budget, limit, multiplier, pass });
  }
  return { rows, breaches };
}

function printRows(rows) {
  for (const row of rows) {
    const p50 = row.p50.toFixed(2).padStart(9);
    const p95 = row.p95.toFixed(2).padStart(9);
    console.log(`${row.pass ? 'PASS' : 'FAIL'}  ${row.key.padEnd(34)} p50 ${p50}ms  p95 ${p95}ms  budget ${row.budget}ms${row.multiplier !== 1 ? ` (xCI ${row.limit}ms)` : ''}`);
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const asJson = args.has('--json');
  const outcome = { mode: args.has('--prod') ? 'prod' : 'local', rows: [], breaches: 0 };

  if (args.has('--prod')) {
    const results = await runProd({ includeBilling: args.has('--billing') });
    const verdict = evaluateAgainstBudgets(results, BUDGETS.productionEndpoints);
    outcome.rows = verdict.rows;
    outcome.breaches = verdict.breaches;
  } else {
    const results = runLocal();
    const verdict = evaluateAgainstBudgets(results, BUDGETS.localHotPaths);
    outcome.rows = verdict.rows;
    outcome.breaches = verdict.breaches;
  }

  if (asJson) {
    console.log(JSON.stringify(outcome, null, 2));
  } else {
    printRows(outcome.rows);
    console.log(`\n${outcome.rows.length - outcome.breaches}/${outcome.rows.length} within budget (${outcome.mode})`);
  }
  return outcome.breaches > 0 ? 1 : 0;
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(__filename)) {
  main().then((code) => { process.exitCode = code; });
}

module.exports = { measure, percentile, runLocal, evaluateAgainstBudgets, writeFixtureLog };
