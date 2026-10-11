'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  decide,
  DECISION_ALLOW,
  DECISION_REVIEW,
  DECISION_BLOCK,
  DECISION_ESCALATE
} = require('../adapters/strands/strands-decider-adapter');

test('strands-decider: read-only tools allow instantly under 25ms budget', () => {
  const res = decide({ toolName: 'view_file', args: { AbsolutePath: '/tmp/test.txt' } });
  assert.equal(res.decision, DECISION_ALLOW);
  assert.equal(res.reason, 'SAFE_READ_ONLY_TOOL');
  assert.equal(res.budgetCompliant, true);
  assert.ok(res.latencyMs < 25.0);
});

test('strands-decider: critical interdiction blocks force push to main', () => {
  const res = decide({
    toolName: 'run_command',
    args: { CommandLine: 'git push --force origin main' }
  });
  assert.equal(res.decision, DECISION_BLOCK);
  assert.equal(res.reason, 'CRITICAL_SECURITY_INTERDICTION');
  assert.equal(res.budgetCompliant, true);
});

test('strands-decider: branch protection bypass is strictly blocked', () => {
  const res = decide({
    toolName: 'run_command',
    args: { CommandLine: 'gh pr merge 123 --admin' }
  });
  assert.equal(res.decision, DECISION_BLOCK);
});

test('strands-decider: destructive clean triggers review', () => {
  const res = decide({
    toolName: 'run_command',
    args: { CommandLine: 'git clean -fd' }
  });
  assert.equal(res.decision, DECISION_REVIEW);
  assert.equal(res.reason, 'HIGH_RISK_MUTATING_ACTION');
});

test('strands-decider: sensitive governance file edit triggers escalation', () => {
  const res = decide({
    toolName: 'replace_file_content',
    args: { TargetFile: '/Users/iganapolsky/workspace/ThumbGate/config/main-branch-ruleset.json' }
  });
  assert.equal(res.decision, DECISION_ESCALATE);
  assert.equal(res.reason, 'GOVERNANCE_CONFIG_PROTECTED');
});

test('strands-decider: standard safe command is allowed within budget', () => {
  const res = decide({
    toolName: 'run_command',
    args: { CommandLine: 'npm test' }
  });
  assert.equal(res.decision, DECISION_ALLOW);
  assert.equal(res.budgetCompliant, true);
});
