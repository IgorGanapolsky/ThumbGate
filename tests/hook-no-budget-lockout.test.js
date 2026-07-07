#!/usr/bin/env node
'use strict';

// Regression test for the 2026-07-07 self-lockout incident.
//
// A stale ~/.thumbgate/budget-state.json (session_start 25 days old) made the
// PreToolUse hook deny EVERY Bash/Edit/Write call in every new session —
// including the edits needed to repair the gate itself. Budget gates were
// removed from the hook path as a result: the hook must NEVER emit a budget
// block, no matter how poisoned the budget state is.
//
// This test spawns the real hook binary with worst-case budget state (action
// count and session age both far over their limits, enforcement env flag ON)
// and asserts the hook does not block the tool call.

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK_PATH = path.join(__dirname, '..', 'scripts', 'hook-pre-tool-use.js');
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-lockout-'));

after(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

function runHook(toolName, toolInput, extraEnv = {}) {
  const statePath = path.join(TEST_DIR, `budget-state-${toolName}.json`);
  // Worst case: both session budget limits blown by orders of magnitude.
  fs.writeFileSync(statePath, JSON.stringify({
    action_count: 999999,
    session_start: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(),
  }));

  const result = spawnSync(process.execPath, [HOOK_PATH], {
    input: JSON.stringify({
      session_id: 'lockout-regression-test',
      tool_name: toolName,
      tool_input: toolInput,
      hook_event_name: 'PreToolUse',
      cwd: TEST_DIR,
    }),
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      THUMBGATE_BUDGET_STATE_PATH: statePath,
      THUMBGATE_FEEDBACK_DIR: path.join(TEST_DIR, 'feedback'),
      // Even with every budget knob forced into "enforce + tiny limits",
      // the hook path must not consult budget gates at all.
      THUMBGATE_BUDGET_ENFORCE: '1',
      THUMBGATE_MAX_ACTIONS: '1',
      THUMBGATE_MAX_TIME_MINUTES: '1',
      THUMBGATE_MONTHLY_BUDGET_USD: '0.000001',
      ...extraEnv,
    },
  });

  assert.equal(result.status, 0, `hook exited non-zero: ${result.stderr}`);
  const stdout = (result.stdout || '').trim();
  if (!stdout) return {};
  return JSON.parse(stdout);
}

describe('hook never budget-blocks (self-lockout regression)', () => {
  for (const [toolName, toolInput] of [
    ['Bash', { command: 'ls -la' }],
    ['Edit', { file_path: '/tmp/x.js', old_string: 'a', new_string: 'b' }],
    ['Write', { file_path: '/tmp/x.js', content: 'x' }],
  ]) {
    it(`${toolName} is not blocked by poisoned budget state`, () => {
      const output = runHook(toolName, toolInput);
      assert.notEqual(output.decision, 'block',
        `hook budget-blocked ${toolName}: ${JSON.stringify(output)}`);
      const denyReason = output.hookSpecificOutput?.permissionDecision;
      assert.notEqual(denyReason, 'deny',
        `hook denied ${toolName}: ${JSON.stringify(output)}`);
      assert.ok(!/budget/i.test(String(output.reason || '')),
        `hook emitted a budget reason for ${toolName}: ${output.reason}`);
    });
  }
});
