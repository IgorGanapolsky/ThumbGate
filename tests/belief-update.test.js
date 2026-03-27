'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { updateBelief, shouldPrune } = require('../scripts/belief-update');

describe('belief-update', () => {
  it('updateBelief increases probability with high likelihood', () => {
    const belief = { priorProbability: 0.5, uncertainty: 0.5, observations: 1 };
    const updated = updateBelief(belief, 0.9);
    assert.ok(updated.priorProbability > 0.5, `Expected > 0.5, got ${updated.priorProbability}`);
    assert.strictEqual(updated.observations, 2);
  });

  it('updateBelief decreases probability with low likelihood', () => {
    const belief = { priorProbability: 0.8, uncertainty: 0.2, observations: 5 };
    const updated = updateBelief(belief, 0.1);
    assert.ok(updated.priorProbability < 0.8, `Expected < 0.8, got ${updated.priorProbability}`);
  });

  it('updateBelief increases uncertainty on contradiction', () => {
    const belief = { priorProbability: 0.9, uncertainty: 0.1, observations: 2 };
    const updated = updateBelief(belief, 0.1); // big contradiction
    assert.ok(updated.uncertainty > belief.uncertainty, `Expected uncertainty to increase`);
  });

  it('shouldPrune returns true for high uncertainty after enough observations', () => {
    assert.strictEqual(shouldPrune({ priorProbability: 0.5, uncertainty: 0.8, observations: 5 }), true);
  });

  it('shouldPrune returns true for very low prior probability', () => {
    assert.strictEqual(shouldPrune({ priorProbability: 0.1, uncertainty: 0.3, observations: 1 }), true);
  });

  it('shouldPrune returns false for healthy belief', () => {
    assert.strictEqual(shouldPrune({ priorProbability: 0.7, uncertainty: 0.3, observations: 5 }), false);
  });
});
