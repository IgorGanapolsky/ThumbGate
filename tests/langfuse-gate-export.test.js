'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildLangfuseGateEvent,
  buildLangfuseGateScore,
  formatJsonl,
  parseInput,
  sanitizeMetadata,
  scoreForDecision,
} = require('../scripts/langfuse-gate-export');

test('gate decisions map to Langfuse score values', () => {
  assert.equal(scoreForDecision('allow'), 1);
  assert.equal(scoreForDecision('allowed'), 1);
  assert.equal(scoreForDecision('log'), 0.75);
  assert.equal(scoreForDecision('approve'), 0.5);
  assert.equal(scoreForDecision('block'), 0);
  assert.equal(scoreForDecision('blocked'), 0);
});

test('Langfuse score payload preserves trace correlation and gate evidence', () => {
  const score = buildLangfuseGateScore({
    traceId: 'trace-123',
    gateId: 'stripe-refund-approval',
    ruleId: 'rule-7',
    decision: 'approve',
    riskTier: 'payment',
    tool: 'stripe.refunds.create',
    agent: 'codex',
    workflow: 'billing-support',
    runtimeComponent: 'mcp-server',
    usageBucket: 'high-token-tool-chain',
    budgetDecision: 'approval-required',
    tokenEstimate: 18000,
    componentUsagePercent: 37,
    promptVersion: 'refund-agent-v3',
    evidenceRequired: 'customer ticket and refund policy link',
    reason: 'Refund action requires owner approval.',
  });

  assert.equal(score.traceId, 'trace-123');
  assert.equal(score.name, 'thumbgate.pre_action_gate');
  assert.equal(score.value, 0.5);
  assert.match(score.comment, /stripe-refund-approval approve/);
  assert.deepEqual(score.metadata, {
    source: 'thumbgate',
    gate_id: 'stripe-refund-approval',
    rule_id: 'rule-7',
    decision: 'approve',
    risk_tier: 'payment',
    tool: 'stripe.refunds.create',
    agent: 'codex',
    workflow: 'billing-support',
    runtime_component: 'mcp-server',
    usage_bucket: 'high-token-tool-chain',
    budget_decision: 'approval-required',
    token_estimate: 18000,
    component_usage_percent: 37,
    prompt_version: 'refund-agent-v3',
    evidence_required: 'customer ticket and refund policy link',
    override_reason: undefined,
    metadata: undefined,
  });
});

test('secret-looking metadata is redacted before export', () => {
  const clean = sanitizeMetadata({
    tool: 'bash',
    apiKey: 'live-secret-value',
    nested: {
      webhook_secret: 'secret',
      ordinary: 'kept',
    },
    authorization: 'Bearer abc',
  });

  assert.equal(clean.tool, 'bash');
  assert.equal(clean.apiKey, '[redacted]');
  assert.equal(clean.authorization, '[redacted]');
  assert.equal(clean.nested.webhook_secret, '[redacted]');
  assert.equal(clean.nested.ordinary, 'kept');
});

test('JSON and JSONL inputs export Langfuse score events without network calls', () => {
  const parsed = parseInput([
    '{"traceId":"t1","gateId":"g1","decision":"block"}',
    '{"traceId":"t2","gateId":"g2","decision":"allow"}',
  ].join('\n'));
  const jsonl = formatJsonl(parsed);
  const events = jsonl.split('\n').map((line) => JSON.parse(line));

  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.type), ['score', 'score']);
  assert.deepEqual(events.map((event) => event.value), [0, 1]);
  assert.equal(buildLangfuseGateEvent({ traceId: 't3', gateId: 'g3', decision: 'log' }).value, 0.75);
});
