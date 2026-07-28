'use strict';

// Known-answer tests for the evaluation primitives.
//
// These are the numbers the CI quality gate will be built on, so they are checked against
// values computed independently (sklearn's documented example for ROC-AUC, hand-computed
// arithmetic for the rest) rather than against whatever this implementation happens to emit.
// A metric library that is only tested against itself cannot detect its own bugs.

const test = require('node:test');
const assert = require('node:assert');

const {
  hashString,
  stratifiedSplit,
  classificationMetrics,
  rocAuc,
  brierScore,
  calibration,
  evaluate,
} = require('../scripts/model-eval.js');

const close = (actual, expected, tolerance = 1e-9) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `expected ${expected}, got ${actual}`,
);

test('rocAuc matches the documented sklearn example', () => {
  // sklearn.metrics.roc_auc_score([0, 0, 1, 1], [0.1, 0.4, 0.35, 0.8]) == 0.75
  const pairs = [
    { probability: 0.1, label: 0 },
    { probability: 0.4, label: 0 },
    { probability: 0.35, label: 1 },
    { probability: 0.8, label: 1 },
  ];
  close(rocAuc(pairs), 0.75);
});

test('rocAuc: perfect, inverted, and all-ties have their textbook values', () => {
  const perfect = [
    { probability: 0.9, label: 1 }, { probability: 0.8, label: 1 },
    { probability: 0.2, label: 0 }, { probability: 0.1, label: 0 },
  ];
  close(rocAuc(perfect), 1);

  const inverted = perfect.map((pair) => ({ ...pair, label: 1 - pair.label }));
  close(rocAuc(inverted), 0);

  // Every score identical: the model carries no ordering information at all.
  const tied = [
    { probability: 0.5, label: 1 }, { probability: 0.5, label: 0 },
    { probability: 0.5, label: 1 }, { probability: 0.5, label: 0 },
  ];
  close(rocAuc(tied), 0.5);
});

test('rocAuc is independent of input order (tie handling)', () => {
  const pairs = [
    { probability: 0.5, label: 1 }, { probability: 0.5, label: 0 },
    { probability: 0.9, label: 1 }, { probability: 0.1, label: 0 },
  ];
  const reversed = pairs.slice().reverse();
  close(rocAuc(pairs), rocAuc(reversed));
});

test('rocAuc returns null rather than a number when one class is absent', () => {
  assert.strictEqual(rocAuc([{ probability: 0.9, label: 1 }, { probability: 0.8, label: 1 }]), null);
});

test('classificationMetrics computes a hand-checked confusion matrix', () => {
  // 2 TP, 1 FP, 1 FN, 2 TN
  const pairs = [
    { probability: 0.9, label: 1 }, { probability: 0.7, label: 1 },  // TP, TP
    { probability: 0.6, label: 0 },                                  // FP
    { probability: 0.2, label: 1 },                                  // FN
    { probability: 0.1, label: 0 }, { probability: 0.3, label: 0 },  // TN, TN
  ];
  const metrics = classificationMetrics(pairs, 0.5);
  assert.deepEqual(metrics.confusion, { truePositive: 2, falsePositive: 1, trueNegative: 2, falseNegative: 1 });
  close(metrics.accuracy, 4 / 6);
  close(metrics.precision, 2 / 3);
  close(metrics.recall, 2 / 3);
  close(metrics.f1, 2 / 3);
});

test('mcc is 0 for a constant classifier no matter how skewed the corpus', () => {
  // 90/10 split, model says "high-risk" for everything: 90% accuracy, zero skill.
  const pairs = [];
  for (let index = 0; index < 90; index += 1) pairs.push({ probability: 0.99, label: 1 });
  for (let index = 0; index < 10; index += 1) pairs.push({ probability: 0.99, label: 0 });
  const metrics = classificationMetrics(pairs, 0.5);
  close(metrics.accuracy, 0.9);
  close(metrics.mcc, 0);   // the whole reason MCC is reported next to accuracy
});

test('brierScore is the mean squared probability error', () => {
  const pairs = [
    { probability: 1, label: 1 },     // 0
    { probability: 0, label: 0 },     // 0
    { probability: 0.5, label: 1 },   // 0.25
    { probability: 0.5, label: 0 },   // 0.25
  ];
  close(brierScore(pairs), 0.125);
});

test('calibration: a perfectly calibrated set has ~zero ECE, a confident-wrong set has ~1', () => {
  // 10 rows in the 0.9 bin, exactly 9 of which are positive.
  const calibrated = [];
  for (let index = 0; index < 9; index += 1) calibrated.push({ probability: 0.9, label: 1 });
  calibrated.push({ probability: 0.9, label: 0 });
  close(calibration(calibrated).expectedCalibrationError, 0, 1e-9);

  const overconfident = [
    { probability: 1, label: 0 },
    { probability: 1, label: 0 },
  ];
  close(calibration(overconfident).expectedCalibrationError, 1, 1e-3);
});

test('evaluate reports lift against the majority-class baseline, not raw accuracy', () => {
  // 8 positives, 2 negatives. A constant "high-risk" answer scores 0.8.
  const pairs = [];
  for (let index = 0; index < 8; index += 1) pairs.push({ probability: 0.99, label: 1 });
  for (let index = 0; index < 2; index += 1) pairs.push({ probability: 0.99, label: 0 });

  const report = evaluate(pairs);
  close(report.accuracy, 0.8);
  close(report.baselineAccuracy, 0.8);
  close(report.lift, 0);          // 80% accuracy that is worth exactly nothing
  close(report.mcc, 0);
});

test('stratifiedSplit is deterministic, disjoint, and lossless', () => {
  const examples = Array.from({ length: 100 }, (_, index) => ({
    id: index,
    label: index % 3 === 0 ? 1 : -1,
    features: { value: index },
  }));

  const first = stratifiedSplit(examples, { testFraction: 0.25, keyFn: (row) => `row-${row.id}` });
  const second = stratifiedSplit(examples, { testFraction: 0.25, keyFn: (row) => `row-${row.id}` });

  assert.deepEqual(first.test.map((row) => row.id), second.test.map((row) => row.id),
    'same corpus produced a different split on a second call');

  const trainIds = new Set(first.train.map((row) => row.id));
  const testIds = new Set(first.test.map((row) => row.id));
  for (const id of testIds) {
    assert.ok(!trainIds.has(id), `row ${id} leaked into both folds`);
  }
  assert.strictEqual(trainIds.size + testIds.size, examples.length, 'split lost or duplicated rows');
  assert.ok(first.test.length > 0 && first.train.length > 0);
});

test('stratifiedSplit keeps the test fold base rate close to the corpus', () => {
  const examples = Array.from({ length: 200 }, (_, index) => ({
    id: index,
    label: index % 10 < 7 ? 1 : -1,   // 70/30, mirroring the real corpus
    features: { value: index },
  }));
  const { test: held } = stratifiedSplit(examples, { testFraction: 0.25, keyFn: (row) => `row-${row.id}` });
  const heldBaseRate = held.filter((row) => row.label === 1).length / held.length;
  assert.ok(Math.abs(heldBaseRate - 0.7) < 0.05,
    `test fold base rate ${heldBaseRate} drifted from the corpus 0.7`);
});

test('stratifiedSplit refuses to fabricate a test fold from a single-class corpus', () => {
  const examples = Array.from({ length: 20 }, (_, index) => ({ id: index, label: 1, features: {} }));
  const split = stratifiedSplit(examples, { testFraction: 0.25 });
  assert.strictEqual(split.test.length, 0, 'produced a test fold with only one class present');
  assert.strictEqual(split.train.length, 20);
});

test('the split does not depend on chronological input order', () => {
  // Rows arrive newest-last in a JSONL log. A positional split would put all recent rows in
  // the test fold and measure drift rather than skill.
  const examples = Array.from({ length: 80 }, (_, index) => ({
    id: index,
    label: index % 4 === 0 ? 1 : -1,
    features: {},
  }));
  const { test: held } = stratifiedSplit(examples, { testFraction: 0.25, keyFn: (row) => `row-${row.id}` });
  const ids = held.map((row) => row.id);
  const secondHalf = ids.filter((id) => id >= 40).length;
  assert.ok(secondHalf > 0 && secondHalf < ids.length,
    `test fold is positionally clustered (${secondHalf}/${ids.length} from the second half)`);
});

test('hashString is stable across calls and sensitive to small changes', () => {
  assert.strictEqual(hashString('thumbgate'), hashString('thumbgate'));
  assert.notStrictEqual(hashString('thumbgate'), hashString('thumbgatf'));
});
