const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
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
} = require('../scripts/gate-eval');
const { validateSpec, loadSpecDir } = require('../scripts/spec-gate');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-gate-eval-'));
}

function writeJson(dir, filename, data) {
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(data, null, 2), 'utf8');
}

const TEST_SPEC = {
  name: 'test-safety',
  constraints: [
    { id: 'no-force-push', scope: 'bash', deny: 'git\\s+push.*(-f|--force)', reason: 'No force push.' },
    { id: 'no-secrets', scope: 'content', deny: 'AKIA[A-Z0-9]{16}', reason: 'No AWS keys.' },
  ],
  invariants: [],
};

const TEST_SUITE = {
  name: 'test-eval',
  cases: [
    { id: 'block-force-push', input: { command: 'git push --force origin main' }, expect: 'block', constraintId: 'no-force-push' },
    { id: 'pass-safe-push', input: { command: 'git push origin main' }, expect: 'pass' },
    { id: 'block-secrets', input: { content: 'key = "AKIAIOSFODNN7EXAMPLE"' }, expect: 'block', constraintId: 'no-secrets' },
    { id: 'pass-safe-code', input: { content: 'const x = 1;' }, expect: 'pass' },
  ],
};

// ---------------------------------------------------------------------------
// validateEvalSuite / validateEvalCase
// ---------------------------------------------------------------------------

test('validateEvalSuite rejects empty or nameless suites', () => {
  assert.throws(() => validateEvalSuite(null), /must be a JSON object/);
  assert.throws(() => validateEvalSuite({}), /requires a "name"/);
  assert.throws(() => validateEvalSuite({ name: 'empty' }), /at least one case/);
});

test('validateEvalSuite accepts valid suite', () => {
  const suite = validateEvalSuite(TEST_SUITE);
  assert.equal(suite.name, 'test-eval');
  assert.equal(suite.cases.length, 4);
});

test('validateEvalCase rejects invalid cases', () => {
  assert.equal(validateEvalCase(null), null);
  assert.equal(validateEvalCase({}), null);
  assert.equal(validateEvalCase({ id: 'x', expect: 'maybe' }), null);
});

test('validateEvalCase accepts valid cases', () => {
  const c = validateEvalCase({ id: 'test', expect: 'block', input: { command: 'rm -rf /' } });
  assert.equal(c.id, 'test');
  assert.equal(c.expect, 'block');
  assert.equal(c.input.command, 'rm -rf /');
});

// ---------------------------------------------------------------------------
// loadEvalSuite / loadEvalDir
// ---------------------------------------------------------------------------

test('loadEvalSuite reads and validates from file', () => {
  const tempDir = makeTempDir();
  writeJson(tempDir, 'test.json', TEST_SUITE);

  const suite = loadEvalSuite(path.join(tempDir, 'test.json'));
  assert.equal(suite.name, 'test-eval');
  assert.equal(suite.cases.length, 4);
});

test('loadEvalDir loads all JSON eval suites from a directory', () => {
  const tempDir = makeTempDir();
  writeJson(tempDir, 'a.json', TEST_SUITE);
  writeJson(tempDir, 'b.json', { name: 'other', cases: [{ id: 'x', expect: 'pass', input: { command: 'ls' } }] });

  const suites = loadEvalDir(tempDir);
  assert.equal(suites.length, 2);
});

test('loadEvalDir returns empty for missing directory', () => {
  assert.equal(loadEvalDir('/nonexistent/path').length, 0);
});

// ---------------------------------------------------------------------------
// runEvalCase / runEvalSuite
// ---------------------------------------------------------------------------

test('runEvalCase correctly identifies block match', () => {
  const specs = [validateSpec(TEST_SPEC)];
  const suite = validateEvalSuite(TEST_SUITE);

  const result = runEvalCase(specs, suite.cases[0]); // force push should block
  assert.equal(result.passed, true);
  assert.equal(result.expected, 'block');
  assert.equal(result.actual, 'block');
  assert.equal(result.constraintMatch, true);
});

test('runEvalCase correctly identifies pass match', () => {
  const specs = [validateSpec(TEST_SPEC)];
  const suite = validateEvalSuite(TEST_SUITE);

  const result = runEvalCase(specs, suite.cases[1]); // safe push should pass
  assert.equal(result.passed, true);
  assert.equal(result.expected, 'pass');
  assert.equal(result.actual, 'pass');
});

test('runEvalCase detects false negative (missed block)', () => {
  // Use a spec with a weak rule that won't catch the expected block
  const weakSpec = validateSpec({
    name: 'weak',
    constraints: [{ id: 'weak-rule', scope: 'bash', deny: 'NEVER_MATCHES_ANYTHING', reason: 'too weak' }],
    invariants: [],
  });

  const evalCase = validateEvalCase({ id: 'should-block', expect: 'block', input: { command: 'git push --force' } });
  const result = runEvalCase([weakSpec], evalCase);
  assert.equal(result.passed, false);
  assert.equal(result.expected, 'block');
  assert.equal(result.actual, 'pass');
});

test('runEvalSuite returns correct pass rate and failure breakdown', () => {
  const specs = [validateSpec(TEST_SPEC)];
  const suite = validateEvalSuite(TEST_SUITE);

  const result = runEvalSuite(specs, suite);
  assert.equal(result.suiteName, 'test-eval');
  assert.equal(result.totalCases, 4);
  assert.equal(result.passed, 4);
  assert.equal(result.failed, 0);
  assert.equal(result.passRate, 100);
  assert.equal(result.falsePositives, 0);
  assert.equal(result.falseNegatives, 0);
});

test('runAllEvals processes multiple suites', () => {
  const specs = [validateSpec(TEST_SPEC)];
  const suites = [validateEvalSuite(TEST_SUITE), validateEvalSuite({ ...TEST_SUITE, name: 'suite-2' })];

  const results = runAllEvals(specs, suites);
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.passRate === 100));
});

// ---------------------------------------------------------------------------
// computeEffectivenessMetrics
// ---------------------------------------------------------------------------

test('computeEffectivenessMetrics returns correct confusion matrix', () => {
  const specs = [validateSpec(TEST_SPEC)];
  const suite = validateEvalSuite(TEST_SUITE);
  const result = runEvalSuite(specs, suite);

  const metrics = computeEffectivenessMetrics(result);
  assert.equal(metrics.truePositives, 2);  // 2 expected blocks, both blocked
  assert.equal(metrics.trueNegatives, 2);  // 2 expected passes, both passed
  assert.equal(metrics.falsePositives, 0);
  assert.equal(metrics.falseNegatives, 0);
  assert.equal(metrics.precision, 1);
  assert.equal(metrics.recall, 1);
  assert.equal(metrics.f1, 1);
  assert.equal(metrics.accuracy, 1);
});

test('computeEffectivenessMetrics handles imperfect results', () => {
  // Simulate a result with mixed outcomes
  const mockResult = {
    totalCases: 4,
    caseResults: [
      { expected: 'block', actual: 'block' },  // TP
      { expected: 'pass', actual: 'block' },    // FP
      { expected: 'block', actual: 'pass' },    // FN
      { expected: 'pass', actual: 'pass' },     // TN
    ],
  };

  const metrics = computeEffectivenessMetrics(mockResult);
  assert.equal(metrics.truePositives, 1);
  assert.equal(metrics.trueNegatives, 1);
  assert.equal(metrics.falsePositives, 1);
  assert.equal(metrics.falseNegatives, 1);
  assert.equal(metrics.precision, 0.5);
  assert.equal(metrics.recall, 0.5);
  assert.equal(metrics.accuracy, 0.5);
});

// ---------------------------------------------------------------------------
// computeEffectivenessScore
// ---------------------------------------------------------------------------

test('computeEffectivenessScore returns 100 for perfect results', () => {
  const specs = [validateSpec(TEST_SPEC)];
  const suite = validateEvalSuite(TEST_SUITE);
  const result = runEvalSuite(specs, suite);

  const score = computeEffectivenessScore(result);
  assert.equal(score, 100);
});

// ---------------------------------------------------------------------------
// compareSpecVersions
// ---------------------------------------------------------------------------

test('compareSpecVersions identifies better spec version', () => {
  const strongSpec = [validateSpec(TEST_SPEC)];
  const weakSpec = [validateSpec({
    name: 'weak',
    constraints: [{ id: 'weak-rule', scope: 'bash', deny: 'NEVER_MATCHES', reason: 'too weak' }],
    invariants: [],
  })];

  const suite = validateEvalSuite(TEST_SUITE);
  const comparison = compareSpecVersions(strongSpec, weakSpec, suite);

  assert.equal(comparison.better, 'A');
  assert.ok(comparison.versionA.score > comparison.versionB.score);
  assert.ok(comparison.delta < 0); // B is worse, so delta is negative
});

test('compareSpecVersions returns tie for identical specs', () => {
  const specs = [validateSpec(TEST_SPEC)];
  const suite = validateEvalSuite(TEST_SUITE);

  const comparison = compareSpecVersions(specs, specs, suite);
  assert.equal(comparison.better, 'tie');
  assert.equal(comparison.delta, 0);
});

// ---------------------------------------------------------------------------
// recordEvalResult / loadEvalResults
// ---------------------------------------------------------------------------

test('recordEvalResult persists and loadEvalResults retrieves', () => {
  const tempDir = makeTempDir();
  const specs = [validateSpec(TEST_SPEC)];
  const suite = validateEvalSuite(TEST_SUITE);
  const result = runEvalSuite(specs, suite);

  recordEvalResult(result, { feedbackDir: tempDir });
  const loaded = loadEvalResults({ feedbackDir: tempDir });

  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].suiteName, 'test-eval');
  assert.equal(loaded[0].passRate, 100);
  assert.ok(loaded[0].metrics);
  assert.equal(loaded[0].metrics.precision, 1);
});

// ---------------------------------------------------------------------------
// computeEffectivenessTrend
// ---------------------------------------------------------------------------

test('computeEffectivenessTrend detects improving trend', () => {
  const results = [
    { runId: 'a', timestamp: '2026-01-01', suiteName: 's', passRate: 60, metrics: { precision: 0.6, recall: 0.6, f1: 0.6 } },
    { runId: 'b', timestamp: '2026-01-02', suiteName: 's', passRate: 65, metrics: { precision: 0.65, recall: 0.65, f1: 0.65 } },
    { runId: 'c', timestamp: '2026-01-03', suiteName: 's', passRate: 90, metrics: { precision: 0.9, recall: 0.9, f1: 0.9 } },
    { runId: 'd', timestamp: '2026-01-04', suiteName: 's', passRate: 95, metrics: { precision: 0.95, recall: 0.95, f1: 0.95 } },
  ];

  const trend = computeEffectivenessTrend(results);
  assert.equal(trend.trend, 'improving');
  assert.ok(trend.avgSecond > trend.avgFirst);
});

test('computeEffectivenessTrend returns unknown for empty results', () => {
  const trend = computeEffectivenessTrend([]);
  assert.equal(trend.trend, 'unknown');
});

// ---------------------------------------------------------------------------
// formatEvalResult / formatComparison
// ---------------------------------------------------------------------------

test('formatEvalResult produces readable output', () => {
  const specs = [validateSpec(TEST_SPEC)];
  const suite = validateEvalSuite(TEST_SUITE);
  const result = runEvalSuite(specs, suite);

  const output = formatEvalResult(result);
  assert.ok(output.includes('test-eval'));
  assert.ok(output.includes('100%'));
  assert.ok(output.includes('Precision'));
  assert.ok(output.includes('Recall'));
});

test('formatComparison produces readable output', () => {
  const specs = [validateSpec(TEST_SPEC)];
  const suite = validateEvalSuite(TEST_SUITE);
  const comparison = compareSpecVersions(specs, specs, suite);

  const output = formatComparison(comparison);
  assert.ok(output.includes('tie'));
  assert.ok(output.includes('test-eval'));
});

// ---------------------------------------------------------------------------
// Integration: built-in agent-safety eval suite
// ---------------------------------------------------------------------------

test('built-in agent-safety eval suite loads and passes against built-in specs', () => {
  const specs = loadSpecDir(path.join(__dirname, '..', 'config', 'specs'));
  const suites = loadEvalDir(path.join(__dirname, '..', 'config', 'evals'));

  assert.ok(suites.length >= 1, 'expected at least one eval suite in config/evals');
  const safetySuite = suites.find((s) => s.name === 'agent-safety-eval');
  assert.ok(safetySuite, 'agent-safety-eval suite must exist');
  assert.ok(safetySuite.cases.length >= 10, 'expected at least 10 eval cases');

  const result = runEvalSuite(specs, safetySuite);
  assert.equal(result.passRate, 100, `Expected 100% pass rate, got ${result.passRate}%. Failures: ${JSON.stringify(result.failures)}`);

  const metrics = computeEffectivenessMetrics(result);
  assert.equal(metrics.precision, 1);
  assert.equal(metrics.recall, 1);
  assert.equal(metrics.falsePositives, 0);
  assert.equal(metrics.falseNegatives, 0);
});
