'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  HARNESS_CLAUDE_CODE,
  HARNESS_ANTIGRAVITY,
  HARNESS_STRANDS,
  HARNESS_OPENHANDS,
  normalizeToCanonicalAction,
  evaluateCrossHarnessInvariants,
  calculateTransferScorecard
} = require('../scripts/multi-harness-invariants');

describe('Multi-Harness Invariants & Transfer Evaluation', () => {
  test('normalizes Antigravity run_command to canonical shell exec', () => {
    const canonical = normalizeToCanonicalAction(
      HARNESS_ANTIGRAVITY,
      'run_command',
      { CommandLine: 'npm test', Cwd: '/workspace' }
    );
    assert.equal(canonical.domain, 'shell');
    assert.equal(canonical.operation, 'exec');
    assert.equal(canonical.target, 'npm test');
  });

  test('normalizes Claude Code Bash to canonical shell exec', () => {
    const canonical = normalizeToCanonicalAction(
      HARNESS_CLAUDE_CODE,
      'Bash',
      { command: 'git status' }
    );
    assert.equal(canonical.domain, 'shell');
    assert.equal(canonical.operation, 'exec');
    assert.equal(canonical.target, 'git status');
  });

  test('normalizes Strands shell and fs_write', () => {
    const shellAction = normalizeToCanonicalAction(
      HARNESS_STRANDS,
      'shell',
      { cmd: 'python3 -m unittest' }
    );
    assert.equal(shellAction.domain, 'shell');
    assert.equal(shellAction.operation, 'exec');

    const writeAction = normalizeToCanonicalAction(
      HARNESS_STRANDS,
      'fs_write',
      { path: 'test.py', data: 'print(1)' }
    );
    assert.equal(writeAction.domain, 'filesystem');
    assert.equal(writeAction.operation, 'write');
    assert.equal(writeAction.target, 'test.py');
  });

  test('normalizes OpenHands execute_bash and file_editor', () => {
    const openhandsAction = normalizeToCanonicalAction(
      HARNESS_OPENHANDS,
      'file_editor',
      { command: 'view', path: 'src/main.rs' }
    );
    assert.equal(openhandsAction.domain, 'filesystem');
    assert.equal(openhandsAction.operation, 'read');
    assert.equal(openhandsAction.target, 'src/main.rs');
  });

  test('catches security policy violations and path traversals', () => {
    const badShell = {
      domain: 'shell',
      operation: 'exec',
      target: 'git push --force origin main'
    };
    const evalShell = evaluateCrossHarnessInvariants(badShell);
    assert.equal(evalShell.valid, false);
    assert.equal(evalShell.issues[0].rule, 'INVARIANT_SECURITY_POLICY_VIOLATION');

    const badFs = {
      domain: 'filesystem',
      operation: 'read',
      target: '../../../etc/passwd'
    };
    const evalFs = evaluateCrossHarnessInvariants(badFs);
    assert.equal(evalFs.valid, false);
    assert.equal(evalFs.issues[0].rule, 'INVARIANT_PATH_TRAVERSAL');
  });

  test('calculates cross-harness transfer scorecard with diversity bonus', () => {
    const trajectory = [
      { harness: 'antigravity', toolName: 'run_command', args: { CommandLine: 'npm test' } },
      { harness: 'claude_code', toolName: 'Bash', args: { command: 'git status' } },
      { harness: 'strands', toolName: 'shell', args: { cmd: 'ls -la' } },
      { harness: 'openhands', toolName: 'execute_bash', args: { cmd: 'echo 1' } }
    ];

    const scorecard = calculateTransferScorecard(trajectory);
    assert.equal(scorecard.totalActions, 4);
    assert.equal(scorecard.formatSuccessRate, 1.0);
    assert.equal(scorecard.invariantPassRate, 1.0);
    assert.equal(scorecard.harnessesObserved.length, 4);
    assert.ok(scorecard.transferReward >= 0.95);
  });
});
