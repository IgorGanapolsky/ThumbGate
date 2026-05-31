'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const pg = require('../scripts/plan-gate');
const ts = require('../scripts/trajectory-scorer');

const TEST_PLAN = path.join(process.cwd(), 'PLAN.md');

test.beforeEach(() => {
  if (fs.existsSync(TEST_PLAN)) fs.unlinkSync(TEST_PLAN);
});

test.after(() => {
  if (fs.existsSync(TEST_PLAN)) fs.unlinkSync(TEST_PLAN);
});

test('Plan Gate - Warns if PLAN.md is missing for risk tools', () => {
  const result = pg.evaluatePlanGate('Bash', { command: 'git commit -m "test"' });
  assert.strictEqual(result.gate, 'plan-gate-missing');
  assert.strictEqual(result.decision, 'warn');
});

test('Plan Gate - Passes if PLAN.md exists and matches', () => {
  fs.writeFileSync(TEST_PLAN, 'Intent: Update index.js\nAssumes: node is installed.');
  const result = pg.evaluatePlanGate('Write', { filePath: 'index.js' });
  // Should return null (allowed) or assumption warning
  if (result) {
    assert.strictEqual(result.gate, 'plan-gate-assumptions');
  } else {
    assert.strictEqual(result, null);
  }
});

test('Plan Gate - Detects Drift', () => {
  fs.writeFileSync(TEST_PLAN, 'Intent: Fix README.md');
  const result = pg.evaluatePlanGate('Write', { filePath: 'auth.js' });
  assert.strictEqual(result.gate, 'plan-gate-drift');
  assert.strictEqual(result.decision, 'warn');
});

test('Assumption Extraction - Finds keywords', () => {
  const content = 'Pre-requisite: DB is up.\nImplicit: API is open.\nAssumption: user is admin.';
  const assumptions = pg.extractAssumptions(content);
  assert.strictEqual(assumptions.length, 3);
  assert.ok(assumptions.includes('DB is up.'));
  assert.ok(assumptions.includes('API is open.'));
  assert.ok(assumptions.includes('user is admin.'));
});

test('Trajectory Scorer - Measures Drift', () => {
  const TEST_PRIMER = path.join(process.cwd(), 'primer.md');
  fs.writeFileSync(TEST_PRIMER, 'Goal: Fix script.js');
  
  // Mock git diff by creating a dummy repo or just assuming empty
  // Since we are in the real repo, this might return actual diffs
  const result = ts.getTrajectoryScore();
  
  assert.ok(result.hasOwnProperty('score'));
  assert.ok(result.hasOwnProperty('isDrifting'));
  
  if (fs.existsSync(TEST_PRIMER)) fs.unlinkSync(TEST_PRIMER);
});
