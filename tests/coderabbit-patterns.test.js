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
  
  // 1. Missing primer.md should return early
  if (fs.existsSync(TEST_PRIMER)) fs.unlinkSync(TEST_PRIMER);
  const noPrimer = ts.getTrajectoryScore();
  assert.strictEqual(noPrimer.score, 0);
  assert.strictEqual(noPrimer.isDrifting, false);

  // 2. Empty changed files
  fs.writeFileSync(TEST_PRIMER, 'Goal: Fix script.js');
  const emptyChanged = ts.getTrajectoryScore({ changedFiles: [] });
  assert.strictEqual(emptyChanged.score, 0);
  assert.strictEqual(emptyChanged.isDrifting, false);

  // 3. Allowed changed files (no drift)
  const noDrift = ts.getTrajectoryScore({ changedFiles: ['script.js'] });
  assert.strictEqual(noDrift.score, 1);
  assert.strictEqual(noDrift.isDrifting, false);

  // 4. Drifting files (driftRatio > 0.6 and changedFiles.length > 3)
  const drift = ts.getTrajectoryScore({ changedFiles: ['auth.js', 'db.js', 'api.js', 'script.js'] });
  assert.ok(drift.score < 0.4);
  assert.strictEqual(drift.isDrifting, true);
  assert.ok(drift.message.includes('Strategic Drift Detected'));

  if (fs.existsSync(TEST_PRIMER)) fs.unlinkSync(TEST_PRIMER);
});
