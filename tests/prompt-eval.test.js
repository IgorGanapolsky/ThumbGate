const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { runSuite, runEvaluation, gradeOutput, loadSuite } = require('../scripts/prompt-eval');

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
