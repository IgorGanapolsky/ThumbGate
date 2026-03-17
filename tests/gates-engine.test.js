'use strict';

process.env.RLHF_PRO_MODE = '1';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  loadGatesConfig,
  matchesGate,
  evaluateGates,
  formatOutput,
  run,
  satisfyCondition,
  isConditionSatisfied,
  loadStats,
  saveStats,
  recordStat,
  loadState,
  saveState,
  STATE_PATH,
  STATS_PATH,
  CONSTRAINTS_PATH,
  TTL_MS,
} = require('../scripts/gates-engine');
const { getAutoGatesPath } = require('../scripts/auto-promote-gates');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cleanupStateFiles() {
  try { fs.unlinkSync(STATE_PATH); } catch {}
  try { fs.unlinkSync(STATS_PATH); } catch {}
  try { fs.unlinkSync(CONSTRAINTS_PATH); } catch {}
}

function withTempFeedbackDir(fn) {
  const originalFeedbackDir = process.env.RLHF_FEEDBACK_DIR;
  const originalProvider = process.env.RLHF_SECRET_SCAN_PROVIDER;
  const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-gates-secret-'));
  process.env.RLHF_FEEDBACK_DIR = tmpFeedbackDir;
  process.env.RLHF_SECRET_SCAN_PROVIDER = 'heuristic';
  try {
    return fn(tmpFeedbackDir);
  } finally {
    if (originalFeedbackDir === undefined) {
      delete process.env.RLHF_FEEDBACK_DIR;
    } else {
      process.env.RLHF_FEEDBACK_DIR = originalFeedbackDir;
    }
    if (originalProvider === undefined) {
      delete process.env.RLHF_SECRET_SCAN_PROVIDER;
    } else {
      process.env.RLHF_SECRET_SCAN_PROVIDER = originalProvider;
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
  const tmpFile = path.join(os.tmpdir(), 'bad-gates.json');
  fs.writeFileSync(tmpFile, 'not json');
  try {
    assert.throws(
      () => loadGatesConfig(tmpFile),
      /JSON/,
    );
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test('loadGatesConfig throws on missing gates array', () => {
  const tmpFile = path.join(os.tmpdir(), 'no-gates.json');
  fs.writeFileSync(tmpFile, JSON.stringify({ version: 1 }));
  try {
    assert.throws(
      () => loadGatesConfig(tmpFile),
      /missing "gates" array/,
    );
  } finally {
    fs.unlinkSync(tmpFile);
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
  const result = evaluateGates('Bash', { command: 'git push origin feature/x' });
  assert.ok(result);
  assert.equal(result.decision, 'deny');
  assert.equal(result.gate, 'push-without-thread-check');
  assert.ok(result.message.includes('review threads'));
});

test('evaluateGates returns deny for force push', () => {
  cleanupStateFiles();
  const result = evaluateGates('Bash', { command: 'git push --force origin main' });
  assert.ok(result);
  assert.equal(result.decision, 'deny');
  // Should match the first matching gate (push-without-thread-check or force-push)
  assert.ok(['push-without-thread-check', 'force-push'].includes(result.gate));
});

test('evaluateGates returns deny for protected branch push', () => {
  cleanupStateFiles();
  // Satisfy the thread check so push-without-thread-check doesn't fire first
  satisfyCondition('pr_threads_checked', 'test');
  const result = evaluateGates('Bash', { command: 'git push origin develop' });
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

test('evaluateGates returns null with bad RLHF_GATES_CONFIG', () => {
  const orig = process.env.RLHF_GATES_CONFIG;
  process.env.RLHF_GATES_CONFIG = '/tmp/nonexistent.json';
  const result = evaluateGates('Bash', { command: 'git push' });
  assert.equal(result, null); // graceful fallback
  if (orig) process.env.RLHF_GATES_CONFIG = orig;
  else delete process.env.RLHF_GATES_CONFIG;
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
