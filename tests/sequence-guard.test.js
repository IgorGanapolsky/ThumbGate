'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { evaluateSequenceState } = require('../scripts/sequence-guard');
const { setTaskScope } = require('../scripts/gates-engine');

const STATE_DIR = process.env.THUMBGATE_STATE_DIR ||
                  (process.env.XDG_STATE_HOME ? path.join(process.env.XDG_STATE_HOME, 'thumbgate') : null) ||
                  (process.env.CODEX_SANDBOX ? path.join(os.tmpdir(), 'thumbgate') : null) ||
                  path.join(process.env.HOME || '/tmp', '.thumbgate');

const SEQUENCE_STATE_PATH = path.join(STATE_DIR, 'sequence-state.json');
const SESSION_ACTIONS_PATH = path.join(STATE_DIR, 'session-actions.json');

function resetSequenceState() {
  try { fs.rmSync(SEQUENCE_STATE_PATH, { force: true }); } catch { /* ignore */ }
}

function clearTestsPassed() {
  try {
    if (fs.existsSync(SESSION_ACTIONS_PATH)) {
      const actions = JSON.parse(fs.readFileSync(SESSION_ACTIONS_PATH, 'utf8'));
      delete actions.tests_passed;
      fs.writeFileSync(SESSION_ACTIONS_PATH, JSON.stringify(actions));
    }
  } catch { /* ignore */ }
}

function resetGovernanceState() {
  // Clear via setTaskScope so session-scoped governance files
  // (governance-state.<THUMBGATE_SESSION_AGENT>.json) are cleared too.
  try { setTaskScope({ clear: true }); } catch { /* ignore */ }
}

const REPO = process.cwd();

test('sequence-guard - edit then unverified commit in the same repo is blocked', () => {
  resetSequenceState();
  clearTestsPassed();
  resetGovernanceState();

  const edit = evaluateSequenceState('Edit', { file_path: path.join(REPO, 'src/api/server.js') });
  assert.equal(edit, null);
  const commit = evaluateSequenceState('Bash', { command: 'git commit -m "fixed"', repoPath: REPO });
  assert.ok(commit, 'expected a block');
  assert.equal(commit.decision, 'deny');
  assert.equal(commit.gate, 'workflow-sequence-violation');
  resetSequenceState();
});

test('sequence-guard - allows commit after tests_passed clears the repo', () => {
  resetSequenceState();
  resetGovernanceState();

  evaluateSequenceState('Edit', { file_path: path.join(REPO, 'src/api/server.js') });
  const actions = fs.existsSync(SESSION_ACTIONS_PATH)
    ? JSON.parse(fs.readFileSync(SESSION_ACTIONS_PATH, 'utf8'))
    : {};
  actions.tests_passed = { timestamp: Date.now() + 1000, metadata: {} };
  fs.writeFileSync(SESSION_ACTIONS_PATH, JSON.stringify(actions));

  const result = evaluateSequenceState('Bash', { command: 'git commit -m "verified"', repoPath: REPO });
  assert.equal(result, null);
  resetSequenceState();
  clearTestsPassed();
});

test('sequence-guard - edit in one repo does NOT block a commit in another (per-repo isolation)', () => {
  resetSequenceState();
  clearTestsPassed();
  resetGovernanceState();

  // Edit a file in this repo (marks THIS repo dirty)...
  evaluateSequenceState('Edit', { file_path: path.join(REPO, 'src/api/server.js') });
  // ...then commit in an unrelated path. Previously the global dirty flag blocked this.
  const otherRepo = os.tmpdir();
  const commit = evaluateSequenceState('Bash', { command: 'git commit -m wip', repoPath: otherRepo });
  assert.equal(commit, null, 'a commit in an unrelated repo must not be blocked by this repo\'s edits');

  resetSequenceState();
});

test('sequence-guard - task scope active - edit outside allowedPaths is blocked', () => {
  resetSequenceState();
  clearTestsPassed();
  resetGovernanceState();

  // Use setTaskScope so the write lands on the same session-scoped
  // governance path loadGovernanceState / sequence-guard read.
  setTaskScope({ allowedPaths: ['src/api/**'], repoPath: REPO });

  // Editing a file inside allowedPaths -> should be allowed (returns null)
  const allowedEdit = evaluateSequenceState('Edit', { file_path: path.join(REPO, 'src/api/server.js') });
  assert.equal(allowedEdit, null);

  // Editing a file outside allowedPaths -> should be blocked
  const blockedEdit = evaluateSequenceState('Edit', { file_path: path.join(REPO, 'tests/sequence-guard.test.js') });
  assert.ok(blockedEdit);
  assert.equal(blockedEdit.decision, 'deny');
  assert.equal(blockedEdit.gate, 'task-scope-violation');

  resetSequenceState();
  resetGovernanceState();
});

test('sequence-guard - task scope active - commit/complete with modified files outside allowedPaths is blocked', () => {
  resetSequenceState();
  clearTestsPassed();
  resetGovernanceState();

  // Write a temporary untracked file to ensure there is a modified file outside allowedPaths
  const tempFile = path.join(REPO, 'tests/temp-test-file.txt');
  fs.writeFileSync(tempFile, 'temp content', 'utf8');

  try {
    setTaskScope({ allowedPaths: ['dummy/**'], repoPath: REPO });

    // Commit attempt should fail since we have a modified file that doesn't match 'dummy/**'
    const commit = evaluateSequenceState('Bash', { command: 'git commit -m "wip"', repoPath: REPO });
    assert.ok(commit);
    assert.equal(commit.decision, 'deny');
    assert.equal(commit.gate, 'task-scope-violation');
  } finally {
    try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
  }

  resetSequenceState();
  resetGovernanceState();
});
