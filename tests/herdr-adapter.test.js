'use strict';

/**
 * Unit test suite for ThumbGate Approvals Adapter for Herdr.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { handleHerdrEvent } = require('../adapters/herdr/herdr-approvals-adapter');

test('handleHerdrEvent allows safe tool calls', () => {
  const event = {
    paneId: 'pane-1',
    agentIdentity: 'claude-code',
    toolName: 'Bash',
    toolInput: { command: 'git status' },
  };

  const res = handleHerdrEvent(event);
  assert.equal(res.decision, 'allow');
  assert.equal(res.hookSpecificOutput.permissionDecision, 'allow');
});

test('handleHerdrEvent denies unauthorized spend mutation commands in Herdr panes', () => {
  const event = {
    paneId: 'pane-2',
    agentIdentity: 'codex',
    toolName: 'Bash',
    toolInput: { command: 'open https://checkout.stripe.com/c/pay/cs_test_abc' },
  };

  const res = handleHerdrEvent(event);
  assert.equal(res.decision, 'deny');
  assert.ok(res.ruleId, 'ruleId must be present for hard denial');
  assert.ok(res.reason.includes('ThumbGate HARD BLOCK'));
});
