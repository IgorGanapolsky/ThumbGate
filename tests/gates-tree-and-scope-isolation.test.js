'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  resolveRepoRoot,
  effectiveCommandCwd,
  loadGovernanceState,
  saveGovernanceState,
  setTaskScope,
  getScopeState,
  evaluateGates,
} = require('../scripts/gates-engine.js');
const { evaluateFinancialControl, detectEconomicAction } = require('../scripts/financial-control-plane.js');
const { evaluateWorkflowSentinel } = require('../scripts/workflow-sentinel.js');

function createTempGitRepo(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test Agent'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@thumbgate.test'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

test('Issue #3522: effectiveCommandCwd and resolveRepoRoot resolve git -C correctly', () => {
  const repoA = createTempGitRepo('repo-a-');
  const repoB = createTempGitRepo('repo-b-');

  // Command targeting repoB from repoA cwd
  const command = `git -C "${repoB}" commit -m "update in repoB"`;
  const resolvedCwd = effectiveCommandCwd(command, { cwd: repoA });
  assert.equal(fs.realpathSync(resolvedCwd), fs.realpathSync(repoB));

  const resolvedRoot = resolveRepoRoot({ command, cwd: repoA });
  assert.equal(fs.realpathSync(resolvedRoot), fs.realpathSync(repoB));
});

test('Issue #3522: workflow-sentinel resolves target worktree for git -C commits', () => {
  const repoA = createTempGitRepo('repo-dirty-');
  const repoB = createTempGitRepo('repo-clean-');

  // Create dirty untracked and staged files in repoA
  fs.writeFileSync(path.join(repoA, 'dirty-1.txt'), 'dirty 1');
  fs.writeFileSync(path.join(repoA, 'dirty-2.txt'), 'dirty 2');

  // Create clean staged file in repoB
  fs.writeFileSync(path.join(repoB, 'handoff.md'), '# Handoff');
  execFileSync('git', ['add', 'handoff.md'], { cwd: repoB, stdio: 'ignore' });

  // Evaluate commit on repoB
  const sentinel = evaluateWorkflowSentinel('Bash', {
    command: `git -C "${repoB}" commit -m "add handoff"`,
    cwd: repoA,
  });

  // Blast radius should only see the single staged file in repoB, not repoA's dirty files
  assert.equal(sentinel.blastRadius.fileCount, 1);
  assert.deepEqual(sentinel.blastRadius.affectedFiles, ['handoff.md']);
});

test('Issue #3522: session-scoped task-scope state isolates sibling agent sessions', () => {
  const session1 = 'session-agent-alpha';
  const session2 = 'session-agent-beta';

  // Session 1 sets a task scope for its own work
  const scope1 = setTaskScope({
    sessionId: session1,
    taskId: 'task-alpha-123',
    summary: 'Work on alpha feature',
    allowedPaths: ['src/alpha/**', 'tests/alpha/**'],
  });

  assert.equal(scope1.taskId, 'task-alpha-123');

  // Session 2 sets a task scope for a different worktree
  const scope2 = setTaskScope({
    sessionId: session2,
    taskId: 'task-beta-456',
    summary: 'Work on beta feature',
    allowedPaths: ['docs/beta/**'],
  });

  assert.equal(scope2.taskId, 'task-beta-456');

  // Verify Session 1's scope was not clobbered
  const state1 = getScopeState({ sessionId: session1 });
  assert.equal(state1.taskScope.taskId, 'task-alpha-123');
  assert.deepEqual(state1.taskScope.allowedPaths, ['src/alpha/**', 'tests/alpha/**']);

  // Verify Session 2's scope is distinct
  const state2 = getScopeState({ sessionId: session2 });
  assert.equal(state2.taskScope.taskId, 'task-beta-456');
  assert.deepEqual(state2.taskScope.allowedPaths, ['docs/beta/**']);

  // Clearing session 1 does not clear session 2
  setTaskScope({ sessionId: session1, clear: true });
  const cleared1 = getScopeState({ sessionId: session1 });
  assert.equal(cleared1.taskScope, null);

  const retained2 = getScopeState({ sessionId: session2 });
  assert.equal(retained2.taskScope.taskId, 'task-beta-456');
});

test('Issue #3523: remedy tools with keywords (checkout, chmod, grant) in prose are never blocked', () => {
  // satisfy_gate with "checkout" in evidence prose
  const satisfyResult = evaluateFinancialControl({
    toolName: 'satisfy_gate',
    toolInput: {
      gate: 'pr_threads_checked',
      evidence: 'Fixed git checkout and verified clean working copy',
    },
  });
  assert.equal(satisfyResult.mode, 'allow');

  // capture_feedback describing a false positive
  const feedbackResult = evaluateFinancialControl({
    toolName: 'capture_feedback',
    toolInput: {
      type: 'issue',
      feedback: 'The permission gate blocked chmod on an executable script fixture',
    },
  });
  assert.equal(feedbackResult.mode, 'allow');

  // record_task_outcome with checkout references
  const outcomeResult = evaluateFinancialControl({
    toolName: 'record_task_outcome',
    toolInput: {
      taskId: 'task-1',
      summary: 'Automated test verified checkout session creation and refund flow',
    },
  });
  assert.equal(outcomeResult.mode, 'allow');
});

test('Issue #3523: gh issue create and git commit prose do not trigger false economic blocks', () => {
  const issueCommand = 'gh issue create --title "Commerce bug" --body "Checkout button failed when user clicked purchase"';
  const isEconomic = detectEconomicAction('Bash', { command: issueCommand });
  assert.equal(isEconomic, false);

  const commitCommand = 'git commit -m "fix(billing): resolve checkout button click handler"';
  const isCommitEconomic = detectEconomicAction('Bash', { command: commitCommand });
  assert.equal(isCommitEconomic, false);
});
