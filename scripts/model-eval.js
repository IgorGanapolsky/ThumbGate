#!/usr/bin/env node
'use strict';

/**
 * model-eval.js — honest evaluation primitives for ThumbGate's learned models.
 *
 * WHY THIS EXISTS
 *
 * The risk scorer reported exactly one number: `trainingAccuracy`, measured on the same rows
 * it trained on. On 2026-07-28 that number was 0.820 — which sounds good until you notice the
 * base rate was 0.711. A model that answers "high-risk" unconditionally scores 71.1%, so the
 * headline figure was measuring an 11-point in-sample lift and presenting it as quality.
 * Nothing anywhere compared against that trivial baseline, and no split existed, so the
 * generalization number was not merely bad — it was unknown.
 *
 * Accuracy is also the wrong summary for a 71/29 split. These primitives therefore report the
 * metrics that survive class imbalance (precision/recall/F1/MCC/ROC-AUC) and the ones that say
 * whether a probability means anything (Brier score, expected calibration error).
 *
 * DETERMINISM IS A REQUIREMENT, NOT A PREFERENCE.
 * Splits are derived from a content hash, never from Math.random(). The same corpus must
 * produce the same split on every machine and every run, or a "quality regression" is
 * indistinguishable from a reshuffle and the CI gate built on top is noise.
 *
 * Everything here is pure: no I/O, no clock, no global state. That is what makes it testable.
 */

/** FNV-1a. Small, fast, and stable across platforms — the only properties we need. */
function hashString(text) {
  let hash = 0x811c9dc5;
  const value = String(text);
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    // 32-bit FNV prime multiply via shifts; Math.imul keeps this exact in JS.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Labels arrive as 1/-1 (AdaBoost) or 1/0 (everything else). Normalize to 1/0. */
function toBinaryLabel(label) {
  return Number(label) === 1 ? 1 : 0;
}

/**
 * Deterministic stratified split.
 *
 * Stratified because a random split of a 71/29 corpus can hand back a test fold with a
 * materially different base rate, which moves the very number we are trying to measure.
 * Splitting inside each class keeps the test fold's base rate close to the corpus.
 *
 * Returns { train, test }. Both are always non-empty when the input supports it; when a class
 * is too small to contribute a test row, the split degrades to "everything is training" rather
 * than silently producing a test fold with one class in it (an AUC of NaN dressed up as data).
 */
function stratifiedSplit(examples, options = {}) {
  const testFraction = Number(options.testFraction || 0.25);
  const keyFn = options.keyFn || ((example, index) => JSON.stringify(example.features || example) + index);

  // Group ACROSS classes, then assign whole groups — StratifiedGroupKFold semantics.
  //
  // Two bugs led here, both caught by tests/risk-model-quality.test.js:
  //   1. Assigning individual rows split tied blocks, so an identical row could sit in both
  //      folds and the test fold scored rows the model had memorized.
  //   2. Grouping per class still split duplicates, because with label noise the SAME feature
  //      vector can carry both labels — the two copies then landed in different class buckets
  //      and different folds.
  // Grouping globally is the only version where "this input is in exactly one fold" holds.
  const classTotals = new Map();
  const groups = new Map();
  examples.forEach((example, index) => {
    const label = toBinaryLabel(example.label);
    classTotals.set(label, (classTotals.get(label) || 0) + 1);
    const hash = hashString(keyFn(example, index));
    if (!groups.has(hash)) groups.set(hash, { members: [], counts: new Map() });
    const group = groups.get(hash);
    group.members.push(example);
    group.counts.set(label, (group.counts.get(label) || 0) + 1);
  });

  // A single-class corpus has nothing to measure; there is no honest split of it.
  if (classTotals.size < 2) return { train: examples.slice(), test: [] };

  // Per-class quotas keep the test fold's base rate near the corpus even though whole groups
  // move together. Without quotas, one large group could swamp the fold and shift the very
  // base rate the lift is measured against.
  const quotas = new Map();
  for (const [label, total] of classTotals) quotas.set(label, Math.floor(total * testFraction));

  const train = [];
  const test = [];
  const taken = new Map();
  // Order by hash, not by position: input order in a JSONL log is chronological, so a
  // positional split would put all recent rows in one fold and measure drift, not skill.
  const ordered = [...groups.entries()].sort((left, right) => left[0] - right[0]);

  for (const [, group] of ordered) {
    // Take the group only while every class it contains is still under quota. A group that
    // would push any class past its quota goes to training instead.
    let fits = true;
    for (const label of group.counts.keys()) {
      if ((taken.get(label) || 0) >= (quotas.get(label) || 0)) { fits = false; break; }
    }
    if (fits) {
      test.push(...group.members);
      for (const [label, count] of group.counts) taken.set(label, (taken.get(label) || 0) + count);
    } else {
      train.push(...group.members);
    }
  }

  // If either side collapsed, report no test fold instead of a meaningless one.
  if (test.length === 0 || train.length === 0) return { train: examples.slice(), test: [] };
  return { train, test };
}

/**
 * Threshold metrics. `pairs` is [{ probability, label }].
 * Precision/recall are reported for the positive (high-risk) class.
 */
function classificationMetrics(pairs, threshold = 0.5) {
  let truePositive = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  let falseNegative = 0;

  for (const pair of pairs) {
    const actual = toBinaryLabel(pair.label);
    const predicted = Number(pair.probability) >= threshold ? 1 : 0;
    if (predicted === 1 && actual === 1) truePositive += 1;
    else if (predicted === 1 && actual === 0) falsePositive += 1;
    else if (predicted === 0 && actual === 0) trueNegative += 1;
    else falseNegative += 1;
  }

  const total = pairs.length || 1;
  const precision = truePositive + falsePositive > 0 ? truePositive / (truePositive + falsePositive) : 0;
  const recall = truePositive + falseNegative > 0 ? truePositive / (truePositive + falseNegative) : 0;
  const specificity = trueNegative + falsePositive > 0 ? trueNegative / (trueNegative + falsePositive) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  // Matthews correlation: the summary that does not flatter a majority-class predictor.
  // A constant classifier scores 0 here no matter how skewed the corpus is.
  const mccDenominator = Math.sqrt(
    (truePositive + falsePositive)
    * (truePositive + falseNegative)
    * (trueNegative + falsePositive)
    * (trueNegative + falseNegative),
  );
  const mcc = mccDenominator > 0
    ? ((truePositive * trueNegative) - (falsePositive * falseNegative)) / mccDenominator
    : 0;

  return {
    accuracy: (truePositive + trueNegative) / total,
    precision,
    recall,
    specificity,
    f1,
    mcc,
    confusion: { truePositive, falsePositive, trueNegative, falseNegative },
  };
}

/**
 * ROC-AUC by the rank method, with tied scores sharing an average rank.
 *
 * Tie handling matters here specifically: a stump ensemble emits a small set of discrete
 * scores, so ties are the common case rather than an edge case. Treating them by input order
 * would make AUC depend on row order — a number that changes when you sort your log.
 */
function rocAuc(pairs) {
  const positives = pairs.filter((pair) => toBinaryLabel(pair.label) === 1).length;
  const negatives = pairs.length - positives;
  if (positives === 0 || negatives === 0) return null; // undefined, and saying so beats guessing

  const ordered = pairs
    .map((pair) => ({ score: Number(pair.probability), label: toBinaryLabel(pair.label) }))
    .sort((left, right) => left.score - right.score);

  const ranks = new Array(ordered.length);
  let index = 0;
  while (index < ordered.length) {
    let end = index;
    while (end + 1 < ordered.length && ordered[end + 1].score === ordered[index].score) end += 1;
    // Ranks are 1-based; tied entries all take the midpoint of the block they occupy.
    const averageRank = ((index + 1) + (end + 1)) / 2;
    for (let position = index; position <= end; position += 1) ranks[position] = averageRank;
    index = end + 1;
  }

  let positiveRankSum = 0;
  ordered.forEach((entry, position) => {
    if (entry.label === 1) positiveRankSum += ranks[position];
  });

  return (positiveRankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

/** Mean squared error of the probability itself. Rewards being uncertain when uncertain. */
function brierScore(pairs) {
  if (pairs.length === 0) return null;
  const total = pairs.reduce((sum, pair) => {
    const actual = toBinaryLabel(pair.label);
    const probability = Number(pair.probability);
    return sum + ((probability - actual) ** 2);
  }, 0);
  return total / pairs.length;
}

/**
 * Expected calibration error: |predicted - observed| averaged over equal-width bins,
 * weighted by bin population.
 *
 * This is the metric that catches a model whose ranking is fine but whose probabilities are
 * meaningless — which matters because downstream gates threshold on the probability, not on
 * the rank.
 */
function calibration(pairs, binCount = 10) {
  if (pairs.length === 0) return { expectedCalibrationError: null, bins: [] };
  const bins = Array.from({ length: binCount }, () => ({ count: 0, predicted: 0, observed: 0 }));

  for (const pair of pairs) {
    const probability = Math.min(0.999999, Math.max(0, Number(pair.probability)));
    const slot = Math.min(binCount - 1, Math.floor(probability * binCount));
    bins[slot].count += 1;
    bins[slot].predicted += probability;
    bins[slot].observed += toBinaryLabel(pair.label);
  }

  let error = 0;
  const report = bins.map((bin, slot) => {
    if (bin.count === 0) return { bin: slot, count: 0, meanPredicted: null, meanObserved: null };
    const meanPredicted = bin.predicted / bin.count;
    const meanObserved = bin.observed / bin.count;
    error += (bin.count / pairs.length) * Math.abs(meanPredicted - meanObserved);
    return { bin: slot, count: bin.count, meanPredicted, meanObserved };
  });

  return { expectedCalibrationError: error, bins: report };
}

/**
 * Full report for a set of (probability, label) pairs.
 *
 * `baselineAccuracy` and `lift` are the point of this whole module: a model is only worth
 * running if it beats the constant classifier, and that comparison must appear next to the
 * accuracy every single time so it can never again be quoted without it.
 */
function evaluate(pairs, options = {}) {
  const threshold = Number(options.threshold ?? 0.5);
  const positives = pairs.filter((pair) => toBinaryLabel(pair.label) === 1).length;
  const baseRate = pairs.length > 0 ? positives / pairs.length : 0;
  // The trivial classifier always answers with the majority class.
  const baselineAccuracy = Math.max(baseRate, 1 - baseRate);
  const metrics = classificationMetrics(pairs, threshold);

  return {
    sampleCount: pairs.length,
    positiveCount: positives,
    baseRate,
    baselineAccuracy,
    accuracy: metrics.accuracy,
    lift: metrics.accuracy - baselineAccuracy,
    precision: metrics.precision,
    recall: metrics.recall,
    specificity: metrics.specificity,
    f1: metrics.f1,
    mcc: metrics.mcc,
    rocAuc: rocAuc(pairs),
    brierScore: brierScore(pairs),
    expectedCalibrationError: calibration(pairs, options.calibrationBins || 10).expectedCalibrationError,
    confusion: metrics.confusion,
  };
}

/** Round every float in a report so persisted artifacts diff cleanly. */
function roundReport(report, digits = 4) {
  const factor = 10 ** digits;
  const rounded = {};
  for (const [key, value] of Object.entries(report || {})) {
    if (typeof value === 'number' && Number.isFinite(value)) rounded[key] = Math.round(value * factor) / factor;
    else if (value && typeof value === 'object' && !Array.isArray(value)) rounded[key] = roundReport(value, digits);
    else rounded[key] = value;
  }
  return rounded;
}

module.exports = {
  hashString,
  stratifiedSplit,
  classificationMetrics,
  rocAuc,
  brierScore,
  calibration,
  evaluate,
  roundReport,
};
