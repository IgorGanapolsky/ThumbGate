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

  test('normalizes Antigravity filesystem and network operations', () => {
    const viewAction = normalizeToCanonicalAction(HARNESS_ANTIGRAVITY, 'view_file', {
      AbsolutePath: '/workspace/src/app.js',
      StartLine: 1,
      EndLine: 50
    });
    assert.equal(viewAction.domain, 'filesystem');
    assert.equal(viewAction.operation, 'read');
    assert.equal(viewAction.target, '/workspace/src/app.js');

    const writeAction = normalizeToCanonicalAction(HARNESS_ANTIGRAVITY, 'write_to_file', {
      TargetFile: '/workspace/src/app.js',
      CodeContent: 'console.log(1)'
    });
    assert.equal(writeAction.domain, 'filesystem');
    assert.equal(writeAction.operation, 'write');
    assert.equal(writeAction.target, '/workspace/src/app.js');

    const replaceAction = normalizeToCanonicalAction(HARNESS_ANTIGRAVITY, 'replace_file_content', {
      TargetFile: '/workspace/src/app.js',
      ReplacementContent: 'console.log(2)'
    });
    assert.equal(replaceAction.domain, 'filesystem');
    assert.equal(replaceAction.operation, 'write');

    const urlAction = normalizeToCanonicalAction(HARNESS_ANTIGRAVITY, 'read_url_content', {
      Url: 'https://docs.anthropic.com'
    });
    assert.equal(urlAction.domain, 'network');
    assert.equal(urlAction.operation, 'read');
    assert.equal(urlAction.target, 'https://docs.anthropic.com');
  });

  test('normalizes Claude Code View, Read, Edit, and Write operations', () => {
    const viewAction = normalizeToCanonicalAction(HARNESS_CLAUDE_CODE, 'View', {
      path: '/workspace/index.js'
    });
    assert.equal(viewAction.domain, 'filesystem');
    assert.equal(viewAction.operation, 'read');

    const editAction = normalizeToCanonicalAction(HARNESS_CLAUDE_CODE, 'Edit', {
      file_path: '/workspace/index.js',
      content: 'module.exports = {};'
    });
    assert.equal(editAction.domain, 'filesystem');
    assert.equal(editAction.operation, 'write');
  });

  test('normalizes Strands fs_read and OpenHands file write operations', () => {
    const strandsRead = normalizeToCanonicalAction(HARNESS_STRANDS, 'fs_read', {
      path: '/workspace/package.json'
    });
    assert.equal(strandsRead.domain, 'filesystem');
    assert.equal(strandsRead.operation, 'read');
    assert.equal(strandsRead.target, '/workspace/package.json');

    const openhandsWrite = normalizeToCanonicalAction(HARNESS_OPENHANDS, 'file_editor', {
      command: 'edit',
      path: '/workspace/src/lib.rs',
      file_text: 'fn main() {}'
    });
    assert.equal(openhandsWrite.domain, 'filesystem');
    assert.equal(openhandsWrite.operation, 'write');
  });

  test('handles unknown harness or tool with generic fallback', () => {
    const generic = normalizeToCanonicalAction('custom_harness', 'unknown_tool', { foo: 'bar' });
    assert.equal(generic.domain, 'generic');
    assert.equal(generic.operation, 'call');
  });

  test('detects empty target and admin merge invariant violations', () => {
    const emptyTarget = evaluateCrossHarnessInvariants({
      domain: 'shell',
      operation: 'exec',
      target: ''
    });
    assert.equal(emptyTarget.valid, false);
    assert.equal(emptyTarget.issues[0].rule, 'INVARIANT_EMPTY_TARGET');

    const adminMerge = evaluateCrossHarnessInvariants({
      domain: 'shell',
      operation: 'exec',
      target: 'gh pr merge 123 --admin'
    });
    assert.equal(adminMerge.valid, false);
    assert.equal(adminMerge.issues[0].rule, 'INVARIANT_SECURITY_POLICY_VIOLATION');

    const rootEscape = evaluateCrossHarnessInvariants({
      domain: 'filesystem',
      operation: 'read',
      target: '/etc/shadow'
    });
    assert.equal(rootEscape.valid, false);
    assert.equal(rootEscape.issues[0].rule, 'INVARIANT_PATH_TRAVERSAL');
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

  test('scorecard handles empty or single harness trajectories gracefully', () => {
    const emptyScorecard = calculateTransferScorecard([]);
    assert.equal(emptyScorecard.totalActions, 0);
    assert.equal(emptyScorecard.transferReward, 1.0);

    const singleHarness = calculateTransferScorecard([
      { harness: 'strands', toolName: 'shell', args: { cmd: 'ls' } }
    ]);
    assert.equal(singleHarness.totalActions, 1);
    assert.equal(singleHarness.harnessesObserved.length, 1);
    assert.ok(singleHarness.transferReward > 0);
  });
});

