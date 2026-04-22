const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  runSuite,
  runEvaluation,
  gradeOutput,
  loadSuite,
  compareReports,
  writeReport,
  loadReport,
} = require('../scripts/prompt-eval');

const SUITE_PATH = path.join(__dirname, '..', 'bench', 'prompt-eval-suite.json');

test('loadSuite loads the prompt eval suite without errors', () => {
  const suite = loadSuite(SUITE_PATH);
  assert.ok(Array.isArray(suite.evaluations), 'evaluations should be an array');
  assert.ok(suite.evaluations.length >= 4, 'should have at least 4 test cases');
});

test('gradeOutput: passing case with all checks met', () => {
  const output = {
    memoryRecord: {
      title: 'MISTAKE: worktree branch violation',
      content: 'NEVER exit worktree and touch main repo',
      category: 'error',
      importance: 'high',
    },
  };
  const expected = {
    hasTitle: true,
    titleContains: ['worktree'],
    hasContent: true,
    contentContains: ['NEVER', 'worktree'],
    category: 'error',
    importance: 'high',
  };
  const checks = gradeOutput(output, expected);
  const allPass = checks.every((c) => c.pass);
  assert.ok(allPass, 'all checks should pass: ' + checks.filter((c) => !c.pass).map((c) => c.criterion).join(', '));
});

test('gradeOutput: failing case with missing content', () => {
  const output = {
    memoryRecord: {
      title: 'Some title',
      content: '',
      category: 'error',
    },
  };
  const expected = {
    hasContent: true,
    contentContains: ['worktree'],
  };
  const checks = gradeOutput(output, expected);
  const failing = checks.filter((c) => !c.pass);
  assert.ok(failing.length >= 1, 'should have at least 1 failing check');
});

test('gradeOutput: rejection case', () => {
  const output = { accepted: false, status: 'rejected' };
  const expected = { shouldReject: true, rejectReason: 'vague' };
  const checks = gradeOutput(output, expected);
  assert.ok(checks[0].pass, 'should detect rejection');
});

test('gradeOutput: domain and outcome checks', () => {
  const output = {
    richContext: {
      domain: 'testing',
      outcomeCategory: 'standard-failure',
    },
  };
  const expected = {
    hasDomain: true,
    domain: 'testing',
    hasOutcome: true,
    outcomeContains: ['failure'],
  };
  const checks = gradeOutput(output, expected);
  const allPass = checks.every((c) => c.pass);
  assert.ok(allPass, 'domain and outcome checks should pass');
});

test('runEvaluation: returns score for a valid eval case', () => {
  const evalCase = {
    id: 'test-enrichment',
    prompt: 'feedback-enrichment',
    input: {
      signal: 'negative',
      context: 'Broke the build',
      tags: ['ci'],
    },
    expectedOutput: {
      hasDomain: true,
    },
  };
  const result = runEvaluation(evalCase);
  assert.ok(['pass', 'fail', 'error'].includes(result.status), 'should have a valid status');
  assert.ok(typeof result.score === 'number', 'should have a numeric score');
});

test('runEvaluation: unknown prompt returns skip', () => {
  const result = runEvaluation({
    id: 'unknown',
    prompt: 'nonexistent-prompt-type',
    input: {},
    expectedOutput: {},
  });
  assert.equal(result.status, 'skip');
});

test('runSuite: runs full suite and returns aggregate report', () => {
  const report = runSuite(SUITE_PATH, { minScore: 0 });
  assert.ok(report.total >= 4, 'should run at least 4 evaluations');
  assert.ok(typeof report.score === 'number', 'should compute aggregate score');
  assert.ok(typeof report.pass === 'boolean', 'should have pass/fail boolean');
  assert.equal(report.total, report.passed + report.failed + report.errors + report.skipped, 'counts should add up');
});

test('compareReports: flags score regressions by eval id', () => {
  const baseline = {
    suite: 'baseline',
    score: 100,
    results: [
      { id: 'a', score: 100, status: 'pass' },
      { id: 'b', score: 100, status: 'pass' },
    ],
  };
  const current = {
    suite: 'current',
    score: 80,
    results: [
      { id: 'a', score: 100, status: 'pass' },
      { id: 'b', score: 60, status: 'fail' },
    ],
  };

  const comparison = compareReports(current, baseline);
  assert.equal(comparison.scoreDelta, -20);
  assert.equal(comparison.regressions.length, 1);
  assert.equal(comparison.regressions[0].id, 'b');
});

test('runSuite: require-no-regressions fails a regressed report even above min score', () => {
  const baselineReport = {
    suite: 'baseline',
    score: 100,
    results: [
      { id: 'lesson-distill-negative-clear', score: 100, status: 'pass' },
      { id: 'lesson-distill-negative-vague', score: 100, status: 'pass' },
      { id: 'lesson-distill-positive', score: 100, status: 'pass' },
      { id: 'prevention-rule-repeated-mistake', score: 100, status: 'pass' },
      { id: 'feedback-capture-enrichment', score: 100, status: 'pass' },
      { id: 'self-distill-session-summary', score: 100, status: 'pass' },
    ],
  };

  const report = runSuite(SUITE_PATH, {
    minScore: 0,
    requireNoRegressions: true,
    baselineReport,
  });

  assert.equal(report.pass, false);
  assert.ok(report.comparison.regressions.length >= 1);
});

test('writeReport/loadReport round-trip eval artifacts', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-prompt-eval-'));
  const outPath = path.join(tmpDir, 'report.json');
  const report = runSuite(SUITE_PATH, { minScore: 0 });

  writeReport(report, outPath);
  const loaded = loadReport(outPath);

  assert.equal(loaded.suite, report.suite);
  assert.equal(loaded.score, report.score);
  assert.equal(Array.isArray(loaded.results), true);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('CLI accepts split --output and --min-score arguments', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-prompt-eval-cli-'));
  const outPath = path.join(tmpDir, 'report.json');
  const result = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'prompt-eval.js'),
    '--min-score',
    '0',
    '--output',
    outPath,
    '--json',
  ], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(outPath), true);
  const report = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.equal(typeof report.score, 'number');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
