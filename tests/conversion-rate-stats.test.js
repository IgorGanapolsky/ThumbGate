'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_PRIOR_ALPHA,
  DEFAULT_PRIOR_BETA,
  logGamma,
  regularizedIncompleteBeta,
  betaQuantile,
  posteriorParameters,
  estimateConversionRate,
  classifyVerdict,
  rankSurfaces,
  renderConversionMarkdown,
} = require('../scripts/conversion-rate-stats');

// Helpers ---------------------------------------------------------------

function approxEqual(actual, expected, tol = 1e-4, msg) {
  const ok = Math.abs(actual - expected) < tol;
  if (!ok) {
    throw new assert.AssertionError({
      message: msg || `expected ${actual} ≈ ${expected} (tol=${tol})`,
      actual,
      expected,
      operator: 'approxEqual',
    });
  }
}

// logGamma ---------------------------------------------------------------

test('logGamma matches known values', () => {
  // Γ(1) = 1, Γ(2) = 1, Γ(3) = 2, Γ(4) = 6, Γ(0.5) = √π
  approxEqual(logGamma(1), 0);
  approxEqual(logGamma(2), 0);
  approxEqual(logGamma(3), Math.log(2));
  approxEqual(logGamma(4), Math.log(6));
  approxEqual(logGamma(0.5), Math.log(Math.sqrt(Math.PI)));
  approxEqual(logGamma(10), Math.log(362880));
});

test('logGamma rejects non-positive input', () => {
  assert.throws(() => logGamma(0), /positive/);
  assert.throws(() => logGamma(-1), /positive/);
});

// regularizedIncompleteBeta ---------------------------------------------

test('regularizedIncompleteBeta returns 0 / 1 at endpoints', () => {
  assert.equal(regularizedIncompleteBeta(0, 2, 5), 0);
  assert.equal(regularizedIncompleteBeta(1, 2, 5), 1);
});

test('regularizedIncompleteBeta matches uniform CDF when α=β=1', () => {
  // Beta(1,1) is uniform on [0,1], so I_x(1,1) = x.
  for (const x of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    approxEqual(regularizedIncompleteBeta(x, 1, 1), x, 1e-5);
  }
});

test('regularizedIncompleteBeta matches known Beta(2,2) values', () => {
  // Beta(2,2) CDF at 0.5 is 0.5 by symmetry. At 0.25 it's 0.15625.
  approxEqual(regularizedIncompleteBeta(0.5, 2, 2), 0.5);
  approxEqual(regularizedIncompleteBeta(0.25, 2, 2), 0.15625);
});

// betaQuantile -----------------------------------------------------------

test('betaQuantile is the inverse of regularizedIncompleteBeta', () => {
  for (const p of [0.05, 0.25, 0.5, 0.75, 0.95]) {
    const x = betaQuantile(p, 3, 7);
    const back = regularizedIncompleteBeta(x, 3, 7);
    approxEqual(back, p, 1e-6, `quantile(${p}) for Beta(3,7) round-trip`);
  }
});

test('betaQuantile boundaries clamp to [0, 1]', () => {
  assert.equal(betaQuantile(0, 2, 5), 0);
  assert.equal(betaQuantile(1, 2, 5), 1);
});

// posteriorParameters ---------------------------------------------------

test('posteriorParameters applies prior + observations correctly', () => {
  const { alpha, beta } = posteriorParameters({ successes: 3, trials: 10 });
  assert.equal(alpha, DEFAULT_PRIOR_ALPHA + 3);
  assert.equal(beta, DEFAULT_PRIOR_BETA + 7);
});

test('posteriorParameters with N=0 returns the pure prior', () => {
  const { alpha, beta } = posteriorParameters({ successes: 0, trials: 0 });
  assert.equal(alpha, DEFAULT_PRIOR_ALPHA);
  assert.equal(beta, DEFAULT_PRIOR_BETA);
});

test('posteriorParameters rejects invalid input', () => {
  assert.throws(() => posteriorParameters({ successes: 5, trials: 3 }), /cannot exceed/);
  assert.throws(() => posteriorParameters({ successes: -1, trials: 10 }), /non-negative/);
  assert.throws(() => posteriorParameters({ successes: 1, trials: 10, priorAlpha: 0 }), /positive/);
});

// estimateConversionRate ------------------------------------------------

test('estimateConversionRate at N=0 returns the prior mean and wide bounds', () => {
  const est = estimateConversionRate({ successes: 0, trials: 0 });
  // Prior mean for Beta(1, 19) is 1/20 = 0.05
  approxEqual(est.mean, 0.05, 1e-9);
  // Posterior is the prior, so CI matches prior CI
  assert.ok(est.lower >= 0 && est.lower <= est.upper);
  assert.equal(est.verdict, 'insufficient_data');
  assert.equal(est.effectiveSampleSize, 0);
});

test('estimateConversionRate at high N tightens around the empirical rate', () => {
  const est = estimateConversionRate({ successes: 500, trials: 10000 });
  // Empirical rate is 5%. With 10k trials and a Beta(1,19) prior the
  // posterior mean is essentially 5.01%, and the CI tightens dramatically.
  approxEqual(est.mean, 501 / 10020, 1e-6);
  assert.ok(est.upper - est.lower < 0.01, `CI should tighten at N=10k, got width ${est.upper - est.lower}`);
  assert.equal(est.verdict, 'credible');
});

test('estimateConversionRate verdict transitions: <30 trials = insufficient_data', () => {
  for (const trials of [0, 1, 5, 29]) {
    const est = estimateConversionRate({ successes: 0, trials });
    assert.equal(est.verdict, 'insufficient_data', `at trials=${trials}`);
  }
});

test('estimateConversionRate handles the N=2 trap (1 conversion of 2 visitors)', () => {
  // Naïve rate = 50%. Bayesian posterior, after Beta(1,19) prior, is
  // Beta(2, 20) with mean ≈ 9% — NOT 50%. This is the right behaviour:
  // one lucky charge on 2 visitors should not move the estimate to 50%.
  const est = estimateConversionRate({ successes: 1, trials: 2 });
  assert.ok(est.mean < 0.15, `mean should be near prior at N=2, got ${est.mean}`);
  assert.equal(est.verdict, 'insufficient_data');
});

test('estimateConversionRate rejects out-of-range credible levels', () => {
  assert.throws(() => estimateConversionRate({ successes: 1, trials: 10, credibleLevel: 0 }), /\(0, 1\)/);
  assert.throws(() => estimateConversionRate({ successes: 1, trials: 10, credibleLevel: 1 }), /\(0, 1\)/);
});

// classifyVerdict -------------------------------------------------------

test('classifyVerdict cutoffs', () => {
  assert.equal(classifyVerdict({ trials: 0, lower: 0, upper: 1 }), 'insufficient_data');
  assert.equal(classifyVerdict({ trials: 29, lower: 0.01, upper: 0.05 }), 'insufficient_data');
  assert.equal(classifyVerdict({ trials: 100, lower: 0.01, upper: 0.20 }), 'wide_uncertainty');
  assert.equal(classifyVerdict({ trials: 1000, lower: 0.04, upper: 0.06 }), 'credible');
});

// rankSurfaces ----------------------------------------------------------

test('rankSurfaces orders by lower bound by default (pessimistic ranking)', () => {
  const surfaces = [
    { surface: '/a', successes: 1, trials: 2 },     // naïve 50%, posterior ~9%
    { surface: '/b', successes: 50, trials: 1000 }, // 5% with tight CI
    { surface: '/c', successes: 0, trials: 0 },     // pure prior, ~5% mean, wide CI
  ];
  const ranked = rankSurfaces(surfaces);
  assert.equal(ranked.length, 3);
  // /b should be first — it has the highest lower bound because of tight CI
  // around 5%. /a and /c will have lower bounds dragged down by uncertainty.
  assert.equal(ranked[0].surface, '/b');
  // Lower bounds are non-increasing across the ranking
  for (let i = 0; i < ranked.length - 1; i += 1) {
    assert.ok(ranked[i].estimate.lower >= ranked[i + 1].estimate.lower, 'lower bound non-increasing');
  }
});

test('rankSurfaces supports sortBy=none for preserving input order', () => {
  const surfaces = [
    { surface: '/a', successes: 1, trials: 2 },
    { surface: '/b', successes: 50, trials: 1000 },
  ];
  const ranked = rankSurfaces(surfaces, { sortBy: 'none' });
  assert.equal(ranked[0].surface, '/a');
  assert.equal(ranked[1].surface, '/b');
});

// renderConversionMarkdown ----------------------------------------------

test('renderConversionMarkdown produces a well-formed table for ranked surfaces', () => {
  const ranked = rankSurfaces([
    { surface: '/pricing', successes: 1, trials: 100 },
    { surface: '/case-studies', successes: 0, trials: 50 },
  ]);
  const md = renderConversionMarkdown(ranked);
  assert.match(md, /## Per-Surface Conversion \(Bayesian beta-binomial, 95% CI\)/);
  assert.match(md, /\/pricing/);
  assert.match(md, /\/case-studies/);
  assert.match(md, /Verdicts:/);
});

test('renderConversionMarkdown handles empty surface list gracefully', () => {
  const md = renderConversionMarkdown([]);
  assert.match(md, /No surfaces measured/);
});
