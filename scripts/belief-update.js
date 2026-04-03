#!/usr/bin/env node
/**
 * Bayesian Belief Update Engine
 *
 * Implements belief revision using recursive Bayesian updates.
 * Updates priorProbability and uncertainty based on new observations.
 * Handles entropy-based pruning of low-confidence memories.
 */

const fs = require('fs');
const path = require('path');

/**
 * Perform a Bayesian update on a belief.
 * @param {object} belief - The existing bayesian metadata
 * @param {number} likelihood - The likelihood of the new observation (0-1)
 * @returns {object} Updated bayesian metadata
 */
function updateBelief(belief, likelihood) {
  const prior = belief.priorProbability;
  const n = belief.observations;

  // Simple Bayesian update for probability (weighted mean)
  // P(H|E) = (P(E|H) * P(H)) / P(E)
  // Here we use a simpler recursive update for multi-turn interaction
  const newPrior = (prior * n + likelihood) / (n + 1);
  
  // Sentry fix: Contradiction should be based on raw difference between likelihood and prior
  // to ensure strong contradictions increase uncertainty regardless of n.
  const contradiction = Math.abs(likelihood - prior);
  const newUncertainty = (belief.uncertainty * n + contradiction) / (n + 1);

  return {
    priorProbability: Math.round(newPrior * 1000) / 1000,
    uncertainty: Math.round(newUncertainty * 1000) / 1000,
    observations: n + 1,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Check if a memory should be pruned based on entropy.
 * @param {object} bayesian - Bayesian metadata
 * @returns {boolean} True if memory should be pruned
 */
function shouldPrune(bayesian) {
  const ENTROPY_THRESHOLD = 0.7;
  const OBSERVATION_FLOOR = 3;

  // Prune if high uncertainty after enough observations
  if (bayesian.observations >= OBSERVATION_FLOOR && bayesian.uncertainty > ENTROPY_THRESHOLD) {
    return true;
  }

  // Prune if prior probability falls too low (it's likely a false belief)
  if (bayesian.priorProbability < 0.2) {
    return true;
  }

  return false;
}

module.exports = {
  updateBelief,
  shouldPrune,
};

if (require.main === module) {
  // Unit test logic if run directly
  console.log('Testing Bayesian Update...');
  let belief = { priorProbability: 0.5, uncertainty: 0.5, observations: 1 };
  
  // Sequence of positive signals
  belief = updateBelief(belief, 0.9);
  console.log('Update 1 (Success):', belief);
  belief = updateBelief(belief, 0.95);
  console.log('Update 2 (Success):', belief);
  
  // Contradiction
  belief = updateBelief(belief, 0.1);
  console.log('Update 3 (Contradiction):', belief);
  
  console.log('Should prune?', shouldPrune(belief));
}
