'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createLettaToolGuard,
  extractLettaToolCall,
  normalizeGateDecision,
  normalizeLettaAction,
} = require('../adapters/letta/thumbgate-letta-adapter');

test('extractLettaToolCall supports client tool events', () => {
  const toolCall = extractLettaToolCall({
    agentId: 'agent-1',
    clientTool: {
      id: 'tool-call-1',
      name: 'shell',
      input: { command: 'git status' },
    },
  });

  assert.deepEqual(toolCall, {
    id: 'tool-call-1',
    name: 'shell',
    arguments: { command: 'git status' },
    server: '',
    surface: 'client-tool',
  });
});

test('normalizeLettaAction maps Letta tool calls into ThumbGate action schema', () => {
  const normalized = normalizeLettaAction({
    agentId: 'agent-2',
    messageId: 'msg-9',
    mcp: {
      name: 'create_issue',
      server: 'github',
      arguments: { title: 'Fix checkout', body: 'Stripe link broken' },
    },
  });

  assert.equal(normalized.provider, 'letta');
  assert.equal(normalized.agentRuntime, 'letta');
  assert.equal(normalized.toolName, 'create_issue');
  assert.equal(normalized.mcpServer, 'github');
  assert.equal(normalized.letta.agentId, 'agent-2');
  assert.equal(normalized.letta.messageId, 'msg-9');
  assert.equal(normalized.letta.surface, 'mcp-tool');
  assert.deepEqual(normalized.toolInput, { title: 'Fix checkout', body: 'Stripe link broken' });
});

test('normalizeGateDecision treats block and approval-required decisions as not allowed', () => {
  assert.deepEqual(normalizeGateDecision({ decision: 'block', reason: 'force push' }), {
    allowed: false,
    blocked: true,
    approvalRequired: false,
    reason: 'force push',
    raw: { decision: 'block', reason: 'force push' },
  });

  const approval = normalizeGateDecision({ decision: 'approve', message: 'human review required' });
  assert.equal(approval.allowed, false);
  assert.equal(approval.blocked, false);
  assert.equal(approval.approvalRequired, true);
});

test('createLettaToolGuard blocks before executing the underlying Letta tool', async () => {
  let executed = false;
  const guarded = createLettaToolGuard({
    gateCheck: async (action) => {
      assert.equal(action.provider, 'letta');
      assert.equal(action.toolName, 'shell');
      return { decision: 'block', reason: 'force push to main is blocked' };
    },
    executeTool: async () => {
      executed = true;
      return { ok: true };
    },
  });

  await assert.rejects(
    guarded({
      clientTool: {
        name: 'shell',
        input: { command: 'git push --force origin main' },
      },
    }),
    (err) => {
      assert.equal(err.code, 'THUMBGATE_BLOCKED');
      assert.match(err.message, /force push/);
      assert.equal(err.thumbgate.normalizedAction.command, 'git push --force origin main');
      return true;
    },
  );
  assert.equal(executed, false);
});

test('createLettaToolGuard allows safe tool calls and passes normalized evidence to executor', async () => {
  const guarded = createLettaToolGuard({
    gateCheck: async () => ({ decision: 'allow' }),
    executeTool: async (_input, context) => ({
      ok: true,
      toolName: context.normalizedAction.toolName,
      allowed: context.decision.allowed,
    }),
  });

  const result = await guarded({
    toolCall: {
      name: 'read_file',
      input: { path: 'README.md' },
    },
  });

  assert.deepEqual(result, {
    ok: true,
    toolName: 'read_file',
    allowed: true,
  });
});
