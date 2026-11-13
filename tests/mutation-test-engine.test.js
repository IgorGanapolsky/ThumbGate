'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { MutationTestEngine } = require('../src/mutation-test-engine');

test('MutationTestEngine generates mutants and detects logic mutations', (t) => {
  const engine = new MutationTestEngine();
  const sampleCode = `
function isAuthorized(user, role) {
  if (user.role === role && user.isActive) {
    return true;
  }
  return false;
}
`;

  const mutants = engine.generateMutants(sampleCode);
  assert.ok(mutants.length >= 2);

  // Check equality mutation
  const eqMutant = mutants.find((m) => m.operator === 'invert_equality');
  assert.ok(eqMutant);
  assert.ok(eqMutant.mutated.includes('!=='));

  // Check boolean inversion
  const boolMutant = mutants.find((m) => m.operator === 'invert_boolean_true');
  assert.ok(boolMutant);
  assert.ok(boolMutant.mutated.includes('return false'));
});

test('MutationTestEngine evaluates test harness and calculates mutation score', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutation-test-'));
  const srcFile = path.join(tmpDir, 'calc.js');
  const code = `
function add(a, b) {
  return a + b;
}
module.exports = { add };
`;
  fs.writeFileSync(srcFile, code);

  const engine = new MutationTestEngine({ minScoreThreshold: 0.5 });
  // Using a test command that checks add(2, 3) === 5
  const testCmd = `node -e "const { add } = require('./calc'); if (add(2, 3) !== 5) process.exit(1);"`;

  const result = engine.evaluateTestHarness(srcFile, testCmd, { maxMutants: 5 });
  assert.ok(result.mutantsEvaluated > 0);
  assert.equal(result.killedCount, 1); // Mutated 'a - b' causes add(2, 3) to equal -1 != 5, killing mutant!
  assert.equal(result.survivedCount, 0);
  assert.equal(result.ok, true);

  // File was restored
  assert.equal(fs.readFileSync(srcFile, 'utf8'), code);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
