'use strict';

process.env.THUMBGATE_PRO_MODE = '1';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const gatesEngine = require('../scripts/gates-engine');
const {
  loadGatesConfig,
  matchesGate,
  evaluateGates,
  evaluateGatesAsync,
  buildReasoning,
  formatOutput,
  run,
  runAsync,
  satisfyCondition,
  isConditionSatisfied,
  loadStats,
  saveStats,
  recordStat,
  loadState,
  saveState,
  computeExecutableHash,
  evaluateSecretGuard,
  buildSecretGuardResult,
  setConstraint,
  loadConstraints,
  saveConstraints,
  loadGovernanceState,
  saveGovernanceState,
  setTaskScope,
  setBranchGovernance,
  approveProtectedAction,
  getScopeState,
  getBranchGovernanceState,
  trackAction,
  hasAction,
  listSessionActions,
  clearSessionActions,
  loadClaimGates,
  registerClaimGate,
  verifyClaimEvidence,
  evaluateBoostedRiskTagGuard,
  evaluatePendingPrThreadResolutionGate,
  PR_THREAD_RESOLUTION_ACTION,
  TTL_MS,
  SESSION_ACTION_TTL_MS,
  PROTECTED_APPROVAL_TTL_MS,
} = gatesEngine;
const { getAutoGatesPath } = require('../scripts/auto-promote-gates');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORIGINAL_PATHS = {
  STATE_PATH: gatesEngine.STATE_PATH,
  STATS_PATH: gatesEngine.STATS_PATH,
  CONSTRAINTS_PATH: gatesEngine.CONSTRAINTS_PATH,
  SESSION_ACTIONS_PATH: gatesEngine.SESSION_ACTIONS_PATH,
  CUSTOM_CLAIM_GATES_PATH: gatesEngine.CUSTOM_CLAIM_GATES_PATH,
  GOVERNANCE_STATE_PATH: gatesEngine.GOVERNANCE_STATE_PATH,
  DEFAULT_CLAIM_GATES_PATH: gatesEngine.DEFAULT_CLAIM_GATES_PATH,
};
const ORIGINAL_ENV = {
  THUMBGATE_FEEDBACK_DIR: process.env.THUMBGATE_FEEDBACK_DIR,
  THUMBGATE_FEEDBACK_LOG: process.env.THUMBGATE_FEEDBACK_LOG,
  THUMBGATE_ATTRIBUTED_FEEDBACK: process.env.THUMBGATE_ATTRIBUTED_FEEDBACK,
  THUMBGATE_GUARDS_PATH: process.env.THUMBGATE_GUARDS_PATH,
};

let sandboxDir = null;

function sandboxPath(name) {
  return path.join(sandboxDir, name);
}

function cleanupStateFiles() {
  fs.rmSync(gatesEngine.STATE_PATH, { force: true });
  fs.rmSync(gatesEngine.STATS_PATH, { force: true });
  fs.rmSync(gatesEngine.CONSTRAINTS_PATH, { force: true });
  fs.rmSync(gatesEngine.SESSION_ACTIONS_PATH, { force: true });
  fs.rmSync(gatesEngine.CUSTOM_CLAIM_GATES_PATH, { force: true });
  fs.rmSync(gatesEngine.GOVERNANCE_STATE_PATH, { force: true });
}

function makeTempPath(name) {
  return path.join(sandboxDir, name);
}

function createPushTestRepo(changedFile = 'src/app.js') {
  const repoDir = fs.mkdtempSync(path.join(sandboxDir, 'repo-'));
  execFileSync('git', ['init'], { cwd: repoDir, stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['config', 'user.name', 'ThumbGate Tests'], { cwd: repoDir, stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['config', 'user.email', 'thumbgate-tests@example.com'], { cwd: repoDir, stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repoDir, stdio: ['ignore', 'pipe', 'pipe'] });
  const filePath = path.join(repoDir, changedFile);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'module.exports = 1;\n');
  execFileSync('git', ['add', '.'], { cwd: repoDir, stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: repoDir, stdio: ['ignore', 'pipe', 'pipe'] });
  fs.writeFileSync(filePath, 'module.exports = 2;\n');
  return repoDir;
}

function withTempFeedbackDir(fn) {
  const originalFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
  const originalProvider = process.env.THUMBGATE_SECRET_SCAN_PROVIDER;
  const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-gates-secret-'));
  process.env.THUMBGATE_FEEDBACK_DIR = tmpFeedbackDir;
  process.env.THUMBGATE_SECRET_SCAN_PROVIDER = 'heuristic';
  try {
    return fn(tmpFeedbackDir);
  } finally {
    if (originalFeedbackDir === undefined) {
      delete process.env.THUMBGATE_FEEDBACK_DIR;
    } else {
      process.env.THUMBGATE_FEEDBACK_DIR = originalFeedbackDir;
    }
    if (originalProvider === undefined) {
      delete process.env.THUMBGATE_SECRET_SCAN_PROVIDER;
    } else {
      process.env.THUMBGATE_SECRET_SCAN_PROVIDER = originalProvider;
    }
    fs.rmSync(tmpFeedbackDir, { recursive: true, force: true });
  }
}

function buildStripeKey() {
  return ['sk', '_live_', '1234567890abcdefghijklmnopqrstuvwxyz'].join('');
}

function buildGitHubPat() {
  return ['gh', 'p_', 'abcdefghijklmnopqrstuvwxyz1234'].join('');
}

beforeEach(() => {
  sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-gates-test-'));
  gatesEngine.STATE_PATH = sandboxPath('gate-state.json');
  gatesEngine.STATS_PATH = sandboxPath('gate-stats.json');
  gatesEngine.CONSTRAINTS_PATH = sandboxPath('session-constraints.json');
  gatesEngine.SESSION_ACTIONS_PATH = sandboxPath('session-actions.json');
  gatesEngine.CUSTOM_CLAIM_GATES_PATH = sandboxPath('claim-verification.json');
  gatesEngine.GOVERNANCE_STATE_PATH = sandboxPath('governance-state.json');
  gatesEngine.DEFAULT_CLAIM_GATES_PATH = ORIGINAL_PATHS.DEFAULT_CLAIM_GATES_PATH;
  process.env.THUMBGATE_FEEDBACK_DIR = sandboxPath('feedback-runtime');
  process.env.THUMBGATE_FEEDBACK_LOG = sandboxPath('feedback-log.jsonl');
  process.env.THUMBGATE_ATTRIBUTED_FEEDBACK = sandboxPath('attributed-feedback.jsonl');
  process.env.THUMBGATE_GUARDS_PATH = sandboxPath('pretool-guards.json');
  fs.writeFileSync(process.env.THUMBGATE_FEEDBACK_LOG, '');
  fs.writeFileSync(process.env.THUMBGATE_ATTRIBUTED_FEEDBACK, '');
  cleanupStateFiles();
});

afterEach(() => {
  cleanupStateFiles();
  gatesEngine.STATE_PATH = ORIGINAL_PATHS.STATE_PATH;
  gatesEngine.STATS_PATH = ORIGINAL_PATHS.STATS_PATH;
  gatesEngine.CONSTRAINTS_PATH = ORIGINAL_PATHS.CONSTRAINTS_PATH;
  gatesEngine.SESSION_ACTIONS_PATH = ORIGINAL_PATHS.SESSION_ACTIONS_PATH;
  gatesEngine.CUSTOM_CLAIM_GATES_PATH = ORIGINAL_PATHS.CUSTOM_CLAIM_GATES_PATH;
  gatesEngine.GOVERNANCE_STATE_PATH = ORIGINAL_PATHS.GOVERNANCE_STATE_PATH;
  gatesEngine.DEFAULT_CLAIM_GATES_PATH = ORIGINAL_PATHS.DEFAULT_CLAIM_GATES_PATH;
  if (ORIGINAL_ENV.THUMBGATE_FEEDBACK_DIR === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
  else process.env.THUMBGATE_FEEDBACK_DIR = ORIGINAL_ENV.THUMBGATE_FEEDBACK_DIR;
  if (ORIGINAL_ENV.THUMBGATE_FEEDBACK_LOG === undefined) delete process.env.THUMBGATE_FEEDBACK_LOG;
  else process.env.THUMBGATE_FEEDBACK_LOG = ORIGINAL_ENV.THUMBGATE_FEEDBACK_LOG;
  if (ORIGINAL_ENV.THUMBGATE_ATTRIBUTED_FEEDBACK === undefined) delete process.env.THUMBGATE_ATTRIBUTED_FEEDBACK;
  else process.env.THUMBGATE_ATTRIBUTED_FEEDBACK = ORIGINAL_ENV.THUMBGATE_ATTRIBUTED_FEEDBACK;
  if (ORIGINAL_ENV.THUMBGATE_GUARDS_PATH === undefined) delete process.env.THUMBGATE_GUARDS_PATH;
  else process.env.THUMBGATE_GUARDS_PATH = ORIGINAL_ENV.THUMBGATE_GUARDS_PATH;
  if (sandboxDir) {
    fs.rmSync(sandboxDir, { recursive: true, force: true });
    sandboxDir = null;
  }
});

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

test('loadGatesConfig loads default config', () => {
  const config = loadGatesConfig();
  assert.equal(config.version, 1);
  assert.ok(Array.isArray(config.gates));
  assert.ok(config.gates.length >= 5);
});

test('loadGatesConfig preserves core default gates for free tier', () => {
  const config = loadGatesConfig();
  const gateIds = config.gates.map((gate) => gate.id);
  assert.ok(gateIds.includes('force-push'));
  assert.ok(gateIds.includes('protected-branch-push'));
  assert.ok(gateIds.includes('env-file-edit'));
});

test('loadGatesConfig reads auto-promoted gates from the feedback runtime directory', () => {
  withTempFeedbackDir((tmpFeedbackDir) => {
    fs.writeFileSync(getAutoGatesPath(), JSON.stringify({
      version: 1,
      gates: [{
        id: 'auto-runtime-test',
        pattern: 'echo\\s+runtime',
        action: 'warn',
        message: 'runtime gate',
        severity: 'medium',
      }],
    }));
    const config = loadGatesConfig();
    assert.ok(config.gates.some((gate) => gate.id === 'auto-runtime-test'));
    assert.ok(getAutoGatesPath().startsWith(tmpFeedbackDir));
  });
});

test('loadGatesConfig throws on missing file', () => {
  assert.throws(
    () => loadGatesConfig('/tmp/nonexistent-gates-config.json'),
    /not found/,
  );
});

test('loadGatesConfig throws on invalid JSON', () => {
  const tmpFile = makeTempPath('bad-gates.json');
  fs.writeFileSync(tmpFile, 'not json');
  try {
    assert.throws(
      () => loadGatesConfig(tmpFile),
      /JSON/,
    );
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
});

test('loadGatesConfig throws on missing gates array', () => {
  const tmpFile = makeTempPath('no-gates.json');
  fs.writeFileSync(tmpFile, JSON.stringify({ version: 1 }));
  try {
    assert.throws(
      () => loadGatesConfig(tmpFile),
      /missing "gates" array/,
    );
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
});

// ---------------------------------------------------------------------------
// Pattern matching
// ---------------------------------------------------------------------------

test('matchesGate matches git push command', () => {
  const gate = { pattern: 'git\\s+push' };
  assert.ok(matchesGate(gate, 'Bash', { command: 'git push origin feature/x' }));
});

test('matchesGate does not match unrelated command', () => {
  const gate = { pattern: 'git\\s+push' };
  assert.ok(!matchesGate(gate, 'Bash', { command: 'git status' }));
});

test('matchesGate matches force push', () => {
  const gate = { pattern: 'git\\s+push\\s+(--force|-f)' };
  assert.ok(matchesGate(gate, 'Bash', { command: 'git push --force origin main' }));
  assert.ok(matchesGate(gate, 'Bash', { command: 'git push -f' }));
});

test('matchesGate matches protected branch push', () => {
  const gate = { pattern: 'git\\s+push\\s+(?:\\S+\\s+)?(?:develop|main|master)\\b' };
  assert.ok(matchesGate(gate, 'Bash', { command: 'git push origin develop' }));
  assert.ok(matchesGate(gate, 'Bash', { command: 'git push origin main' }));
  assert.ok(!matchesGate(gate, 'Bash', { command: 'git push origin feature/x' }));
});

test('matchesGate matches package-lock reset', () => {
  const gate = { pattern: 'git\\s+checkout\\s+\\S+\\s+--\\s+package-lock\\.json' };
  assert.ok(matchesGate(gate, 'Bash', { command: 'git checkout develop -- package-lock.json' }));
  assert.ok(!matchesGate(gate, 'Bash', { command: 'git checkout develop' }));
});

test('matchesGate matches .env file edit', () => {
  const gate = { pattern: '\\.env' };
  assert.ok(matchesGate(gate, 'Edit', { file_path: '/home/user/project/.env' }));
  assert.ok(!matchesGate(gate, 'Edit', { file_path: '/home/user/project/src/app.js' }));
});

test('matchesGate handles invalid regex gracefully', () => {
  const gate = { pattern: '[invalid' };
  assert.ok(!matchesGate(gate, 'Bash', { command: 'anything' }));
});

test('matchesGate handles missing tool_input fields', () => {
  const gate = { pattern: 'git\\s+push' };
  assert.ok(!matchesGate(gate, 'Bash', {}));
});

// ---------------------------------------------------------------------------
// Block action
// ---------------------------------------------------------------------------

test('evaluateGates returns deny for git push', () => {
  cleanupStateFiles();
  const repoPath = createPushTestRepo();
  setTaskScope({ summary: 'push feature branch', allowedPaths: ['**'] });
  const result = evaluateGates('Bash', { command: 'git push origin feature/x', repoPath });
  assert.ok(result);
  assert.equal(result.decision, 'deny');
  assert.equal(result.gate, 'push-without-thread-check');
  assert.ok(result.message.includes('review threads'));
});

test('evaluateGates blocks wrapped git push when task scope is local-only', () => {
  cleanupStateFiles();
  const repoPath = createPushTestRepo();
  setTaskScope({ summary: 'fix local Android build', allowedPaths: ['**'], localOnly: true });
  satisfyCondition('pr_threads_checked', '0 unresolved threads');
  const result = evaluateGates('Bash', { command: `cd ${repoPath} && git push origin feature/x`, repoPath });
  assert.ok(result);
  assert.equal(result.decision, 'deny');
  assert.equal(result.gate, 'local-only-remote-side-effect');
  assert.ok(result.message.includes('local-only'));
});

test('evaluateGates blocks gh pr create when task scope is local-only', () => {
  cleanupStateFiles();
  setTaskScope({ summary: 'fix local Android build', allowedPaths: ['**'], localOnly: true });
  const result = evaluateGates('Bash', { command: 'gh pr create --title fix --body body' });
  assert.ok(result);
  assert.equal(result.decision, 'deny');
  assert.equal(result.gate, 'local-only-remote-side-effect');
});

test('evaluateGates blocks remote side effects from local_only constraint alone', () => {
  cleanupStateFiles();
  setConstraint('local_only', true);
  const result = evaluateGates('Bash', { command: 'gh pr merge 42 --merge' });
  assert.ok(result);
  assert.equal(result.decision, 'deny');
  assert.equal(result.gate, 'local-only-remote-side-effect');
});

test('evaluateGates allows local read commands when task scope is local-only', () => {
  cleanupStateFiles();
  setTaskScope({ summary: 'inspect local Android build', allowedPaths: ['**'], localOnly: true });
  const result = evaluateGates('Bash', { command: 'git status --short' });
  assert.equal(result, null);
});

test('evaluateGatesAsync blocks wrapped git push when task scope is local-only', async () => {
  cleanupStateFiles();
  const repoPath = createPushTestRepo();
  setTaskScope({ summary: 'fix local Android build', allowedPaths: ['**'], localOnly: true });
  satisfyCondition('pr_threads_checked', '0 unresolved threads');
  const result = await evaluateGatesAsync('Bash', { command: `npm test && git push origin feature/x`, repoPath });
  assert.ok(result);
  assert.equal(result.decision, 'deny');
  assert.equal(result.gate, 'local-only-remote-side-effect');
});

test('evaluateGates returns deny for force push', () => {
  cleanupStateFiles();
  const repoPath = createPushTestRepo();
  setTaskScope({ summary: 'force push check', allowedPaths: ['**'] });
  satisfyCondition('pr_threads_checked', '0 unresolved threads');
  const result = evaluateGates('Bash', { command: 'git push --force origin main', repoPath });
  assert.ok(result);
  assert.equal(result.decision, 'deny');
  assert.equal(result.gate, 'force-push');
});

test('evaluateGates returns deny for protected branch push', () => {
  cleanupStateFiles();
  const repoPath = createPushTestRepo();
  setTaskScope({ summary: 'protected branch push check', allowedPaths: ['**'] });
  // Satisfy the thread check so push-without-thread-check doesn't fire first
  satisfyCondition('pr_threads_checked', 'test');
  const result = evaluateGates('Bash', { command: 'git push origin develop', repoPath });
  assert.ok(result);
  assert.equal(result.decision, 'deny');
  assert.equal(result.gate, 'protected-branch-push');
  cleanupStateFiles();
});

// ---------------------------------------------------------------------------
// Warn action
// ---------------------------------------------------------------------------

test('evaluateGates returns warn for .env edit', () => {
  cleanupStateFiles();
  setTaskScope({ summary: 'env tweak', allowedPaths: ['project/**', '**/.env', '**/.env.local'] });
  const result = evaluateGates('Edit', { file_path: '/project/.env' });
  assert.ok(result);
  assert.equal(result.decision, 'warn');
  assert.equal(result.gate, 'env-file-edit');
  assert.ok(result.message.includes('tokens'));
});

// ---------------------------------------------------------------------------
// No-match passthrough
// ---------------------------------------------------------------------------

test('evaluateGates returns null when no gate matches', () => {
  const result = evaluateGates('Bash', { command: 'ls -la' });
  assert.equal(result, null);
});

test('evaluateGates returns null for Read tool', () => {
  const result = evaluateGates('Read', { file_path: '/project/src/app.js' });
  assert.equal(result, null);
});

test('evaluateGates allows non-protected edits when no task scope is declared', () => {
  cleanupStateFiles();
  const result = evaluateGates('Edit', { file_path: '/project/src/app.js' });
  assert.equal(result, null);
});

test('evaluateGates blocks high-risk git writes when no task scope is declared', () => {
  cleanupStateFiles();
  const repoPath = createPushTestRepo('src/app.js');
  const result = evaluateGates('Bash', {
    command: 'git push origin feature/x',
    repoPath,
    changed_files: ['src/app.js'],
  });
  assert.ok(result);
  assert.equal(result.decision, 'deny');
  assert.equal(result.gate, 'task-scope-required');
  assert.match(result.message, /No task scope is declared/i);
});

test('evaluateGates blocks out-of-scope edit when file is outside declared scope', () => {
  cleanupStateFiles();
  setTaskScope({ summary: 'touch tests only', allowedPaths: ['project/tests/**'] });
  const result = evaluateGates('Edit', { file_path: '/project/src/app.js' });
  assert.ok(result);
  assert.equal(result.decision, 'deny');
  assert.equal(result.gate, 'task-scope-edit-boundary');
  assert.match(result.message, /outside the declared task scope/i);
});

test('evaluateGates blocks protected file edits until approval exists', () => {
  cleanupStateFiles();
  setTaskScope({ summary: 'policy update', allowedPaths: ['AGENTS.md'] });
  const result = evaluateGates('Edit', { file_path: '/AGENTS.md' });
  assert.ok(result);
  assert.equal(result.decision, 'deny');
  assert.equal(result.gate, 'protected-file-approval-required');
  assert.match(result.message, /Protected files require explicit approval/i);
});

test('approveProtectedAction unlocks approved protected files', () => {
  cleanupStateFiles();
  setTaskScope({ summary: 'policy update', allowedPaths: ['AGENTS.md'] });
  approveProtectedAction({ pathGlobs: ['AGENTS.md'], reason: 'user approved policy update' });
  const result = evaluateGates('Edit', { file_path: '/AGENTS.md' });
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// Unless conditions with TTL
// ---------------------------------------------------------------------------

test('unless condition allows push when satisfied', () => {
  cleanupStateFiles();
  satisfyCondition('pr_threads_checked', '0 unresolved threads');
  const result = evaluateGates('Bash', { command: 'git push origin feature/x' });
  // push-without-thread-check should be bypassed; other gates may or may not match
  // If it returns null or a different gate, the unless worked
  if (result) {
    assert.notEqual(result.gate, 'push-without-thread-check');
  }
  cleanupStateFiles();
});

test('isConditionSatisfied returns false when expired', () => {
  cleanupStateFiles();
  // Write state with old timestamp
  const state = { pr_threads_checked: { timestamp: Date.now() - TTL_MS - 1000, evidence: 'old' } };
  saveState(state);
  assert.ok(!isConditionSatisfied('pr_threads_checked'));
  cleanupStateFiles();
});

test('isConditionSatisfied returns false when not set', () => {
  cleanupStateFiles();
  assert.ok(!isConditionSatisfied('nonexistent_condition'));
});

test('isConditionSatisfied returns true within TTL', () => {
  cleanupStateFiles();
  satisfyCondition('test_condition', 'evidence');
  assert.ok(isConditionSatisfied('test_condition'));
  cleanupStateFiles();
});

test('setTaskScope persists scope state', () => {
  cleanupStateFiles();
  const scope = setTaskScope({
    taskId: '1733520',
    summary: 'harden gates',
    allowedPaths: ['scripts/**', 'tests/**'],
    protectedPaths: ['AGENTS.md'],
    localOnly: true,
  });
  const state = getScopeState();
  assert.equal(scope.taskId, '1733520');
  assert.deepEqual(state.taskScope.allowedPaths, ['scripts/**', 'tests/**']);
  assert.equal(loadConstraints().local_only.value, true);
});

test('setTaskScope clear removes task scope but preserves approvals', () => {
  cleanupStateFiles();
  setTaskScope({
    taskId: '1733520',
    summary: 'policy update',
    allowedPaths: ['AGENTS.md'],
  });
  approveProtectedAction({ pathGlobs: ['AGENTS.md'], reason: 'temporary approval' });
  const cleared = setTaskScope({ clear: true });
  const state = getScopeState();
  assert.equal(cleared, null);
  assert.equal(state.taskScope, null);
  assert.equal(state.protectedApprovals.length, 1);
});

test('setBranchGovernance persists branch governance state', () => {
  cleanupStateFiles();
  const governance = setBranchGovernance({
    branchName: 'feat/thumbgate-hardening',
    baseBranch: 'main',
    prRequired: true,
    prNumber: '999',
    queueRequired: true,
    releaseVersion: '0.9.11',
  });
  const state = getScopeState();
  assert.equal(governance.branchName, 'feat/thumbgate-hardening');
  assert.equal(state.branchGovernance.prNumber, '999');
  assert.equal(getBranchGovernanceState().releaseVersion, '0.9.11');
});

test('setBranchGovernance clear removes branch governance but preserves scope', () => {
  cleanupStateFiles();
  setTaskScope({
    taskId: '1733520',
    summary: 'policy update',
    allowedPaths: ['AGENTS.md'],
  });
  setBranchGovernance({
    branchName: 'feat/thumbgate-hardening',
    baseBranch: 'main',
    prRequired: true,
    releaseVersion: '0.9.11',
  });
  const cleared = setBranchGovernance({ clear: true });
  const state = getScopeState();
  assert.equal(cleared, null);
  assert.equal(state.branchGovernance, null);
  assert.equal(state.taskScope.taskId, '1733520');
});

test('setTaskScope rejects empty allowedPaths', () => {
  cleanupStateFiles();
  assert.throws(
    () => setTaskScope({ summary: 'invalid scope', allowedPaths: [] }),
    /allowedPaths must be a non-empty array/,
  );
});

test('approveProtectedAction expires approvals after ttl', () => {
  cleanupStateFiles();
  approveProtectedAction({ pathGlobs: ['AGENTS.md'], reason: 'temporary approval', ttlMs: 60 * 1000 });
  const state = loadGovernanceState();
  assert.equal(state.protectedApprovals.length, 1);
  const expired = {
    taskScope: null,
    protectedApprovals: [{
      ...state.protectedApprovals[0],
      timestamp: Date.now() - PROTECTED_APPROVAL_TTL_MS - 1000,
      expiresAt: Date.now() - 1000,
    }],
    branchGovernance: null,
  };
  saveGovernanceState(expired);
  assert.equal(loadGovernanceState().protectedApprovals.length, 0);
});

test('approveProtectedAction validates inputs and clamps invalid ttl values', () => {
  cleanupStateFiles();
  assert.throws(
    () => approveProtectedAction({ pathGlobs: [], reason: 'no files' }),
    /pathGlobs must be a non-empty array/,
  );
  assert.throws(
    () => approveProtectedAction({ pathGlobs: ['AGENTS.md'], reason: '' }),
    /reason is required/,
  );

  const approval = approveProtectedAction({
    pathGlobs: ['AGENTS.md'],
    reason: 'clamped ttl',
    ttlMs: 5,
  });
  assert.ok(approval.expiresAt - approval.timestamp >= 60 * 1000);
});

// ---------------------------------------------------------------------------
// Stats tracking
// ---------------------------------------------------------------------------

test('recordStat increments blocked count', () => {
  cleanupStateFiles();
  recordStat('test-gate', 'block');
  recordStat('test-gate', 'block');
  recordStat('test-gate', 'warn');
  const stats = loadStats();
  assert.equal(stats.blocked, 2);
  assert.equal(stats.warned, 1);
  assert.equal(stats.byGate['test-gate'].blocked, 2);
  assert.equal(stats.byGate['test-gate'].warned, 1);
  cleanupStateFiles();
});

test('loadStats returns defaults when file missing', () => {
  cleanupStateFiles();
  const stats = loadStats();
  assert.equal(stats.blocked, 0);
  assert.equal(stats.warned, 0);
  assert.equal(stats.passed, 0);
});

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

test('formatOutput returns deny JSON for block result', () => {
  const output = JSON.parse(formatOutput({
    decision: 'deny',
    gate: 'test-gate',
    message: 'Test block message',
    severity: 'critical',
  }));
  assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
  assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('test-gate'));
  assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('Test block message'));
});

test('formatOutput returns additionalContext for warn result', () => {
  const output = JSON.parse(formatOutput({
    decision: 'warn',
    gate: 'test-gate',
    message: 'Test warn message',
    severity: 'medium',
  }));
  assert.ok(output.hookSpecificOutput.additionalContext.includes('WARNING'));
  assert.ok(output.hookSpecificOutput.additionalContext.includes('Test warn message'));
});

test('formatOutput surfaces reminder payloads when context is injected', () => {
  const output = JSON.parse(formatOutput(null, '[ThumbGate] lesson reminder'));
  assert.equal(output.hookSpecificOutput.additionalContext, '[ThumbGate] lesson reminder');
  assert.equal(output.hookSpecificOutput.systemReminder, '[ThumbGate] lesson reminder');
  assert.equal(output.hookSpecificOutput.thumbgateSystemReminder, '[ThumbGate] lesson reminder');
});

test('formatOutput returns empty object for null result', () => {
  const output = JSON.parse(formatOutput(null));
  assert.deepEqual(output, {});
});

// ---------------------------------------------------------------------------
// Full run integration
// ---------------------------------------------------------------------------

test('run blocks git push via stdin-like input', () => {
  cleanupStateFiles();
  const output = JSON.parse(run({
    tool_name: 'Bash',
    tool_input: { command: 'git push origin feature/test' },
  }));
  assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
  cleanupStateFiles();
});

test('run passes through non-matching commands', () => {
  const output = JSON.parse(run({
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
  }));
  assert.deepEqual(output, {});
});

test('run warns on .env edit', () => {
  cleanupStateFiles();
  setTaskScope({ summary: 'env tweak', allowedPaths: ['project/**', '**/.env', '**/.env.local'] });
  const output = JSON.parse(run({
    tool_name: 'Edit',
    tool_input: { file_path: '/project/.env.local' },
  }));
  assert.ok(output.hookSpecificOutput.additionalContext.includes('WARNING'));
  cleanupStateFiles();
});

test('run blocks reads of files that contain secrets', () => {
  withTempFeedbackDir((tmpFeedbackDir) => {
    const filePath = path.join(tmpFeedbackDir, '.env');
    const stripeKey = buildStripeKey();
    fs.writeFileSync(filePath, `STRIPE_SECRET_KEY=${stripeKey}\n`);

    const output = JSON.parse(run({
      tool_name: 'Read',
      tool_input: { file_path: filePath },
      cwd: tmpFeedbackDir,
    }));

    assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /secret material/i);

    const diagnosticLog = path.join(tmpFeedbackDir, 'diagnostic-log.jsonl');
    const diagnosticContent = fs.readFileSync(diagnosticLog, 'utf8');
    assert.ok(diagnosticContent.includes('secret_guard'));
    assert.ok(!diagnosticContent.includes(stripeKey));
  });
});

test('run blocks bash commands that expose inline secrets', () => {
  withTempFeedbackDir(() => {
    const gitHubPat = buildGitHubPat();
    const output = JSON.parse(run({
      tool_name: 'Bash',
      tool_input: { command: `curl -H "Authorization: Bearer ${gitHubPat}" https://example.com` },
    }));

    assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /secret material/i);
  });
});

// ---------------------------------------------------------------------------
// Config via env var
// ---------------------------------------------------------------------------

test('evaluateGates returns null with bad THUMBGATE_GATES_CONFIG', () => {
  const orig = process.env.THUMBGATE_GATES_CONFIG;
  process.env.THUMBGATE_GATES_CONFIG = '/tmp/nonexistent.json';
  const result = evaluateGates('Bash', { command: 'git push' });
  assert.equal(result, null); // graceful fallback
  if (orig) process.env.THUMBGATE_GATES_CONFIG = orig;
  else delete process.env.THUMBGATE_GATES_CONFIG;
});

// ---------------------------------------------------------------------------
// gate-satisfy.js
// ---------------------------------------------------------------------------

test('satisfyGate creates state entry', () => {
  cleanupStateFiles();
  const { satisfyGate } = require('../scripts/gate-satisfy');
  const result = satisfyGate('pr_threads_checked', '0 unresolved');
  assert.ok(result.satisfied);
  assert.equal(result.gate, 'pr_threads_checked');
  assert.ok(result.timestamp > 0);
  assert.equal(result.evidence, '0 unresolved');
  assert.ok(isConditionSatisfied('pr_threads_checked'));
  cleanupStateFiles();
});

test('satisfyGate throws without gate ID', () => {
  const { satisfyGate } = require('../scripts/gate-satisfy');
  assert.throws(() => satisfyGate(), /gate ID is required/);
});

// ---------------------------------------------------------------------------
// Reasoning chain (explainability)
// ---------------------------------------------------------------------------

test('buildReasoning returns array with pattern match step', () => {
  const gate = { id: 'test-gate', pattern: 'git\\s+push', action: 'block', severity: 'critical', layer: 'Execution' };
  const reasoning = buildReasoning(gate, 'Bash', { command: 'git push origin main' });
  assert.ok(Array.isArray(reasoning), 'reasoning should be an array');
  assert.ok(reasoning.length >= 2, `expected >= 2 steps, got ${reasoning.length}`);
  assert.ok(reasoning[0].includes('git push origin main'), 'first step should show matched text');
  assert.ok(reasoning[1].includes('test-gate'), 'second step should identify the gate');
});

test('buildReasoning identifies manual policy rules', () => {
  const gate = { id: 'force-push', pattern: 'git\\s+push', action: 'block', severity: 'critical' };
  const reasoning = buildReasoning(gate, 'Bash', { command: 'git push --force' });
  assert.ok(reasoning.some((s) => s.includes('Manual policy rule')), 'should identify as manual rule');
});

test('buildReasoning identifies auto-promoted gates', () => {
  const gate = { id: 'auto-test', pattern: 'test', action: 'warn', severity: 'medium', promotedAt: '2026-03-30T00:00:00Z', occurrences: 4 };
  const reasoning = buildReasoning(gate, 'Bash', { command: 'test cmd' });
  assert.ok(reasoning.some((s) => s.includes('Auto-promoted')), 'should identify as auto-promoted');
  assert.ok(reasoning.some((s) => s.includes('4 failures')), 'should include occurrence count');
});

test('buildReasoning includes unless bypass hint', () => {
  const gate = { id: 'push-gate', pattern: 'push', action: 'block', severity: 'critical', unless: 'pr_threads_checked' };
  const reasoning = buildReasoning(gate, 'Bash', { command: 'git push' });
  assert.ok(reasoning.some((s) => s.includes('satisfy_gate("pr_threads_checked")')), 'should hint at bypass');
});

test('buildReasoning includes historical fire count', () => {
  cleanupStateFiles();
  recordStat('hist-gate', 'block');
  recordStat('hist-gate', 'block');
  recordStat('hist-gate', 'warn');
  const gate = { id: 'hist-gate', pattern: 'test', action: 'block', severity: 'critical' };
  const reasoning = buildReasoning(gate, 'Bash', { command: 'test' });
  assert.ok(reasoning.some((s) => s.includes('blocked 2×')), 'should show block count');
  assert.ok(reasoning.some((s) => s.includes('warned 1×')), 'should show warn count');
  cleanupStateFiles();
});

test('buildReasoning truncates long input text', () => {
  const gate = { id: 'long-gate', pattern: '.', action: 'block', severity: 'critical' };
  const longCmd = 'x'.repeat(200);
  const reasoning = buildReasoning(gate, 'Bash', { command: longCmd });
  assert.ok(reasoning[0].includes('…'), 'should truncate with ellipsis');
  assert.ok(reasoning[0].length < 200, 'first step should be shorter than input');
});

test('evaluateGates includes reasoning array in deny result', () => {
  cleanupStateFiles();
  const result = evaluateGates('Bash', { command: 'git push origin feature/x' });
  assert.ok(result);
  assert.equal(result.decision, 'deny');
  assert.ok(Array.isArray(result.reasoning), 'result should have reasoning array');
  assert.ok(result.reasoning.length >= 2, 'reasoning should have multiple steps');
  cleanupStateFiles();
});

test('evaluateGates includes reasoning array in warn result', () => {
  cleanupStateFiles();
  setTaskScope({ summary: 'env tweak', allowedPaths: ['project/**', '**/.env'] });
  const result = evaluateGates('Edit', { file_path: '/project/.env' });
  assert.ok(result);
  assert.equal(result.decision, 'warn');
  assert.ok(Array.isArray(result.reasoning), 'warn result should have reasoning array');
  cleanupStateFiles();
});

test('formatOutput includes reasoning in deny reason text', () => {
  const output = JSON.parse(formatOutput({
    decision: 'deny',
    gate: 'test-gate',
    message: 'Blocked for testing',
    severity: 'critical',
    reasoning: ['Pattern matched', 'Manual rule'],
  }));
  assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('Reasoning:'));
  assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('Pattern matched'));
  assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('Manual rule'));
});

test('formatOutput includes reminder context in deny payloads', () => {
  const output = JSON.parse(formatOutput({
    decision: 'deny',
    gate: 'test-gate',
    message: 'Blocked for testing',
    severity: 'critical',
    reasoning: [],
  }, '[ThumbGate] remember this prior failure'));
  assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(output.hookSpecificOutput.additionalContext, '[ThumbGate] remember this prior failure');
  assert.equal(output.hookSpecificOutput.systemReminder, '[ThumbGate] remember this prior failure');
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /remember this prior failure/);
});

test('formatOutput includes reasoning in warn context text', () => {
  const output = JSON.parse(formatOutput({
    decision: 'warn',
    gate: 'test-gate',
    message: 'Warning for testing',
    severity: 'medium',
    reasoning: ['Step 1', 'Step 2'],
  }));
  assert.ok(output.hookSpecificOutput.additionalContext.includes('Reasoning:'));
  assert.ok(output.hookSpecificOutput.additionalContext.includes('Step 1'));
});

test('formatOutput omits reasoning section when reasoning is empty', () => {
  const output = JSON.parse(formatOutput({
    decision: 'deny',
    gate: 'test-gate',
    message: 'No reasoning',
    severity: 'critical',
    reasoning: [],
  }));
  assert.ok(!output.hookSpecificOutput.permissionDecisionReason.includes('Reasoning:'));
});

// ---------------------------------------------------------------------------
// Structured pre-gate reasoning
// ---------------------------------------------------------------------------

test('satisfyCondition stores structuredReasoning when provided', () => {
  cleanupStateFiles();
  const reasoning = {
    premise: 'I need to push because the PR is approved',
    evidence: '0 unresolved threads, CI green',
    risk: 'Force push could overwrite others work',
    conclusion: 'Safe to push — regular push, not force',
  };
  satisfyCondition('test_reasoning', 'CI green', reasoning);
  const state = loadState();
  assert.ok(state.test_reasoning.structuredReasoning, 'should store structured reasoning');
  assert.equal(state.test_reasoning.structuredReasoning.premise, reasoning.premise);
  assert.equal(state.test_reasoning.structuredReasoning.conclusion, reasoning.conclusion);
  assert.equal(state.test_reasoning.evidence, 'CI green');
  cleanupStateFiles();
});

test('satisfyCondition works without structuredReasoning (backward compat)', () => {
  cleanupStateFiles();
  satisfyCondition('test_no_reasoning', 'simple evidence');
  const state = loadState();
  assert.ok(!state.test_no_reasoning.structuredReasoning, 'should not have structured reasoning');
  assert.equal(state.test_no_reasoning.evidence, 'simple evidence');
  cleanupStateFiles();
});

test('satisfyCondition stores all four reasoning fields', () => {
  cleanupStateFiles();
  const reasoning = { premise: 'P', evidence: 'E', risk: 'R', conclusion: 'C' };
  satisfyCondition('test_full', 'ev', reasoning);
  const state = loadState();
  const sr = state.test_full.structuredReasoning;
  assert.equal(sr.premise, 'P');
  assert.equal(sr.evidence, 'E');
  assert.equal(sr.risk, 'R');
  assert.equal(sr.conclusion, 'C');
  cleanupStateFiles();
});

// ---------------------------------------------------------------------------
// Metric skip tools (evaluateGatesAsync fast path)
// ---------------------------------------------------------------------------

test('evaluateGatesAsync skips metric gates for tools in METRIC_SKIP_TOOLS', async () => {
  // Create a temp config with a metric gate that matches everything
  const tmpConfig = makeTempPath('metric-skip-test.json');
  fs.writeFileSync(tmpConfig, JSON.stringify({
    version: 1,
    gates: [{
      id: 'metric-gate',
      pattern: '.*',
      action: 'block',
      message: 'Metric gate fired',
      severity: 'critical',
      metrics: { name: 'revenue', min: 100 },
    }],
  }));

  try {
    // capture_feedback is in METRIC_SKIP_TOOLS — should skip the metric gate entirely
    const result = await evaluateGatesAsync('capture_feedback', { command: 'anything' }, tmpConfig);
    // The gate has metrics so skipMetrics causes `continue`, meaning no gate fires → null
    assert.equal(result, null);
  } finally {
    fs.rmSync(tmpConfig, { force: true });
  }
});

test('evaluateGatesAsync skips metric gates for recall tool', async () => {
  const tmpConfig = makeTempPath('metric-skip-recall.json');
  fs.writeFileSync(tmpConfig, JSON.stringify({
    version: 1,
    gates: [{
      id: 'metric-gate-recall',
      pattern: '.*',
      action: 'block',
      message: 'Should not fire for recall',
      severity: 'critical',
      metrics: { name: 'mrr', min: 50 },
    }],
  }));

  try {
    const result = await evaluateGatesAsync('recall', { command: 'test' }, tmpConfig);
    assert.equal(result, null);
  } finally {
    fs.rmSync(tmpConfig, { force: true });
  }
});

test('evaluateGatesAsync does NOT skip metric gates for non-skip tools', async () => {
  // Mock semantic-layer to return a metric value that violates the gate
  const semanticLayerPath = require.resolve('../scripts/semantic-layer');
  const originalModule = require(semanticLayerPath);
  const originalGetBusinessMetrics = originalModule.getBusinessMetrics;

  // Override getBusinessMetrics to return a low revenue
  originalModule.getBusinessMetrics = async () => ({
    metrics: { revenue: 10 },
  });

  const tmpConfig = makeTempPath('metric-noskip-test.json');
  fs.writeFileSync(tmpConfig, JSON.stringify({
    version: 1,
    gates: [{
      id: 'metric-gate-noskip',
      pattern: '.*',
      action: 'block',
      message: 'Revenue too low',
      severity: 'critical',
      metrics: { name: 'revenue', min: 100 },
    }],
  }));

  try {
    cleanupStateFiles();
    // 'Bash' is NOT in METRIC_SKIP_TOOLS, so metric evaluation runs
    const result = await evaluateGatesAsync('Bash', { command: 'echo hello' }, tmpConfig);
    assert.ok(result);
    assert.equal(result.decision, 'deny');
    assert.equal(result.gate, 'metric-gate-noskip');
  } finally {
    originalModule.getBusinessMetrics = originalGetBusinessMetrics;
    fs.rmSync(tmpConfig, { force: true });
    cleanupStateFiles();
  }
});

// ---------------------------------------------------------------------------
// Metric timeout (3s Promise.race)
// ---------------------------------------------------------------------------

test('evaluateGatesAsync returns pass on metric timeout', async () => {
  const semanticLayerPath = require.resolve('../scripts/semantic-layer');
  const originalModule = require(semanticLayerPath);
  const originalGetBusinessMetrics = originalModule.getBusinessMetrics;

  // Override to simulate a slow metric call (never resolves within 3s)
  originalModule.getBusinessMetrics = () => new Promise(() => {});

  const tmpConfig = makeTempPath('metric-timeout-test.json');
  fs.writeFileSync(tmpConfig, JSON.stringify({
    version: 1,
    gates: [{
      id: 'metric-gate-timeout',
      pattern: '.*',
      action: 'block',
      message: 'Should not block on timeout',
      severity: 'critical',
      metrics: { name: 'revenue', min: 100, window: '7d' },
    }],
  }));

  try {
    cleanupStateFiles();
    // The 3s timeout should fire, returning { pass: true, reason: 'metric-timeout' }
    // Since metricsPassed is true, the gate is skipped (continue) → null result
    const result = await evaluateGatesAsync('Bash', { command: 'echo test' }, tmpConfig);
    assert.equal(result, null);
  } finally {
    originalModule.getBusinessMetrics = originalGetBusinessMetrics;
    fs.rmSync(tmpConfig, { force: true });
    cleanupStateFiles();
  }
}).timeout = 10000;

// ---------------------------------------------------------------------------
// checkMetricCondition returning boolean (tested indirectly via evaluateGatesAsync)
// ---------------------------------------------------------------------------

test('evaluateGatesAsync passes when metric is within bounds', async () => {
  const semanticLayerPath = require.resolve('../scripts/semantic-layer');
  const originalModule = require(semanticLayerPath);
  const originalGetBusinessMetrics = originalModule.getBusinessMetrics;

  originalModule.getBusinessMetrics = async () => ({
    metrics: { revenue: 200 },
  });

  const tmpConfig = makeTempPath('metric-pass-test.json');
  fs.writeFileSync(tmpConfig, JSON.stringify({
    version: 1,
    gates: [{
      id: 'metric-gate-pass',
      pattern: '.*',
      action: 'block',
      message: 'Revenue check',
      severity: 'critical',
      metrics: { name: 'revenue', min: 100, max: 500 },
    }],
  }));

  try {
    cleanupStateFiles();
    // Revenue=200 is within [100, 500], so metric passes → gate skipped → null
    const result = await evaluateGatesAsync('Bash', { command: 'echo ok' }, tmpConfig);
    assert.equal(result, null);
  } finally {
    originalModule.getBusinessMetrics = originalGetBusinessMetrics;
    fs.rmSync(tmpConfig, { force: true });
    cleanupStateFiles();
  }
});

test('evaluateGatesAsync blocks when metric exceeds max', async () => {
  const semanticLayerPath = require.resolve('../scripts/semantic-layer');
  const originalModule = require(semanticLayerPath);
  const originalGetBusinessMetrics = originalModule.getBusinessMetrics;

  originalModule.getBusinessMetrics = async () => ({
    metrics: { churn: 25 },
  });

  const tmpConfig = makeTempPath('metric-max-test.json');
  fs.writeFileSync(tmpConfig, JSON.stringify({
    version: 1,
    gates: [{
      id: 'metric-gate-max',
      pattern: '.*',
      action: 'warn',
      message: 'Churn too high',
      severity: 'high',
      metrics: { name: 'churn', max: 10 },
    }],
  }));

  try {
    cleanupStateFiles();
    const result = await evaluateGatesAsync('Bash', { command: 'deploy' }, tmpConfig);
    assert.ok(result);
    assert.equal(result.decision, 'warn');
    assert.equal(result.gate, 'metric-gate-max');
  } finally {
    originalModule.getBusinessMetrics = originalGetBusinessMetrics;
    fs.rmSync(tmpConfig, { force: true });
    cleanupStateFiles();
  }
});

test('evaluateGatesAsync passes when metric is undefined (missing from metrics)', async () => {
  const semanticLayerPath = require.resolve('../scripts/semantic-layer');
  const originalModule = require(semanticLayerPath);
  const originalGetBusinessMetrics = originalModule.getBusinessMetrics;

  originalModule.getBusinessMetrics = async () => ({
    metrics: {},
  });

  const tmpConfig = makeTempPath('metric-undefined-test.json');
  fs.writeFileSync(tmpConfig, JSON.stringify({
    version: 1,
    gates: [{
      id: 'metric-gate-undef',
      pattern: '.*',
      action: 'block',
      message: 'Metric not found',
      severity: 'critical',
      metrics: { name: 'nonexistent_metric', min: 100 },
    }],
  }));

  try {
    cleanupStateFiles();
    // checkMetricCondition returns true when value is undefined → gate skipped
    const result = await evaluateGatesAsync('Bash', { command: 'echo test' }, tmpConfig);
    assert.equal(result, null);
  } finally {
    originalModule.getBusinessMetrics = originalGetBusinessMetrics;
    fs.rmSync(tmpConfig, { force: true });
    cleanupStateFiles();
  }
});

// ---------------------------------------------------------------------------
// evaluateGatesAsync warn action for metric-failed gate
// ---------------------------------------------------------------------------

test('evaluateGatesAsync returns warn with metricFailed reasoning', async () => {
  const semanticLayerPath = require.resolve('../scripts/semantic-layer');
  const originalModule = require(semanticLayerPath);
  const originalGetBusinessMetrics = originalModule.getBusinessMetrics;

  originalModule.getBusinessMetrics = async () => ({
    metrics: { revenue: 5 },
  });

  const tmpConfig = makeTempPath('metric-warn-test.json');
  fs.writeFileSync(tmpConfig, JSON.stringify({
    version: 1,
    gates: [{
      id: 'metric-warn-gate',
      pattern: '.*',
      action: 'warn',
      message: 'Low revenue warning',
      severity: 'medium',
      metrics: { name: 'revenue', min: 50 },
    }],
  }));

  try {
    cleanupStateFiles();
    const result = await evaluateGatesAsync('Bash', { command: 'echo test' }, tmpConfig);
    assert.ok(result);
    assert.equal(result.decision, 'warn');
    assert.ok(result.reasoning.some((s) => s.includes('Business metric')));
  } finally {
    originalModule.getBusinessMetrics = originalGetBusinessMetrics;
    fs.rmSync(tmpConfig, { force: true });
    cleanupStateFiles();
  }
});

// ---------------------------------------------------------------------------
// evaluateGatesAsync config load failure
// ---------------------------------------------------------------------------

test('evaluateGatesAsync returns null when config fails to load', async () => {
  const result = await evaluateGatesAsync('Bash', { command: 'echo test' }, '/tmp/nonexistent-async.json');
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// evaluateGatesAsync no-match passthrough
// ---------------------------------------------------------------------------

test('evaluateGatesAsync returns null when no gate matches', async () => {
  const result = await evaluateGatesAsync('Bash', { command: 'ls -la' });
  assert.equal(result, null);
});

test('evaluateGatesAsync denies high-risk actions when recurring negative memory matches', async () => {
  const tmpConfig = makeTempPath('memory-only-gates.json');
  fs.writeFileSync(tmpConfig, JSON.stringify({ version: 1, gates: [] }));

  const feedbackLog = makeTempPath('memory-feedback.jsonl');
  const attributedFeedback = makeTempPath('memory-attributed.jsonl');
  const entries = [
    { id: 'mem-1', signal: 'negative', context: 'git push AGENTS.md protected file regression', timestamp: new Date().toISOString() },
    { id: 'mem-2', signal: 'negative', context: 'git push AGENTS.md protected file regression', timestamp: new Date().toISOString() },
  ];
  fs.writeFileSync(feedbackLog, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
  fs.writeFileSync(attributedFeedback, '');

  const originalFeedbackLog = process.env.THUMBGATE_FEEDBACK_LOG;
  const originalAttributedFeedback = process.env.THUMBGATE_ATTRIBUTED_FEEDBACK;
  process.env.THUMBGATE_FEEDBACK_LOG = feedbackLog;
  process.env.THUMBGATE_ATTRIBUTED_FEEDBACK = attributedFeedback;

  try {
    const result = await evaluateGatesAsync('Bash', {
      command: 'git push origin feature/x',
      changed_files: ['AGENTS.md'],
    }, tmpConfig);
    assert.ok(result);
    assert.equal(result.decision, 'deny');
    assert.equal(result.gate, 'memory-high-risk-default-deny');
    assert.match(result.message, /Recurring negative memory matched/i);
  } finally {
    if (originalFeedbackLog === undefined) delete process.env.THUMBGATE_FEEDBACK_LOG;
    else process.env.THUMBGATE_FEEDBACK_LOG = originalFeedbackLog;
    if (originalAttributedFeedback === undefined) delete process.env.THUMBGATE_ATTRIBUTED_FEEDBACK;
    else process.env.THUMBGATE_ATTRIBUTED_FEEDBACK = originalAttributedFeedback;
    fs.rmSync(tmpConfig, { force: true });
    fs.rmSync(feedbackLog, { force: true });
    fs.rmSync(attributedFeedback, { force: true });
  }
});

test('evaluateGatesAsync allows scoped high-risk actions even when recurring negative memory exists', async () => {
  const tmpConfig = makeTempPath('memory-scope-bypass-gates.json');
  fs.writeFileSync(tmpConfig, JSON.stringify({ version: 1, gates: [] }));
  const repoPath = createPushTestRepo('src/index.js');

  const feedbackLog = makeTempPath('memory-scope-feedback.jsonl');
  const attributedFeedback = makeTempPath('memory-scope-attributed.jsonl');
  const entries = Array.from({ length: 3 }, (_, index) => ({
    id: `mem-scope-${index}`,
    toolName: 'Bash',
    signal: 'negative',
    context: 'git push AGENTS.md protected file regression',
    timestamp: new Date().toISOString(),
  }));
  fs.writeFileSync(feedbackLog, '');
  fs.writeFileSync(attributedFeedback, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');

  const originalFeedbackLog = process.env.THUMBGATE_FEEDBACK_LOG;
  const originalAttributedFeedback = process.env.THUMBGATE_ATTRIBUTED_FEEDBACK;
  process.env.THUMBGATE_FEEDBACK_LOG = feedbackLog;
  process.env.THUMBGATE_ATTRIBUTED_FEEDBACK = attributedFeedback;

  try {
    setTaskScope({
      allowedPaths: ['src/**'],
      summary: 'Allow src files for the current task.',
    });
    const result = await evaluateGatesAsync('Bash', {
      command: 'git push origin feature/x',
      repoPath,
      changed_files: ['src/index.js'],
    }, tmpConfig);
    assert.equal(result, null);
  } finally {
    if (originalFeedbackLog === undefined) delete process.env.THUMBGATE_FEEDBACK_LOG;
    else process.env.THUMBGATE_FEEDBACK_LOG = originalFeedbackLog;
    if (originalAttributedFeedback === undefined) delete process.env.THUMBGATE_ATTRIBUTED_FEEDBACK;
    else process.env.THUMBGATE_ATTRIBUTED_FEEDBACK = originalAttributedFeedback;
    fs.rmSync(tmpConfig, { force: true });
    fs.rmSync(feedbackLog, { force: true });
    fs.rmSync(attributedFeedback, { force: true });
  }
});

test('evaluateGates allows gh pr create after explicit approval even when bash memory is negative', () => {
  const tmpConfig = makeTempPath('memory-pr-approval-gates.json');
  fs.writeFileSync(tmpConfig, JSON.stringify({ version: 1, gates: [] }));

  const feedbackLog = makeTempPath('memory-pr-feedback.jsonl');
  const attributedFeedback = makeTempPath('memory-pr-attributed.jsonl');
  const entries = Array.from({ length: 3 }, (_, index) => ({
    id: `mem-pr-${index}`,
    toolName: 'Bash',
    signal: 'negative',
    context: 'gh pr create without user permission',
    timestamp: new Date().toISOString(),
  }));
  fs.writeFileSync(feedbackLog, '');
  fs.writeFileSync(attributedFeedback, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');

  const originalFeedbackLog = process.env.THUMBGATE_FEEDBACK_LOG;
  const originalAttributedFeedback = process.env.THUMBGATE_ATTRIBUTED_FEEDBACK;
  process.env.THUMBGATE_FEEDBACK_LOG = feedbackLog;
  process.env.THUMBGATE_ATTRIBUTED_FEEDBACK = attributedFeedback;

  try {
    setTaskScope({
      allowedPaths: ['README.md'],
      summary: 'Allow README.md for PR prep.',
    });
    setBranchGovernance({
      branchName: 'feat/thumbgate-hardening',
      baseBranch: 'main',
      prRequired: true,
      releaseVersion: '0.9.11',
    });
    satisfyCondition('pr_create_allowed', 'User explicitly approved PR creation');
    const result = evaluateGates('Bash', {
      command: 'gh pr create --title "test"',
      changed_files: ['README.md'],
    }, tmpConfig);
    assert.equal(result, null);
  } finally {
    if (originalFeedbackLog === undefined) delete process.env.THUMBGATE_FEEDBACK_LOG;
    else process.env.THUMBGATE_FEEDBACK_LOG = originalFeedbackLog;
    if (originalAttributedFeedback === undefined) delete process.env.THUMBGATE_ATTRIBUTED_FEEDBACK;
    else process.env.THUMBGATE_ATTRIBUTED_FEEDBACK = originalAttributedFeedback;
    fs.rmSync(tmpConfig, { force: true });
    fs.rmSync(feedbackLog, { force: true });
    fs.rmSync(attributedFeedback, { force: true });
  }
});

test('evaluateBoostedRiskTagGuard denies matching high-risk tag actions', () => {
  const result = evaluateBoostedRiskTagGuard('Bash', {
    command: 'gh pr comment 123 --body "addressing bot review"',
    boostedRisk: {
      highRiskTags: [{ tag: 'bot-comments', count: 6, failures: 6, riskRate: 1 }],
    },
  });
  assert.ok(result);
  assert.equal(result.decision, 'deny');
  assert.equal(result.gate, 'boosted-risk-tag-default-deny');
  assert.match(result.message, /bot-comments/);
});

test('evaluateGates blocks boostedRisk highRiskTags before advisory memory', () => {
  const tmpConfig = makeTempPath('boosted-risk-empty-gates.json');
  fs.writeFileSync(tmpConfig, JSON.stringify({ version: 1, gates: [] }));
  const result = evaluateGates('Bash', {
    command: 'gh pr comment 123 --body "thread fixed"',
    boostedRisk: {
      riskScore: 1,
      exampleCount: 6,
      highRiskTags: ['bot-comments'],
    },
  }, tmpConfig);
  assert.ok(result);
  assert.equal(result.decision, 'deny');
  assert.equal(result.gate, 'boosted-risk-tag-default-deny');
});

test('git commit on PR branch registers thread-resolution claim gate and blocks next non-evidence tool', () => {
  cleanupStateFiles();
  const tmpConfig = makeTempPath('pr-commit-empty-gates.json');
  fs.writeFileSync(tmpConfig, JSON.stringify({ version: 1, gates: [] }));

  const commitResult = evaluateGates('Bash', {
    command: 'git commit -m "fix review feedback"',
    branchName: 'fix/review-feedback',
    prNumber: 123,
  }, tmpConfig);
  assert.equal(commitResult, null);
  assert.ok(hasAction(PR_THREAD_RESOLUTION_ACTION));
  assert.ok(loadClaimGates().claims.some((claim) => claim.requiredActions.includes('pr_threads_checked')));

  const blocked = evaluatePendingPrThreadResolutionGate('Read', { file_path: 'README.md' });
  assert.ok(blocked);
  assert.equal(blocked.decision, 'deny');
  assert.equal(blocked.gate, 'pr-thread-resolution-verified-required');

  satisfyCondition('pr_threads_checked', 'reviewThreads first:50 returned 0 unresolved');
  assert.equal(evaluatePendingPrThreadResolutionGate('Read', { file_path: 'README.md' }), null);
});

test('evaluateGates blocks raw GitHub auto-merge even after merge permission is satisfied', () => {
  cleanupStateFiles();
  setTaskScope({
    allowedPaths: ['scripts/**', 'tests/**'],
    summary: 'Allow merge-gate hardening work.',
  });
  satisfyCondition('pr_merge_allowed', 'User approved PR merge after checks');
  const result = evaluateGates('Bash', {
    command: 'gh pr merge 676 --auto --squash --delete-branch',
    changed_files: ['scripts/pr-manager.js', 'tests/pr-manager.test.js'],
  });
  assert.ok(result);
  assert.equal(result.decision, 'deny');
  assert.equal(result.gate, 'raw-gh-auto-merge-blocked');
  assert.match(result.message, /Raw GitHub auto-merge is blocked/);
});

test('evaluateGates blocks gh pr create without branch governance', () => {
  cleanupStateFiles();
  const repoPath = createPushTestRepo('scripts/ops.js');
  setTaskScope({
    allowedPaths: ['scripts/**'],
    summary: 'Allow script updates for the current task.',
  });
  satisfyCondition('pr_create_allowed', 'user explicitly approved PR creation');
  const result = evaluateGates('Bash', {
    command: 'gh pr create --title "test"',
    repoPath,
    changed_files: ['scripts/ops.js'],
  });
  assert.ok(result);
  assert.equal(result.gate, 'branch-governance-required');
  assert.match(result.message, /require explicit branch governance/i);
});

test('evaluateGates blocks publish when branch governance release version is missing', () => {
  cleanupStateFiles();
  setBranchGovernance({
    branchName: 'main',
    baseBranch: 'main',
    prRequired: true,
  });
  const result = evaluateGates('Bash', {
    command: 'npm publish',
  });
  assert.ok(result);
  assert.equal(result.gate, 'branch-governance-required');
  assert.match(result.message, /releaseVersion/i);
});

// ---------------------------------------------------------------------------
// evaluateGatesAsync when clause
// ---------------------------------------------------------------------------

test('evaluateGatesAsync skips gate when when-clause not satisfied', async () => {
  cleanupStateFiles();
  const tmpConfig = makeTempPath('async-when-test.json');
  fs.writeFileSync(tmpConfig, JSON.stringify({
    version: 1,
    gates: [{
      id: 'when-gate',
      pattern: '.*',
      action: 'block',
      message: 'Should not fire',
      severity: 'critical',
      when: { constraints: { some_mode: true } },
    }],
  }));

  try {
    const result = await evaluateGatesAsync('Bash', { command: 'echo test' }, tmpConfig);
    assert.equal(result, null);
  } finally {
    fs.rmSync(tmpConfig, { force: true });
    cleanupStateFiles();
  }
});

// ---------------------------------------------------------------------------
// evaluateGatesAsync unless condition
// ---------------------------------------------------------------------------

test('evaluateGatesAsync skips gate when unless condition is satisfied', async () => {
  cleanupStateFiles();
  satisfyCondition('async_test_condition', 'test evidence');

  const tmpConfig = makeTempPath('async-unless-test.json');
  fs.writeFileSync(tmpConfig, JSON.stringify({
    version: 1,
    gates: [{
      id: 'unless-gate',
      pattern: '.*',
      action: 'block',
      message: 'Should be bypassed',
      severity: 'critical',
      unless: 'async_test_condition',
    }],
  }));

  try {
    const result = await evaluateGatesAsync('Bash', { command: 'echo test' }, tmpConfig);
    assert.equal(result, null);
  } finally {
    fs.rmSync(tmpConfig, { force: true });
    cleanupStateFiles();
  }
});

// ---------------------------------------------------------------------------
// runAsync
// ---------------------------------------------------------------------------

test('runAsync passes through non-matching commands', async () => {
  const output = JSON.parse(await runAsync({
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
  }));
  assert.deepEqual(output, {});
});

test('runAsync blocks secret exposure', async () => {
  await withTempFeedbackDir(async (tmpFeedbackDir) => {
    const gitHubPat = buildGitHubPat();
    const output = JSON.parse(await runAsync({
      tool_name: 'Bash',
      tool_input: { command: `curl -H "Authorization: Bearer ${gitHubPat}" https://example.com` },
    }));
    assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /secret material/i);
  });
});

// ---------------------------------------------------------------------------
// computeExecutableHash
// ---------------------------------------------------------------------------

test('computeExecutableHash returns null for empty command', () => {
  assert.equal(computeExecutableHash(''), null);
  assert.equal(computeExecutableHash(null), null);
  assert.equal(computeExecutableHash(undefined), null);
});

test('computeExecutableHash returns a hash for known binary', () => {
  const hash = computeExecutableHash('node --version');
  // node binary should exist and produce a hex hash
  assert.ok(hash === null || /^[0-9a-f]{64}$/.test(hash));
});

test('computeExecutableHash returns null for nonexistent command', () => {
  assert.equal(computeExecutableHash('__nonexistent_binary_xyz_123__'), null);
});

// ---------------------------------------------------------------------------
// setConstraint / loadConstraints / saveConstraints
// ---------------------------------------------------------------------------

test('setConstraint stores and loads constraints', () => {
  cleanupStateFiles();
  const entry = setConstraint('local_only', true);
  assert.equal(entry.value, true);
  assert.ok(entry.timestamp > 0);
  const constraints = loadConstraints();
  assert.equal(constraints.local_only.value, true);
  cleanupStateFiles();
});

// ---------------------------------------------------------------------------
// evaluateSecretGuard
// ---------------------------------------------------------------------------

test('evaluateSecretGuard returns null when no secrets detected', () => {
  const result = evaluateSecretGuard({
    tool_name: 'Bash',
    tool_input: { command: 'echo hello' },
  });
  assert.equal(result, null);
});

test('buildSecretGuardResult builds correct structure', () => {
  const result = buildSecretGuardResult({
    provider: 'heuristic',
    findings: [{ id: 'test-finding', label: 'Test Secret', line: 1, path: '/test', source: 'test', reason: 'test reason' }],
  });
  assert.equal(result.decision, 'deny');
  assert.equal(result.gate, 'secret-exfiltration');
  assert.equal(result.severity, 'critical');
  assert.equal(result.secretScan.provider, 'heuristic');
  assert.equal(result.secretScan.findings.length, 1);
  assert.equal(result.secretScan.findings[0].id, 'test-finding');
});

// ---------------------------------------------------------------------------
// Session action tracking
// ---------------------------------------------------------------------------

test('trackAction stores and retrieves actions', () => {
  cleanupStateFiles();
  const entry = trackAction('tests_passed', { sha: 'abc123' });
  assert.ok(entry.timestamp > 0);
  assert.equal(entry.metadata.sha, 'abc123');
  assert.ok(hasAction('tests_passed'));
  assert.ok(!hasAction('nonexistent'));
  cleanupStateFiles();
});

test('trackAction throws on empty actionId', () => {
  assert.throws(() => trackAction(''), /actionId is required/);
  assert.throws(() => trackAction(null), /actionId is required/);
});

test('trackAction throws on invalid metadata', () => {
  assert.throws(() => trackAction('test', 'not-an-object'), /metadata must be an object/);
});

test('listSessionActions returns all actions', () => {
  cleanupStateFiles();
  trackAction('action1');
  trackAction('action2');
  const actions = listSessionActions();
  assert.ok(actions.action1);
  assert.ok(actions.action2);
  cleanupStateFiles();
});

test('clearSessionActions removes all actions', () => {
  cleanupStateFiles();
  trackAction('action1');
  clearSessionActions();
  assert.ok(!hasAction('action1'));
  cleanupStateFiles();
});

test('hasAction returns false for empty actionId', () => {
  assert.ok(!hasAction(''));
  assert.ok(!hasAction(null));
});

// ---------------------------------------------------------------------------
// Claim verification
// ---------------------------------------------------------------------------

test('loadClaimGates loads default claim gates', () => {
  cleanupStateFiles();
  const config = loadClaimGates();
  assert.ok(Array.isArray(config.claims));
  assert.ok(config.claims.length > 0);
  cleanupStateFiles();
});

test('registerClaimGate creates and merges custom claim gates', () => {
  cleanupStateFiles();
  const entry = registerClaimGate('tests? pass', ['tests_passed'], 'Must run tests first');
  assert.equal(entry.pattern, 'tests? pass');
  assert.deepEqual(entry.requiredActions, ['tests_passed']);
  assert.ok(entry.createdAt > 0);

  // Register again to update
  const updated = registerClaimGate('tests? pass', ['tests_passed', 'ci_green'], 'Updated message');
  assert.deepEqual(updated.requiredActions, ['tests_passed', 'ci_green']);
  cleanupStateFiles();
});

test('registerClaimGate throws on empty pattern', () => {
  assert.throws(() => registerClaimGate('', ['action']), /claimPattern is required/);
});

test('registerClaimGate throws on empty requiredActions', () => {
  assert.throws(() => registerClaimGate('test', []), /non-empty array/);
  assert.throws(() => registerClaimGate('test', ['', '  ']), /at least one non-empty/);
});

test('verifyClaimEvidence verifies claims against tracked actions', () => {
  cleanupStateFiles();
  trackAction('tests_passed');
  const result = verifyClaimEvidence('all tests pass');
  // Default claim gates include a pattern for "tests? pass"
  assert.ok(result.checks.length > 0);
  // tests_passed is tracked, so that check should pass
  const testsCheck = result.checks.find((check) => {
    return Array.isArray(check.missing) && check.claim === 'tests? pass|all tests|ci.*green|ci.*pass';
  });
  assert.ok(testsCheck);
  assert.ok(testsCheck.passed);
  cleanupStateFiles();
});

test('verifyClaimEvidence returns missing actions when not tracked', () => {
  cleanupStateFiles();
  const result = verifyClaimEvidence('all tests pass and ci is green');
  const testsCheck = result.checks.find((check) => {
    return check.claim === 'tests? pass|all tests|ci.*green|ci.*pass';
  });
  assert.ok(testsCheck);
  assert.ok(!testsCheck.passed);
  assert.ok(testsCheck.missing.length > 0);
  cleanupStateFiles();
});

test('verifyClaimEvidence throws on empty claimText', () => {
  assert.throws(() => verifyClaimEvidence(''), /claimText is required/);
});

// ---------------------------------------------------------------------------
// formatOutput edge case: unknown decision
// ---------------------------------------------------------------------------

test('formatOutput returns empty object for unknown decision', () => {
  const output = JSON.parse(formatOutput({ decision: 'unknown', gate: 'x', message: 'y' }));
  assert.deepEqual(output, {});
});

// ---------------------------------------------------------------------------
// recordStat pass action
// ---------------------------------------------------------------------------

test('recordStat increments passed count', () => {
  cleanupStateFiles();
  recordStat('test-gate', 'pass');
  const stats = loadStats();
  assert.equal(stats.passed, 1);
  cleanupStateFiles();
});

// ---------------------------------------------------------------------------
// checkWhenClause via evaluateGates with constraint set
// ---------------------------------------------------------------------------

test('evaluateGates fires gate when when-clause constraint is satisfied', () => {
  cleanupStateFiles();
  setConstraint('local_only', true);
  const result = evaluateGates('Bash', { command: 'git push origin feature/x' });
  assert.ok(result);
  assert.equal(result.decision, 'deny');
  cleanupStateFiles();
});

// ---------------------------------------------------------------------------
// buildReasoning with when-clause constraints
// ---------------------------------------------------------------------------

test('buildReasoning includes constraint context when gate has when clause', () => {
  const gate = {
    id: 'constrained-gate',
    pattern: 'test',
    action: 'block',
    severity: 'critical',
    when: { constraints: { local_only: true } },
  };
  const reasoning = buildReasoning(gate, 'Bash', { command: 'test' });
  assert.ok(reasoning.some((s) => s.includes('local_only')));
});

// ---------------------------------------------------------------------------
// Session action TTL expiry
// ---------------------------------------------------------------------------

test('loadSessionActions prunes expired actions', () => {
  cleanupStateFiles();
  // Write an action with an old timestamp directly to the file
  const expiredActions = {
    old_action: { timestamp: Date.now() - SESSION_ACTION_TTL_MS - 1000, metadata: {} },
    fresh_action: { timestamp: Date.now(), metadata: {} },
  };
  const actionsDir = path.dirname(gatesEngine.SESSION_ACTIONS_PATH);
  fs.mkdirSync(actionsDir, { recursive: true });
  fs.writeFileSync(gatesEngine.SESSION_ACTIONS_PATH, JSON.stringify(expiredActions, null, 2) + '\n');

  const actions = listSessionActions();
  assert.ok(!actions.old_action, 'expired action should be pruned');
  assert.ok(actions.fresh_action, 'fresh action should remain');
  cleanupStateFiles();
});

test('loadSessionActions skips non-object entries', () => {
  cleanupStateFiles();
  const badActions = {
    null_entry: null,
    string_entry: 'not-an-object',
    valid_entry: { timestamp: Date.now(), metadata: {} },
  };
  const actionsDir = path.dirname(gatesEngine.SESSION_ACTIONS_PATH);
  fs.mkdirSync(actionsDir, { recursive: true });
  fs.writeFileSync(gatesEngine.SESSION_ACTIONS_PATH, JSON.stringify(badActions, null, 2) + '\n');

  const actions = listSessionActions();
  assert.ok(!actions.null_entry);
  assert.ok(!actions.string_entry);
  assert.ok(actions.valid_entry);
  cleanupStateFiles();
});

// ---------------------------------------------------------------------------
// loadClaimGateFile edge cases
// ---------------------------------------------------------------------------

test('loadClaimGates merges custom claims over defaults', () => {
  cleanupStateFiles();
  // Register a custom claim that overrides a default pattern
  registerClaimGate('tests? pass', ['custom_action'], 'Custom message');
  const config = loadClaimGates();
  const testsGate = config.claims.find((c) => c.pattern === 'tests? pass');
  assert.ok(testsGate);
  assert.deepEqual(testsGate.requiredActions, ['custom_action']);
  cleanupStateFiles();
});

// ---------------------------------------------------------------------------
// verifyClaimEvidence with invalid regex in claim
// ---------------------------------------------------------------------------

test('verifyClaimEvidence skips claims with invalid regex patterns', () => {
  cleanupStateFiles();
  // Write a custom claim with an invalid regex
  const customClaims = {
    version: 1,
    claims: [
      { pattern: '[invalid-regex', requiredActions: ['action1'], message: 'Bad regex' },
      { pattern: 'valid pattern', requiredActions: ['action2'], message: 'Valid' },
    ],
  };
  const claimsDir = path.dirname(gatesEngine.CUSTOM_CLAIM_GATES_PATH);
  fs.mkdirSync(claimsDir, { recursive: true });
  fs.writeFileSync(gatesEngine.CUSTOM_CLAIM_GATES_PATH, JSON.stringify(customClaims, null, 2) + '\n');

  // Should not throw — invalid regex is skipped
  const result = verifyClaimEvidence('valid pattern here');
  // Only the valid pattern should produce a check
  const validCheck = result.checks.find((c) => c.claim === 'valid pattern');
  assert.ok(validCheck);
  cleanupStateFiles();
});

// ---------------------------------------------------------------------------
// loadJSON parse error
// ---------------------------------------------------------------------------

test('loadJSON returns empty object on corrupt JSON file', () => {
  cleanupStateFiles();
  const stateDir = path.dirname(gatesEngine.STATE_PATH);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(gatesEngine.STATE_PATH, 'not valid json!!!');
  const state = loadState();
  assert.deepEqual(state, {});
  cleanupStateFiles();
});

// ---------------------------------------------------------------------------
// Non-primary config loading edge cases
// ---------------------------------------------------------------------------

test('loadGatesConfig logs warning for corrupt auto-promoted gates file', () => {
  withTempFeedbackDir((tmpFeedbackDir) => {
    const autoPath = getAutoGatesPath();
    fs.writeFileSync(autoPath, 'not json at all');
    // Should not throw — corrupt auto gates are silently skipped with console.error
    const config = loadGatesConfig();
    assert.ok(Array.isArray(config.gates));
    assert.ok(config.gates.length > 0); // still has default gates
  });
});

test('loadGatesConfig throws when auto gates file has no gates array', () => {
  withTempFeedbackDir((tmpFeedbackDir) => {
    const autoPath = getAutoGatesPath();
    fs.writeFileSync(autoPath, JSON.stringify({ version: 1, noGatesHere: true }));
    // loadOne returns undefined for non-primary with missing gates array,
    // then .map() on undefined throws a TypeError
    assert.throws(() => loadGatesConfig(), /Cannot read properties of undefined/);
  });
});

// ---------------------------------------------------------------------------
// loadClaimGates with missing/invalid default claim gates
// ---------------------------------------------------------------------------

test('loadClaimGates throws when default claim gates file is missing', () => {
  const origPath = gatesEngine.DEFAULT_CLAIM_GATES_PATH;
  // Temporarily point to a nonexistent file
  gatesEngine.DEFAULT_CLAIM_GATES_PATH = makeTempPath('nonexistent-claim-gates.json');
  try {
    assert.throws(() => loadClaimGates(), /not found/);
  } finally {
    gatesEngine.DEFAULT_CLAIM_GATES_PATH = origPath;
  }
});

test('loadClaimGates throws when default claim gates has invalid format', () => {
  const origPath = gatesEngine.DEFAULT_CLAIM_GATES_PATH;
  const tmpFile = makeTempPath('invalid-claims.json');
  fs.writeFileSync(tmpFile, JSON.stringify({ version: 1, notClaims: true }));
  gatesEngine.DEFAULT_CLAIM_GATES_PATH = tmpFile;
  try {
    assert.throws(() => loadClaimGates(), /Invalid claim gates/);
  } finally {
    gatesEngine.DEFAULT_CLAIM_GATES_PATH = origPath;
    fs.rmSync(tmpFile, { force: true });
  }
});

// ---------------------------------------------------------------------------
// evaluateSecretGuard with secret detected (covers recordSecretViolation)
// ---------------------------------------------------------------------------

test('evaluateSecretGuard blocks and records violation for detected secrets', () => {
  withTempFeedbackDir((tmpFeedbackDir) => {
    const stripeKey = buildStripeKey();
    const result = evaluateSecretGuard({
      tool_name: 'Bash',
      tool_input: { command: `echo ${stripeKey}` },
    });
    assert.ok(result);
    assert.equal(result.decision, 'deny');
    assert.equal(result.gate, 'secret-exfiltration');
  });
});

test('evaluateSecretGuard records violation with file_path context', () => {
  withTempFeedbackDir((tmpFeedbackDir) => {
    const filePath = path.join(tmpFeedbackDir, 'secrets.txt');
    const stripeKey = buildStripeKey();
    fs.writeFileSync(filePath, `SECRET=${stripeKey}\n`);

    const result = evaluateSecretGuard({
      tool_name: 'Read',
      tool_input: { file_path: filePath },
      cwd: tmpFeedbackDir,
    });
    assert.ok(result);
    assert.equal(result.decision, 'deny');
  });
});

test('evaluateSecretGuard handles missing tool_input gracefully', () => {
  // No secrets in empty input
  const result = evaluateSecretGuard({});
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// Three-tier approval routing: approve and log gate actions
// ---------------------------------------------------------------------------

test('evaluateGates returns approve decision for approve-action gate', () => {
  cleanupStateFiles();
  const tmpConfig = makeTempPath('approve-action-test.json');
  fs.writeFileSync(tmpConfig, JSON.stringify({
    version: 1,
    gates: [{
      id: 'test-approve-gate',
      pattern: 'deploy.*prod',
      action: 'approve',
      message: 'Production deploy requires approval',
      severity: 'high',
    }],
  }));

  try {
    const result = evaluateGates('Bash', { command: 'deploy to prod' }, tmpConfig);
    assert.ok(result);
    assert.equal(result.decision, 'approve');
    assert.equal(result.gate, 'test-approve-gate');
    assert.equal(result.requiresApproval, true);
    assert.equal(result.severity, 'high');
  } finally {
    fs.rmSync(tmpConfig, { force: true });
    cleanupStateFiles();
  }
});

test('evaluateGates returns log decision and continues for log-action gate', () => {
  cleanupStateFiles();
  const tmpConfig = makeTempPath('log-action-test.json');
  fs.writeFileSync(tmpConfig, JSON.stringify({
    version: 1,
    gates: [{
      id: 'test-log-gate',
      pattern: '.*style.*',
      action: 'log',
      message: 'Style violation logged',
      severity: 'low',
    }],
  }));

  try {
    // log gates should NOT block — evaluateGates returns null when only log gates fire
    const result = evaluateGates('Bash', { command: 'fix style issues' }, tmpConfig);
    assert.equal(result, null);

    // But the stat should be recorded
    const stats = loadStats();
    assert.ok(stats.logged >= 1, 'logged stat should be incremented');
  } finally {
    fs.rmSync(tmpConfig, { force: true });
    cleanupStateFiles();
  }
});

test('evaluateGatesAsync returns approve decision for approve-action gate', async () => {
  cleanupStateFiles();
  const tmpConfig = makeTempPath('async-approve-test.json');
  fs.writeFileSync(tmpConfig, JSON.stringify({
    version: 1,
    gates: [{
      id: 'async-approve-gate',
      pattern: 'migrate.*schema',
      action: 'approve',
      message: 'Schema migration requires approval',
      severity: 'high',
    }],
  }));

  try {
    const result = await evaluateGatesAsync('Bash', { command: 'migrate schema v2' }, tmpConfig);
    assert.ok(result);
    assert.equal(result.decision, 'approve');
    assert.equal(result.gate, 'async-approve-gate');
    assert.equal(result.requiresApproval, true);
  } finally {
    fs.rmSync(tmpConfig, { force: true });
    cleanupStateFiles();
  }
});

test('evaluateGatesAsync log gate does not block and records stat', async () => {
  cleanupStateFiles();
  const tmpConfig = makeTempPath('async-log-test.json');
  fs.writeFileSync(tmpConfig, JSON.stringify({
    version: 1,
    gates: [{
      id: 'async-log-gate',
      pattern: '.*warning.*',
      action: 'log',
      message: 'Non-critical warning logged',
      severity: 'low',
    }],
  }));

  try {
    const result = await evaluateGatesAsync('Bash', { command: 'process warning event' }, tmpConfig);
    assert.equal(result, null);

    const stats = loadStats();
    assert.ok(stats.logged >= 1, 'logged stat should be incremented');
  } finally {
    fs.rmSync(tmpConfig, { force: true });
    cleanupStateFiles();
  }
});

test('recordStat tracks pendingApproval and logged counters', () => {
  cleanupStateFiles();
  recordStat('test-approve', 'approve', { id: 'test-approve', severity: 'high' });
  recordStat('test-log', 'log', { id: 'test-log', severity: 'low' });

  const stats = loadStats();
  assert.ok(stats.pendingApproval >= 1, 'pendingApproval should be incremented');
  assert.ok(stats.logged >= 1, 'logged should be incremented');
  assert.ok(stats.byGate['test-approve']?.pendingApproval >= 1);
  assert.ok(stats.byGate['test-log']?.logged >= 1);
  cleanupStateFiles();
});

test('approve gate blocks before log gate fires on same input', () => {
  cleanupStateFiles();
  const tmpConfig = makeTempPath('approve-before-log-test.json');
  fs.writeFileSync(tmpConfig, JSON.stringify({
    version: 1,
    gates: [
      {
        id: 'approve-first',
        pattern: 'deploy.*prod',
        action: 'approve',
        message: 'Needs approval',
        severity: 'high',
      },
      {
        id: 'log-second',
        pattern: 'deploy.*prod',
        action: 'log',
        message: 'Logged deploy',
        severity: 'low',
      },
    ],
  }));

  try {
    const result = evaluateGates('Bash', { command: 'deploy to prod' }, tmpConfig);
    assert.ok(result);
    assert.equal(result.decision, 'approve');
    assert.equal(result.gate, 'approve-first');
  } finally {
    fs.rmSync(tmpConfig, { force: true });
    cleanupStateFiles();
  }
});
