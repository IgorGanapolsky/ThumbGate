'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pg = require('../scripts/plan-gate');
const ts = require('../scripts/trajectory-scorer');

let testRoot;
let testPlan;

test.beforeEach(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-plan-gate-'));
  testPlan = path.join(testRoot, 'PLAN.md');
});

test.afterEach(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

test('Plan Gate - Warns if PLAN.md is missing for risk tools', () => {
  const result = pg.evaluatePlanGate('Bash', { command: 'git commit -m "test"' }, { projectRoot: testRoot });
  assert.strictEqual(result.gate, 'plan-gate-missing');
  assert.strictEqual(result.decision, 'warn');
});

test('Plan Gate - Passes if PLAN.md exists and matches', () => {
  fs.writeFileSync(testPlan, 'Intent: Update index.js\nAssumes: node is installed.\nRisks: None.');
  const result = pg.evaluatePlanGate('Write', { filePath: 'index.js' }, { projectRoot: testRoot });
  // Should return null (allowed) or assumption warning
  if (result) {
    assert.strictEqual(result.gate, 'plan-gate-assumptions');
  } else {
    assert.strictEqual(result, null);
  }
});

test('Plan Gate - Warns if Self-Critique/Risks are missing in PLAN.md', () => {
  fs.writeFileSync(testPlan, 'Intent: Update index.js\nGoal: Solve bug.');
  const result = pg.evaluatePlanGate('Write', { filePath: 'index.js' }, { projectRoot: testRoot });
  assert.strictEqual(result.gate, 'plan-gate-critique-missing');
  assert.strictEqual(result.decision, 'warn');
});

test('Plan Gate - Detects Drift', () => {
  fs.writeFileSync(testPlan, 'Intent: Fix README.md\nMitigations: None.');
  const result = pg.evaluatePlanGate('Write', { filePath: 'auth.js' }, { projectRoot: testRoot });
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
  const testPrimer = path.join(testRoot, 'primer.md');
  
  // 1. Missing primer.md should return early
  const noPrimer = ts.getTrajectoryScore({ projectRoot: testRoot });
  assert.strictEqual(noPrimer.score, 0);
  assert.strictEqual(noPrimer.isDrifting, false);

  // 2. Empty changed files
  fs.writeFileSync(testPrimer, 'Goal: Fix script.js');
  const emptyChanged = ts.getTrajectoryScore({ projectRoot: testRoot, changedFiles: [] });
  assert.strictEqual(emptyChanged.score, 0);
  assert.strictEqual(emptyChanged.isDrifting, false);

  // 3. Allowed changed files (no drift)
  const noDrift = ts.getTrajectoryScore({ projectRoot: testRoot, changedFiles: ['script.js'] });
  assert.strictEqual(noDrift.score, 1);
  assert.strictEqual(noDrift.isDrifting, false);

  // 4. Drifting files (driftRatio > 0.6 and changedFiles.length > 3)
  const drift = ts.getTrajectoryScore({ projectRoot: testRoot, changedFiles: ['auth.js', 'db.js', 'api.js', 'script.js'] });
  assert.ok(drift.score < 0.4);
  assert.strictEqual(drift.isDrifting, true);
  assert.ok(drift.message.includes('Strategic Drift Detected'));

});
