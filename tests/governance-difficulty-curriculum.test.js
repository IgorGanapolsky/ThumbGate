'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CURRICULUM_LEVELS,
  MAX_LEVEL,
  getLevelSpec,
  evaluateCurriculumLevel,
  runGovernanceCurriculum,
  suggestHarderNextRound,
} = require('../scripts/governance-difficulty-curriculum');

test('curriculum exposes five progressive levels with pass criteria', () => {
  assert.equal(MAX_LEVEL, 5);
  assert.equal(CURRICULUM_LEVELS.length, 5);
  assert.equal(getLevelSpec(1).name, 'basic_interdiction');
  assert.equal(getLevelSpec(5).name, 'rsi_frontier');
  assert.ok(getLevelSpec(3).required.researchFullCycle);
  assert.ok(getLevelSpec(5).required.hillclimbMinScore >= 90);
});

test('level 1 evaluates gateway interdiction without requiring full research cycle', () => {
  const result = evaluateCurriculumLevel({ level: 1, includeHillclimb: false });
  assert.equal(result.schema, 'thumbgate.governance_difficulty_curriculum.v1');
  assert.equal(result.level, 1);
  assert.equal(result.passed, true);
  assert.ok(result.checks.some((c) => c.id === 'gateway_blocks_adversarial' && c.passed));
  assert.ok(result.checks.some((c) => c.id === 'gateway_allows_benign' && c.passed));
  assert.equal(result.harderNextRound, true);
  assert.equal(result.nextLevel, 2);
  assert.match(result.disclaimer, /Not affiliated with EdotEnv/);
});

test('level 2 requires ordered research cycle and denies claim-without-verify', () => {
  const result = evaluateCurriculumLevel({ level: 2, includeHillclimb: false });
  assert.equal(result.passed, true);
  assert.ok(result.checks.some((c) => c.id === 'research_full_cycle' && c.passed));
  assert.ok(result.checks.some((c) => c.id === 'claim_without_verify_denied' && c.passed));
  assert.ok(result.researchResult?.success);
  assert.ok(result.researchResult?.harderNextRound || result.researchResult?.finalDifficulty >= 2);
});

test('full curriculum run ratchets levels until complete or fail', () => {
  const run = runGovernanceCurriculum({ startLevel: 1, maxLevel: 3, includeHillclimb: false });
  assert.equal(run.schema, 'thumbgate.governance_difficulty_curriculum.run.v1');
  assert.ok(run.levels.length >= 1);
  assert.ok(run.highestPassed >= 1);
  // Without hillclimb, levels 1–3 should pass on local gates
  assert.equal(run.status, 'CURRICULUM_COMPLETE');
  assert.equal(run.highestPassed, 3);
  assert.match(run.disclaimer, /Not affiliated/);
});

test('suggestHarderNextRound only ratchets after a verified pass', () => {
  const hold = suggestHarderNextRound(2, false);
  assert.equal(hold.difficulty, 2);
  assert.equal(hold.harderNextRound, false);

  const up = suggestHarderNextRound(2, true);
  assert.equal(up.difficulty, 3);
  assert.equal(up.harderNextRound, true);

  const cap = suggestHarderNextRound(5, true);
  assert.equal(cap.difficulty, 5);
  assert.equal(cap.harderNextRound, false);
});
