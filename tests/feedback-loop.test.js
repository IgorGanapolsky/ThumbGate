// tests/feedback-loop.test.js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  captureFeedback,
  analyzeFeedback,
  buildPreventionRules,
  feedbackSummary,
  appendDiagnosticRecord,
  getPendingBackgroundSideEffectCount,
  readJSONL,
  getFeedbackPaths,
  inferDomain,
  inferOutcome,
  enrichFeedbackContext,
  waitForBackgroundSideEffects,
} = require('../scripts/feedback-loop');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-loop-test-'));
}

function appendJSONL(filePath, record) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
}

// -- inferDomain --

test('inferDomain: tags=["testing"] returns "testing"', () => {
  assert.strictEqual(inferDomain(['testing'], ''), 'testing');
});

test('inferDomain: tags=["security"] returns "security"', () => {
  assert.strictEqual(inferDomain(['security'], ''), 'security');
});

test('inferDomain: empty tags, context mentions performance returns "performance"', () => {
  assert.strictEqual(inferDomain([], 'performance optimization'), 'performance');
});

// -- inferOutcome --

test('inferOutcome: positive signal with "quick fix" includes "success"', () => {
  const result = inferOutcome('positive', 'quick fix');
  assert.ok(result.includes('success'), `expected "success" in "${result}"`);
});

test('inferOutcome: negative signal with "wrong assumption" returns a string', () => {
  const result = inferOutcome('negative', 'wrong assumption');
  assert.strictEqual(typeof result, 'string');
  assert.ok(result.length > 0);
});

// -- enrichFeedbackContext --

test('enrichFeedbackContext: returns object with richContext', () => {
  const event = { signal: 'positive', tags: ['testing'], context: 'ran tests' };
  const params = { context: 'ran tests' };
  const enriched = enrichFeedbackContext(event, params);
  assert.ok(enriched.richContext, 'should have richContext');
  assert.strictEqual(enriched.richContext.domain, 'testing');
  assert.strictEqual(typeof enriched.richContext.outcomeCategory, 'string');
});

// -- captureFeedback --

test('captureFeedback: valid negative feedback returns accepted=true', (t) => {
  const tmpDir = makeTmpDir();
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.RLHF_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  const result = captureFeedback({
    signal: 'down',
    context: 'Agent skipped tests before claiming done',
    whatWentWrong: 'No tests were run',
    whatToChange: 'Always run tests first',
    tags: ['verification', 'testing'],
  });
  assert.strictEqual(result.accepted, true);
  assert.equal(result.feedbackEvent.diagnosis.rootCauseCategory, 'tool_output_misread');
  assert.equal(result.memoryRecord.diagnosis.rootCauseCategory, 'tool_output_misread');
});

test('captureFeedback: valid positive feedback returns accepted=true', (t) => {
  const tmpDir = makeTmpDir();
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.RLHF_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  const result = captureFeedback({
    signal: 'up',
    context: 'Ran tests and included output',
    whatWorked: 'Evidence-first flow',
    tags: ['verification', 'testing'],
  });
  assert.strictEqual(result.accepted, true);
});

test('captureFeedback: rejects vague negative (no context/whatWentWrong/whatToChange)', (t) => {
  const tmpDir = makeTmpDir();
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.RLHF_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  const result = captureFeedback({ signal: 'down' });
  assert.strictEqual(result.accepted, false);
  assert.strictEqual(result.needsClarification, true);
  assert.match(result.prompt, /What failed and what should change next time/i);
  assert.equal(result.feedbackEvent.diagnosis, undefined);
});

test('captureFeedback: rejects generic positive context and requests clarification', (t) => {
  const tmpDir = makeTmpDir();
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.RLHF_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  const result = captureFeedback({
    signal: 'up',
    context: 'thumbs up',
    tags: ['verification'],
  });
  assert.strictEqual(result.accepted, false);
  assert.strictEqual(result.status, 'clarification_required');
  assert.strictEqual(result.needsClarification, true);
  assert.match(result.reason, /too vague/i);
  assert.match(result.prompt, /What specifically worked that should be repeated/i);
});

// -- analyzeFeedback --

test('analyzeFeedback: returns correct counts on populated log', (t) => {
  const tmpDir = makeTmpDir();
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.RLHF_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  const logPath = path.join(tmpDir, 'feedback-log.jsonl');
  appendJSONL(logPath, { signal: 'positive', tags: ['testing'], skill: 'verify' });
  appendJSONL(logPath, { signal: 'negative', tags: ['testing'], skill: 'verify' });
  appendJSONL(logPath, { signal: 'positive', tags: ['testing'], skill: 'verify' });

  const stats = analyzeFeedback(logPath);
  assert.strictEqual(stats.total, 3);
  assert.strictEqual(stats.totalPositive, 2);
  assert.strictEqual(stats.totalNegative, 1);
  assert.strictEqual(stats.tags.testing.total, 3);
  assert.equal(stats.diagnostics.totalDiagnosed, 0);
});

// -- buildPreventionRules --

test('buildPreventionRules: returns markdown string with header', (t) => {
  const tmpDir = makeTmpDir();
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.RLHF_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  const rules = buildPreventionRules();
  assert.strictEqual(typeof rules, 'string');
  assert.ok(rules.includes('# Prevention Rules'), 'should contain header');
});

test('buildPreventionRules: includes diagnostic sections for repeated root causes', (t) => {
  const tmpDir = makeTmpDir();
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.RLHF_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  captureFeedback({
    signal: 'down',
    context: 'Approved without proof and triggered rubric gate',
    whatWentWrong: 'Missing verification evidence',
    whatToChange: 'Always include proof',
    tags: ['verification'],
    rubricScores: [
      { criterion: 'verification_evidence', score: 1, evidence: 'no logs', judge: 'judge-a' },
    ],
    guardrails: { testsPassed: false, pathSafety: true, budgetCompliant: true },
  });
  captureFeedback({
    signal: 'down',
    context: 'Approved without proof and triggered rubric gate again',
    whatWentWrong: 'Missing verification evidence',
    whatToChange: 'Always include proof',
    tags: ['verification'],
    rubricScores: [
      { criterion: 'verification_evidence', score: 1, evidence: 'no logs', judge: 'judge-a' },
    ],
    guardrails: { testsPassed: false, pathSafety: true, budgetCompliant: true },
  });

  const rules = buildPreventionRules(2);
  assert.match(rules, /Root Cause Categories/);
  assert.match(rules, /guardrail_triggered/);
  assert.match(rules, /Repeated Failure Constraints/);
});

// -- feedbackSummary --

test('feedbackSummary: returns string with "Positive:"', (t) => {
  const tmpDir = makeTmpDir();
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.RLHF_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  // Seed some feedback so summary has data
  const result = captureFeedback({
    signal: 'up',
    context: 'Ran full test suite',
    whatWorked: 'Evidence-first approach',
    tags: ['testing'],
  });

  const summary = feedbackSummary();
  assert.strictEqual(typeof summary, 'string');
  assert.ok(summary.includes('Positive:'), `expected "Positive:" in summary, got: ${summary}`);
});

test('analyzeFeedback: includes boosted risk summary after sequence training rows exist', (t) => {
  const tmpDir = makeTmpDir();
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  process.env.RLHF_VECTOR_STUB_EMBED = 'true';
  t.after(() => {
    delete process.env.RLHF_FEEDBACK_DIR;
    delete process.env.RLHF_VECTOR_STUB_EMBED;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  captureFeedback({
    signal: 'up',
    context: 'ran tests and included logs',
    whatWorked: 'evidence first',
    tags: ['testing', 'verification'],
  });
  captureFeedback({
    signal: 'up',
    context: 'verified fix with proof',
    whatWorked: 'tests passed',
    tags: ['testing', 'verification'],
  });
  captureFeedback({
    signal: 'down',
    context: 'skipped tests and missing logs caused failure',
    whatWentWrong: 'verification skipped',
    whatToChange: 'always run tests',
    tags: ['debugging', 'verification'],
  });
  captureFeedback({
    signal: 'down',
    context: 'unsafe path and security risk caused rejection',
    whatWentWrong: 'unsafe path',
    whatToChange: 'validate paths',
    tags: ['security'],
  });
  captureFeedback({
    signal: 'up',
    context: 'proof attached and verification complete',
    whatWorked: 'full evidence',
    tags: ['testing', 'verification'],
  });
  captureFeedback({
    signal: 'down',
    context: 'regression due to skipped verification',
    whatWentWrong: 'regression shipped',
    whatToChange: 'add regression tests',
    tags: ['debugging', 'verification'],
  });

  const analysis = analyzeFeedback();
  assert.ok(analysis.boostedRisk, 'expected boostedRisk summary');
  assert.ok(analysis.boostedRisk.exampleCount >= 6, `expected >= 6 examples, got ${analysis.boostedRisk.exampleCount}`);
  assert.ok(analysis.diagnostics.totalDiagnosed >= 2, 'expected diagnosis aggregation');

  const summary = feedbackSummary();
  assert.ok(summary.includes('Boosted risk'), `expected boosted risk line in summary, got: ${summary}`);
});

test('analyzeFeedback and prevention rules include persisted diagnostic records outside feedback capture', (t) => {
  const tmpDir = makeTmpDir();
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.RLHF_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  appendDiagnosticRecord({
    source: 'verification_loop',
    step: 'verification',
    context: 'claimed done without tests',
    diagnosis: {
      diagnosed: true,
      rootCauseCategory: 'tool_output_misread',
      criticalFailureStep: 'verification',
      violations: [{ constraintId: 'workflow:proof_commands' }],
      evidence: [],
    },
  });

  const analysis = analyzeFeedback();
  assert.equal(analysis.diagnostics.totalDiagnosed, 1);

  const rules = buildPreventionRules(1);
  assert.match(rules, /Root Cause Categories/);
  assert.match(rules, /tool_output_misread: 1 failures/);
  assert.match(rules, /workflow:proof_commands: 1 failures/);
});

test('captureFeedback: waitForBackgroundSideEffects drains deferred vector writes', async (t) => {
  const tmpDir = makeTmpDir();
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  await waitForBackgroundSideEffects();

  const vectorStore = require('../scripts/vector-store');
  const originalUpsertFeedback = vectorStore.upsertFeedback;
  let flushed = false;

  vectorStore.upsertFeedback = async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    flushed = true;
  };

  t.after(() => {
    vectorStore.upsertFeedback = originalUpsertFeedback;
    delete process.env.RLHF_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  const result = captureFeedback({
    signal: 'up',
    context: 'Deferred vector side-effect proof',
    whatWorked: 'background task tracking',
    tags: ['verification'],
  });

  assert.equal(result.accepted, true);
  assert.equal(flushed, false);
  assert.equal(getPendingBackgroundSideEffectCount(), 1);

  await waitForBackgroundSideEffects();

  assert.equal(flushed, true);
  assert.equal(getPendingBackgroundSideEffectCount(), 0);
});
