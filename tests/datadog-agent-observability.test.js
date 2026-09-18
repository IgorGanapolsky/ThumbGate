'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DatadogAgentObservability,
  AgentTraceSpan,
} = require('../src/observability/datadog-agent-observability');

test('DatadogAgentObservability: creates trace and span hierarchy with latency metrics', () => {
  const obs = new DatadogAgentObservability({ serviceName: 'test-service' });
  const root = obs.startTrace('orchestrator_root');
  assert.equal(root.name, 'orchestrator_root');
  assert.ok(root.traceId);
  assert.equal(root.tags.service, 'test-service');

  const child = obs.startChildSpan(root, 'step_eval');
  assert.equal(child.parentSpanId, root.id);
  assert.equal(child.traceId, root.traceId);

  obs.recordUsage(child, { tokensIn: 100, tokensOut: 50, costUsd: 0.002 });
  child.finish('SUCCESS');
  root.finish('SUCCESS');

  const summary = obs.exportTraceSummary(root.traceId);
  assert.ok(summary);
  assert.equal(summary.totalSpans, 2);
  assert.equal(summary.metrics.totalTokens, 150);
  assert.equal(summary.metrics.totalCostUsd, 0.002);
});

test('DatadogAgentObservability: sensitive data scanner redacts tokens and PII', () => {
  const obs = new DatadogAgentObservability();
  const raw = 'Auth: Bearer sk-ant-api03-abcdef12345678901234567890 and user email test@example.com';
  const scrubbed = obs.scrubSensitiveData(raw);

  assert.ok(!scrubbed.includes('test@example.com'));
  assert.ok(scrubbed.includes('[REDACTED_'));
  assert.equal(obs.stats.piiRedactionCount, 2);
});

test('DatadogAgentObservability: redacts modern provider credentials including github_pat and sk-proj', () => {
  const obs = new DatadogAgentObservability();
  const raw = 'Keys: github_pat_11AAAAAAA01234567890abcdef1234567890 and sk-proj-12345678901234567890';
  const scrubbed = obs.scrubSensitiveData(raw);

  assert.ok(!scrubbed.includes('github_pat_'));
  assert.ok(!scrubbed.includes('sk-proj-'));
  assert.ok(scrubbed.includes('[REDACTED:github_fine_grained_pat]'));
  assert.ok(scrubbed.includes('[REDACTED:openai_project_key]'));
});

test('DatadogAgentObservability: triggers tripwire when budget ceiling is breached', () => {
  const obs = new DatadogAgentObservability({ budgetLimitUsd: 0.05 });
  const root = obs.startTrace('budget_check');

  assert.throws(() => {
    obs.recordUsage(root, { costUsd: 0.06 });
  }, /Cost ceiling breached/);

  assert.equal(obs.stats.budgetBreaches, 1);
});

test('DatadogAgentObservability: quality evaluation checks no-ops and violations', () => {
  const obs = new DatadogAgentObservability();
  const passEval = obs.evaluateQuality({ traceId: 'trace-1', actionCount: 3, noOpDetected: false });
  assert.equal(passEval.verdict, 'PASS');

  const failEval = obs.evaluateQuality({ traceId: 'trace-2', actionCount: 0, noOpDetected: true });
  assert.equal(failEval.verdict, 'FAIL');
  assert.equal(failEval.checks.noOpInterdiction, 'FAIL');
});
