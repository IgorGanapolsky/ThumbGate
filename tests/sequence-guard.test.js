'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { evaluateSequenceState } = require('../scripts/sequence-guard');

const SEQUENCE_STATE_PATH = path.join(process.env.HOME || '/tmp', '.thumbgate', 'sequence-state.json');
const SESSION_ACTIONS_PATH = path.join(process.env.HOME || '/tmp', '.thumbgate', 'session-actions.json');

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

// process.cwd() during `node --test` is the repo root, which is a real git repo, so
// edits + commits here resolve to the same repo key.
const REPO = process.cwd();

test('sequence-guard - edit then unverified commit in the same repo is blocked', () => {
  resetSequenceState();
  clearTestsPassed();
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
  // Edit a file in this repo (marks THIS repo dirty)...
  evaluateSequenceState('Edit', { file_path: path.join(REPO, 'src/api/server.js') });
  // ...then commit in an unrelated path. Previously the global dirty flag blocked this.
  const otherRepo = os.tmpdir();
  const commit = evaluateSequenceState('Bash', { command: 'git commit -m wip', repoPath: otherRepo });
  assert.equal(commit, null, 'a commit in an unrelated repo must not be blocked by this repo\'s edits');
  resetSequenceState();
});
