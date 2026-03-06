const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

test('E2E: feedback capture -> memory -> DPO export -> prevention rules', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-e2e-'));
  const origFeedbackDir = process.env.RLHF_FEEDBACK_DIR;
  process.env.RLHF_FEEDBACK_DIR = tmpDir;

  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (origFeedbackDir) process.env.RLHF_FEEDBACK_DIR = origFeedbackDir;
    else delete process.env.RLHF_FEEDBACK_DIR;
  });

  const {
    captureFeedback,
    analyzeFeedback,
    buildPreventionRules,
    writePreventionRules,
    feedbackSummary,
    readJSONL,
    getFeedbackPaths,
  } = require('../scripts/feedback-loop');
  const { exportDpoFromMemories } = require('../scripts/export-dpo-pairs');

  // Step 1: Capture negative feedback (mistake)
  await t.test('step 1: capture negative feedback creates mistake memory', () => {
    const result = captureFeedback({
      signal: 'down',
      context: 'Deployed without running tests first',
      whatWentWrong: 'Skipped test suite before deployment',
      whatToChange: 'Always run npm test before any deployment',
      tags: ['deployment', 'testing', 'verification'],
      rubricScores: [
        { criterion: 'correctness', score: 2, evidence: 'regressions found post-deploy', judge: 'qa' },
        { criterion: 'verification_evidence', score: 1, evidence: 'no test output attached', judge: 'qa' },
      ],
      guardrails: { testsPassed: false, pathSafety: true, budgetCompliant: true },
    });

    assert.equal(result.accepted, true, 'negative feedback should be accepted');
    assert.ok(result.memoryRecord, 'should produce a memory record');
    assert.equal(result.memoryRecord.category, 'error', 'negative should become error memory');
    assert.ok(result.memoryRecord.title.includes('MISTAKE'), 'error memory title should start with MISTAKE');
  });

  // Step 2: Capture positive feedback (learning)
  await t.test('step 2: capture positive feedback creates learning memory', () => {
    const result = captureFeedback({
      signal: 'up',
      context: 'Ran full test suite before deployment, all 200 tests passed',
      whatWorked: 'Used npm test && npm run prove:adapters before deploy',
      tags: ['deployment', 'testing', 'verification'],
      rubricScores: [
        { criterion: 'correctness', score: 5, evidence: '200 tests pass', judge: 'ci' },
        { criterion: 'verification_evidence', score: 5, evidence: 'proof report attached', judge: 'ci' },
        { criterion: 'safety', score: 4, evidence: 'no destructive ops', judge: 'ci' },
      ],
      guardrails: { testsPassed: true, pathSafety: true, budgetCompliant: true },
    });

    assert.equal(result.accepted, true, 'positive feedback should be accepted');
    assert.ok(result.memoryRecord, 'should produce a memory record');
    assert.equal(result.memoryRecord.category, 'learning', 'positive should become learning memory');
  });

  // Step 3: Verify memory log contains both records
  await t.test('step 3: memory log contains error and learning', () => {
    const { MEMORY_LOG_PATH } = getFeedbackPaths();
    const memories = readJSONL(MEMORY_LOG_PATH);

    assert.equal(memories.length, 2, 'should have 2 memory records');
    const errors = memories.filter((m) => m.category === 'error');
    const learnings = memories.filter((m) => m.category === 'learning');
    assert.equal(errors.length, 1, 'should have 1 error');
    assert.equal(learnings.length, 1, 'should have 1 learning');
  });

  // Step 4: Verify feedback log contains both events
  await t.test('step 4: feedback log contains both signals', () => {
    const { FEEDBACK_LOG_PATH } = getFeedbackPaths();
    const events = readJSONL(FEEDBACK_LOG_PATH);

    assert.equal(events.length, 2, 'should have 2 feedback events');
    assert.ok(events.some((e) => e.signal === 'negative'), 'should have negative signal');
    assert.ok(events.some((e) => e.signal === 'positive'), 'should have positive signal');
  });

  // Step 5: Analyze feedback stats
  await t.test('step 5: feedback stats reflect captured signals', () => {
    const { FEEDBACK_LOG_PATH } = getFeedbackPaths();
    const stats = analyzeFeedback(FEEDBACK_LOG_PATH);

    assert.equal(stats.total, 2);
    assert.equal(stats.totalPositive, 1);
    assert.equal(stats.totalNegative, 1);
    assert.equal(stats.approvalRate, 0.5);
    assert.ok(stats.tags.deployment.positive >= 1);
    assert.ok(stats.tags.deployment.negative >= 1);
    assert.ok(stats.rubric.samples >= 2, 'both signals had rubric scores');
  });

  // Step 6: Export DPO pairs
  await t.test('step 6: DPO export produces paired training data with reasoning', () => {
    const { MEMORY_LOG_PATH } = getFeedbackPaths();
    const memories = readJSONL(MEMORY_LOG_PATH);
    const result = exportDpoFromMemories(memories);

    assert.equal(result.pairs.length, 1, 'should produce 1 DPO pair');

    const pair = result.pairs[0];
    assert.ok(pair.prompt, 'pair should have a prompt');
    assert.ok(pair.chosen, 'pair should have a chosen response');
    assert.ok(pair.rejected, 'pair should have a rejected response');
    assert.ok(pair.metadata.matchedKeys.length > 0, 'pair should have matched domain keys');
    assert.ok(pair.metadata.rubric, 'pair should have rubric delta');
    assert.ok(pair.metadata.rubric.weightedDelta > 0, 'learning should score higher than error');
    assert.ok(pair.metadata.reasoningTrace, 'pair should have reasoning trace');
    assert.ok(pair.metadata.reasoningTrace.confidence > 0, 'reasoning trace should have confidence');
    assert.ok(result.reasoning, 'export should have aggregate reasoning');

    assert.equal(result.unpairedErrors.length, 0, 'all errors should be paired');
    assert.equal(result.unpairedLearnings.length, 0, 'all learnings should be paired');
  });

  // Step 7: Generate prevention rules
  await t.test('step 7: prevention rules generated from mistakes', () => {
    const markdown = buildPreventionRules(1);

    assert.ok(markdown.includes('# Prevention Rules'), 'should include header');
    assert.ok(markdown.includes('Rubric Failure Dimensions'), 'should include rubric section');
  });

  // Step 8: Write prevention rules to file
  await t.test('step 8: prevention rules written to disk', () => {
    const rulesPath = path.join(tmpDir, 'prevention-rules.md');
    const result = writePreventionRules(rulesPath, 1);

    assert.ok(fs.existsSync(rulesPath), 'rules file should exist');
    assert.ok(result.markdown.length > 20, 'should have meaningful content');
  });

  // Step 9: Generate text summary
  await t.test('step 9: feedback summary produces readable text', () => {
    const summary = feedbackSummary(10);

    assert.ok(summary.includes('Positive:'), 'summary should include positive count');
    assert.ok(summary.includes('Negative:'), 'summary should include negative count');
  });

  // Step 10: Rubric-gated positive is blocked
  await t.test('step 10: rubric gate blocks unsafe positive promotion', () => {
    const result = captureFeedback({
      signal: 'up',
      context: 'Claimed done without evidence',
      whatWorked: 'looked fine',
      tags: ['deployment'],
      rubricScores: [
        { criterion: 'verification_evidence', score: 5, judge: 'judge-a' },
        { criterion: 'verification_evidence', score: 1, judge: 'judge-b', evidence: 'no logs' },
      ],
      guardrails: { testsPassed: false, pathSafety: true, budgetCompliant: true },
    });

    assert.equal(result.accepted, false, 'unsafe positive should be rejected');
    assert.ok(/rubric gate/i.test(result.reason), 'rejection reason should mention rubric gate');
  });

  // Step 11: Verify final stats after gated attempt
  await t.test('step 11: blocked promotion tracked in analytics', () => {
    const { FEEDBACK_LOG_PATH } = getFeedbackPaths();
    const stats = analyzeFeedback(FEEDBACK_LOG_PATH);

    assert.equal(stats.total, 3, 'should have 3 total events');
    assert.ok(stats.rubric.blockedPromotions >= 1, 'should track blocked promotions');
  });
});

test('E2E: API server feedback capture -> stats -> summary round-trip', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-e2e-api-'));
  const origFeedbackDir = process.env.RLHF_FEEDBACK_DIR;
  const origApiKey = process.env.RLHF_API_KEY;
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  process.env.RLHF_API_KEY = 'e2e-test-key';

  const { startServer } = require('../src/api/server');
  const { server, port } = await startServer({ port: 0 });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (err) {}
    if (origFeedbackDir) process.env.RLHF_FEEDBACK_DIR = origFeedbackDir;
    else delete process.env.RLHF_FEEDBACK_DIR;
    if (origApiKey) process.env.RLHF_API_KEY = origApiKey;
    else delete process.env.RLHF_API_KEY;
  });

  const headers = {
    Authorization: 'Bearer e2e-test-key',
    'Content-Type': 'application/json',
  };

  await t.test('capture feedback via API', async () => {
    const res = await fetch(`http://localhost:${port}/v1/feedback/capture`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        signal: 'down',
        context: 'E2E test negative feedback',
        whatWentWrong: 'Something failed',
        whatToChange: 'Fix the thing',
        tags: ['e2e', 'testing'],
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.accepted, true);
  });

  await t.test('capture positive feedback via API', async () => {
    const res = await fetch(`http://localhost:${port}/v1/feedback/capture`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        signal: 'up',
        context: 'E2E test positive feedback',
        whatWorked: 'Everything passed',
        tags: ['e2e', 'testing'],
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.accepted, true);
  });

  await t.test('fetch stats reflects both signals', async () => {
    const res = await fetch(`http://localhost:${port}/v1/feedback/stats`, { headers });
    assert.equal(res.status, 200);
    const stats = await res.json();
    assert.equal(stats.total, 2);
    assert.equal(stats.totalPositive, 1);
    assert.equal(stats.totalNegative, 1);
  });

  await t.test('fetch summary returns text', async () => {
    const res = await fetch(`http://localhost:${port}/v1/feedback/summary`, { headers });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.summary.includes('Positive:'));
  });

  await t.test('rubric-gated capture returns 422', async () => {
    const res = await fetch(`http://localhost:${port}/v1/feedback/capture`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        signal: 'up',
        context: 'gated attempt',
        whatWorked: 'claimed success',
        tags: ['e2e'],
        rubricScores: [
          { criterion: 'verification_evidence', score: 5, judge: 'judge-a' },
          { criterion: 'verification_evidence', score: 1, judge: 'judge-b' },
        ],
        guardrails: { testsPassed: false, pathSafety: true, budgetCompliant: true },
      }),
    });
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.accepted, false);
  });

  await t.test('health endpoint returns ok', async () => {
    const res = await fetch(`http://localhost:${port}/healthz`, { headers });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
  });
});
