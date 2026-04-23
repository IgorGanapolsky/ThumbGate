const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildEvalSuiteFromFeedback,
  feedbackEntryToEvalCase,
  formatProofReport,
  runFeedbackEvalSuite,
  runSuite,
  runEvaluation,
  gradeOutput,
  loadSuite,
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

test('feedbackEntryToEvalCase converts negative feedback into a lesson eval', () => {
  const evalCase = feedbackEntryToEvalCase({
    id: 'fb_1',
    signal: 'down',
    context: 'Skipped verification and shipped a broken checkout flow',
    whatWentWrong: 'Claimed the flow worked before running tests',
    whatToChange: 'Always run focused checkout tests before claiming success',
    tags: ['verification'],
  });

  assert.equal(evalCase.prompt, 'lesson-distillation');
  assert.equal(evalCase.input.signal, 'negative');
  assert.equal(evalCase.expectedOutput.category, 'error');
  assert.equal(evalCase.expectedOutput.hasContent, true);
});

test('feedbackEntryToEvalCase turns vague thumbs-down into a rejection eval', () => {
  const evalCase = feedbackEntryToEvalCase({ signal: 'down', context: 'thumbs down' });
  assert.deepEqual(evalCase.expectedOutput, {
    shouldReject: true,
    rejectReason: 'vague-feedback',
  });
});

test('feedbackEntryToEvalCase builds regex-free stable ids from noisy context', () => {
  const evalCase = feedbackEntryToEvalCase({
    signal: 'down',
    context: '--- Ship!!! broken $$$ checkout /// path ??? ',
  }, 2);

  assert.equal(evalCase.id, 'feedback-negative-negative-ship-broken-checkout-path-3');
});

test('buildEvalSuiteFromFeedback creates bounded reusable eval suites', () => {
  const suite = buildEvalSuiteFromFeedback([
    { id: 'fb_1', signal: 'down', context: 'Skipped tests before merge', whatToChange: 'Run tests first' },
    { id: 'fb_2', signal: 'up', context: 'Verified the adapter parity before pushing', whatWorked: 'Ran parity tests' },
  ], { maxCases: 1, sourcePath: '/tmp/feedback-log.jsonl' });

  assert.equal(suite.source.totalEntries, 2);
  assert.equal(suite.source.selectedCases, 1);
  assert.equal(suite.evaluations.length, 1);
  assert.equal(suite.source.type, 'feedback-log');
});

test('runFeedbackEvalSuite reads feedback-log.jsonl and returns proof report data', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-prompt-eval-'));
  const feedbackLog = path.join(tmpDir, 'feedback-log.jsonl');
  fs.writeFileSync(feedbackLog, [
    JSON.stringify({
      id: 'fb_eval_1',
      signal: 'down',
      context: 'Exited the worktree and modified the main checkout',
      whatWentWrong: 'Touched the wrong branch after creating a worktree',
      whatToChange: 'Stay inside the assigned worktree until the PR is opened',
      tags: ['git'],
    }),
    JSON.stringify({
      id: 'fb_eval_2',
      signal: 'up',
      context: 'Ran the focused tests before reporting completion',
      whatWorked: 'Verification was evidence-backed',
      tags: ['testing'],
    }),
  ].join('\n') + '\n');

  const { suite, report } = runFeedbackEvalSuite({ feedbackLog, minScore: 0 });
  const proof = formatProofReport(report, suite);

  assert.equal(suite.evaluations.length, 2);
  assert.equal(report.feedbackDerived, true);
  assert.match(proof, /Feedback-Derived Coverage/);
  assert.match(proof, /Buyer Proof/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('runFeedbackEvalSuite handles empty feedback logs as bootstrapping proof', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-empty-prompt-eval-'));
  const feedbackLog = path.join(tmpDir, 'feedback-log.jsonl');
  fs.writeFileSync(feedbackLog, '', 'utf8');

  const { suite, report } = runFeedbackEvalSuite({ feedbackLog, minScore: 0 });

  assert.equal(suite.evaluations.length, 0);
  assert.equal(report.noCases, true);
  assert.equal(report.pass, true);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
