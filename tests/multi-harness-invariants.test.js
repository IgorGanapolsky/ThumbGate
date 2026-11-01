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
  calculateTransferScorecard,
  evaluateOpenHandsFactoryStep,
  interpretOpenHandsHookResult
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

  test('allows the four factory roles and one exact-head watchdog merge', () => {
    for (const role of ['triage', 'developer', 'reviewer']) {
      const verdict = evaluateOpenHandsFactoryStep({ role, outboundSpendUsd: 0 });
      assert.equal(verdict.allowed, true, role);
      assert.equal(verdict.measuredOnTheirDemo, false);
    }

    const developerWrite = evaluateOpenHandsFactoryStep({
      role: 'developer',
      permissions: ['contents:write']
    });
    assert.equal(developerWrite.allowed, true);

    const reviewerRead = evaluateOpenHandsFactoryStep({
      role: 'reviewer',
      permissions: { 'contents:read': true, 'pull_requests:write': true }
    });
    assert.equal(reviewerRead.allowed, true);

    const merge = evaluateOpenHandsFactoryStep({
      role: 'watchdog',
      canMerge: true,
      actorId: 'review-bot',
      authorId: 'dev-bot',
      reviewedSha: 'abc123',
      headSha: 'abc123',
      testsPassed: true,
      reviewPassed: true,
      startsAgent: false,
      outboundSpendUsd: 0
    });
    assert.equal(merge.allowed, true);
    assert.equal(merge.role, 'watchdog');
    assert.equal(Object.hasOwn(merge, 'demoMergeCount'), false);
  });

  test('refuses a reviewer push, a developer merge, and a watchdog that starts work', () => {
    const reviewerPush = evaluateOpenHandsFactoryStep({ role: 'reviewer', canPush: true });
    assert.equal(reviewerPush.allowed, false);
    assert.equal(reviewerPush.issues[0].rule, 'OPENHANDS_REVIEWER_CANNOT_PUSH');

    const reviewerWrite = evaluateOpenHandsFactoryStep({
      role: 'reviewer',
      permissions: ['contents:write']
    });
    assert.equal(reviewerWrite.allowed, false);
    assert.ok(reviewerWrite.issues.some((issue) => issue.rule === 'OPENHANDS_REVIEWER_CANNOT_PUSH'));

    const developerMerge = evaluateOpenHandsFactoryStep({ role: 'developer', canMerge: true });
    assert.equal(developerMerge.allowed, false);
    assert.equal(developerMerge.issues[0].rule, 'OPENHANDS_DEVELOPER_CANNOT_MERGE');

    const startsAgent = evaluateOpenHandsFactoryStep({ role: 'watchdog', startsAgent: true });
    assert.equal(startsAgent.allowed, false);
    assert.equal(startsAgent.issues[0].rule, 'OPENHANDS_WATCHDOG_STARTS_NO_AGENT');

    const unknown = evaluateOpenHandsFactoryStep({ role: 'owner' });
    assert.equal(unknown.allowed, false);
    assert.equal(unknown.role, null);
    assert.equal(unknown.issues[0].rule, 'OPENHANDS_UNKNOWN_ROLE');

    const spend = evaluateOpenHandsFactoryStep({ role: 'triage', outboundSpendUsd: 1 });
    assert.equal(spend.allowed, false);
    assert.ok(spend.issues.some((issue) => issue.rule === 'OPENHANDS_OUTBOUND_SPEND'));
  });

  test('refuses a watchdog merge unless the actor, head, tests, and review all match', () => {
    const sameActor = evaluateOpenHandsFactoryStep({
      role: 'watchdog',
      action: 'merge',
      actorId: 'dev-bot',
      authorId: 'dev-bot',
      reviewedSha: 'abc123',
      headSha: 'abc123',
      testsPassed: true,
      reviewPassed: true
    });
    assert.equal(sameActor.allowed, false);
    assert.ok(sameActor.issues.some((issue) => issue.rule === 'OPENHANDS_WATCHDOG_MERGE_REFUSED'));

    const movedHead = evaluateOpenHandsFactoryStep({
      role: 'watchdog',
      canMerge: true,
      actorId: 'review-bot',
      authorId: 'dev-bot',
      reviewedSha: 'abc123',
      headSha: 'def456',
      testsPassed: true,
      reviewPassed: true
    });
    assert.equal(movedHead.allowed, false);

    const testsFailed = evaluateOpenHandsFactoryStep({
      role: 'watchdog',
      merging: true,
      actorId: 'review-bot',
      authorId: 'dev-bot',
      reviewedSha: 'abc123',
      headSha: 'abc123',
      testsPassed: false,
      reviewPassed: true
    });
    assert.equal(testsFailed.allowed, false);

    const reusedToken = evaluateOpenHandsFactoryStep({
      role: 'watchdog',
      canMerge: true,
      actorId: 'review-bot',
      authorId: 'dev-bot',
      reviewedSha: 'abc123',
      headSha: 'abc123',
      testsPassed: true,
      reviewPassed: true,
      tokenId: 'dev-token',
      developerTokenId: 'dev-token'
    });
    assert.equal(reusedToken.allowed, false);
    assert.ok(reusedToken.issues.some((issue) => issue.rule === 'OPENHANDS_WATCHDOG_REUSES_AUTHOR_TOKEN'));

    const vendorDemo = evaluateOpenHandsFactoryStep({ role: 'watchdog', demoMergeCount: 6 });
    assert.equal(vendorDemo.allowed, false);
    assert.equal(vendorDemo.measuredOnTheirDemo, false);
    assert.equal(JSON.stringify(vendorDemo).includes('6'), false);
    assert.ok(vendorDemo.issues.some((issue) => issue.rule === 'OPENHANDS_VENDOR_DEMO_NOT_MEASUREMENT'));
  });

  test('applies factory rules only when the caller passes a factory constraint', () => {
    const command = { domain: 'shell', operation: 'exec', target: 'gh pr merge 1' };
    const plain = evaluateCrossHarnessInvariants(command);
    assert.equal(plain.valid, true);

    const developer = evaluateCrossHarnessInvariants(command, {
      factoryRole: 'developer',
      canMerge: true
    });
    assert.equal(developer.valid, false);
    assert.ok(developer.issues.some((issue) => issue.rule === 'OPENHANDS_DEVELOPER_CANNOT_MERGE'));

    const watchdog = evaluateCrossHarnessInvariants(command, {
      factoryRole: 'watchdog',
      canMerge: true,
      actorId: 'review-bot',
      authorId: 'dev-bot',
      reviewedSha: 'abc123',
      headSha: 'abc123',
      testsPassed: true,
      reviewPassed: true
    });
    assert.equal(watchdog.valid, true);
  });

  test('blocks a hook only when that event can block and the hook is not async', () => {
    const exitBlock = interpretOpenHandsHookResult({ event: 'PreToolUse', exitCode: 2 });
    assert.equal(exitBlock.event, 'pre_tool_use');
    assert.equal(exitBlock.blocked, true);
    assert.equal(exitBlock.reasons[0], 'exit_2');

    const decisionDeny = interpretOpenHandsHookResult({ event: 'pre_tool_use', exitCode: 0, decision: 'deny' });
    assert.equal(decisionDeny.blocked, true);
    assert.equal(decisionDeny.reasons[0], 'decision_deny');

    const decisionAllow = interpretOpenHandsHookResult({ event: 'pre_tool_use', exitCode: 2, decision: 'allow' });
    assert.equal(decisionAllow.blocked, false);
    assert.equal(decisionAllow.proceeds, true);

    const otherExit = interpretOpenHandsHookResult({ event: 'UserPromptSubmit', exitCode: 1 });
    assert.equal(otherExit.blocked, false);

    const promptBlock = interpretOpenHandsHookResult({ event: 'user_prompt_submit', exit_code: 2 });
    assert.equal(promptBlock.blocked, true);

    const asyncDeny = interpretOpenHandsHookResult({ event: 'PreToolUse', async: true, exitCode: 2, decision: 'deny' });
    assert.equal(asyncDeny.blocked, false);
    assert.equal(asyncDeny.canBlock, false);
    assert.equal(asyncDeny.reasons[0], 'async_hook_cannot_block');

    for (const event of ['PostToolUse', 'post_tool_use', 'SessionStart', 'session_end']) {
      const ignored = interpretOpenHandsHookResult({ event, exitCode: 2, decision: 'deny' });
      assert.equal(ignored.blocked, false, event);
      assert.equal(ignored.reasons[0], 'event_cannot_block');
    }

    const stopEarly = interpretOpenHandsHookResult({ event: 'Stop', exitCode: 0, checksPassed: false, decision: 'allow' });
    assert.equal(stopEarly.blocked, true);
    assert.equal(stopEarly.reasons[0], 'stop_without_checks_passed');

    const stopSnake = interpretOpenHandsHookResult({ event: 'stop', exitCode: 0, checks_passed: false });
    assert.equal(stopSnake.blocked, true);

    const stopDone = interpretOpenHandsHookResult({ event: 'Stop', exitCode: 0, checksPassed: true });
    assert.equal(stopDone.blocked, false);
    assert.equal(stopDone.proceeds, true);

    const stopDeny = interpretOpenHandsHookResult({ event: 'Stop', exitCode: 0, checksPassed: true, decision: 'deny' });
    assert.equal(stopDeny.blocked, true);
    assert.equal(stopDeny.reasons[0], 'decision_deny');
  });
});

