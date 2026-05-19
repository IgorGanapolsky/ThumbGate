'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assignVariant,
  decide,
  renderDecisionMarkdown,
  sampleBeta,
  parseArgs,
  DEFAULT_DECISION_THRESHOLD,
} = require('../scripts/ab-experiment-framework');

test('assignVariant is deterministic for the same visitor + experiment', () => {
  const variants = [{ name: 'A', weight: 0.5 }, { name: 'B', weight: 0.5 }];
  const v1 = assignVariant('visitor-123', 'pricing-hero-v1', variants);
  const v2 = assignVariant('visitor-123', 'pricing-hero-v1', variants);
  assert.equal(v1, v2);
  assert.ok(v1 === 'A' || v1 === 'B');
});

test('assignVariant produces independent bucketings across experiments', () => {
  const variants = [{ name: 'A', weight: 0.5 }, { name: 'B', weight: 0.5 }];
  let differences = 0;
  for (let i = 0; i < 1000; i += 1) {
    const a = assignVariant(`v-${i}`, 'exp-1', variants);
    const b = assignVariant(`v-${i}`, 'exp-2', variants);
    if (a !== b) differences += 1;
  }
  // Independent hashes => ~50% disagreement. Allow a wide band.
  assert.ok(differences > 350 && differences < 650, `differences=${differences} suggests hash dependence between experiments`);
});

test('assignVariant respects weights at scale', () => {
  const variants = [{ name: 'A', weight: 0.8 }, { name: 'B', weight: 0.2 }];
  let countB = 0;
  const N = 5000;
  for (let i = 0; i < N; i += 1) {
    if (assignVariant(`visitor-${i}`, 'weight-test', variants) === 'B') countB += 1;
  }
  const fractionB = countB / N;
  // Expect ~20% in B; allow 3pp tolerance on 5k samples.
  assert.ok(fractionB > 0.17 && fractionB < 0.23, `fractionB=${fractionB}`);
});

test('assignVariant rejects bad inputs', () => {
  assert.throws(() => assignVariant('v', 'k', []), /non-empty/);
  assert.throws(
    () => assignVariant('v', 'k', [{ name: 'A', weight: 0.3 }, { name: 'B', weight: 0.3 }]),
    /weights must sum to 1/
  );
});

test('sampleBeta concentrates near the posterior mean', () => {
  // Beta(50, 50) has mean 0.5 and small variance; 2000 draws should hover.
  let sum = 0;
  const N = 2000;
  for (let i = 0; i < N; i += 1) sum += sampleBeta(50, 50);
  const mean = sum / N;
  assert.ok(Math.abs(mean - 0.5) < 0.02, `sample mean=${mean}`);
});

test('decide ships B when B is clearly better with high practical lift', () => {
  const report = decide(
    { name: 'control', trials: 1000, successes: 50 },   // 5%
    { name: 'variant', trials: 1000, successes: 100 },  // 10% — double the rate
    { mcSamples: 5000 }
  );
  assert.equal(report.verdict, 'ship_b');
  assert.ok(report.probBGreater > 0.99);
  assert.ok(report.probBPracticallyBetter >= DEFAULT_DECISION_THRESHOLD);
});

test('decide ships A when A is clearly better', () => {
  const report = decide(
    { name: 'control', trials: 1000, successes: 100 },
    { name: 'variant', trials: 1000, successes: 50 },
    { mcSamples: 5000 }
  );
  assert.equal(report.verdict, 'ship_a');
  assert.ok(report.probAPracticallyBetter >= DEFAULT_DECISION_THRESHOLD);
});

test('decide stops as inconclusive when arms are effectively tied at huge sample size', () => {
  // At 100k trials each with identical rates, expected loss falls below epsilon.
  const report = decide(
    { trials: 100000, successes: 5000 },
    { trials: 100000, successes: 5000 },
    { mcSamples: 5000 }
  );
  assert.equal(report.verdict, 'inconclusive_stop');
  assert.ok(Math.min(report.expectedLossA, report.expectedLossB) <= report.lossEpsilon);
});

test('decide says continue at low sample size with no clear winner', () => {
  const report = decide(
    { trials: 50, successes: 5 },
    { trials: 50, successes: 6 },
    { mcSamples: 5000 }
  );
  assert.equal(report.verdict, 'continue');
});

test('renderDecisionMarkdown surfaces the verdict and probabilities', () => {
  const report = decide(
    { name: 'A', trials: 500, successes: 25 },
    { name: 'B', trials: 500, successes: 60 },
    { mcSamples: 3000 }
  );
  const md = renderDecisionMarkdown(report);
  assert.ok(md.includes(`Verdict: \`${report.verdict}\``));
  assert.ok(md.includes('P(B > A)'));
  assert.ok(md.includes('Decision rule'));
});

test('parseArgs reads --json and --mc-samples', () => {
  const parsed = parseArgs(['--json', '--mc-samples', '1234']);
  assert.equal(parsed.json, true);
  assert.equal(parsed.samples, 1234);
});
