'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildRlsdCreditAssignment,
  buildRlsdCreditAssignments,
  buildTraceAnalytics,
  evaluateTraceShape,
  formatTraceAnalyticsReport,
  loadReasoningTraces,
  normalizeAgentTraceRecord,
  recordReasoningTrace,
  redactTraceText,
} = require('../scripts/agent-reasoning-traces');

function makeCodeTrace(overrides = {}) {
  return {
    id: 'trace_code_good',
    taskType: 'code-change',
    source: 'test',
    model: 'kimi-k2.6',
    messages: [
      { role: 'user', content: 'Implement a parser for agent traces.' },
      { role: 'assistant', content: 'Plan: inspect current scripts, add a small module, then test it.' },
      { role: 'assistant', content: 'Calling tool: apply_patch', tool_calls: [{ name: 'apply_patch', arguments: { file: 'scripts/x.js' } }] },
      { role: 'assistant', content: 'apply_patch wrote scripts/agent-reasoning-traces.js' },
      { role: 'assistant', content: 'node --test tests/agent-reasoning-traces.test.js passed' },
      { role: 'assistant', content: 'Evidence: test run passed with local output.' },
      { role: 'assistant', content: 'Committed and opened PR #123.' },
    ],
    success: true,
    ...overrides,
  };
}

test('redactTraceText removes secrets and hidden reasoning sections', () => {
  const fakeGithubToken = ['ghp', '1234567890abcdef1234567890abcdef1234'].join('_');
  const redacted = redactTraceText(
    `token ${fakeGithubToken} <think>private chain</think> a@b.com`
  );

  assert.doesNotMatch(redacted, new RegExp(fakeGithubToken));
  assert.doesNotMatch(redacted, /private chain/);
  assert.doesNotMatch(redacted, /a@b\.com/);
  assert.match(redacted, /\[REDACTED_GITHUB_TOKEN\]/);
  assert.match(redacted, /\[REDACTED_REASONING_TRACE\]/);
  assert.match(redacted, /\[REDACTED_EMAIL\]/);
});

test('normalizeAgentTraceRecord keeps observable trace metadata without raw reasoning', () => {
  const trace = normalizeAgentTraceRecord(makeCodeTrace({
    messages: [
      { role: 'user', content: 'Fix production deploy.' },
      { role: 'assistant', content: 'Plan: verify first.', reasoning_content: 'secret hidden chain of thought' },
      { role: 'assistant', content: 'npm test passed.' },
    ],
  }));

  assert.equal(trace.privacy.rawReasoningStored, false);
  assert.equal(trace.privacy.reasoningSignals, 1);
  assert.equal(trace.steps[1].reasoning.charCount, 'secret hidden chain of thought'.length);
  assert.doesNotMatch(JSON.stringify(trace), /secret hidden chain of thought/);
});

test('evaluateTraceShape rewards complete code-change traces', () => {
  const trace = normalizeAgentTraceRecord(makeCodeTrace());
  const evaluation = evaluateTraceShape(trace);

  assert.equal(evaluation.verdict, 'healthy');
  assert.equal(evaluation.missingRequired.length, 0);
  assert.ok(evaluation.score >= 85);
});

test('evaluateTraceShape gates public engagement that auto-posts without approval shape', () => {
  const trace = normalizeAgentTraceRecord({
    id: 'trace_public_bad',
    taskType: 'public-engagement',
    messages: [
      { role: 'user', content: 'Reply on Bluesky.' },
      { role: 'assistant', content: 'Audience: agent builders discussing local-first gates.' },
      { role: 'assistant', content: 'Draft: ThumbGate solves this with pre-action gates.' },
      { role: 'assistant', content: 'auto-posted the reply automatically' },
    ],
  });
  const evaluation = evaluateTraceShape(trace);

  assert.equal(evaluation.verdict, 'gate');
  assert.ok(evaluation.missingRequired.includes('approval_gate'));
  assert.ok(evaluation.forbiddenPresent.includes('auto_post'));
});

test('buildTraceAnalytics produces gate candidates and eval tuples', () => {
  const report = buildTraceAnalytics([
    makeCodeTrace(),
    {
      id: 'trace_prod_bad',
      taskType: 'production-change',
      messages: [
        { role: 'user', content: 'Deploy production billing fix.' },
        { role: 'assistant', content: 'Plan: patch and ship.' },
        { role: 'assistant', content: 'Calling tool: shell', tool_calls: [{ name: 'shell' }] },
        { role: 'assistant', content: 'Done. shipped.' },
      ],
    },
  ]);

  assert.equal(report.tracesAnalyzed, 2);
  assert.ok(report.averageShapeScore > 0);
  assert.ok(report.gateCandidates.some((candidate) => candidate.key.includes('production-change:verification')));
  assert.equal(report.evalTuples.length, 2);
  assert.ok(report.evalTuples.some((tuple) => tuple.expected === 'block_or_escalate'));
});

test('buildRlsdCreditAssignment separates verifiable direction from dense step magnitude', () => {
  const trace = normalizeAgentTraceRecord(makeCodeTrace({ success: false }));
  const assignment = buildRlsdCreditAssignment(trace);

  assert.equal(assignment.eligible, true);
  assert.equal(assignment.direction, 'penalize');
  assert.equal(assignment.directionSource, 'verifiable_outcome');
  assert.equal(assignment.leakageGuard.includes('magnitude only'), true);
  assert.equal(assignment.privacy.rawReasoningStored, false);
  assert.ok(assignment.stepCredits.some((step) => step.eventType === 'verification' && step.magnitude > 0));
  assert.ok(assignment.stepCredits.every((step) => step.signedReward <= 0));
  assert.ok(Math.abs(assignment.stepCredits.reduce((sum, step) => sum + step.magnitude, 0) - 1) < 0.01);
});

test('buildRlsdCreditAssignments keeps non-verifiable traces out of RLSD export', () => {
  const report = buildRlsdCreditAssignments([
    makeCodeTrace({ id: 'verified_success', success: true }),
    {
      id: 'open_ended_brand_voice',
      taskType: 'research',
      messages: [
        { role: 'user', content: 'Write a brand voice opinion.' },
        { role: 'assistant', content: 'Summary: this sounds on-brand.' },
      ],
    },
  ]);

  assert.equal(report.mode, 'rlsd_credit_assignment');
  assert.equal(report.tracesAnalyzed, 2);
  assert.equal(report.eligibleTraces, 1);
  assert.equal(report.ineligibleTraces, 1);
  assert.ok(report.assignments.find((assignment) => assignment.traceId === 'open_ended_brand_voice').stepCredits.every((step) => step.signedReward === 0));
  assert.ok(report.recommendations.some((item) => /preference-based evaluation/.test(item)));
});

test('recordReasoningTrace persists normalized traces to local JSONL', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-traces-'));

  recordReasoningTrace(makeCodeTrace({ id: 'persisted_trace' }), { feedbackDir: tempDir });
  const traces = loadReasoningTraces({ feedbackDir: tempDir });

  assert.equal(traces.length, 1);
  assert.equal(traces[0].traceId, 'persisted_trace');
  assert.equal(traces[0].privacy.rawReasoningStored, false);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('formatTraceAnalyticsReport includes privacy and gate information', () => {
  const report = buildTraceAnalytics([makeCodeTrace()]);
  const markdown = formatTraceAnalyticsReport(report);

  assert.match(markdown, /Agent Reasoning Trace Intelligence/);
  assert.match(markdown, /raw hidden reasoning is not stored/);
});
