#!/usr/bin/env node
'use strict';

/**
 * model-calibration.js — Platt scaling and decision-threshold selection.
 *
 * WHY THIS EXISTS
 *
 * Repeated-resampling evaluation of the risk scorer (12 stratified splits, 2026-07-28) found:
 *
 *   ROC-AUC          ~0.69   -> the ranking carries real signal
 *   accuracy lift    -0.083  -> yet it LOSES to "always answer high-risk"
 *   ECE               0.145  -> and its probabilities are off by ~15 points
 *
 * Those three facts together have one explanation: the model orders actions correctly but
 * converts that order into a decision badly. The score came from `1/(1+exp(-2*margin))`, a
 * fixed squashing with no relationship to observed frequencies, and was then cut at a hardcoded
 * 0.5 on a corpus whose base rate is 0.71.
 *
 * So the fix is not a better learner — it is to learn the mapping from margin to probability
 * (Platt scaling) and to choose the cut point from data instead of assuming one.
 *
 * THE CARDINAL RULE, ENFORCED BY CONSTRUCTION: both are fitted on the TRAINING fold only.
 * Fitting a threshold on the same rows you then score with it is how a model reports
 * improvements that do not exist. These functions take the training pairs explicitly and never
 * see the test fold.
 */

/**
 * Platt scaling: fit P(y=1 | margin) = 1 / (1 + exp(A * margin + B)).
 *
 * Uses Platt's regularized targets rather than raw 0/1 labels — with t+ = (N+ + 1)/(N+ + 2)
 * and t- = 1/(N- + 2) — which is what keeps A from running off to infinity when the training
 * folds happen to be separable. Optimization is plain gradient descent with a fixed iteration
 * count: deterministic, dependency-free, and entirely adequate for two parameters.
 */
function fitPlattScaling(margins, labels, options = {}) {
  const iterations = Number(options.iterations || 2000);
  const learningRate = Number(options.learningRate || 0.05);

  const positives = labels.reduce((sum, label) => sum + (Number(label) === 1 ? 1 : 0), 0);
  const negatives = labels.length - positives;
  if (positives === 0 || negatives === 0 || labels.length === 0) {
    // Nothing to calibrate against; identity is the honest answer.
    return { a: -2, b: 0, fitted: false, reason: 'single-class-or-empty' };
  }

  const highTarget = (positives + 1) / (positives + 2);
  const lowTarget = 1 / (negatives + 2);
  const targets = labels.map((label) => (Number(label) === 1 ? highTarget : lowTarget));

  let a = -2;   // the historical fixed slope, so we start from current behaviour
  let b = 0;

  for (let step = 0; step < iterations; step += 1) {
    let gradientA = 0;
    let gradientB = 0;
    for (let index = 0; index < margins.length; index += 1) {
      const margin = Number(margins[index]) || 0;
      const probability = 1 / (1 + Math.exp(a * margin + b));
      const error = probability - targets[index];
      // d/dA and d/dB of the cross-entropy through the sigmoid.
      gradientA += error * -margin * probability * (1 - probability) / Math.max(probability * (1 - probability), 1e-12);
      gradientB += error * -1 * probability * (1 - probability) / Math.max(probability * (1 - probability), 1e-12);
    }
    a -= (learningRate * gradientA) / margins.length;
    b -= (learningRate * gradientB) / margins.length;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return { a: -2, b: 0, fitted: false, reason: 'diverged' };
  }

  return { a, b, fitted: true };
}

function applyPlattScaling(margin, scaling) {
  if (!scaling || scaling.fitted === false) return 1 / (1 + Math.exp(-2 * (Number(margin) || 0)));
  return 1 / (1 + Math.exp(scaling.a * (Number(margin) || 0) + scaling.b));
}

/**
 * Choose a decision threshold from training pairs.
 *
 * Default objective is MCC, not accuracy. On a 71/29 corpus, maximizing accuracy pushes the
 * threshold toward "always say the majority class", which scores well and decides nothing —
 * exactly the degenerate behaviour this whole exercise exists to detect. MCC only rewards a
 * threshold that separates both classes.
 *
 * Candidate thresholds are the midpoints between observed probabilities, so the search covers
 * every distinct decision this model can actually make and nothing else.
 */
function selectThreshold(pairs, options = {}) {
  const objective = options.objective || 'mcc';
  if (pairs.length === 0) return { threshold: 0.5, score: 0, objective, fitted: false };

  const sorted = [...new Set(pairs.map((pair) => Number(pair.probability)))].sort((left, right) => left - right);
  const candidates = new Set([0.5]);
  for (let index = 0; index + 1 < sorted.length; index += 1) {
    candidates.add((sorted[index] + sorted[index + 1]) / 2);
  }

  const score = (threshold) => {
    let truePositive = 0;
    let falsePositive = 0;
    let trueNegative = 0;
    let falseNegative = 0;
    for (const pair of pairs) {
      const actual = Number(pair.label) === 1 ? 1 : 0;
      const predicted = Number(pair.probability) >= threshold ? 1 : 0;
      if (predicted === 1 && actual === 1) truePositive += 1;
      else if (predicted === 1 && actual === 0) falsePositive += 1;
      else if (predicted === 0 && actual === 0) trueNegative += 1;
      else falseNegative += 1;
    }
    if (objective === 'accuracy') return (truePositive + trueNegative) / pairs.length;
    if (objective === 'youden') {
      const sensitivity = truePositive + falseNegative > 0 ? truePositive / (truePositive + falseNegative) : 0;
      const specificity = trueNegative + falsePositive > 0 ? trueNegative / (trueNegative + falsePositive) : 0;
      return sensitivity + specificity - 1;
    }
    const denominator = Math.sqrt(
      (truePositive + falsePositive) * (truePositive + falseNegative)
      * (trueNegative + falsePositive) * (trueNegative + falseNegative),
    );
    return denominator > 0
      ? ((truePositive * trueNegative) - (falsePositive * falseNegative)) / denominator
      : 0;
  };

  let best = { threshold: 0.5, score: score(0.5), objective, fitted: true };
  for (const threshold of candidates) {
    const value = score(threshold);
    // Ties resolve toward the threshold nearer 0.5 for stability across refits.
    if (value > best.score || (value === best.score && Math.abs(threshold - 0.5) < Math.abs(best.threshold - 0.5))) {
      best = { threshold, score: value, objective, fitted: true };
    }
  }
  return best;
}

module.exports = { fitPlattScaling, applyPlattScaling, selectThreshold };
