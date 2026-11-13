/**
 * Unit Tests for StateBench Finite State Tracker & Krohn-Rhodes Register
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  StateBenchFiniteTracker,
  KROHN_RHODES_LEVELS
} = require('../src/statebench-finite-tracker');

test('StateBench - Level 1: R-Trivial enforces immutable assignment', () => {
  const tracker = new StateBenchFiniteTracker();
  tracker.setImmutable('DB_PORT', 5432);

  assert.equal(tracker.resolveState('DB_PORT'), 5432);

  // Attempting to overwrite must throw deterministically
  assert.throws(() => {
    tracker.setImmutable('DB_PORT', 3306);
  }, /R_TRIVIAL_VIOLATION/);

  assert.throws(() => {
    tracker.assignValue('DB_PORT', 3306);
  }, /R_TRIVIAL_VIOLATION/);
});

test('StateBench - Level 2: Aperiodic tracks latest-write-wins', () => {
  const tracker = new StateBenchFiniteTracker();
  tracker.assignValue('auth_token', 'token_v1');
  tracker.assignValue('auth_token', 'token_v2');
  tracker.assignValue('auth_token', 'token_v3');

  assert.equal(tracker.resolveState('auth_token'), 'token_v3');

  const check = tracker.verifyLlmClaim('auth_token', 'token_v3');
  assert.equal(check.verified, true);
  assert.equal(check.status, 'VERIFIED');
});

test('StateBench - Level 3: Soluble carries self-referential updates without drift', () => {
  const tracker = new StateBenchFiniteTracker();
  tracker.assignValue('retry_count', 0);

  tracker.accumulateSelf('retry_count', '+', 1);
  tracker.accumulateSelf('retry_count', '+', 1);
  tracker.accumulateSelf('retry_count', '+', 3);

  assert.equal(tracker.resolveState('retry_count'), 5);

  tracker.accumulateSelf('retry_count', '*', 2);
  assert.equal(tracker.resolveState('retry_count'), 10);
});

test('StateBench - Level 4: General Finite tracks S_5 permutation swaps and catches LLM hallucinations', () => {
  const tracker = new StateBenchFiniteTracker();

  // Magician hiding a ball under 5 cups (A, B, C, D, E)
  tracker.assignValue('cup_A', 'EMPTY');
  tracker.assignValue('cup_B', 'BALL');
  tracker.assignValue('cup_C', 'EMPTY');
  tracker.assignValue('cup_D', 'EMPTY');
  tracker.assignValue('cup_E', 'EMPTY');

  // Sequence of 5 swaps
  tracker.swapVariables('cup_B', 'cup_D'); // Ball now in D
  tracker.swapVariables('cup_A', 'cup_C'); // A and C swap
  tracker.swapVariables('cup_D', 'cup_E'); // Ball now in E
  tracker.swapVariables('cup_B', 'cup_E'); // Ball now in B
  tracker.swapVariables('cup_B', 'cup_A'); // Ball now in A

  assert.equal(tracker.resolveState('cup_A'), 'BALL');
  assert.equal(tracker.resolveState('cup_B'), 'EMPTY');
  assert.equal(tracker.resolveState('cup_E'), 'EMPTY');

  // LLM hallucinating that the ball stayed in cup B or cup D
  const hallucinatedCheck = tracker.verifyLlmClaim('cup_D', 'BALL');
  assert.equal(hallucinatedCheck.verified, false);
  assert.equal(hallucinatedCheck.status, 'STATE_TRACKING_HALLUCINATION_DETECTED');
  assert.equal(hallucinatedCheck.groundTruth, 'EMPTY');

  // Ground truth verified
  const realCheck = tracker.verifyLlmClaim('cup_A', 'BALL');
  assert.equal(realCheck.verified, true);
  assert.equal(realCheck.status, 'VERIFIED');
});
