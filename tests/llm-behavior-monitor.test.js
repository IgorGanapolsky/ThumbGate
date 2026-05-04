'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  analyzeBehaviorEvents,
  buildGoldenDatasetCandidates,
  formatBehaviorReport,
  normalizeEvent,
} = require('../scripts/llm-behavior-monitor');

test('normalizeEvent detects refusals, apologies, schema failures, and thumbs-downs', () => {
  const event = normalizeEvent({
    id: 's1',
    output: "I'm sorry, I cannot do that.",
    schemaError: 'missing tool payload',
    feedback: '👎',
    retries: 2,
  });

  assert.equal(event.refusal, true);
  assert.equal(event.apology, true);
  assert.equal(event.schemaValid, false);
  assert.equal(event.feedback, 'down');
  assert.equal(event.retryCount, 2);
});

test('analyzeBehaviorEvents blocks deterministic schema and tool-call drift', () => {
  const report = analyzeBehaviorEvents([
    { id: 'a', input: 'lookup customer', expectedTool: 'get_customer', actualTool: null, schemaValid: false },
    { id: 'b', input: 'send email', expectedTool: 'send_email', actualTool: 'draft_email', schemaValid: true },
    { id: 'c', input: 'normal answer', output: 'done', schemaValid: true },
  ], {
    thresholds: {
      malformedRate: 0.01,
      wrongToolRate: 0.01,
      missingToolRate: 0.01,
    },
  });

  assert.equal(report.verdict, 'blocked');
  assert.ok(report.alerts.some((alert) => alert.id === 'malformedRate-threshold' && alert.severity === 'block'));
  assert.ok(report.alerts.some((alert) => alert.id === 'wrongToolRate-threshold'));
  assert.ok(report.alerts.some((alert) => alert.id === 'missingToolRate-threshold'));
});

test('analyzeBehaviorEvents warns on retry, refusal, apology, and negative feedback drift', () => {
  const report = analyzeBehaviorEvents([
    { id: 'r1', output: 'retry me', retries: 1 },
    { id: 'r2', output: 'I cannot answer that benign request.' },
    { id: 'r3', output: 'Apologies, I missed context.' },
    { id: 'r4', feedback: 'thumbs-down', output: 'bad answer' },
    { id: 'r5', output: 'ok' },
  ], {
    baseline: {
      retryRate: 0,
      refusalRate: 0,
      apologyRate: 0,
      negativeFeedbackRate: 0,
    },
    thresholds: {
      retryRate: 0.1,
      refusalRate: 0.1,
      apologyRate: 0.1,
      negativeFeedbackRate: 0.1,
      driftDelta: 0.05,
    },
  });

  assert.equal(report.verdict, 'watch');
  assert.ok(report.alerts.some((alert) => alert.id === 'retryRate-threshold'));
  assert.ok(report.alerts.some((alert) => alert.id === 'refusalRate-drift'));
  assert.ok(report.nextActions.some((action) => /Promote reviewed failure examples/.test(action)));
});

test('buildGoldenDatasetCandidates creates human-reviewed eval promotion rows', () => {
  const candidates = buildGoldenDatasetCandidates([
    normalizeEvent({ id: 'bad-schema', input: 'call tool', schemaValid: false, output: '{}' }),
    normalizeEvent({ id: 'good', input: 'ok', output: 'ok' }),
    normalizeEvent({ id: 'retry', input: 'ambiguous', retries: 1, correctedOutput: 'clarify first', riskTags: ['high-stakes'] }),
  ]);

  assert.deepEqual(candidates.map((candidate) => candidate.reason), [
    'deterministic_schema_failure',
    'retry_or_regeneration',
  ]);
  assert.equal(candidates[1].syntheticVariants, 5);
  assert.equal(candidates.every((candidate) => candidate.reviewRequired), true);
});

test('formatBehaviorReport renders operator-readable drift summary', () => {
  const report = analyzeBehaviorEvents([{ feedback: 'down', output: 'bad' }], {
    thresholds: { negativeFeedbackRate: 0.1 },
  });
  const markdown = formatBehaviorReport(report);

  assert.match(markdown, /LLM Behavior Monitor/);
  assert.match(markdown, /negativeFeedbackRate/);
  assert.match(markdown, /Golden Dataset Candidates/);
});
