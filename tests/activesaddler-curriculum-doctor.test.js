'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const {
  ActiveSaddlerCurriculum,
  COMPARISON_MAP,
  CANONICAL_FAILURE_ARMS,
  runDoctor
} = require('../scripts/activesaddler-curriculum-doctor');

const SCRIPT_PATH = path.join(__dirname, '../scripts/activesaddler-curriculum-doctor.js');

test('activesaddler: verify comparison map exposes 4 practices and anti-clone rules', () => {
  assert.equal(COMPARISON_MAP.verdict, 'COMPARE_NOT_CLONE');
  assert.equal(COMPARISON_MAP.stolenPractices.length, 4);
  const practiceNames = COMPARISON_MAP.stolenPractices.map(p => p.practice);
  assert.ok(practiceNames.includes('Dynamic Failure-Pattern Arms'));
  assert.ok(practiceNames.includes('Discounted UCB Policy'));
  assert.ok(practiceNames.includes('Fail-Fast Rule Prioritization'));
  assert.ok(practiceNames.includes('Automated Drift Detection'));
  assert.ok(COMPARISON_MAP.antiCloneRules.some(r => r.includes('NEVER install PyTorch')));
});

test('activesaddler: initializes canonical arms correctly', () => {
  const curriculum = new ActiveSaddlerCurriculum();
  assert.equal(curriculum.arms.size, CANONICAL_FAILURE_ARMS.length);
  assert.ok(curriculum.arms.has('arm:force-push-main'));
  assert.ok(curriculum.arms.has('arm:bypass-branch-protection'));
  assert.ok(curriculum.arms.has('arm:token-shunt-overflow'));
});

test('activesaddler: recordObservation applies discounting and updates counts', () => {
  const curriculum = new ActiveSaddlerCurriculum({ discountFactor: 0.9 });
  curriculum.recordObservation('arm:force-push-main', { violation: true, latencyMs: 0.5 });
  
  const arm = curriculum.arms.get('arm:force-push-main');
  assert.equal(arm.pulls, 1);
  assert.equal(arm.violations, 1);
  assert.equal(arm.discountedViolations, 1.0);

  // Subsequent observation causes discounting
  curriculum.recordObservation('arm:bypass-branch-protection', { violation: false, latencyMs: 0.2 });
  assert.ok(arm.discountedViolations < 1.0);
  assert.equal(curriculum.totalSteps, 2);
});

test('activesaddler: unvisited arms receive exploration optimism', () => {
  const curriculum = new ActiveSaddlerCurriculum();
  // Pull one arm so total steps > 0
  curriculum.recordObservation('arm:token-shunt-overflow', { violation: false });

  const unvisitedScore = curriculum.computeArmScore('arm:bypass-branch-protection');
  // Unvisited critical arm has high optimistic score (10 * multiplier = 30)
  assert.equal(unvisitedScore, 30.0);
});

test('activesaddler: prioritizeRules orders rules by highest curriculum risk within <1ms', () => {
  const curriculum = new ActiveSaddlerCurriculum();

  // Simulate multiple violations on token shunt
  for (let i = 0; i < 5; i++) {
    curriculum.recordObservation('arm:token-shunt-overflow', { violation: true });
  }

  const sampleRules = [
    { id: 'rule:git-clean', description: 'Prevent untracked deletion' },
    { id: 'rule:token-shunt', description: 'Token shunt dump limit' },
    { id: 'rule:branch-protection', description: 'Branch protection reservation' }
  ];

  const result = curriculum.prioritizeRules(sampleRules);
  assert.ok(result.prioritizedRules.length === 3);
  assert.ok(result.evaluationLatencyMs < 1.0);
  assert.equal(result.withinBudget, true);

  // Verify descending order
  for (let i = 0; i < result.prioritizedRules.length - 1; i++) {
    assert.ok(
      result.prioritizedRules[i].curriculumScore >= result.prioritizedRules[i + 1].curriculumScore
    );
  }
});

test('activesaddler: detectDrift identifies concentrated failure clusters', () => {
  const curriculum = new ActiveSaddlerCurriculum();

  // Record 1 clean, then 6 token shunt failures
  curriculum.recordObservation('arm:force-push-main', { violation: false });
  for (let i = 0; i < 6; i++) {
    curriculum.recordObservation('arm:token-shunt-overflow', { violation: true });
  }

  const drift = curriculum.detectDrift(10);
  assert.equal(drift.driftDetected, true);
  assert.equal(drift.dominantArmId, 'arm:token-shunt-overflow');
  assert.ok(drift.violationShare >= 0.6);
  assert.ok(drift.recommendation.includes('arm:token-shunt-overflow'));
});

test('activesaddler: CLI runs cleanly with --json and --map-only', () => {
  const mapRun = spawnSync('node', [SCRIPT_PATH, '--map-only'], { encoding: 'utf8' });
  assert.equal(mapRun.status, 0);
  const mapJson = JSON.parse(mapRun.stdout);
  assert.equal(mapJson.verdict, 'COMPARE_NOT_CLONE');

  const jsonRun = spawnSync('node', [SCRIPT_PATH, '--json'], { encoding: 'utf8' });
  assert.equal(jsonRun.status, 0);
  const output = JSON.parse(jsonRun.stdout);
  assert.equal(output.status, 'HEALTHY');
  assert.equal(output.passedBudget, true);
  assert.ok(output.arms.length >= 5);
});
