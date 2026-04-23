#!/usr/bin/env node
'use strict';

/**
 * Gate Eval — systematic evaluation of gate effectiveness.
 *
 * Applies Anthropic's prompt-evaluation framework to ThumbGate's approval layer:
 *
 *   1. Test cases: define expected outcomes (SHOULD block / SHOULD pass),
 *      run them against current specs, report mismatches.
 *   2. Version comparison: compare two spec sets side-by-side to see which
 *      catches more real violations without increasing false positives.
 *   3. Effectiveness metrics: precision, recall, false-positive rate computed
 *      from labeled audit trail data.
 *
 * Eval-case format (JSON):
 *   {
 *     "cases": [
 *       { "id": "force-push-blocked", "input": { "command": "git push --force" },
 *         "expect": "block", "constraintId": "no-force-push" },
 *       { "id": "safe-push-passes", "input": { "command": "git push origin main" },
 *         "expect": "pass" }
 *     ]
 *   }
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { readJsonl, appendJsonl } = require('./fs-utils');
const { resolveFeedbackDir } = require('./feedback-paths');
const { expandFixturePlaceholders } = require('./secret-fixture-tokens');
const { evaluateAction, loadSpecDir, validateSpec } = require('./spec-gate');

const EVAL_DIR = path.join(__dirname, '..', 'config', 'evals');
const EVAL_RESULTS_FILE = 'gate-eval-results.jsonl';

// ---------------------------------------------------------------------------
// Eval Case Loading & Validation
// ---------------------------------------------------------------------------

function loadEvalSuite(suitePath) {
  const raw = fs.readFileSync(path.resolve(suitePath), 'utf8');
  const suite = JSON.parse(raw);
  return validateEvalSuite(suite, suitePath);
}

function loadEvalDir(dirPath = EVAL_DIR) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return loadEvalSuite(path.join(dirPath, f));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function validateEvalSuite(suite, sourcePath = null) {
  if (!suite || typeof suite !== 'object') {
    throw new Error('Eval suite must be a JSON object.');
  }
  const name = normalizeText(suite.name, 120);
  if (!name) throw new Error('Eval suite requires a "name" field.');

  const cases = Array.isArray(suite.cases)
    ? suite.cases.map(validateEvalCase).filter(Boolean)
    : [];

  if (cases.length === 0) {
    throw new Error('Eval suite must have at least one case.');
  }

  return {
    name,
    description: normalizeText(suite.description, 500) || '',
    sourcePath: sourcePath || null,
    cases,
  };
}

function validateEvalCase(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = normalizeText(raw.id, 80);
  const expect = normalizeText(raw.expect, 20);
  if (!id || !expect) return null;
  if (expect !== 'block' && expect !== 'pass') return null;

  const input = raw.input && typeof raw.input === 'object' ? raw.input : {};

  return {
    id,
    input: {
      tool: normalizeText(input.tool, 80) || null,
      command: normalizeText(input.command, 2000) || null,
      content: expandFixtureText(input.content, 5000),
      action: normalizeText(input.action, 200) || null,
      sandbox: normalizeText(input.sandbox, 2000) || null,
      sessionActions: Array.isArray(input.sessionActions) ? input.sessionActions : [],
    },
    expect,
    constraintId: normalizeText(raw.constraintId, 80) || null,
    reason: normalizeText(raw.reason, 500) || null,
  };
}

// ---------------------------------------------------------------------------
// Eval Execution
// ---------------------------------------------------------------------------

/**
 * Run a single eval case against specs.
 */
function runEvalCase(specs, evalCase) {
  const result = evaluateAction(specs, evalCase.input);
  const actualOutcome = result.allowed ? 'pass' : 'block';
  const matched = actualOutcome === evalCase.expect;

  // If a specific constraintId is expected, verify it was in the blocked list
  let constraintMatch = null;
  if (evalCase.constraintId && evalCase.expect === 'block') {
    const found = result.blocked.some(
      (b) => b.constraintId === evalCase.constraintId || b.invariantId === evalCase.constraintId
    );
    constraintMatch = found;
  }

  return {
    caseId: evalCase.id,
    expected: evalCase.expect,
    actual: actualOutcome,
    passed: matched && (constraintMatch === null || constraintMatch),
    constraintMatch,
    blockedBy: result.blocked.map((b) => b.constraintId || b.invariantId),
    totalChecked: result.totalChecked,
  };
}

/**
 * Run all cases in an eval suite against specs.
 */
function runEvalSuite(specs, suite) {
  const runId = `eval_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const timestamp = new Date().toISOString();
  const caseResults = suite.cases.map((c) => runEvalCase(specs, c));

  const passed = caseResults.filter((r) => r.passed);
  const failed = caseResults.filter((r) => !r.passed);

  // Classify failures
  const falsePositives = failed.filter((r) => r.expected === 'pass' && r.actual === 'block');
  const falseNegatives = failed.filter((r) => r.expected === 'block' && r.actual === 'pass');

  return {
    runId,
    timestamp,
    suiteName: suite.name,
    totalCases: caseResults.length,
    passed: passed.length,
    failed: failed.length,
    passRate: caseResults.length > 0 ? Math.round((passed.length / caseResults.length) * 100) : 0,
    falsePositives: falsePositives.length,
    falseNegatives: falseNegatives.length,
    caseResults,
    failures: failed,
  };
}

/**
 * Run all eval suites against specs.
 */
function runAllEvals(specs, suites) {
  return suites.map((suite) => runEvalSuite(specs, suite));
}

// ---------------------------------------------------------------------------
// Version Comparison
// ---------------------------------------------------------------------------

/**
 * Compare two spec versions (A vs B) against the same eval suite.
 * Returns which version is better at catching real violations without false positives.
 */
function compareSpecVersions(specsA, specsB, suite) {
  const resultA = runEvalSuite(specsA, suite);
  const resultB = runEvalSuite(specsB, suite);

  const scoreA = computeEffectivenessScore(resultA);
  const scoreB = computeEffectivenessScore(resultB);

  return {
    suiteName: suite.name,
    versionA: {
      passRate: resultA.passRate,
      falsePositives: resultA.falsePositives,
      falseNegatives: resultA.falseNegatives,
      score: scoreA,
    },
    versionB: {
      passRate: resultB.passRate,
      falsePositives: resultB.falsePositives,
      falseNegatives: resultB.falseNegatives,
      score: scoreB,
    },
    better: scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : 'tie',
    delta: Math.round((scoreB - scoreA) * 100) / 100,
    detailA: resultA,
    detailB: resultB,
  };
}

// ---------------------------------------------------------------------------
// Effectiveness Metrics
// ---------------------------------------------------------------------------

/**
 * Compute effectiveness metrics from eval results.
 *
 * In gate evaluation:
 *   - True Positive: expected block, got block
 *   - True Negative: expected pass, got pass
 *   - False Positive: expected pass, got block (over-blocking)
 *   - False Negative: expected block, got pass (missed threat)
 */
function computeEffectivenessMetrics(evalResult) {
  let tp = 0, tn = 0, fp = 0, fn = 0;

  for (const cr of evalResult.caseResults) {
    if (cr.expected === 'block' && cr.actual === 'block') tp++;
    else if (cr.expected === 'pass' && cr.actual === 'pass') tn++;
    else if (cr.expected === 'pass' && cr.actual === 'block') fp++;
    else if (cr.expected === 'block' && cr.actual === 'pass') fn++;
  }

  const precision = (tp + fp) > 0 ? Math.round((tp / (tp + fp)) * 100) / 100 : 1;
  const recall = (tp + fn) > 0 ? Math.round((tp / (tp + fn)) * 100) / 100 : 1;
  const f1 = (precision + recall) > 0
    ? Math.round((2 * precision * recall / (precision + recall)) * 100) / 100
    : 0;
  const falsePositiveRate = (fp + tn) > 0
    ? Math.round((fp / (fp + tn)) * 100) / 100
    : 0;

  return {
    truePositives: tp,
    trueNegatives: tn,
    falsePositives: fp,
    falseNegatives: fn,
    precision,
    recall,
    f1,
    falsePositiveRate,
    accuracy: evalResult.totalCases > 0
      ? Math.round(((tp + tn) / evalResult.totalCases) * 100) / 100
      : 0,
  };
}

/**
 * Single effectiveness score (0-100) for version comparison.
 * Weights: recall matters most (missed threats are worse than over-blocking).
 */
function computeEffectivenessScore(evalResult) {
  const m = computeEffectivenessMetrics(evalResult);
  // Weighted: 50% recall, 30% precision, 20% accuracy
  return Math.round((m.recall * 50 + m.precision * 30 + m.accuracy * 20) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Results Persistence
// ---------------------------------------------------------------------------

function getResultsPath({ feedbackDir } = {}) {
  const dir = feedbackDir || resolveFeedbackDir();
  return path.join(dir, EVAL_RESULTS_FILE);
}

function recordEvalResult(evalResult, options = {}) {
  const entry = {
    runId: evalResult.runId,
    timestamp: evalResult.timestamp,
    suiteName: evalResult.suiteName,
    totalCases: evalResult.totalCases,
    passed: evalResult.passed,
    failed: evalResult.failed,
    passRate: evalResult.passRate,
    falsePositives: evalResult.falsePositives,
    falseNegatives: evalResult.falseNegatives,
    metrics: computeEffectivenessMetrics(evalResult),
    failures: evalResult.failures.map((f) => ({
      caseId: f.caseId,
      expected: f.expected,
      actual: f.actual,
      blockedBy: f.blockedBy,
    })),
  };
  appendJsonl(getResultsPath(options), entry);
  return entry;
}

function loadEvalResults(options = {}) {
  return readJsonl(getResultsPath(options));
}

/**
 * Track effectiveness trend over time from stored results.
 */
function computeEffectivenessTrend(results) {
  if (results.length === 0) return { trend: 'unknown', entries: [] };

  const entries = results.map((r) => ({
    runId: r.runId,
    timestamp: r.timestamp,
    suiteName: r.suiteName,
    passRate: r.passRate,
    precision: r.metrics ? r.metrics.precision : null,
    recall: r.metrics ? r.metrics.recall : null,
    f1: r.metrics ? r.metrics.f1 : null,
  }));

  // Compare first and last half
  const mid = Math.floor(entries.length / 2);
  const firstHalf = entries.slice(0, mid || 1);
  const secondHalf = entries.slice(mid || 1);

  const avgFirst = average(firstHalf.map((e) => e.passRate));
  const avgSecond = average(secondHalf.map((e) => e.passRate));

  let trend = 'stable';
  if (avgSecond > avgFirst + 5) trend = 'improving';
  else if (avgSecond < avgFirst - 5) trend = 'degrading';

  return { trend, avgFirst, avgSecond, entries };
}

// ---------------------------------------------------------------------------
// Format Output
// ---------------------------------------------------------------------------

function formatEvalResult(evalResult) {
  const metrics = computeEffectivenessMetrics(evalResult);
  const lines = [];
  lines.push(`Suite: ${evalResult.suiteName}`);
  lines.push(`Pass Rate: ${evalResult.passRate}% (${evalResult.passed}/${evalResult.totalCases})`);
  lines.push(`Precision: ${metrics.precision} | Recall: ${metrics.recall} | F1: ${metrics.f1}`);
  lines.push(`False Positives: ${evalResult.falsePositives} | False Negatives: ${evalResult.falseNegatives}`);

  if (evalResult.failures.length > 0) {
    lines.push('');
    lines.push('Failures:');
    for (const f of evalResult.failures) {
      lines.push(`  - ${f.caseId}: expected ${f.expected}, got ${f.actual} (blocked by: ${f.blockedBy.join(', ') || 'none'})`);
    }
  }

  return lines.join('\n');
}

function formatComparison(comparison) {
  const lines = [];
  lines.push(`Suite: ${comparison.suiteName}`);
  lines.push(`Winner: ${comparison.better} (delta: ${comparison.delta > 0 ? '+' : ''}${comparison.delta})`);
  lines.push(`  A: pass=${comparison.versionA.passRate}% FP=${comparison.versionA.falsePositives} FN=${comparison.versionA.falseNegatives} score=${comparison.versionA.score}`);
  lines.push(`  B: pass=${comparison.versionB.passRate}% FP=${comparison.versionB.falsePositives} FN=${comparison.versionB.falseNegatives} score=${comparison.versionB.score}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeText(value, maxLength = 500) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

function expandFixtureText(value, maxLength = 5000) {
  const text = normalizeText(value, maxLength);
  return text ? expandFixturePlaceholders(text) : null;
}

function average(arr) {
  if (arr.length === 0) return 0;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 100) / 100;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function isCliInvocation(argv = process.argv) {
  const invokedPath = argv[1];
  return invokedPath ? path.resolve(invokedPath) === __filename : false;
}

if (isCliInvocation()) {
  const command = process.argv[2] || 'run';

  if (command === 'run') {
    const specs = loadSpecDir();
    const suites = loadEvalDir();
    if (suites.length === 0) {
      console.log('No eval suites found in config/evals/');
      process.exit(0);
    }
    const results = runAllEvals(specs, suites);
    for (const r of results) {
      console.log(formatEvalResult(r));
      console.log('');
    }
    const allPassed = results.every((r) => r.failed === 0);
    process.exit(allPassed ? 0 : 1);
  } else if (command === 'history') {
    const results = loadEvalResults();
    const trend = computeEffectivenessTrend(results);
    console.log(JSON.stringify(trend, null, 2));
  } else {
    console.error(`Unknown command: ${command}. Use: run, history`);
    process.exit(1);
  }
}

module.exports = {
  compareSpecVersions,
  computeEffectivenessMetrics,
  computeEffectivenessScore,
  computeEffectivenessTrend,
  formatComparison,
  formatEvalResult,
  loadEvalDir,
  loadEvalResults,
  loadEvalSuite,
  recordEvalResult,
  runAllEvals,
  runEvalCase,
  runEvalSuite,
  validateEvalCase,
  validateEvalSuite,
};
