'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildEvalReport,
  buildLangSmithCompatibleRuns,
  buildRagasCompatibleRows,
  evaluateGeneration,
  runAsyncEvaluation,
  scoreFaithfulness,
} = require('../scripts/async-eval-observability');

test('scoreFaithfulness rewards answers grounded in retrieved context', () => {
  const grounded = scoreFaithfulness(
    'ThumbGate blocks force push before execution.',
    ['ThumbGate blocks force push before execution.']
  );
  const hallucinated = scoreFaithfulness(
    'ThumbGate sends the deployment to Mars.',
    ['ThumbGate blocks force push before execution.']
  );

  assert.equal(grounded.score, 1);
  assert.ok(hallucinated.score < grounded.score);
});

test('evaluateGeneration returns RAG-style scores and fails ungrounded answers', () => {
  const result = evaluateGeneration({
    id: 'bad',
    question: 'Is checkout working?',
    response: 'Checkout is working and has 1000 paid customers.',
    retrievedContexts: ['The checkout diagnostic verifies the Stripe link is reachable.'],
    reference: 'The checkout link is reachable.',
  });

  assert.equal(result.id, 'bad');
  assert.equal(result.passed, false);
  assert.ok(result.scores.faithfulness < 1);
  assert.ok(Object.hasOwn(result.scores, 'answerRelevance'));
  assert.ok(Object.hasOwn(result.scores, 'contextPrecision'));
});

test('buildEvalReport emits CI, Ragas-compatible, and LangSmith-compatible payloads', () => {
  const cases = [
    {
      id: 'good',
      traceId: 'trace-1',
      question: 'Should Letta force-push?',
    response: 'Letta should not force-push because ThumbGate blocks force push before execution [context-1].',
      retrievedContexts: ['ThumbGate blocks force push before execution for Letta tool calls.'],
      reference: 'ThumbGate blocks high-risk Letta tool calls.',
    },
  ];
  const report = buildEvalReport(cases);

  assert.equal(report.mode, 'async-post-generation');
  assert.equal(report.total, 1);
  assert.equal(report.sinks.ci, true);
  assert.equal(report.sinks.langsmithCompatible, true);
  assert.equal(report.sinks.ragasCompatible, true);
  assert.deepEqual(report.metrics, ['faithfulness', 'answerRelevance', 'contextPrecision', 'groundedness', 'citationPrecision']);
  assert.equal(report.ragasDataset[0].user_input, cases[0].question);
  assert.equal(report.langsmithRuns[0].id, 'trace-1');
  assert.ok(report.langsmithRuns[0].feedback.some((entry) => entry.key === 'faithfulness'));
});

test('compatibility helpers produce expected external shapes', () => {
  const cases = [{
    question: 'What was retrieved?',
    response: 'The checkout proof was retrieved [context-1].',
    retrievedContexts: ['checkout proof'],
    reference: 'checkout proof',
  }];

  const ragasRows = buildRagasCompatibleRows(cases);
  const langsmithRuns = buildLangSmithCompatibleRuns(cases, buildEvalReport(cases).results);

  assert.deepEqual(Object.keys(ragasRows[0]).sort(), ['reference', 'response', 'retrieved_contexts', 'user_input']);
  assert.ok(Array.isArray(langsmithRuns[0].feedback));
  assert.equal(langsmithRuns[0].name, 'thumbgate_async_rag_eval');
});

test('runAsyncEvaluation writes a report after generation without blocking the caller path', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-async-eval-'));
  const outputPath = path.join(tmpDir, 'report.json');

  const report = await runAsyncEvaluation([{
    id: 'async-good',
    question: 'Should execution continue?',
    response: 'Execution should continue because the retrieved context says the gate allowed the action [context-1].',
    retrievedContexts: ['The gate allowed the action and execution should continue.'],
    reference: 'The gate allowed execution.',
  }], { outputPath });

  assert.equal(report.total, 1);
  assert.equal(fs.existsSync(outputPath), true);
  const persisted = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.equal(persisted.total, 1);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
