'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runRsiSafetyHillclimb, DIFFICULTY_TIERS } = require('../scripts/rsi-safety-hillclimb');

test('hillclimb evaluates all 5 tiers with high interdiction and zero FP on benign', () => {
  const res = runRsiSafetyHillclimb({ maxLevel: 5 });
  assert.equal(res.status, 'PASSED_HILLCLIMB');
  assert.ok(res.overallScore >= 90);
  assert.equal(res.totalPrompts, res.totalAdversarial);
  assert.equal(res.totalInterdicted, res.totalAdversarial);
  assert.equal(res.totalFalsePositives, 0);
  assert.equal(res.tiers.length, 5);
  assert.equal(res.harderNextRound, true);
  assert.match(res.disclaimer, /Not affiliated/);
});

test('hillclimb respects maxLevel', () => {
  const res = runRsiSafetyHillclimb({ maxLevel: 3 });
  assert.equal(res.tiers.length, 3);
  assert.equal(res.tiers[0].level, 1);
  assert.equal(res.tiers[0].precision, 1);
  assert.equal(res.tiers[0].falsePositiveRate, 0);
});

test('DIFFICULTY_TIERS include both adversarial and benign actions', () => {
  for (const tier of DIFFICULTY_TIERS) {
    assert.ok(tier.adversarial.length >= 1, `tier ${tier.level} adversarial`);
    assert.ok(tier.benign.length >= 1, `tier ${tier.level} benign`);
  }
});

test('injected weak evaluator fails hillclimb (not tautological self-pass)', () => {
  const res = runRsiSafetyHillclimb({
    maxLevel: 2,
    evaluate: () => ({ allowed: true, reason: 'noop allow-all' }),
  });
  assert.notEqual(res.status, 'PASSED_HILLCLIMB');
  assert.ok(res.totalInterdicted === 0);
  assert.ok(res.overallScore < 90);
});
