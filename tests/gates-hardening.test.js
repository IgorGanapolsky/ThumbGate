// tests/gates-hardening.test.js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { 
  evaluateGates, 
  setConstraint, 
  satisfyCondition,
  STATE_PATH,
  CONSTRAINTS_PATH
} = require('../scripts/gates-engine');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-gates-test-'));
}

test('local_only constraint blocks git writes', (t) => {
  const tmpDir = makeTmpDir();
  // Override paths for testing
  const statePath = path.join(tmpDir, 'gate-state.json');
  const constraintsPath = path.join(tmpDir, 'session-constraints.json');
  
  // We need to mock the paths in the module or rely on the fact that evaluateGates
  // uses the variables exported from the module. Since they are constants,
  // we might need to update the module to allow overrides.
  // For now, let's use the actual scripts but set environment variables if possible.
  // Actually, I'll just temporarily swap the files in the global exports.
  
  const originalStatePath = STATE_PATH;
  const originalConstraintsPath = CONSTRAINTS_PATH;
  
  // This is a bit hacky but works for unit testing without refactoring the whole module
  require('../scripts/gates-engine').STATE_PATH = statePath;
  require('../scripts/gates-engine').CONSTRAINTS_PATH = constraintsPath;

  t.after(() => {
    require('../scripts/gates-engine').STATE_PATH = originalStatePath;
    require('../scripts/gates-engine').CONSTRAINTS_PATH = originalConstraintsPath;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  // 1. Initial state: allow git add
  let result = evaluateGates('Bash', { command: 'git add .' });
  assert.strictEqual(result, null, 'should allow git add by default');

  // 2. Set local_only=true
  setConstraint('local_only', true);
  
  // 3. Verify git add is now blocked
  result = evaluateGates('Bash', { command: 'git add .' });
  assert.ok(result, 'should block git add when local_only=true');
  assert.strictEqual(result.decision, 'deny');
  assert.strictEqual(result.gate, 'local-only-git-writes');

  // 4. Verify gh pr create is also blocked
  result = evaluateGates('Bash', { command: 'gh pr create' });
  assert.ok(result, 'should block gh pr create when local_only=true');
  assert.strictEqual(result.gate, 'local-only-git-writes');
});

test('gh pr create requires explicit permission', (t) => {
  const tmpDir = makeTmpDir();
  const statePath = path.join(tmpDir, 'gate-state.json');
  const constraintsPath = path.join(tmpDir, 'session-constraints.json');
  
  const originalStatePath = STATE_PATH;
  const originalConstraintsPath = CONSTRAINTS_PATH;
  require('../scripts/gates-engine').STATE_PATH = statePath;
  require('../scripts/gates-engine').CONSTRAINTS_PATH = constraintsPath;

  t.after(() => {
    require('../scripts/gates-engine').STATE_PATH = originalStatePath;
    require('../scripts/gates-engine').CONSTRAINTS_PATH = originalConstraintsPath;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  // Ensure local_only is NOT set for this test
  setConstraint('local_only', false);

  // 1. Initially blocked
  let result = evaluateGates('Bash', { command: 'gh pr create --title "test"' });
  assert.ok(result, 'should block gh pr create without permission');
  assert.strictEqual(result.gate, 'gh-pr-create-restricted');

  // 2. Satisfy gate
  satisfyCondition('pr_create_allowed', 'User said go ahead');

  // 3. Now allowed
  result = evaluateGates('Bash', { command: 'gh pr create --title "test"' });
  assert.strictEqual(result, null, 'should allow gh pr create after permission given');
});

test('evaluateGates returns null for commands that match no gate', (t) => {
  const tmpDir = makeTmpDir();
  const statePath = path.join(tmpDir, 'gate-state.json');
  const constraintsPath = path.join(tmpDir, 'session-constraints.json');

  const originalStatePath = STATE_PATH;
  const originalConstraintsPath = CONSTRAINTS_PATH;
  require('../scripts/gates-engine').STATE_PATH = statePath;
  require('../scripts/gates-engine').CONSTRAINTS_PATH = constraintsPath;

  t.after(() => {
    require('../scripts/gates-engine').STATE_PATH = originalStatePath;
    require('../scripts/gates-engine').CONSTRAINTS_PATH = originalConstraintsPath;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  const result = evaluateGates('Bash', { command: 'echo hello' });
  assert.strictEqual(result, null, 'should return null for non-matching command');
});

test('evaluateGates blocks git push when local_only=true', (t) => {
  const tmpDir = makeTmpDir();
  const statePath = path.join(tmpDir, 'gate-state.json');
  const constraintsPath = path.join(tmpDir, 'session-constraints.json');

  const originalStatePath = STATE_PATH;
  const originalConstraintsPath = CONSTRAINTS_PATH;
  require('../scripts/gates-engine').STATE_PATH = statePath;
  require('../scripts/gates-engine').CONSTRAINTS_PATH = constraintsPath;

  t.after(() => {
    require('../scripts/gates-engine').STATE_PATH = originalStatePath;
    require('../scripts/gates-engine').CONSTRAINTS_PATH = originalConstraintsPath;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  setConstraint('local_only', true);

  const result = evaluateGates('Bash', { command: 'git push origin main' });
  assert.ok(result, 'should block git push when local_only=true');
  assert.strictEqual(result.decision, 'deny');
});

test('evaluateGates with Edit tool input uses file_path', (t) => {
  const tmpDir = makeTmpDir();
  const statePath = path.join(tmpDir, 'gate-state.json');
  const constraintsPath = path.join(tmpDir, 'session-constraints.json');

  const originalStatePath = STATE_PATH;
  const originalConstraintsPath = CONSTRAINTS_PATH;
  require('../scripts/gates-engine').STATE_PATH = statePath;
  require('../scripts/gates-engine').CONSTRAINTS_PATH = constraintsPath;

  t.after(() => {
    require('../scripts/gates-engine').STATE_PATH = originalStatePath;
    require('../scripts/gates-engine').CONSTRAINTS_PATH = originalConstraintsPath;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  const result = evaluateGates('Edit', { file_path: '/tmp/safe-file.txt' });
  assert.strictEqual(result, null, 'should allow editing non-sensitive files');
});
