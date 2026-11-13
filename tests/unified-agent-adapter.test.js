'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  SUPPORTED_AGENTS,
  AGENT_CLI_COMMANDS,
  EVENT_TYPES,
  buildPerTaskMcpConfig,
  createTaskMcpConfigFile,
  DynamicApprovalGate,
  UnifiedCodingAgentAdapter,
  VerifyAndRepairRunner,
} = require('../src/unified-agent-adapter');

test('UnifiedCodingAgentAdapter: validates supported agents and builds proper CLI args', () => {
  for (const agent of ['claude', 'codex', 'copilot', 'cursor', 'gemini', 'poolside', 'mock']) {
    const adapter = new UnifiedCodingAgentAdapter({ agentType: agent });
    assert.equal(adapter.agentType, agent);
  }

  assert.throws(() => {
    new UnifiedCodingAgentAdapter({ agentType: 'unsupported-bot' });
  }, /Unsupported agent type/);

  const claudeAdapter = new UnifiedCodingAgentAdapter({ agentType: 'claude' });
  const claudeCmd = claudeAdapter.buildCommand('Refactor auth', {
    model: 'claude-3-7-sonnet',
    mcpConfigFile: '/tmp/mcp.json',
    dangerouslySkipPermissions: true,
  });

  assert.equal(claudeCmd.bin, 'claude');
  assert.ok(claudeCmd.args.includes('-p'));
  assert.ok(claudeCmd.args.includes('Refactor auth'));
  assert.ok(claudeCmd.args.includes('--model'));
  assert.ok(claudeCmd.args.includes('claude-3-7-sonnet'));
  assert.ok(claudeCmd.args.includes('--mcp-config'));
  assert.ok(claudeCmd.args.includes('--dangerously-skip-permissions'));
});

test('UnifiedCodingAgentAdapter: normalizes raw stdout chunks into standard event stream', () => {
  const adapter = new UnifiedCodingAgentAdapter({ agentType: 'mock' });
  const sessionId = 'test-session-1';

  // 1. Tool call json
  const toolJson = JSON.stringify({ type: 'tool_use', tool: 'Edit', input: { path: 'a.js' } });
  const toolEvents = adapter.normalizeOutputChunk(toolJson, sessionId);
  assert.equal(toolEvents.length, 1);
  assert.equal(toolEvents[0].type, EVENT_TYPES.TOOL_CALL);
  assert.equal(toolEvents[0].tool, 'Edit');

  // 2. Thought json
  const thoughtJson = JSON.stringify({ type: 'thought', content: 'Analyzing dependency tree' });
  const thoughtEvents = adapter.normalizeOutputChunk(thoughtJson, sessionId);
  assert.equal(thoughtEvents.length, 1);
  assert.equal(thoughtEvents[0].type, EVENT_TYPES.THOUGHT);
  assert.equal(thoughtEvents[0].content, 'Analyzing dependency tree');

  // 3. Plain text output
  const plainEvents = adapter.normalizeOutputChunk('Compiling typescript...\nDone.', sessionId);
  assert.equal(plainEvents.length, 2);
  assert.equal(plainEvents[0].type, EVENT_TYPES.OUTPUT_CHUNK);
  assert.equal(plainEvents[0].text, 'Compiling typescript...');
});

test('UnifiedCodingAgentAdapter: handles steering, interactive approvals, and mock task execution', async () => {
  const adapter = new UnifiedCodingAgentAdapter({ agentType: 'mock' });
  const capturedEvents = [];

  adapter.on(EVENT_TYPES.SESSION_START, (e) => capturedEvents.push(e));
  adapter.on(EVENT_TYPES.TASK_COMPLETED, (e) => capturedEvents.push(e));
  adapter.on(EVENT_TYPES.STEER_INJECTED, (e) => capturedEvents.push(e));

  // Run mock task
  const result = await adapter.runTask('Write cache module', {
    sessionId: 'sess_cache_1',
    mockHandler: async (prompt) => {
      return { ok: true, output: `Generated cache module for prompt: ${prompt}` };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.sessionId, 'sess_cache_1');
  assert.ok(result.output.includes('Generated cache module'));
  assert.equal(capturedEvents.filter((e) => e.type === EVENT_TYPES.SESSION_START).length, 1);
  assert.equal(capturedEvents.filter((e) => e.type === EVENT_TYPES.TASK_COMPLETED).length, 1);

  // Dynamic Approvals
  const approval = adapter.requestApproval('sess_cache_1', 'file_delete', { target: 'legacy.js' });
  assert.equal(approval.status, 'PENDING');
  assert.equal(approval.operation, 'file_delete');

  const resolved = adapter.resolveApproval(approval.approvalId, 'APPROVE', 'Operator authorized');
  assert.equal(resolved.ok, true);
  assert.equal(resolved.approval.status, 'APPROVED');
  assert.equal(resolved.approval.reason, 'Operator authorized');
});

test('DynamicApprovalGate & createTaskMcpConfigFile: evaluate risks and manage per-task MCP files', () => {
  const gate = new DynamicApprovalGate();

  const safeCheck = gate.evaluate('lint');
  assert.equal(safeCheck.approved, true);
  assert.equal(safeCheck.requiresInteractiveApproval, false);

  const dangerousCheck = gate.evaluate('force_push');
  assert.equal(dangerousCheck.approved, false);
  assert.equal(dangerousCheck.requiresInteractiveApproval, true);

  // Per-task MCP configuration
  const baseConfig = { mcpServers: { globalServer: { command: 'node' } } };
  const taskServers = { sqliteTask: { command: 'sqlite3' } };
  const merged = buildPerTaskMcpConfig(baseConfig, taskServers);
  assert.ok(merged.mcpServers.globalServer);
  assert.ok(merged.mcpServers.sqliteTask);

  const fileBundle = createTaskMcpConfigFile(taskServers, baseConfig);
  assert.ok(fs.existsSync(fileBundle.configPath));
  assert.ok(fileBundle.config.mcpServers.sqliteTask);

  // Clean up
  fileBundle.cleanup();
  assert.equal(fs.existsSync(fileBundle.configPath), false);
});

test('VerifyAndRepairRunner: executes single-pass success and multi-attempt repair loop with token savings', async () => {
  const adapter = new UnifiedCodingAgentAdapter({ agentType: 'mock' });
  const runner = new VerifyAndRepairRunner(adapter, { maxRepairAttempts: 3 });

  // 1. Single pass success
  const singlePass = await runner.executeWithVerifyAndRepair({
    taskPrompt: 'Create simple greeter',
    verifier: {
      fn: async () => ({ passed: true, output: '1 test passed' }),
    },
    options: {
      mockHandler: async () => ({ ok: true, output: 'Greeter built' }),
    },
  });

  assert.equal(singlePass.ok, true);
  assert.equal(singlePass.attempts, 1);
  assert.equal(singlePass.tokenSavingsPct, 0);

  // 2. Multi-attempt repair (fails attempt 1, passes attempt 2)
  let verifyCount = 0;
  const repairRun = await runner.executeWithVerifyAndRepair({
    taskPrompt: 'Implement concurrent queue',
    verifier: {
      fn: async () => {
        verifyCount++;
        if (verifyCount === 1) {
          return { passed: false, output: 'Race condition detected on dequeue()' };
        }
        return { passed: true, output: 'All concurrency tests passed' };
      },
    },
    options: {
      mockHandler: async (prompt) => {
        if (prompt.includes('VERIFY-AND-REPAIR')) {
          return { ok: true, output: 'Patched atomic CAS lock' };
        }
        return { ok: true, output: 'Initial concurrent queue implementation' };
      },
    },
  });

  assert.equal(repairRun.ok, true);
  assert.equal(repairRun.attempts, 2);
  assert.equal(repairRun.tokenSavingsPct, 38);
  assert.equal(repairRun.history.length, 2);
  assert.equal(repairRun.history[0].verifyPassed, false);
  assert.equal(repairRun.history[1].verifyPassed, true);
  assert.ok(repairRun.history[1].prompt.includes('Race condition detected on dequeue()'));

  // 3. Exhausted repair attempts
  const exhaustedRun = await runner.executeWithVerifyAndRepair({
    taskPrompt: 'Impossible task',
    verifier: {
      fn: async () => ({ passed: false, output: 'Always failing assertion' }),
    },
    options: {
      mockHandler: async () => ({ ok: true, output: 'Attempt' }),
    },
  });

  assert.equal(exhaustedRun.ok, false);
  assert.equal(exhaustedRun.attempts, 3);
  assert.ok(exhaustedRun.error.includes('Verification failed after 3 repair attempts'));
});
