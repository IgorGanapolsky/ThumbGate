'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPolicyEngineGuard,
  normalizePolicyAction,
  normalizePolicyDecision,
} = require('../adapters/policy-engine/thumbgate-policy-engine-adapter');

test('normalizePolicyDecision maps common policy-engine block outputs', () => {
  const decision = normalizePolicyDecision({
    status: 'deny',
    message: 'off-scope network egress',
    policyId: 'egress-001',
    provider: 'guardian-sdk',
    violations: [{ ruleId: 'egress-001', reason: 'curl to unknown host' }],
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.blocked, true);
  assert.equal(decision.approvalRequired, false);
  assert.equal(decision.decision, 'block');
  assert.equal(decision.reason, 'off-scope network egress');
  assert.equal(decision.source, 'guardian-sdk');
  assert.equal(decision.policyId, 'egress-001');
  assert.equal(decision.evidence[0].id, 'egress-001');
});

test('normalizePolicyDecision maps approval-required outputs', () => {
  const decision = normalizePolicyDecision({
    action: 'requires_review',
    explanation: 'production deploy needs human approval',
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.blocked, false);
  assert.equal(decision.approvalRequired, true);
  assert.equal(decision.decision, 'approval_required');
});

test('normalizePolicyDecision treats explicit allow as executable', () => {
  const decision = normalizePolicyDecision({
    allowed: true,
    reason: 'read-only ls command',
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.blocked, false);
  assert.equal(decision.approvalRequired, false);
  assert.equal(decision.decision, 'allow');
});

test('normalizePolicyDecision fails closed on unknown policy output', () => {
  const decision = normalizePolicyDecision({
    verdict: 'maybe',
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.blocked, false);
  assert.equal(decision.approvalRequired, true);
  assert.equal(decision.decision, 'unknown');
  assert.match(decision.reason, /approval required/);
});

test('normalizePolicyAction preserves provider-action fields for ThumbGate gates', () => {
  const action = normalizePolicyAction({
    provider: 'oracle-guardian',
    toolName: 'Bash',
    input: { command: 'curl https://example.com' },
    policyContext: { dataClass: 'secret' },
  });

  assert.equal(action.provider, 'oracle-guardian');
  assert.equal(action.toolName, 'Bash');
  assert.equal(action.actionType, 'shell.exec');
  assert.equal(action.command, 'curl https://example.com');
  assert.deepEqual(action.policyContext, { dataClass: 'secret' });
});

test('createPolicyEngineGuard blocks before executing the underlying tool', async () => {
  let executed = false;
  const guarded = createPolicyEngineGuard({
    source: 'ethicore',
    policyCheck: async () => ({ decision: 'block', reason: 'production write blocked' }),
    executeTool: async () => {
      executed = true;
      return { ok: true };
    },
  });

  await assert.rejects(
    guarded({ toolName: 'sql.query', input: { sql: 'DROP TABLE users' } }),
    (err) => {
      assert.equal(err.code, 'THUMBGATE_BLOCKED');
      assert.match(err.message, /production write/);
      assert.equal(err.thumbgate.policyDecision.source, 'ethicore');
      return true;
    },
  );
  assert.equal(executed, false);
});

test('createPolicyEngineGuard lets ThumbGate hard-block a policy allow', async () => {
  let executed = false;
  const guarded = createPolicyEngineGuard({
    policyCheck: async () => ({ decision: 'allow', reason: 'policy engine allow' }),
    gateCheck: async () => ({ allowed: false, reason: 'local repeated mistake rule' }),
    executeTool: async () => {
      executed = true;
      return { ok: true };
    },
  });

  await assert.rejects(
    guarded({ toolName: 'Bash', input: { command: 'git push --force origin main' } }),
    (err) => {
      assert.equal(err.code, 'THUMBGATE_BLOCKED');
      assert.match(err.message, /local repeated mistake/);
      assert.equal(err.thumbgate.policyDecision.allowed, true);
      assert.equal(err.thumbgate.gateDecision.allowed, false);
      return true;
    },
  );
  assert.equal(executed, false);
});

test('createPolicyEngineGuard passes normalized evidence to executor on allow', async () => {
  const guarded = createPolicyEngineGuard({
    policyCheck: async () => ({ status: 'pass', reason: 'read-only action' }),
    executeTool: async (_input, context) => ({
      ok: true,
      allowed: context.effectiveDecision.allowed,
      actionType: context.normalizedAction.actionType,
    }),
  });

  const result = await guarded({ toolName: 'Read', input: { path: 'README.md' } });

  assert.deepEqual(result, {
    ok: true,
    allowed: true,
    actionType: 'tool.call',
  });
});
