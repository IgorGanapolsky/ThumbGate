'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const GATES_ENGINE_MODULE_ID = require.resolve('../scripts/gates-engine');
const HYBRID_FEEDBACK_MODULE_ID = require.resolve('../scripts/hybrid-feedback-context');
const RATE_LIMITER_MODULE_ID = require.resolve('../scripts/rate-limiter');

function createHarness() {
  const savedEnv = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    THUMBGATE_FEEDBACK_DIR: process.env.THUMBGATE_FEEDBACK_DIR,
    THUMBGATE_API_KEY: process.env.THUMBGATE_API_KEY,
    THUMBGATE_PRO_KEY: process.env.THUMBGATE_PRO_KEY,
    THUMBGATE_FEEDBACK_LOG: process.env.THUMBGATE_FEEDBACK_LOG,
    THUMBGATE_FEEDBACK_INBOX: process.env.THUMBGATE_FEEDBACK_INBOX,
    THUMBGATE_PENDING_SYNC: process.env.THUMBGATE_PENDING_SYNC,
    THUMBGATE_ATTRIBUTED_FEEDBACK: process.env.THUMBGATE_ATTRIBUTED_FEEDBACK,
    THUMBGATE_GUARDS_PATH: process.env.THUMBGATE_GUARDS_PATH,
  };
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-gates-home-'));
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-gates-repo-'));
  const filePath = path.join(repoDir, 'safe-file.txt');
  const moduleIds = [GATES_ENGINE_MODULE_ID, HYBRID_FEEDBACK_MODULE_ID, RATE_LIMITER_MODULE_ID];

  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  process.env.THUMBGATE_FEEDBACK_DIR = path.join(homeDir, '.thumbgate/runtime');
  process.env.THUMBGATE_FEEDBACK_LOG = path.join(homeDir, '.thumbgate/runtime', 'feedback-log.jsonl');
  process.env.THUMBGATE_FEEDBACK_INBOX = path.join(homeDir, '.thumbgate/runtime', 'inbox.jsonl');
  process.env.THUMBGATE_PENDING_SYNC = path.join(homeDir, '.thumbgate/runtime', 'pending-sync.jsonl');
  process.env.THUMBGATE_ATTRIBUTED_FEEDBACK = path.join(homeDir, '.thumbgate/runtime', 'attributed-feedback.jsonl');
  process.env.THUMBGATE_GUARDS_PATH = path.join(homeDir, '.thumbgate/runtime', 'pretool-guards.json');
  delete process.env.THUMBGATE_API_KEY;
  delete process.env.THUMBGATE_PRO_KEY;

  for (const moduleId of moduleIds) {
    delete require.cache[moduleId];
  }

  execSync('git init', { cwd: repoDir, stdio: 'ignore' });
  execSync('git config user.email "thumbgate-tests@example.com"', { cwd: repoDir, stdio: 'ignore' });
  execSync('git config user.name "ThumbGate Tests"', { cwd: repoDir, stdio: 'ignore' });
  execSync('git config commit.gpgsign false', { cwd: repoDir, stdio: 'ignore' });
  fs.writeFileSync(filePath, 'base\n');
  execSync('git add safe-file.txt', { cwd: repoDir, stdio: 'ignore' });
  execSync('git commit -m "init"', { cwd: repoDir, stdio: 'ignore' });
  fs.writeFileSync(filePath, 'changed\n');

  const gates = require('../scripts/gates-engine');

  return {
    gates,
    repoDir,
    filePath,
    cleanup() {
      for (const moduleId of moduleIds) {
        delete require.cache[moduleId];
      }
      if (savedEnv.HOME !== undefined) process.env.HOME = savedEnv.HOME;
      else delete process.env.HOME;
      if (savedEnv.USERPROFILE !== undefined) process.env.USERPROFILE = savedEnv.USERPROFILE;
      else delete process.env.USERPROFILE;
      if (savedEnv.THUMBGATE_FEEDBACK_DIR !== undefined) process.env.THUMBGATE_FEEDBACK_DIR = savedEnv.THUMBGATE_FEEDBACK_DIR;
      else delete process.env.THUMBGATE_FEEDBACK_DIR;
      if (savedEnv.THUMBGATE_API_KEY !== undefined) process.env.THUMBGATE_API_KEY = savedEnv.THUMBGATE_API_KEY;
      else delete process.env.THUMBGATE_API_KEY;
      if (savedEnv.THUMBGATE_PRO_KEY !== undefined) process.env.THUMBGATE_PRO_KEY = savedEnv.THUMBGATE_PRO_KEY;
      else delete process.env.THUMBGATE_PRO_KEY;
      if (savedEnv.THUMBGATE_FEEDBACK_LOG !== undefined) process.env.THUMBGATE_FEEDBACK_LOG = savedEnv.THUMBGATE_FEEDBACK_LOG;
      else delete process.env.THUMBGATE_FEEDBACK_LOG;
      if (savedEnv.THUMBGATE_FEEDBACK_INBOX !== undefined) process.env.THUMBGATE_FEEDBACK_INBOX = savedEnv.THUMBGATE_FEEDBACK_INBOX;
      else delete process.env.THUMBGATE_FEEDBACK_INBOX;
      if (savedEnv.THUMBGATE_PENDING_SYNC !== undefined) process.env.THUMBGATE_PENDING_SYNC = savedEnv.THUMBGATE_PENDING_SYNC;
      else delete process.env.THUMBGATE_PENDING_SYNC;
      if (savedEnv.THUMBGATE_ATTRIBUTED_FEEDBACK !== undefined) process.env.THUMBGATE_ATTRIBUTED_FEEDBACK = savedEnv.THUMBGATE_ATTRIBUTED_FEEDBACK;
      else delete process.env.THUMBGATE_ATTRIBUTED_FEEDBACK;
      if (savedEnv.THUMBGATE_GUARDS_PATH !== undefined) process.env.THUMBGATE_GUARDS_PATH = savedEnv.THUMBGATE_GUARDS_PATH;
      else delete process.env.THUMBGATE_GUARDS_PATH;
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(repoDir, { recursive: true, force: true });
    },
  };
}

function declareTaskScope(gates, repoDir) {
  return gates.setTaskScope({
    allowedPaths: ['safe-file.txt'],
    summary: 'Allow edits to the temporary test file only.',
    repoPath: repoDir,
  });
}

test('local_only constraint blocks git writes', (t) => {
  const harness = createHarness();
  t.after(() => harness.cleanup());

  declareTaskScope(harness.gates, harness.repoDir);

  let result = harness.gates.evaluateGates('Bash', {
    command: 'git add safe-file.txt',
    cwd: harness.repoDir,
    repoPath: harness.repoDir,
  });
  assert.strictEqual(result, null, 'should allow scoped git add by default');

  harness.gates.setConstraint('local_only', true);

  result = harness.gates.evaluateGates('Bash', {
    command: 'git add safe-file.txt',
    cwd: harness.repoDir,
    repoPath: harness.repoDir,
  });
  assert.ok(result, 'should block git add when local_only=true');
  assert.strictEqual(result.decision, 'deny');
  assert.strictEqual(result.gate, 'local-only-git-writes');

  result = harness.gates.evaluateGates('Bash', {
    command: 'gh pr create',
    cwd: harness.repoDir,
    repoPath: harness.repoDir,
  });
  assert.ok(result, 'should block gh pr create when local_only=true');
  assert.strictEqual(result.gate, 'local-only-git-writes');
});

test('gh pr create requires explicit permission', (t) => {
  const harness = createHarness();
  t.after(() => harness.cleanup());

  declareTaskScope(harness.gates, harness.repoDir);
  harness.gates.setBranchGovernance({
    branchName: 'feat/thumbgate-hardening',
    baseBranch: 'main',
    prRequired: true,
    releaseVersion: '0.9.11',
  });
  harness.gates.setConstraint('local_only', false);

  let result = harness.gates.evaluateGates('Bash', {
    command: 'gh pr create --title "test"',
    cwd: harness.repoDir,
    repoPath: harness.repoDir,
  });
  assert.ok(result, 'should block gh pr create without permission');
  assert.strictEqual(result.gate, 'gh-pr-create-restricted');

  harness.gates.satisfyCondition('pr_create_allowed', 'User said go ahead');

  result = harness.gates.evaluateGates('Bash', {
    command: 'gh pr create --title "test"',
    cwd: harness.repoDir,
    repoPath: harness.repoDir,
  });
  assert.strictEqual(result, null, 'should allow gh pr create after permission given');
});

test('evaluateGates returns null for commands that match no gate', (t) => {
  const harness = createHarness();
  t.after(() => harness.cleanup());

  const result = harness.gates.evaluateGates('Bash', {
    command: 'echo hello',
    cwd: harness.repoDir,
    repoPath: harness.repoDir,
  });
  assert.strictEqual(result, null, 'should return null for non-matching command');
});

test('evaluateGates blocks git push when local_only=true', (t) => {
  const harness = createHarness();
  t.after(() => harness.cleanup());

  declareTaskScope(harness.gates, harness.repoDir);
  harness.gates.setConstraint('local_only', true);

  const result = harness.gates.evaluateGates('Bash', {
    command: 'git push origin main',
    cwd: harness.repoDir,
    repoPath: harness.repoDir,
  });
  assert.ok(result, 'should block git push when local_only=true');
  assert.strictEqual(result.decision, 'deny');
  assert.strictEqual(result.gate, 'local-only-git-writes');
});

test('evaluateGates with Edit tool input uses file_path', (t) => {
  const harness = createHarness();
  t.after(() => harness.cleanup());

  declareTaskScope(harness.gates, harness.repoDir);

  const result = harness.gates.evaluateGates('Edit', {
    file_path: 'safe-file.txt',
    cwd: harness.repoDir,
    repoPath: harness.repoDir,
  });
  assert.strictEqual(result, null, 'should allow editing scoped non-sensitive files');
});
