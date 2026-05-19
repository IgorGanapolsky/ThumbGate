#!/usr/bin/env node
/**
 * ab-experiment-framework.js — Bayesian A/B testing harness on top of the
 * existing Beta-binomial conversion-rate stats.
 *
 * What this gives us. ThumbGate already ships the math: `conversion-rate-stats.js`
 * computes Beta-binomial posteriors with credible intervals. What's been
 * missing is the *experiment harness* — variant assignment, decision rule,
 * sample-size guard, and stopping criteria. This module is that harness.
 *
 * Design choices, made explicit.
 *
 *   1. Variant assignment is a deterministic hash of the visitor ID (or any
 *      stable cookie). Same visitor → same variant for the experiment's
 *      lifetime. No server-side sticky session needed.
 *
 *   2. Decision rule is Bayesian, not frequentist. We compute
 *      P(rate_B > rate_A) by Monte Carlo sampling from the Beta posteriors
 *      (existing posteriorParameters() in conversion-rate-stats.js). When
 *      that probability crosses a threshold (default 0.95), we declare a
 *      winner. No p-values, no fixed sample size, no peeking penalty —
 *      Bayesian decision theory under a default uniform prior handles this
 *      correctly.
 *
 *   3. Minimum-effect guard. Even at 95% posterior probability, a 0.01%
 *      improvement is not worth shipping the variant. We require the
 *      posterior probability of a *practical* lift (default 5% relative)
 *      to clear the threshold. This is the right business decision rule,
 *      not just the right statistical one.
 *
 *   4. Loss-bound stopping. If neither arm wins but the *expected loss* of
 *      picking the wrong arm drops below epsilon (default 0.05% absolute),
 *      we stop — the experiment is "decided to be inconclusive" because
 *      the choice no longer matters much.
 *
 * Why this design over the alternatives.
 *
 *   - Frequentist NHST: requires pre-registered sample size, penalizes
 *     peeking, doesn't naturally extend to multi-arm or sequential. We
 *     already use Beta posteriors elsewhere in the stack (thompson-sampling,
 *     conversion-rate-stats) so Bayesian is consistent.
 *
 *   - Multi-armed bandits (Thompson Sampling): great for *traffic
 *     allocation*, not great when you want a clean before/after decision.
 *     A/B with a Bayesian decision rule gives you the clean "switch to
 *     B" moment that copy / pricing experiments actually need.
 *
 *   - Sequential probability ratio test: clean math, but requires a fixed
 *     effect size assumption upfront. Practical-significance threshold
 *     handles the same concern more transparently.
 *
 * Out of scope for this module. The harness is the math + decision rule.
 * Page-rendering integration (cookie set, variant-aware HTML) is the
 * next PR; this one ships the foundation so the page integration can be
 * a thin server-side change.
 */

'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const {
  posteriorParameters,
  estimateConversionRate,
} = require('./conversion-rate-stats');

const DEFAULT_MC_SAMPLES = 20000;
const DEFAULT_DECISION_THRESHOLD = 0.95;
const DEFAULT_PRACTICAL_LIFT = 0.05; // 5% relative
const DEFAULT_LOSS_EPSILON = 0.0005; // 0.05% absolute

/**
 * Deterministic variant assignment. Same visitor → same variant for the
 * lifetime of the experiment. Uses a salted SHA-256 hash so different
 * experiments produce independent bucketings of the same visitor pool.
 *
 * @param {string} visitorId - stable visitor identifier (cookie, install_id)
 * @param {string} experimentKey - unique key for the experiment (e.g. 'pricing-hero-v1')
 * @param {Array<{name: string, weight?: number}>} variants - must sum to ≤1.0
 * @returns {string} variant name
 */
function assignVariant(visitorId, experimentKey, variants) {
  if (!Array.isArray(variants) || variants.length === 0) {
    throw new Error('variants must be a non-empty array');
  }
  const weights = variants.map((v) => (typeof v.weight === 'number' ? v.weight : 1 / variants.length));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (Math.abs(weightSum - 1) > 1e-6) {
    throw new Error(`variant weights must sum to 1.0; got ${weightSum.toFixed(6)}`);
  }
  const hash = crypto.createHash('sha256').update(`${experimentKey}:${visitorId}`).digest();
  // Take the first 4 bytes as an unsigned 32-bit int, normalize to [0,1).
  const bucket = hash.readUInt32BE(0) / 0x1_0000_0000;
  let cumulative = 0;
  for (let i = 0; i < variants.length; i += 1) {
    cumulative += weights[i];
    if (bucket < cumulative) return variants[i].name;
  }
  return variants[variants.length - 1].name;
}

/**
 * Sample once from Beta(alpha, beta) using the Marsaglia-Tsang method
 * (via Gamma sampling). Pure JS; uses crypto.randomInt for the underlying
 * uniform.
 *
 * @param {number} alpha
 * @param {number} beta
 * @returns {number}
 */
function sampleBeta(alpha, beta) {
  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  return x / (x + y);
}

function sampleGamma(shape) {
  // Marsaglia-Tsang for shape ≥ 1
  if (shape < 1) {
    // Boost shape by 1, scale at end
    const boost = Math.pow(uniform(), 1 / shape);
    return sampleGamma(shape + 1) * boost;
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let i = 0; i < 1000; i += 1) {
    let x;
    let v;
    do {
      x = standardNormal();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = uniform();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
  throw new Error('sampleGamma failed to converge (shape was probably invalid)');
}

function standardNormal() {
  // Box-Muller — single draw cached for the next call.
  const u1 = uniform();
  const u2 = uniform();
  return Math.sqrt(-2 * Math.log(u1 || Number.MIN_VALUE)) * Math.cos(2 * Math.PI * u2);
}

function uniform() {
  // crypto.randomInt(min, max) requires (max - min) <= 2^48 - 1. Use 2^32
  // for the range — plenty of entropy for MC sampling and well within bounds.
  return crypto.randomInt(0, 2 ** 32) / 2 ** 32;
}

/**
 * Run the Bayesian A/B decision against two arms. Computes:
 *  - P(rate_B > rate_A)
 *  - P(rate_B > rate_A * (1 + practicalLift)) — the practical-significance probability
 *  - expected loss of picking each arm
 *  - verdict: "ship_b" | "ship_a" | "inconclusive_stop" | "continue"
 *
 * @param {{ trials, successes, name? }} arm_a
 * @param {{ trials, successes, name? }} arm_b
 * @param {object} [opts]
 * @returns {object} decision report
 */
function decide(arm_a, arm_b, opts = {}) {
  const decisionThreshold = opts.decisionThreshold ?? DEFAULT_DECISION_THRESHOLD;
  const practicalLift = opts.practicalLift ?? DEFAULT_PRACTICAL_LIFT;
  const lossEpsilon = opts.lossEpsilon ?? DEFAULT_LOSS_EPSILON;
  const mcSamples = opts.mcSamples ?? DEFAULT_MC_SAMPLES;

  const aPosterior = posteriorParameters({
    successes: arm_a.successes,
    trials: arm_a.trials,
    priorAlpha: opts.priorAlpha,
    priorBeta: opts.priorBeta,
  });
  const bPosterior = posteriorParameters({
    successes: arm_b.successes,
    trials: arm_b.trials,
    priorAlpha: opts.priorAlpha,
    priorBeta: opts.priorBeta,
  });

  let bGreater = 0;
  let bGreaterByPracticalLift = 0;
  let aGreaterByPracticalLift = 0;
  let lossPickingA = 0;
  let lossPickingB = 0;

  for (let i = 0; i < mcSamples; i += 1) {
    const rateA = sampleBeta(aPosterior.alpha, aPosterior.beta);
    const rateB = sampleBeta(bPosterior.alpha, bPosterior.beta);
    if (rateB > rateA) bGreater += 1;
    if (rateB > rateA * (1 + practicalLift)) bGreaterByPracticalLift += 1;
    if (rateA > rateB * (1 + practicalLift)) aGreaterByPracticalLift += 1;
    if (rateA > rateB) lossPickingB += rateA - rateB;
    else lossPickingA += rateB - rateA;
  }

  const probBGreater = bGreater / mcSamples;
  const probBPracticallyBetter = bGreaterByPracticalLift / mcSamples;
  const probAPracticallyBetter = aGreaterByPracticalLift / mcSamples;
  const expectedLossA = lossPickingA / mcSamples;
  const expectedLossB = lossPickingB / mcSamples;

  let verdict;
  if (probBPracticallyBetter >= decisionThreshold) {
    verdict = 'ship_b';
  } else if (probAPracticallyBetter >= decisionThreshold) {
    verdict = 'ship_a';
  } else if (Math.min(expectedLossA, expectedLossB) <= lossEpsilon) {
    verdict = 'inconclusive_stop';
  } else {
    verdict = 'continue';
  }

  return {
    arm_a: {
      name: arm_a.name || 'A',
      ...arm_a,
      estimate: estimateConversionRate({ successes: arm_a.successes, trials: Math.max(arm_a.trials, arm_a.successes) }),
    },
    arm_b: {
      name: arm_b.name || 'B',
      ...arm_b,
      estimate: estimateConversionRate({ successes: arm_b.successes, trials: Math.max(arm_b.trials, arm_b.successes) }),
    },
    probBGreater,
    probBPracticallyBetter,
    probAPracticallyBetter,
    expectedLossA,
    expectedLossB,
    verdict,
    decisionThreshold,
    practicalLift,
    lossEpsilon,
    mcSamples,
  };
}

function renderDecisionMarkdown(report) {
  const lines = [];
  lines.push(`# A/B Decision: ${report.arm_a.name} vs ${report.arm_b.name}`);
  lines.push('');
  lines.push(`**Verdict: \`${report.verdict}\`**`);
  lines.push('');
  lines.push('| Arm | trials | successes | rate (95% CI) |');
  lines.push('|---|---:|---:|---|');
  for (const arm of [report.arm_a, report.arm_b]) {
    const e = arm.estimate;
    lines.push(`| ${arm.name} | ${arm.trials} | ${arm.successes} | ${(e.mean * 100).toFixed(3)}% [${(e.lower * 100).toFixed(3)}%, ${(e.upper * 100).toFixed(3)}%] |`);
  }
  lines.push('');
  lines.push(`P(B > A) = **${(report.probBGreater * 100).toFixed(1)}%**`);
  lines.push(`P(B better by ≥${(report.practicalLift * 100).toFixed(1)}% relative) = **${(report.probBPracticallyBetter * 100).toFixed(1)}%**`);
  lines.push(`P(A better by ≥${(report.practicalLift * 100).toFixed(1)}% relative) = **${(report.probAPracticallyBetter * 100).toFixed(1)}%**`);
  lines.push(`Expected loss of picking A: ${(report.expectedLossA * 100).toFixed(4)}%`);
  lines.push(`Expected loss of picking B: ${(report.expectedLossB * 100).toFixed(4)}%`);
  lines.push('');
  lines.push('## Decision rule');
  lines.push(`- ship if P(arm practically better) ≥ ${(report.decisionThreshold * 100).toFixed(0)}%`);
  lines.push(`- stop (inconclusive) if min expected loss ≤ ${(report.lossEpsilon * 100).toFixed(4)}%`);
  lines.push(`- continue otherwise`);
  lines.push('');
  return lines.join('\n');
}

function parseArgs(argv = []) {
  return {
    json: argv.includes('--json'),
    samples: (() => {
      const i = argv.indexOf('--mc-samples');
      return i > -1 ? Number(argv[i + 1]) : DEFAULT_MC_SAMPLES;
    })(),
  };
}

module.exports = {
  assignVariant,
  decide,
  renderDecisionMarkdown,
  sampleBeta,
  parseArgs,
  DEFAULT_DECISION_THRESHOLD,
  DEFAULT_PRACTICAL_LIFT,
  DEFAULT_LOSS_EPSILON,
  DEFAULT_MC_SAMPLES,
};

// CLI: read two arms from argv, print decision
if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  const args = parseArgs(process.argv.slice(2));
  const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (argv.length !== 4) {
    process.stderr.write('usage: ab-experiment-framework.js <trials_a> <successes_a> <trials_b> <successes_b> [--json] [--mc-samples N]\n');
    process.exit(1);
  }
  const report = decide(
    { name: 'A', trials: Number(argv[0]), successes: Number(argv[1]) },
    { name: 'B', trials: Number(argv[2]), successes: Number(argv[3]) },
    { mcSamples: args.samples }
  );
  process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : `${renderDecisionMarkdown(report)}\n`);
}
