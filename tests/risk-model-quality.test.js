'use strict';

// CI quality gate for the learned risk model.
//
// DESIGN CONSTRAINT: the real corpus lives in ~/.thumbgate on a developer machine and is
// private. CI cannot see it. So this suite asserts on a DETERMINISTIC SYNTHETIC FIXTURE with a
// known, planted signal.
//
// That choice buys a specific diagnostic power. If these tests fail, the TRAINER is broken.
// If they pass while the real corpus shows no lift (which is exactly the situation as of
// 2026-07-28 — see docs/ML-EVALUATION.md), the trainer is fine and the DATA lacks signal.
// Those are different problems with different fixes, and a test suite that cannot tell them
// apart sends you to debug the wrong one.
//
// The fixture uses a fixed LCG rather than Math.random(): a flaky quality gate gets muted, and
// a muted gate protects nothing.

const test = require('node:test');
const assert = require('node:assert');

const riskScorer = require('../scripts/risk-scorer.js');

// Training is a Pro-gated capability. Passing an explicit, empty env makes every call here
// hermetic: `isEnforced` reads the INJECTED env, so these tests neither throw under
// THUMBGATE_ENFORCE_ENTITLEMENTS=1 in CI nor depend on whatever license happens to be
// installed on the developer machine running them. `silent` keeps the advisory warning out of
// the test output.
const ENTITLEMENT = { entitlement: { env: {}, silent: true } };
const { evaluate, stratifiedSplit } = require('../scripts/model-eval.js');

/** Deterministic LCG (numerical recipes constants). Same fixture on every machine, forever. */
function makeRandom(seed = 42) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * Rows whose risk genuinely depends on observable features.
 *
 * The planted rule: risk rises with failing guardrails and explicit error types. Roughly 12%
 * label noise is added so a perfect score is impossible — a fixture a model can ace at 100%
 * would hide overfitting rather than expose it.
 */
function buildFixture(count = 600, seed = 7) {
  const random = makeRandom(seed);
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    const failingGuardrails = random() < 0.4 ? Math.floor(random() * 3) + 1 : 0;
    const hasError = random() < 0.35;
    const trend = random() * 2 - 1;

    const risky = failingGuardrails > 0 || hasError;
    const label = random() < 0.12 ? !risky : risky;   // 12% label noise

    rows.push({
      context: risky ? 'deploy failed with error in production' : 'updated documentation and verified tests pass',
      targetRisk: label ? 1 : 0,
      domain: index % 2 === 0 ? 'deployment' : 'testing',
      skill: null,
      targetTags: failingGuardrails > 0 ? ['deploy', 'guardrail'] : ['docs'],
      filePathCount: Math.floor(random() * 5),
      errorType: hasError ? 'runtime' : null,
      rubric: {
        weightedScore: risky ? 0.3 : 0.8,
        failingCriteria: [],
        failingGuardrails: Array.from({ length: failingGuardrails }, (_, slot) => `guardrail-${slot}`),
        judgeDisagreements: [],
      },
      features: { rewardSequence: [trend, trend], recentTrend: trend, timeGaps: [1, 2], actionPatterns: {} },
    });
  }
  return rows;
}

const FIXTURE = buildFixture();

test('the fixture itself is not degenerate', () => {
  const positives = FIXTURE.filter((row) => row.targetRisk === 1).length;
  const baseRate = positives / FIXTURE.length;
  // If the fixture drifted to near-0 or near-1 base rate, every assertion below becomes
  // trivially satisfiable and the gate silently stops testing anything.
  assert.ok(baseRate > 0.3 && baseRate < 0.75, `fixture base rate ${baseRate} is degenerate`);
  assert.strictEqual(FIXTURE.length, 600);
});

test('the fixture is byte-identical across runs (no Math.random leaked in)', () => {
  const rebuilt = buildFixture();
  assert.deepEqual(rebuilt, FIXTURE, 'fixture is not reproducible — a quality gate on it would be noise');
});

test('trainer recovers planted signal: held-out lift over the majority baseline', () => {
  const model = riskScorer.trainRiskModel(FIXTURE, { ...ENTITLEMENT });
  const holdout = model.metrics.holdout;

  assert.ok(holdout, 'model.metrics.holdout is missing — the trainer stopped reporting generalization');
  assert.strictEqual(holdout.available, true, `holdout unavailable: ${holdout.reason}`);
  assert.ok(holdout.testCount >= 50, `test fold too small to mean anything: ${holdout.testCount}`);

  // The planted signal is strong and directly observable, so a working trainer must clear the
  // majority-class baseline by a wide margin. This is the assertion that fails if boosting,
  // feature extraction, or label derivation regresses.
  assert.ok(holdout.lift > 0.15,
    `held-out lift ${holdout.lift} over baseline ${holdout.baselineAccuracy} — trainer is not learning the planted signal`);
  // Floor is 0.75, not the ~0.88 an ideal predictor could reach on a fixture with a clean
  // signal feature and 12% label noise. Measured value is ~0.768, and the gap is understood:
  // after the first stump finds the real feature, later rounds boost on noise features
  // (filePathCount, recentTrend) and blur the ranking. That weakness is documented in
  // docs/ML-EVALUATION.md rather than hidden by an aspirational threshold — this gate exists
  // to catch REGRESSION, so it is set just below the known-good value.
  assert.ok(holdout.rocAuc > 0.75, `held-out ROC-AUC ${holdout.rocAuc} regressed below the known-good 0.768`);
  assert.ok(holdout.mcc > 0.5, `held-out MCC ${holdout.mcc} indicates the model is not separating classes`);
});

test('in-sample score is recorded but never substituted for the held-out score', () => {
  const model = riskScorer.trainRiskModel(FIXTURE, { ...ENTITLEMENT });
  assert.ok(model.metrics.inSample, 'inSample metrics missing');
  assert.ok(model.metrics.holdout, 'holdout metrics missing');

  // The original defect: one number, measured on training rows, presented as quality. Both
  // must be present and distinguishable so no caller can quote the flattering one by accident.
  assert.notStrictEqual(model.metrics.inSample.accuracy, undefined);
  assert.notStrictEqual(model.metrics.holdout.accuracy, undefined);
  // NOT asserted: that in-sample >= held-out. It usually is, but it is not an invariant —
  // a small test fold can be easier than average by chance, and here it lands 1.4 points
  // above in-sample on 149 rows, comfortably inside sampling variation. What WOULD indicate
  // crossed folds is a large gap in that direction, so that is what the bound catches.
  assert.ok(model.metrics.holdout.accuracy - model.metrics.inSample.accuracy < 0.15,
    `held-out accuracy (${model.metrics.holdout.accuracy}) exceeds in-sample `
    + `(${model.metrics.inSample.accuracy}) by more than sampling noise explains — folds may be crossed`);
  assert.ok(model.metrics.holdout.testCount < model.metrics.inSample.sampleCount,
    'held-out fold is not smaller than the full corpus, so the split did not happen');
});

test('every reported accuracy is accompanied by its baseline', () => {
  const model = riskScorer.trainRiskModel(FIXTURE, { ...ENTITLEMENT });
  for (const key of ['inSample', 'holdout']) {
    const report = model.metrics[key];
    if (report && report.available !== false) {
      assert.strictEqual(typeof report.baselineAccuracy, 'number',
        `${key} reports accuracy without the trivial baseline it must be compared against`);
      assert.strictEqual(typeof report.lift, 'number', `${key} reports no lift`);
    }
  }
});

test('a model trained on pure noise reports approximately zero held-out lift', () => {
  // The other half of the gate: the trainer must NOT manufacture skill where none exists.
  // Without this, a bug that leaks labels into features would sail past every test above.
  const random = makeRandom(99);
  const noise = Array.from({ length: 400 }, () => ({
    context: 'unremarkable activity',
    targetRisk: random() < 0.5 ? 1 : 0,
    domain: 'general',
    targetTags: [],
    filePathCount: Math.floor(random() * 4),
    errorType: null,
    rubric: { weightedScore: random(), failingCriteria: [], failingGuardrails: [], judgeDisagreements: [] },
    features: { rewardSequence: [random()], recentTrend: random(), timeGaps: [1], actionPatterns: {} },
  }));

  const model = riskScorer.trainRiskModel(noise, { ...ENTITLEMENT });
  const holdout = model.metrics.holdout;
  assert.strictEqual(holdout.available, true);
  assert.ok(holdout.lift < 0.15,
    `trainer found ${holdout.lift} lift in pure noise — labels are probably leaking into features`);
});

test('holdout splits are reproducible for a fixed corpus', () => {
  const first = riskScorer.trainRiskModel(FIXTURE, { ...ENTITLEMENT }).metrics.holdout;
  const second = riskScorer.trainRiskModel(FIXTURE, { ...ENTITLEMENT }).metrics.holdout;
  assert.strictEqual(first.testCount, second.testCount);
  assert.strictEqual(first.accuracy, second.accuracy, 'the same corpus produced two different held-out scores');
});

test('holdout reports unavailability instead of inventing a number', () => {
  const singleClass = buildFixture(40).map((row) => ({ ...row, targetRisk: 1 }));
  const model = riskScorer.trainRiskModel(singleClass, { ...ENTITLEMENT });
  assert.strictEqual(model.metrics.holdout.available, false,
    'a single-class corpus produced a held-out score, which cannot be meaningful');
});

test('stratifiedSplit keeps duplicate rows in the same fold (no leakage)', () => {
  // The real corpus repeats near-identical actions. If duplicates straddle the split, the test
  // fold contains answers copied from the training fold and every metric is inflated.
  const duplicated = [...FIXTURE.slice(0, 150), ...FIXTURE.slice(0, 150)];
  const examples = duplicated.map((row) => ({
    row,
    label: riskScorer.deriveTargetRisk(row) === 1 ? 1 : -1,
    features: {},
  }));
  // Key on enough fields to produce many distinct groups; keying on two fields would collapse
  // the corpus into a handful of groups and make this assertion pass vacuously.
  const key = (example) => JSON.stringify([
    example.row.context,
    example.row.domain,
    example.row.targetTags,
    example.row.filePathCount,
    example.row.errorType,
    example.row.rubric && example.row.rubric.failingGuardrails,
  ]);
  const { train, test: held } = stratifiedSplit(examples, { testFraction: 0.25, keyFn: key });

  assert.ok(held.length > 0, 'no test fold produced — the leakage assertion below would be vacuous');
  const trainKeys = new Set(train.map(key));
  for (const example of held) {
    assert.ok(!trainKeys.has(key(example)),
      'an identical row appears in both folds — held-out scores would be inflated');
  }
});

test('evaluate never credits a constant classifier with skill', () => {
  const pairs = [];
  for (let index = 0; index < 70; index += 1) pairs.push({ probability: 0.9, label: 1 });
  for (let index = 0; index < 30; index += 1) pairs.push({ probability: 0.9, label: 0 });
  const report = evaluate(pairs);
  assert.ok(Math.abs(report.lift) < 1e-9, 'constant classifier was credited with lift');
  assert.ok(Math.abs(report.mcc) < 1e-9, 'constant classifier was credited with MCC');
});
