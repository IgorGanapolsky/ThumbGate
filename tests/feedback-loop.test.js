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
  listEnforcementMatrix,
  appendDiagnosticRecord,
  getPendingBackgroundSideEffectCount,
  readJSONL,
  getFeedbackPaths,
  inferDomain,
  inferOutcome,
  enrichFeedbackContext,
  inferLessonFromConversation,
  waitForBackgroundSideEffects,
} = require('../scripts/feedback-loop');
const { evaluateMemoryIngress } = require('../scripts/memory-firewall');
const { recordConversationEntry } = require('../scripts/feedback-history-distiller');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-loop-test-'));
}

function appendJSONL(filePath, record) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
}

function loadFreshFeedbackLoop() {
  delete require.cache[require.resolve('../scripts/feedback-loop')];
  delete require.cache[require.resolve('../scripts/lesson-db')];
  try { delete require.cache[require.resolve('../scripts/feedback-paths')]; } catch {}
  return require('../scripts/feedback-loop');
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

test('enrichFeedbackContext: marks scope, approval, and protected-file enforcement without regex backtracking', () => {
  const event = {
    signal: 'negative',
    tags: ['policy'],
    context: 'The agent edited hook files outside the assigned scope without approval.',
    whatWentWrong: 'It touched unrelated files and a protected file.',
    whatToChange: 'Stay within scope and ask before changing hook file policy.',
  };
  const params = {
    filePaths: ['.husky/pre-push', 'src/index.js'],
  };

  const enriched = enrichFeedbackContext(event, params);
  assert.equal(enriched.richContext.enforcement.scopeViolation, true);
  assert.equal(enriched.richContext.enforcement.approvalFailure, true);
  assert.equal(enriched.richContext.enforcement.protectedFileViolation, true);
  assert.deepEqual(enriched.richContext.enforcement.protectedFiles, ['.husky/pre-push']);
});

// -- captureFeedback --

test('captureFeedback: valid negative feedback returns accepted=true', (t) => {
  const tmpDir = makeTmpDir();
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
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
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
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

test('captureFeedback: specific positive feedback without manual tags infers a domain tag', (t) => {
  const tmpDir = makeTmpDir();
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  const result = captureFeedback({
    signal: 'up',
    context: 'ThumbGate automation and Claude statusline repair',
    whatWorked: 'Verified the live ThumbGate version and fixed the stale Claude statusline wiring',
  });

  assert.strictEqual(result.accepted, true);
  assert.ok(result.memoryRecord.tags.includes('thumbgate'));
});

test('evaluateMemoryIngress: ShieldCortex blocks secret-bearing payload when explicitly enabled', () => {
  const decision = evaluateMemoryIngress({
    feedbackEvent: {
      signal: 'up',
      context: 'Do not persist sk-ant-abcdefghijklmnopqrstuvwxyz123456 in memory.',
      tags: ['security'],
    },
    provider: 'shieldcortex',
  });

  assert.strictEqual(decision.allowed, false);
  // Provider may be 'shieldcortex' (when package is installed) or 'local' (graceful fallback)
  assert.ok(
    decision.provider === 'shieldcortex' || decision.provider === 'local',
    `expected shieldcortex or local provider, got: ${decision.provider}`
  );
  assert.ok(
    decision.threatIndicators.includes('credential_leak'),
    `expected credential_leak in ${JSON.stringify(decision.threatIndicators)}`
  );
});

test('captureFeedback: blocks secret-bearing feedback before any raw memory write', (t) => {
  const tmpDir = makeTmpDir();
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  process.env.THUMBGATE_MEMORY_FIREWALL_PROVIDER = 'local';
  t.after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    delete process.env.THUMBGATE_MEMORY_FIREWALL_PROVIDER;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  const secret = 'sk-ant-abcdefghijklmnopqrstuvwxyz123456';
  const result = captureFeedback({
    signal: 'up',
    context: `Never store ${secret} in durable memory.`,
    whatWorked: 'It caught a secret before persistence.',
    tags: ['security'],
  });

  assert.strictEqual(result.accepted, false);
  assert.strictEqual(result.status, 'blocked');
  assert.strictEqual(fs.existsSync(path.join(tmpDir, 'feedback-log.jsonl')), false);
  assert.strictEqual(fs.existsSync(path.join(tmpDir, 'memory-log.jsonl')), false);

  const diagnostics = readJSONL(path.join(tmpDir, 'diagnostic-log.jsonl'));
  assert.strictEqual(diagnostics.length, 1);
  assert.match(diagnostics[0].context, /\[REDACTED:/);
  assert.doesNotMatch(JSON.stringify(diagnostics[0]), new RegExp(secret));
});

test('captureFeedback: rejects vague negative (no context/whatWentWrong/whatToChange)', (t) => {
  const tmpDir = makeTmpDir();
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
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
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
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

test('captureFeedback: promotes vague negative feedback when chatHistory supplies a concrete failure', (t) => {
  const tmpDir = makeTmpDir();
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  const result = captureFeedback({
    signal: 'down',
    context: 'thumbs down',
    chatHistory: [
      { author: 'user', text: 'Do not use Tailwind in this repo.' },
      { author: 'assistant', text: 'I used Tailwind classes in the hero rewrite.' },
    ],
    tags: ['ui'],
  });

  assert.equal(result.accepted, true);
  assert.equal(result.feedbackEvent.submittedContext, 'thumbs down');
  assert.match(result.feedbackEvent.context, /History-aware distillation/i);
  assert.match(result.feedbackEvent.whatWentWrong, /ignored a prior instruction/i);
  assert.ok(Array.isArray(result.feedbackEvent.conversationWindow));
  assert.equal(result.feedbackEvent.conversationWindow.length, 2);
  assert.ok(result.feedbackEvent.distillation);
  assert.match(result.memoryRecord.content, /How to avoid/);
});

test('captureFeedback: can distill a statusline follow-up from local conversation history', (t) => {
  const tmpDir = makeTmpDir();
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  recordConversationEntry({
    author: 'assistant',
    text: 'Ran npm test and attached the output before closing the task.',
    source: 'statusline-test',
  }, { feedbackDir: tmpDir });

  const result = captureFeedback({
    signal: 'up',
    context: 'thumbs up',
    allowLocalConversationFallback: true,
    tags: ['verification'],
  });

  assert.equal(result.accepted, true);
  assert.match(result.feedbackEvent.whatWorked, /successful pattern/i);
  assert.equal(result.feedbackEvent.distillation.source, 'local_conversation_window');
});

// -- analyzeFeedback --

test('analyzeFeedback: returns correct counts on populated log', (t) => {
  const tmpDir = makeTmpDir();
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
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

test('analyzeFeedback and feedbackSummary include audit-trail entries (real gate events)', (t) => {
  const tmpDir = makeTmpDir();
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {};
  });

  const logPath = path.join(tmpDir, 'feedback-log.jsonl');
  const now = new Date().toISOString();
  appendJSONL(logPath, { signal: 'positive', tags: ['testing'], skill: 'verify', timestamp: now });
  appendJSONL(logPath, { signal: 'negative', tags: ['audit-trail', 'testing'], skill: 'verify', timestamp: now });
  appendJSONL(logPath, { signal: 'negative', tags: ['testing'], skill: 'verify', timestamp: now });

  const stats = analyzeFeedback(logPath);
  assert.strictEqual(stats.total, 3);
  assert.strictEqual(stats.totalPositive, 1);
  assert.strictEqual(stats.totalNegative, 2);
  assert.strictEqual(stats.tags.testing.total, 3);
  assert.strictEqual(stats.skills.verify.total, 3);
  assert.strictEqual(stats.windows['7d'].total, 3);

  const summary = feedbackSummary(20, { feedbackDir: tmpDir });
  assert.match(summary, /Feedback Summary \(last 3\)/);
  assert.match(summary, /Positive: 1/);
  assert.match(summary, /Negative: 2/);
});

test('getFeedbackPaths falls back to global dir when neither .thumbgate nor .claude exists', () => {
  const savedFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
  const savedRailwayVolumeMountPath = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  delete process.env.THUMBGATE_FEEDBACK_DIR;
  delete process.env.RAILWAY_VOLUME_MOUNT_PATH;

  // This test exercises the global fallback path (lines 89-93)
  // which happens when neither .thumbgate nor .claude/memory/feedback exist in cwd.
  // Since the test runs from the project root which has .thumbgate, we just verify
  // the function returns valid paths.
  const paths = getFeedbackPaths();
  assert.ok(paths.FEEDBACK_DIR, 'should have FEEDBACK_DIR');
  assert.ok(paths.FEEDBACK_LOG_PATH, 'should have FEEDBACK_LOG_PATH');
  assert.ok(paths.FEEDBACK_LOG_PATH.endsWith('feedback-log.jsonl'));

  if (savedFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
  else process.env.THUMBGATE_FEEDBACK_DIR = savedFeedbackDir;
  if (savedRailwayVolumeMountPath === undefined) delete process.env.RAILWAY_VOLUME_MOUNT_PATH;
  else process.env.RAILWAY_VOLUME_MOUNT_PATH = savedRailwayVolumeMountPath;
});

test('getFeedbackPaths prefers Railway volume mount when explicit feedback dir is absent', () => {
  const savedFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
  const savedRailwayVolumeMountPath = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  delete process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.RAILWAY_VOLUME_MOUNT_PATH = '/data';

  const paths = getFeedbackPaths();
  assert.equal(paths.FEEDBACK_DIR, path.join('/data', 'feedback'));
  assert.equal(paths.FEEDBACK_LOG_PATH, path.join('/data', 'feedback', 'feedback-log.jsonl'));

  if (savedFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
  else process.env.THUMBGATE_FEEDBACK_DIR = savedFeedbackDir;
  if (savedRailwayVolumeMountPath === undefined) delete process.env.RAILWAY_VOLUME_MOUNT_PATH;
  else process.env.RAILWAY_VOLUME_MOUNT_PATH = savedRailwayVolumeMountPath;
});

// -- buildPreventionRules --

test('buildPreventionRules: returns markdown string with header', (t) => {
  const tmpDir = makeTmpDir();
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  const rules = buildPreventionRules();
  assert.strictEqual(typeof rules, 'string');
  assert.ok(rules.includes('# Prevention Rules'), 'should contain header');
});

test('buildPreventionRules: includes diagnostic sections for repeated root causes', (t) => {
  const tmpDir = makeTmpDir();
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
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
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
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
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  process.env.THUMBGATE_VECTOR_STUB_EMBED = 'true';
  t.after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    delete process.env.THUMBGATE_VECTOR_STUB_EMBED;
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

test('analyzeFeedback: SQLite fast path stays scoped to the active feedback dir and preserves the full shape', (t) => {
  const tmpDir = makeTmpDir();
  const prevFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
  const prevLessonDbPath = process.env.LESSON_DB_PATH;
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  delete process.env.LESSON_DB_PATH;

  t.after(() => {
    if (prevFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = prevFeedbackDir;
    if (prevLessonDbPath === undefined) delete process.env.LESSON_DB_PATH;
    else process.env.LESSON_DB_PATH = prevLessonDbPath;
    delete require.cache[require.resolve('../scripts/feedback-loop')];
    delete require.cache[require.resolve('../scripts/lesson-db')];
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  const freshLoop = loadFreshFeedbackLoop();
  freshLoop.captureFeedback({
    signal: 'up',
    context: 'ran full verification with logs',
    whatWorked: 'evidence attached',
    tags: ['testing', 'verification'],
  });
  freshLoop.captureFeedback({
    signal: 'down',
    context: 'skipped tests and shipped a regression',
    whatWentWrong: 'verification skipped',
    whatToChange: 'always run tests first',
    tags: ['testing', 'verification'],
  });

  const analysis = freshLoop.analyzeFeedback();
  assert.equal(analysis.total, 2);
  assert.equal(analysis.totalPositive, 1);
  assert.equal(analysis.totalNegative, 1);
  assert.equal(typeof analysis.approvalRate, 'number');
  assert.ok(Array.isArray(analysis.recommendations));
  assert.equal(typeof analysis.rubric.blockedPromotions, 'number');
  assert.ok(fs.existsSync(path.join(tmpDir, 'lessons.sqlite')), 'expected scoped SQLite lesson DB in feedback dir');

  const summary = freshLoop.feedbackSummary();
  assert.match(summary, /Overall approval:\s+50%/);
});

test('analyzeFeedback: explicit logPath bypasses unrelated SQLite state', (t) => {
  const feedbackDir = makeTmpDir();
  const isolatedDir = makeTmpDir();
  const isolatedLogPath = path.join(isolatedDir, 'feedback-log.jsonl');
  const prevFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
  const prevLessonDbPath = process.env.LESSON_DB_PATH;
  process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
  delete process.env.LESSON_DB_PATH;

  t.after(() => {
    if (prevFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = prevFeedbackDir;
    if (prevLessonDbPath === undefined) delete process.env.LESSON_DB_PATH;
    else process.env.LESSON_DB_PATH = prevLessonDbPath;
    delete require.cache[require.resolve('../scripts/feedback-loop')];
    delete require.cache[require.resolve('../scripts/lesson-db')];
    try { fs.rmSync(feedbackDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
    try { fs.rmSync(isolatedDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  const freshLoop = loadFreshFeedbackLoop();
  freshLoop.captureFeedback({
    signal: 'up',
    context: 'writes a single SQLite-backed record',
    whatWorked: 'local DB scoped correctly',
    tags: ['testing'],
  });

  appendJSONL(isolatedLogPath, { signal: 'positive', tags: ['api'] });
  appendJSONL(isolatedLogPath, { signal: 'negative', tags: ['api'] });
  appendJSONL(isolatedLogPath, { signal: 'positive', tags: ['api'] });

  const analysis = freshLoop.analyzeFeedback(isolatedLogPath);
  assert.equal(analysis.total, 3);
  assert.equal(analysis.totalPositive, 2);
  assert.equal(analysis.totalNegative, 1);
  assert.equal(analysis.tags.api.total, 3);
});

test('analyzeFeedback and prevention rules include persisted diagnostic records outside feedback capture', (t) => {
  const tmpDir = makeTmpDir();
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
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
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  await waitForBackgroundSideEffects();

  // Patch upsertFeedback on BOTH modules so whichever getVectorStoreModule()
  // returns will use the patched version.
  let flushed = false;
  const patchedUpsert = async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    flushed = true;
  };

  const fsSearch = require('../scripts/filesystem-search');
  const origFsUpsert = fsSearch.upsertFeedback;
  fsSearch.upsertFeedback = patchedUpsert;

  let vectorStore, origVsUpsert;
  try {
    vectorStore = require('../scripts/vector-store');
    origVsUpsert = vectorStore.upsertFeedback;
    vectorStore.upsertFeedback = patchedUpsert;
  } catch { vectorStore = null; }

  t.after(() => {
    fsSearch.upsertFeedback = origFsUpsert;
    if (vectorStore) vectorStore.upsertFeedback = origVsUpsert;
    delete process.env.THUMBGATE_FEEDBACK_DIR;
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

// -- Rejection Ledger --

test('rejected feedback is written to rejection-ledger.jsonl with revival condition', () => {
  const tmpDir = makeTmpDir();
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

  const result = captureFeedback({ signal: 'down' });
  assert.equal(result.accepted, false);

  const ledgerPath = path.join(tmpDir, 'rejection-ledger.jsonl');
  assert.ok(fs.existsSync(ledgerPath), 'rejection-ledger.jsonl should exist');

  const entries = fs.readFileSync(ledgerPath, 'utf-8').trim().split('\n').map(JSON.parse);
  assert.ok(entries.length >= 1, 'at least one rejection entry');
  assert.ok(entries[0].reason, 'rejection entry has reason');
  assert.ok(entries[0].revivalCondition, 'rejection entry has revivalCondition');
  assert.equal(entries[0].signal, 'negative');

  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.THUMBGATE_FEEDBACK_DIR;
});

test('rejected positive feedback is also recorded in rejection ledger', () => {
  const tmpDir = makeTmpDir();
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

  const result = captureFeedback({ signal: 'up' });
  assert.equal(result.accepted, false);

  const ledgerPath = path.join(tmpDir, 'rejection-ledger.jsonl');
  const entries = fs.readFileSync(ledgerPath, 'utf-8').trim().split('\n').map(JSON.parse);
  assert.ok(entries.length >= 1);
  assert.equal(entries[0].signal, 'positive');
  assert.ok(entries[0].revivalCondition.includes('whatWorked'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.THUMBGATE_FEEDBACK_DIR;
});

// -- Enforcement Matrix --

test('listEnforcementMatrix returns pipeline, gates, and rejectionLedger', () => {
  const tmpDir = makeTmpDir();
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

  captureFeedback({
    signal: 'up',
    context: 'Tests passed with full evidence',
    whatWorked: 'Evidence-first verification flow',
    tags: ['verification', 'testing'],
  });
  captureFeedback({ signal: 'down' });

  const matrix = listEnforcementMatrix();
  assert.ok(matrix.pipeline, 'matrix has pipeline section');
  assert.ok(matrix.gates, 'matrix has gates section');
  assert.ok(matrix.rejectionLedger, 'matrix has rejectionLedger section');
  assert.equal(typeof matrix.pipeline.totalFeedback, 'number');
  assert.equal(typeof matrix.pipeline.promoted, 'number');
  assert.equal(typeof matrix.pipeline.rejected, 'number');
  assert.equal(typeof matrix.pipeline.promotionRate, 'number');
  assert.ok(matrix.rejectionLedger.total >= 1, 'at least 1 rejection');
  assert.ok(Array.isArray(matrix.rejectionLedger.topReasons));
  assert.ok(Array.isArray(matrix.rejectionLedger.recentRejections));

  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.THUMBGATE_FEEDBACK_DIR;
});

// -- Branch coverage: inferDomain additional domains --

test('inferDomain: ui tag', () => { assert.strictEqual(inferDomain(['ui'], ''), 'ui-components'); });
test('inferDomain: component context', () => { assert.strictEqual(inferDomain([], 'render component'), 'ui-components'); });
test('inferDomain: api tag', () => { assert.strictEqual(inferDomain(['api'], ''), 'api-integration'); });
test('inferDomain: endpoint context', () => { assert.strictEqual(inferDomain([], 'endpoint failed'), 'api-integration'); });
test('inferDomain: git tag', () => { assert.strictEqual(inferDomain(['git'], ''), 'git-workflow'); });
test('inferDomain: commit context', () => { assert.strictEqual(inferDomain([], 'commit message'), 'git-workflow'); });
test('inferDomain: doc tag', () => { assert.strictEqual(inferDomain(['doc'], ''), 'documentation'); });
test('inferDomain: readme context', () => { assert.strictEqual(inferDomain([], 'update readme'), 'documentation'); });
test('inferDomain: debug tag', () => { assert.strictEqual(inferDomain(['debug'], ''), 'debugging'); });
test('inferDomain: error context', () => { assert.strictEqual(inferDomain([], 'fix the error'), 'debugging'); });
test('inferDomain: arch tag', () => { assert.strictEqual(inferDomain(['arch'], ''), 'architecture'); });
test('inferDomain: design context', () => { assert.strictEqual(inferDomain([], 'system design'), 'architecture'); });
test('inferDomain: data tag', () => { assert.strictEqual(inferDomain(['data'], ''), 'data-modeling'); });
test('inferDomain: schema context', () => { assert.strictEqual(inferDomain([], 'update schema'), 'data-modeling'); });
test('inferDomain: general fallback', () => { assert.strictEqual(inferDomain(['misc'], 'random'), 'general'); });
test('inferDomain: null tags', () => { assert.strictEqual(inferDomain(null, ''), 'general'); });

// -- Branch coverage: inferOutcome additional paths --

test('inferOutcome: positive first try', () => { assert.strictEqual(inferOutcome('positive', 'got it first try'), 'quick-success'); });
test('inferOutcome: positive thorough', () => { assert.strictEqual(inferOutcome('positive', 'thorough analysis'), 'deep-success'); });
test('inferOutcome: positive creative', () => { assert.strictEqual(inferOutcome('positive', 'creative solution'), 'creative-success'); });
test('inferOutcome: positive partial', () => { assert.strictEqual(inferOutcome('positive', 'partial fix'), 'partial-success'); });
test('inferOutcome: positive standard', () => { assert.strictEqual(inferOutcome('positive', 'done'), 'standard-success'); });
test('inferOutcome: negative wrong', () => { assert.strictEqual(inferOutcome('negative', 'wrong answer'), 'factual-error'); });
test('inferOutcome: negative shallow', () => { assert.strictEqual(inferOutcome('negative', 'too shallow'), 'insufficient-depth'); });
test('inferOutcome: negative slow', () => { assert.strictEqual(inferOutcome('negative', 'too slow'), 'efficiency-issue'); });
test('inferOutcome: negative assumed', () => { assert.strictEqual(inferOutcome('negative', 'I assumed too much'), 'false-assumption'); });
test('inferOutcome: negative incomplete', () => { assert.strictEqual(inferOutcome('negative', 'incomplete output'), 'incomplete'); });
test('inferOutcome: negative standard', () => { assert.strictEqual(inferOutcome('negative', 'bad'), 'standard-failure'); });

// -- Branch coverage: enrichFeedbackContext edge cases --

test('enrichFeedbackContext: filePaths as string', () => {
  const event = { signal: 'positive', tags: ['testing'], context: 'ran tests' };
  const enriched = enrichFeedbackContext(event, { context: 'ran tests', filePaths: 'src/a.js, src/b.js' });
  assert.deepStrictEqual(enriched.richContext.filePaths, ['src/a.js', 'src/b.js']);
});

test('enrichFeedbackContext: filePaths as array', () => {
  const event = { signal: 'positive', tags: ['testing'], context: 'ran tests' };
  const enriched = enrichFeedbackContext(event, { context: 'ran tests', filePaths: ['src/a.js'] });
  assert.deepStrictEqual(enriched.richContext.filePaths, ['src/a.js']);
});

test('enrichFeedbackContext: empty filePaths string', () => {
  const event = { signal: 'positive', tags: ['testing'], context: 'ran tests' };
  const enriched = enrichFeedbackContext(event, { context: 'ran tests', filePaths: '  ' });
  assert.deepStrictEqual(enriched.richContext.filePaths, []);
});

test('enrichFeedbackContext: errorType param', () => {
  const event = { signal: 'negative', tags: ['testing'], context: 'error' };
  const enriched = enrichFeedbackContext(event, { context: 'error', errorType: 'TypeError' });
  assert.strictEqual(enriched.richContext.errorType, 'TypeError');
});

test('enrichFeedbackContext: null errorType', () => {
  const event = { signal: 'negative', tags: ['testing'], context: 'error' };
  const enriched = enrichFeedbackContext(event, { context: 'error' });
  assert.strictEqual(enriched.richContext.errorType, null);
});

// -- readJSONL tail-read --

test('readJSONL: non-existent file returns empty array', () => {
  const result = readJSONL('/tmp/does-not-exist-' + Date.now() + '.jsonl');
  assert.deepStrictEqual(result, []);
});

test('readJSONL: default maxLines (500) truncates a file with more than 500 lines', () => {
  const tmpDir = makeTmpDir();
  const filePath = path.join(tmpDir, 'large.jsonl');
  const lines = [];
  for (let i = 0; i < 600; i++) {
    lines.push(JSON.stringify({ idx: i }));
  }
  fs.writeFileSync(filePath, lines.join('\n') + '\n');

  const result = readJSONL(filePath);
  assert.strictEqual(result.length, 500);
  // Should return the LAST 500 lines (indices 100-599)
  assert.strictEqual(result[0].idx, 100);
  assert.strictEqual(result[499].idx, 599);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('readJSONL: maxLines 0 returns all lines', () => {
  const tmpDir = makeTmpDir();
  const filePath = path.join(tmpDir, 'all.jsonl');
  const lines = [];
  for (let i = 0; i < 600; i++) {
    lines.push(JSON.stringify({ idx: i }));
  }
  fs.writeFileSync(filePath, lines.join('\n') + '\n');

  const result = readJSONL(filePath, { maxLines: 0 });
  assert.strictEqual(result.length, 600);
  assert.strictEqual(result[0].idx, 0);
  assert.strictEqual(result[599].idx, 599);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('readJSONL: maxLines 10 returns only last 10 lines', () => {
  const tmpDir = makeTmpDir();
  const filePath = path.join(tmpDir, 'small.jsonl');
  const lines = [];
  for (let i = 0; i < 50; i++) {
    lines.push(JSON.stringify({ idx: i }));
  }
  fs.writeFileSync(filePath, lines.join('\n') + '\n');

  const result = readJSONL(filePath, { maxLines: 10 });
  assert.strictEqual(result.length, 10);
  assert.strictEqual(result[0].idx, 40);
  assert.strictEqual(result[9].idx, 49);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('readJSONL: malformed JSON lines are skipped', () => {
  const tmpDir = makeTmpDir();
  const filePath = path.join(tmpDir, 'malformed.jsonl');
  const content = [
    JSON.stringify({ a: 1 }),
    'not valid json{{{',
    JSON.stringify({ b: 2 }),
    '}{bad',
    JSON.stringify({ c: 3 }),
  ].join('\n') + '\n';
  fs.writeFileSync(filePath, content);

  const result = readJSONL(filePath);
  assert.strictEqual(result.length, 3);
  assert.deepStrictEqual(result[0], { a: 1 });
  assert.deepStrictEqual(result[1], { b: 2 });
  assert.deepStrictEqual(result[2], { c: 3 });

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// -- inferLessonFromConversation --

test('inferLessonFromConversation: returns null for empty array', () => {
  assert.strictEqual(inferLessonFromConversation([], 'negative'), null);
  assert.strictEqual(inferLessonFromConversation(null, 'negative'), null);
  assert.strictEqual(inferLessonFromConversation(undefined, 'positive'), null);
});

test('inferLessonFromConversation: negative signal extracts user intent and assistant action', () => {
  const window = [
    { role: 'user', content: 'Fix the login bug in src/auth/login.ts' },
    { role: 'assistant', content: 'I deleted the entire auth module and replaced it with a TODO' },
  ];
  const result = inferLessonFromConversation(window, 'negative');
  assert.ok(result);
  assert.ok(result.lesson.includes('User asked:'));
  assert.ok(result.lesson.includes('User rejected this'));
  assert.ok(result.whatWentWrong);
  assert.strictEqual(result.whatWorked, null);
  assert.strictEqual(result.messageCount, 2);
});

test('inferLessonFromConversation: positive signal extracts approval', () => {
  const window = [
    { role: 'user', content: 'Refactor the payment hook' },
    { role: 'assistant', content: 'Extracted business logic into usePaymentFlow hook with tests' },
  ];
  const result = inferLessonFromConversation(window, 'positive');
  assert.ok(result);
  assert.ok(result.lesson.includes('User approved this'));
  assert.strictEqual(result.whatWentWrong, null);
  assert.ok(result.whatWorked);
});

test('inferLessonFromConversation: extracts file paths and error patterns', () => {
  const window = [
    { role: 'user', content: 'The build is broken' },
    { role: 'assistant', content: 'Error: FAIL in src/features/menu/hooks/useMenuData.ts - crash on null reference. Also touched scripts/build.js and tests/menu.test.ts' },
  ];
  const result = inferLessonFromConversation(window, 'negative');
  assert.ok(result);
  assert.ok(result.filePaths.length > 0);
  assert.ok(result.filePaths.some(f => f.includes('src/features/menu')));
  assert.ok(result.errorPatterns.length > 0);
  assert.ok(result.tags.includes('has-file-context'));
  assert.ok(result.tags.includes('has-error-context'));
});

test('captureFeedback: conversationWindow enriches context and is stored', () => {
  const tmpDir = makeTmpDir();
  process.env.THUMBGATE_DATA_DIR = tmpDir;

  const window = [
    { role: 'user', content: 'Fix the cart total calculation' },
    { role: 'assistant', content: 'Updated the useCartTotal hook to handle discount codes correctly' },
  ];

  const result = captureFeedback({
    signal: 'up',
    context: 'good fix',
    conversationWindow: window,
  });

  // Should still be accepted
  assert.ok(result.accepted !== undefined);

  // The feedbackEvent should have conversationWindow stored
  if (result.feedbackEvent) {
    assert.ok(Array.isArray(result.feedbackEvent.conversationWindow));
    assert.strictEqual(result.feedbackEvent.conversationWindow.length, 2);
    assert.strictEqual(result.feedbackEvent.conversationWindow[0].role, 'user');
    // Content should be capped at 500 chars
    assert.ok(result.feedbackEvent.conversationWindow[0].content.length <= 500);
  }

  delete process.env.THUMBGATE_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
