'use strict';
/**
 * RRSI: Regularized Recursive Self-Improvement of Agent Harnesses
 *
 * Implements the mathematical regularization framework from Google Cloud AI Research
 * (arXiv:2609.24972, Sep 2026: Xia, Han, Wang, Pfister, Lee, et al.).
 *
 * Prevents recursive agent harness evolution from overfitting to finite evaluation
 * noise, leaking benchmark/test cheats, and accumulating unconstrained prompt/rule
 * complexity ($L_0$ and $L_1$ explosions).
 *
 * Core Planes:
 * 1. Proposal Regularization:
 *    - Cosine-Annealed Update Sparsity (b_t budget)
 *    - Annealed Step Sizing (alpha_t step attenuation)
 *    - Stagnation-Driven Structured Exploration (Entropy Regularization)
 *    - Credit-Assignment Falsification Conditioning
 *
 * 2. Selection Regularization:
 *    - Leakage Critic (pre-screening benchmark/fixture hardcoding)
 *    - Complexity-Aware Scoring (L1 cost penalty: Delta S_reg = Delta S - lambda * Delta C)
 *    - Stability-Aware Acceptance Floor (Delta S_reg > epsilon)
 *    - Structural Pruning (L0 redundancy and dormancy removal)
 *
 * Zero external dependencies — deterministic Node.js.
 */

const RRSI_DEFAULTS = Object.freeze({
  MIN_BUDGET: 1,
  MAX_BUDGET: 3,
  MIN_STEP_MULTIPLIER: 0.25,
  MAX_STEP_MULTIPLIER: 1.0,
  COMPLEXITY_LAMBDA: 0.05,
  STABILITY_FLOOR: 0.002,
  STAGNATION_WINDOW: 3,
  STAGNATION_THRESHOLD: 0.001,
});

/**
 * Compute the cosine-annealed cardinality budget b_t (L0 update sparsity).
 * Early in evolution (t -> 0), b_t allows multi-parameter exploration (b_max).
 * Late in evolution (t -> T), b_t anneals to isolated, fine-grained edits (b_min).
 *
 * Formula:
 * b_t = floor(b_min + (b_max - b_min) * 0.5 * (1 + cos(pi * min(t, T) / T)))
 *
 * @param {number} iteration - 0-indexed current iteration t
 * @param {number} totalIterations - Total scheduled iterations T
 * @param {object} [options]
 * @returns {number} Integer budget in [minBudget, maxBudget]
 */
function calculateAnnealedBudget(iteration, totalIterations, options = {}) {
  const minBudget = Number.isFinite(options.minBudget) ? options.minBudget : RRSI_DEFAULTS.MIN_BUDGET;
  const maxBudget = Number.isFinite(options.maxBudget) ? options.maxBudget : RRSI_DEFAULTS.MAX_BUDGET;

  if (totalIterations <= 1 || iteration <= 0) {
    return maxBudget;
  }
  if (iteration >= totalIterations) {
    return minBudget;
  }

  const progress = Math.min(1, Math.max(0, iteration / totalIterations));
  const cosineFactor = 0.5 * (1 + Math.cos(Math.PI * progress));
  const budget = Math.floor(minBudget + (maxBudget - minBudget) * cosineFactor);

  return Math.max(minBudget, Math.min(maxBudget, budget));
}

/**
 * Compute the cosine-annealed step multiplier alpha_t.
 * Scales mutation step size down as iteration index approaches total iterations.
 *
 * Formula:
 * alpha_t = alpha_min + (alpha_max - alpha_min) * 0.5 * (1 + cos(pi * min(t, T) / T))
 *
 * @param {number} iteration - 0-indexed current iteration t
 * @param {number} totalIterations - Total scheduled iterations T
 * @param {object} [options]
 * @returns {number} Float multiplier in [minMultiplier, maxMultiplier]
 */
function calculateAnnealedStepMultiplier(iteration, totalIterations, options = {}) {
  const minMultiplier = Number.isFinite(options.minMultiplier)
    ? options.minMultiplier
    : RRSI_DEFAULTS.MIN_STEP_MULTIPLIER;
  const maxMultiplier = Number.isFinite(options.maxMultiplier)
    ? options.maxMultiplier
    : RRSI_DEFAULTS.MAX_STEP_MULTIPLIER;

  if (totalIterations <= 1 || iteration <= 0) {
    return maxMultiplier;
  }
  if (iteration >= totalIterations) {
    return minMultiplier;
  }

  const progress = Math.min(1, Math.max(0, iteration / totalIterations));
  const cosineFactor = 0.5 * (1 + Math.cos(Math.PI * progress));
  const multiplier = minMultiplier + (maxMultiplier - minMultiplier) * cosineFactor;

  return Math.round(Math.max(minMultiplier, Math.min(maxMultiplier, multiplier)) * 10000) / 10000;
}

/**
 * Leakage Critic: Pre-screens proposed mutations, diffs, rules, or values
 * to reject benchmark-specific hardcoded strings, test fixtures, or cheats.
 *
 * @param {string|object} candidate - Proposed text, diff, or mutation object
 * @param {object} [options]
 * @returns {{ passed: boolean, leaks: string[], reason: string | null }}
 */
function screenLeakage(candidate, options = {}) {
  const text = typeof candidate === 'string'
    ? candidate
    : JSON.stringify(candidate || '');

  const customDenyPatterns = Array.isArray(options.denyPatterns) ? options.denyPatterns : [];

  const BENCHMARK_LEAKAGE_PATTERNS = [
    { name: 'benchmark_dataset', regex: /\b(?:swe[-_]?bench|humaneval|mbpp|gsm8k|arc[-_]?challenge|webarena|synthetic[-_]?eval)\b/i },
    { name: 'test_fixture_hardcode', regex: /(?:tests?\/fixtures\/|fixture_[a-z0-9_]+\.(?:json|html|txt)|mock_[a-z0-9_]+_response)/i },
    { name: 'session_lease_leak', regex: /(?:thumbgate-session-lease\.json|\.thumbgate\/session-lease)/i },
    { name: 'temp_filesystem_leak', regex: /(?:\/private\/tmp\/|\/tmp\/[a-z0-9_.-]+|\/var\/folders\/)/i },
    { name: 'golden_cheat_token', regex: /(?:golden[-_]?answer|expected[-_]?golden(?:[-_]?answer)?|cheat[-_]?bypass|assert_true_always)/i },
    ...customDenyPatterns.map((pat, idx) => ({
      name: `custom_pattern_${idx}`,
      regex: pat instanceof RegExp ? pat : new RegExp(pat, 'i'),
    })),
  ];

  const leaks = [];
  for (const pattern of BENCHMARK_LEAKAGE_PATTERNS) {
    if (pattern.regex.test(text)) {
      leaks.push(pattern.name);
    }
  }

  const passed = leaks.length === 0;
  const reason = passed ? null : `Leakage Critic rejected candidate containing: ${leaks.join(', ')}`;

  return {
    passed,
    leaks,
    reason,
  };
}

/**
 * Measure complexity delta between candidate and baseline.
 * Can evaluate parameter displacement, string length, or token delta.
 *
 * @param {object} candidate
 * @param {object} baseline
 * @param {object} [options]
 * @returns {number} Normalized complexity delta (>= 0)
 */
function computeComplexityDelta(candidate, baseline, options = {}) {
  // If numeric parameter change:
  if (typeof candidate === 'number' && typeof baseline === 'number') {
    const range = Array.isArray(options.range) && options.range.length === 2
      ? Math.max(1e-6, Math.abs(options.range[1] - options.range[0]))
      : Math.max(1, Math.abs(baseline) || 1);
    return Math.abs(candidate - baseline) / range;
  }

  // If text/string (e.g. prompt or rule):
  if (typeof candidate === 'string' && typeof baseline === 'string') {
    const lengthDelta = Math.max(0, candidate.length - baseline.length);
    const baseLength = Math.max(1, baseline.length);
    return lengthDelta / baseLength;
  }

  // If object mutation:
  if (candidate && typeof candidate === 'object' && baseline && typeof baseline === 'object') {
    const candidateKeys = Object.keys(candidate).length;
    const baselineKeys = Object.keys(baseline).length;
    return Math.max(0, (candidateKeys - baselineKeys) / Math.max(1, baselineKeys));
  }

  return 0;
}

/**
 * Evaluate complexity-regularized score and acceptance decision.
 *
 * Regularization formula:
 * Delta S = S_cand - S_base
 * ComplexityPenalty = lambda * max(0, Delta Complexity)
 * Delta S_reg = Delta S - ComplexityPenalty
 *
 * Accepted iff:
 * 1. candidate passed all tests
 * 2. candidate score >= baseline score
 * 3. Delta S_reg > stabilityFloor
 *
 * @param {object} params
 * @param {number} params.baselineScore - S_base in [0, 1]
 * @param {number} params.candidateScore - S_cand in [0, 1]
 * @param {boolean} [params.testsPassed=true] - Whether evaluation tests passed
 * @param {number} [params.complexityDelta=0] - Complexity growth (>= 0)
 * @param {object} [options]
 * @returns {object}
 */
function evaluateComplexityRegularizedScore(params, options = {}) {
  const baselineScore = Number.isFinite(params.baselineScore) ? params.baselineScore : 0;
  const candidateScore = Number.isFinite(params.candidateScore) ? params.candidateScore : 0;
  const testsPassed = params.testsPassed !== false;
  const complexityDelta = Number.isFinite(params.complexityDelta) ? Math.max(0, params.complexityDelta) : 0;

  const lambda = Number.isFinite(options.lambda) ? options.lambda : RRSI_DEFAULTS.COMPLEXITY_LAMBDA;
  const stabilityFloor = Number.isFinite(options.stabilityFloor) ? options.stabilityFloor : RRSI_DEFAULTS.STABILITY_FLOOR;

  const rawDelta = Math.round((candidateScore - baselineScore) * 10000) / 10000;
  const penalty = Math.round((lambda * complexityDelta) * 10000) / 10000;
  const regularizedDelta = Math.round((rawDelta - penalty) * 10000) / 10000;

  let accepted = false;
  let reason = '';

  if (!testsPassed) {
    accepted = false;
    reason = 'Candidate evaluation failed test execution';
  } else if (candidateScore < baselineScore) {
    accepted = false;
    reason = `Score regressed from ${baselineScore} to ${candidateScore} (delta: ${rawDelta})`;
  } else if (regularizedDelta <= stabilityFloor) {
    accepted = false;
    reason = `Score gain (${rawDelta}) penalized by complexity (${penalty}) leaves regularized delta (${regularizedDelta}) below stability floor (${stabilityFloor})`;
  } else {
    accepted = true;
    reason = `Regularized delta (+${regularizedDelta}) clears stability floor (+${stabilityFloor}) with complexity penalty (${penalty})`;
  }

  return {
    accepted,
    rawDelta,
    regularizedDelta,
    penalty,
    complexityDelta,
    stabilityFloor,
    reason,
  };
}

/**
 * Stagnation Detector: Detects when recursive self-improvement has stalled
 * over a sliding window w of experiments.
 *
 * @param {Array<object>} history - Array of previous experiment results
 * @param {object} [options]
 * @returns {{ isStagnant: boolean, windowSize: number, recentDeltas: number[], reason: string }}
 */
function detectStagnation(history = [], options = {}) {
  const windowSize = Number.isFinite(options.windowSize) ? options.windowSize : RRSI_DEFAULTS.STAGNATION_WINDOW;
  const threshold = Number.isFinite(options.threshold) ? options.threshold : RRSI_DEFAULTS.STAGNATION_THRESHOLD;

  if (!Array.isArray(history) || history.length < windowSize) {
    return {
      isStagnant: false,
      windowSize,
      recentDeltas: [],
      reason: `Insufficient history (${(history || []).length}/${windowSize}) to evaluate stagnation`,
    };
  }

  const recent = history.slice(-windowSize);
  const recentDeltas = recent.map((item) => {
    if (typeof item.regularizedDelta === 'number') return item.regularizedDelta;
    if (typeof item.delta === 'number') return item.delta;
    if (typeof item.score === 'number' && typeof item.baseline === 'number') {
      return item.score - item.baseline;
    }
    return 0;
  });

  const allFlat = recentDeltas.every((d) => Math.abs(d) <= threshold);
  const allDiscarded = recent.every((item) => item.kept === false || item.status === 'discarded');

  const isStagnant = allFlat || allDiscarded;
  const reason = isStagnant
    ? `Stagnation detected: last ${windowSize} experiments flat/discarded (max |delta| = ${Math.max(...recentDeltas.map(Math.abs)).toFixed(4)})`
    : `Progress healthy: recent variations exceed threshold ${threshold}`;

  return {
    isStagnant,
    windowSize,
    recentDeltas,
    reason,
  };
}

/**
 * Structured Exploration Selector (Entropy Regularization):
 * Directs proposal generation to under-explored targets when stagnation occurs,
 * and conditions selection on credit-assignment history to prevent re-testing
 * previously falsified values.
 *
 * @param {object} params
 * @param {Array<object>} params.targets - List of available evolution targets
 * @param {Array<object>} [params.history=[]] - Past experiment history
 * @param {boolean} [params.isStagnant=false] - Whether stagnation is currently flagged
 * @returns {{ target: object, strategy: string, rationale: string }}
 */
function selectTargetWithExploration({ targets = [], history = [], isStagnant = false } = {}) {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error('selectTargetWithExploration requires a non-empty targets array');
  }

  // Count visits per target name
  const visitCounts = new Map();
  targets.forEach((t) => visitCounts.set(t.name, 0));

  (history || []).forEach((exp) => {
    const targetName = exp.target?.name || exp.mutation?.target || exp.targetName;
    if (targetName && visitCounts.has(targetName)) {
      visitCounts.set(targetName, visitCounts.get(targetName) + 1);
    }
  });

  // If stagnant: pick the target with the LOWEST visit count (forced exploration)
  if (isStagnant) {
    let minTarget = targets[0];
    let minCount = visitCounts.get(minTarget.name) || 0;

    for (const t of targets) {
      const count = visitCounts.get(t.name) || 0;
      if (count < minCount) {
        minCount = count;
        minTarget = t;
      }
    }

    return {
      target: minTarget,
      strategy: 'entropy_exploration',
      rationale: `Stagnation active: selected under-explored target "${minTarget.name}" (exercised ${minCount} times)`,
    };
  }

  // Exploitation / weighted selection: prefer targets with higher success rates
  const successCounts = new Map();
  targets.forEach((t) => successCounts.set(t.name, 0));

  (history || []).forEach((exp) => {
    const targetName = exp.target?.name || exp.mutation?.target || exp.targetName;
    if (targetName && successCounts.has(targetName) && exp.kept) {
      successCounts.set(targetName, successCounts.get(targetName) + 1);
    }
  });

  // Pick target with best win rate or least recent failure
  const sorted = [...targets].sort((a, b) => {
    const aWins = successCounts.get(a.name) || 0;
    const bWins = successCounts.get(b.name) || 0;
    if (bWins !== aWins) return bWins - aWins;
    return (visitCounts.get(a.name) || 0) - (visitCounts.get(b.name) || 0);
  });

  return {
    target: sorted[0],
    strategy: 'exploitation',
    rationale: `Exploitation active: selected top-performing target "${sorted[0].name}"`,
  };
}

/**
 * Structural Pruner (L0 Rule Pruning):
 * Identifies and strips redundant, duplicate, or subsumed rules
 * to halt unbounded agent harness bloat.
 *
 * @param {Array<string|object>} rules - Array of rules (strings or rule objects)
 * @param {object} [options]
 * @returns {{ prunedRules: Array<any>, removedRules: Array<any>, reductionCount: number }}
 */
function pruneStructuralRedundancy(rules = [], options = {}) {
  if (!Array.isArray(rules)) {
    return { prunedRules: [], removedRules: [], reductionCount: 0 };
  }

  const seen = new Set();
  const prunedRules = [];
  const removedRules = [];

  for (const rule of rules) {
    const ruleText = typeof rule === 'string'
      ? rule.trim()
      : (rule.text || rule.title || rule.description || JSON.stringify(rule)).trim();

    const normalized = ruleText.toLowerCase().replace(/[\s\-_]+/g, ' ');

    if (!normalized) {
      removedRules.push({ rule, reason: 'empty_rule' });
      continue;
    }

    if (seen.has(normalized)) {
      removedRules.push({ rule, reason: 'duplicate_rule' });
      continue;
    }

    // Check for subsumption (if a shorter rule already captured this concept)
    let isSubsumed = false;
    for (const existing of seen) {
      if (existing.length >= 15 && normalized.includes(existing)) {
        isSubsumed = true;
        break;
      }
    }

    if (isSubsumed) {
      removedRules.push({ rule, reason: 'subsumed_rule' });
      continue;
    }

    seen.add(normalized);
    prunedRules.push(rule);
  }

  return {
    prunedRules,
    removedRules,
    reductionCount: removedRules.length,
  };
}

module.exports = {
  RRSI_DEFAULTS,
  calculateAnnealedBudget,
  calculateAnnealedStepMultiplier,
  screenLeakage,
  computeComplexityDelta,
  evaluateComplexityRegularizedScore,
  detectStagnation,
  selectTargetWithExploration,
  pruneStructuralRedundancy,
};
