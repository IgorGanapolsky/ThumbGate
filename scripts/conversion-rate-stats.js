#!/usr/bin/env node
/**
 * conversion-rate-stats.js — honest conversion-rate estimation for low-N data.
 *
 * THE PROBLEM THIS SOLVES
 *
 * ThumbGate has shipped 7 public revenue surfaces (/, /pricing, /case-studies,
 * /compare/heidi, /learn/spec-driven-development, /pro, /go/teams). Each will
 * accumulate Plausible visitor counts and (eventually) Stripe charges. The
 * naïve approach is to compute conversion = charges / visitors per surface
 * and rank surfaces by that ratio.
 *
 * That approach lies at low N. /case-studies with 1 visitor and 0 charges
 * gets a "0%" rate, but the truth is "we don't know — could be 0%, could be
 * 80%, sample is too small." Likewise a /pricing surface with 1 visitor and
 * 1 charge gets ranked as 100% conversion, which would steer all traffic to
 * a surface that converted exactly one buyer.
 *
 * The right ML for this regime is a Bayesian beta-binomial model:
 *
 *   conversion_rate ~ Beta(α + successes, β + failures)
 *
 * With a weakly informative prior (Beta(α₀, β₀) reflecting a "most
 * dev-tool surfaces convert at 1-3%" expectation), the posterior gives a
 * credible interval that GETS NARROWER as N grows. At N=0 the interval is
 * wide and honest; at N=10,000 the interval tightens to the empirical rate.
 * Same code path, no need to switch models when "we finally have data."
 *
 * This module exports pure stats functions (no IO, no fetch) so they're
 * trivial to test and easy to wire into the unified revenue rollup once
 * #2090 lands.
 *
 * WHY NOT JUST USE THE FREQUENTIST RATE
 *
 * Wilson score interval, Agresti-Coull, etc. are options but they're not
 * naturally extensible to Thompson Sampling (which IS in the ThumbGate
 * stack already, for gate-policy bandits). Beta-binomial gives us a posterior
 * we can sample from when we want to allocate traffic adaptively across
 * surfaces — same model, two uses.
 *
 * REFERENCES
 *   Wikipedia: Beta-binomial distribution
 *   ThumbGate's existing scripts/thompson-sampling.js — uses Beta posteriors
 *   for arm selection in the gate-policy bandit.
 */

'use strict';

// ---------------------------------------------------------------------------
// Beta distribution math
// ---------------------------------------------------------------------------

/**
 * log Gamma function (Lanczos approximation). Used to compute Beta-function
 * normalizing constants when we need PDF / CDF values. Lanczos is good to
 * ~14 digits over the positive reals which is plenty for our use case
 * (conversion-rate counts; α and β are small integers + prior).
 *
 * @param {number} x
 * @returns {number}
 */
function logGamma(x) {
  if (x <= 0) {
    throw new RangeError(`logGamma requires positive input, got ${x}`);
  }
  // Lanczos approximation with g = 7, n = 9
  const g = 7;
  const c = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    // Reflection formula
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const z = x - 1;
  let sum = c[0];
  for (let i = 1; i < g + 2; i += 1) {
    sum += c[i] / (z + i);
  }
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(sum);
}

/**
 * Regularized incomplete beta function I_x(α, β), computed by Lentz's
 * algorithm for the continued fraction. This is the CDF of the Beta
 * distribution at point x.
 *
 * @param {number} x — point in [0, 1]
 * @param {number} a — alpha (>0)
 * @param {number} b — beta (>0)
 * @returns {number}
 */
function regularizedIncompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (a <= 0 || b <= 0) {
    throw new RangeError(`regularizedIncompleteBeta requires a, b > 0; got a=${a} b=${b}`);
  }
  // Continued fraction expansion. Use symmetry to ensure faster convergence.
  const bt = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x)
  );
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betaContinuedFraction(x, a, b)) / a;
  }
  return 1 - (bt * betaContinuedFraction(1 - x, b, a)) / b;
}

/**
 * Lentz-method continued-fraction evaluator for the incomplete beta.
 *
 * @param {number} x
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function betaContinuedFraction(x, a, b) {
  const MAX_ITERATIONS = 200;
  const EPS = 3e-15;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX_ITERATIONS; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) {
      return h;
    }
  }
  return h;
}

/**
 * Inverse CDF (quantile function) of the Beta distribution. Uses
 * bisection on the regularized incomplete beta. Slow, but bisection is
 * deterministic and we only call this twice per surface per rollup, so
 * speed doesn't matter.
 *
 * @param {number} p — probability in (0, 1)
 * @param {number} a — alpha (>0)
 * @param {number} b — beta (>0)
 * @returns {number}
 */
function betaQuantile(p, a, b) {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  if (a <= 0 || b <= 0) {
    throw new RangeError(`betaQuantile requires a, b > 0; got a=${a} b=${b}`);
  }
  // Bisection
  let lo = 0;
  let hi = 1;
  const EPS = 1e-10;
  const MAX_ITER = 100;
  for (let i = 0; i < MAX_ITER; i += 1) {
    const mid = (lo + hi) / 2;
    const cdf = regularizedIncompleteBeta(mid, a, b);
    if (Math.abs(cdf - p) < EPS) {
      return mid;
    }
    if (cdf < p) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------
// Beta-binomial conversion-rate inference
// ---------------------------------------------------------------------------

/**
 * Default weakly-informative prior: Beta(1, 19) reflects "most dev-tool
 * surfaces convert at around 5% with broad uncertainty." Mean 0.05, mode 0.
 * Equivalent to "we've seen 1 prior success out of 20 prior trials."
 *
 * The choice is opinionated but defensible — the alternative (Beta(1,1),
 * uniform) puts too much mass on >50% conversion rates, which is unrealistic
 * for cold landing pages. The prior gets washed out by ~30 real observations
 * either way.
 */
const DEFAULT_PRIOR_ALPHA = 1;
const DEFAULT_PRIOR_BETA = 19;
const DEFAULT_CREDIBLE_LEVEL = 0.95;

/**
 * Compute the posterior Beta distribution parameters for a conversion rate
 * given observed successes and trials, with a configurable prior.
 *
 * @param {object} input
 * @param {number} input.successes — non-negative integer count of conversions
 * @param {number} input.trials — non-negative integer count of visitor sessions
 * @param {number} [input.priorAlpha=DEFAULT_PRIOR_ALPHA]
 * @param {number} [input.priorBeta=DEFAULT_PRIOR_BETA]
 * @returns {{alpha: number, beta: number}}
 */
function posteriorParameters({
  successes,
  trials,
  priorAlpha = DEFAULT_PRIOR_ALPHA,
  priorBeta = DEFAULT_PRIOR_BETA,
}) {
  if (!Number.isFinite(successes) || successes < 0) {
    throw new RangeError(`successes must be a non-negative number, got ${successes}`);
  }
  if (!Number.isFinite(trials) || trials < 0) {
    throw new RangeError(`trials must be a non-negative number, got ${trials}`);
  }
  if (successes > trials) {
    throw new RangeError(`successes (${successes}) cannot exceed trials (${trials})`);
  }
  if (priorAlpha <= 0 || priorBeta <= 0) {
    throw new RangeError(`prior parameters must be positive; got α=${priorAlpha} β=${priorBeta}`);
  }
  return {
    alpha: priorAlpha + successes,
    beta: priorBeta + (trials - successes),
  };
}

/**
 * Compute a posterior credible interval and point estimate (mean) for a
 * conversion rate given observed successes and trials.
 *
 * Returns the full evidence trail — prior, posterior parameters, mean,
 * mode, and lower/upper bounds of the equal-tailed credible interval — so
 * callers can render exactly the uncertainty they need.
 *
 * @param {object} input
 * @param {number} input.successes
 * @param {number} input.trials
 * @param {number} [input.priorAlpha]
 * @param {number} [input.priorBeta]
 * @param {number} [input.credibleLevel=0.95] — e.g. 0.95 for 95% CI
 * @returns {object}
 */
function estimateConversionRate({
  successes,
  trials,
  priorAlpha = DEFAULT_PRIOR_ALPHA,
  priorBeta = DEFAULT_PRIOR_BETA,
  credibleLevel = DEFAULT_CREDIBLE_LEVEL,
}) {
  if (credibleLevel <= 0 || credibleLevel >= 1) {
    throw new RangeError(`credibleLevel must be in (0, 1); got ${credibleLevel}`);
  }
  const { alpha, beta } = posteriorParameters({ successes, trials, priorAlpha, priorBeta });
  const mean = alpha / (alpha + beta);
  // Mode of Beta(α, β):
  //   α > 1 AND β > 1                — single interior mode at (α-1)/(α+β-2)
  //   α ≤ 1 < β, OR β ≤ 1 < α        — boundary mode at the larger-density end
  //   α < 1 AND β < 1                — BIMODAL: density spikes at both 0 and 1
  //                                    (U-shaped), with 0.5 as the antimode.
  //                                    We report the boundary with higher
  //                                    density. Density at 0 is finite when
  //                                    α > 1 and zero when α < 1; at α=β<1
  //                                    the two boundaries are equally peaked
  //                                    so we tie-break to mean side.
  //   α == 1 AND β == 1              — flat (uniform); no unique mode, report mean.
  let mode;
  if (alpha > 1 && beta > 1) {
    mode = (alpha - 1) / (alpha + beta - 2);
  } else if (alpha <= 1 && beta > 1) {
    mode = 0;
  } else if (alpha > 1 && beta <= 1) {
    mode = 1;
  } else if (alpha < 1 && beta < 1) {
    // U-shaped Beta. Compare unnormalized densities at the boundaries via
    // the log-density limit; whichever end has higher mass is the dominant
    // mode. For Beta(α, β) with α, β < 1, log f(x) -> +∞ as x -> 0 with
    // exponent -(1-α), and as x -> 1 with exponent -(1-β). Higher 1-α
    // means a sharper spike at 0; higher 1-β means a sharper spike at 1.
    if (1 - alpha > 1 - beta) mode = 0;
    else if (1 - beta > 1 - alpha) mode = 1;
    else mode = mean < 0.5 ? 0 : 1;
  } else {
    // α == 1 AND β == 1 — uniform. Mean is as principled as anything.
    mode = mean;
  }
  const tail = (1 - credibleLevel) / 2;
  const lower = betaQuantile(tail, alpha, beta);
  const upper = betaQuantile(1 - tail, alpha, beta);
  // The "honest" sample size we've effectively committed to claiming.
  const effectiveSampleSize = alpha + beta - priorAlpha - priorBeta;
  return {
    successes,
    trials,
    priorAlpha,
    priorBeta,
    posteriorAlpha: alpha,
    posteriorBeta: beta,
    credibleLevel,
    mean,
    mode,
    lower,
    upper,
    effectiveSampleSize,
    // A human-readable verdict that captures how much to trust this estimate.
    verdict: classifyVerdict({ trials, lower, upper }),
  };
}

/**
 * Classify how trustworthy a posterior estimate is given the data volume
 * and the width of the credible interval. We use three buckets:
 *
 *   "insufficient_data"   trials < 30 (prior dominates)
 *   "wide_uncertainty"    interval width > 0.10 (10 percentage points)
 *   "credible"            interval width <= 0.10
 *
 * The 30-trial cutoff is the conventional rule-of-thumb for binomial
 * estimates to start trusting the empirical mean. The 10pp cutoff is a
 * judgement call — narrower than 10pp is "we could act on this."
 *
 * @param {object} input
 * @param {number} input.trials
 * @param {number} input.lower
 * @param {number} input.upper
 * @returns {"insufficient_data"|"wide_uncertainty"|"credible"}
 */
function classifyVerdict({ trials, lower, upper }) {
  if (trials < 30) return 'insufficient_data';
  if (upper - lower > 0.1) return 'wide_uncertainty';
  return 'credible';
}

/**
 * Compute conversion-rate estimates for an array of surfaces, each with
 * its own successes/trials counts. Returns the same array decorated with
 * estimate fields, optionally sorted by lower bound of the credible
 * interval (the "pessimistic ranking" — surfaces ranked by what we're
 * confident they're AT LEAST converting at).
 *
 * Pessimistic ranking is the right default for the bandit case: it
 * prevents allocating traffic to a surface whose point estimate is high
 * but whose lower bound is near zero (i.e. one lucky charge on 2 visitors).
 *
 * @param {Array<{surface: string, successes: number, trials: number}>} surfaces
 * @param {object} [opts]
 * @param {number} [opts.priorAlpha]
 * @param {number} [opts.priorBeta]
 * @param {number} [opts.credibleLevel]
 * @param {"lower"|"mean"|"upper"|"none"} [opts.sortBy="lower"]
 * @returns {Array<object>}
 */
function rankSurfaces(surfaces, opts = {}) {
  const { sortBy = 'lower' } = opts;
  const decorated = surfaces.map((row) => ({
    ...row,
    estimate: estimateConversionRate({
      successes: row.successes,
      trials: row.trials,
      priorAlpha: opts.priorAlpha,
      priorBeta: opts.priorBeta,
      credibleLevel: opts.credibleLevel,
    }),
  }));
  if (sortBy === 'none') return decorated;
  const key = sortBy === 'mean' || sortBy === 'upper' ? sortBy : 'lower';
  return decorated.sort((a, b) => b.estimate[key] - a.estimate[key]);
}

/**
 * Render a markdown summary of conversion-rate estimates suitable for
 * inclusion in the unified revenue rollup.
 *
 * @param {Array<{surface: string, successes: number, trials: number, estimate: object}>} ranked
 * @returns {string}
 */
function renderConversionMarkdown(ranked) {
  const lines = [];
  // Pull the credible level from the first ranked row's estimate so the
  // heading and column label reflect what the caller actually requested
  // (instead of hardcoding 95% when, say, a 90% CI was computed).
  const credibleLevel = ranked.length && ranked[0].estimate
    ? ranked[0].estimate.credibleLevel
    : DEFAULT_CREDIBLE_LEVEL;
  const ciLabel = `${Math.round(credibleLevel * 100)}% CI`;
  lines.push(`## Per-Surface Conversion (Bayesian beta-binomial, ${ciLabel})`);
  lines.push('');
  if (!ranked.length) {
    lines.push('_No surfaces measured._');
    return lines.join('\n') + '\n';
  }
  lines.push(`| Surface | Trials | Successes | Mean | ${ciLabel} | Verdict |`);
  lines.push('| --- | ---: | ---: | ---: | --- | --- |');
  for (const row of ranked) {
    const est = row.estimate;
    const mean = (est.mean * 100).toFixed(2);
    const lo = (est.lower * 100).toFixed(2);
    const hi = (est.upper * 100).toFixed(2);
    lines.push(`| \`${row.surface}\` | ${row.trials} | ${row.successes} | ${mean}% | [${lo}%, ${hi}%] | ${est.verdict} |`);
  }
  lines.push('');
  lines.push(`Verdicts: \`insufficient_data\` = <30 trials, prior still dominates. \`wide_uncertainty\` = ${ciLabel} wider than 10pp. \`credible\` = narrow enough to act on.`);
  return lines.join('\n') + '\n';
}

module.exports = {
  DEFAULT_PRIOR_ALPHA,
  DEFAULT_PRIOR_BETA,
  DEFAULT_CREDIBLE_LEVEL,
  logGamma,
  regularizedIncompleteBeta,
  betaQuantile,
  posteriorParameters,
  estimateConversionRate,
  classifyVerdict,
  rankSurfaces,
  renderConversionMarkdown,
};
