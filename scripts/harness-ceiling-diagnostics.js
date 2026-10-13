#!/usr/bin/env node
'use strict';

/**
 * ThumbGate Harness Ceiling & Failure Composition Diagnostics
 *
 * FORMAT steal from arXiv:2610.11655 (Tian et al., October 2026):
 * "Harness Evolution Hits a Ceiling: When Weight Training Should Begin"
 *
 * Core Tenets:
 * 1. Failure Taxonomy (first signal that fires):
 *    - F1 (Evidence): unbacked claims ratio >= 0.5, or exit gate passed with unresolved checklist items.
 *    - F2 (Harness Friction): harness interventions themselves broke the agent (>=10 blocked tool calls or forced locks).
 *    - F3 (Execution Control): tool call loops (same call >= 3x), runaway step budget (>= 90%), or runtime timeouts.
 *    - F4 (Planning / Content): delivered cleanly with zero process signals, but poor quality (score < 0.5).
 * 2. Mathematical Score Identity:
 *    - S = r * q_bar (Delivery rate r * mean score among delivered q_bar)
 *    - Delta S = Delta r * q_bar + r_prime * Delta q_bar
 * 3. Proposition 1 Selection Optimism Bound:
 *    - Expected max noise over K candidates: s * sqrt(2 * ln(K)), where s = sigma / sqrt(m).
 * 4. Diagnose-Then-Intervene Rule:
 *    - If r < 0.80 or F3 dominant -> Evolve Harness (tools, state ledger, loop breakers).
 *    - If r >= 0.85 and F4 dominant -> Weight Training Ceiling! (Distill via LoRA / DPO export).
 *    - If F2 elevated (> 20%) -> Prune / calibrate overzealous pre-tool deny gates.
 * 5. Writes-vs-Sees Partition:
 *    - Edits touching what the model writes (tool schemas, structured outputs) -> distill into weights.
 *    - Edits touching what the model sees (history window, ledger, retrieved context) -> keep in harness runtime.
 *
 * Zero external packages; pure local CPU execution (<0.5ms).
 */

const fs = require('node:fs');
const path = require('node:path');

const FAILURE_CLASSES = Object.freeze({
  HEALTHY: 'HEALTHY',
  F1_EVIDENCE: 'F1_EVIDENCE',
  F2_FRICTION: 'F2_FRICTION',
  F3_EXECUTION: 'F3_EXECUTION',
  F4_CONTENT: 'F4_CONTENT',
});

const DEFAULT_NOISE_SIGMA = 0.023; // Median per-rollout standard deviation from arXiv:2610.11655
const DEFAULT_RESOLVABILITY_THRESHOLD = 0.035;

/**
 * Classify a single trajectory by the first signal that fires.
 *
 * @param {Object} trajectory
 * @returns {{ classification: string, reason: string, score: number, delivered: boolean }}
 */
function classifyTrajectory(trajectory = {}) {
  const score = Number.isFinite(Number(trajectory.score)) ? Number(trajectory.score) : 0;
  const delivered = Boolean(trajectory.delivered ?? (trajectory.output != null || score > 0));

  // A trajectory whose delivered plan scores >= 0.5 is healthy
  if (delivered && score >= 0.5) {
    return {
      classification: FAILURE_CLASSES.HEALTHY,
      reason: 'Delivered valid plan with score >= 0.5',
      score,
      delivered: true,
    };
  }

  // F1, evidence: unbacked-citation ratio >= 0.5 or exit gate passed with unresolved checklist items
  const unbackedRatio = Number(trajectory.unbackedCitationRatio ?? 0);
  const unresolvedItems = Number(trajectory.unresolvedChecklistItems ?? 0);
  if (unbackedRatio >= 0.5 || unresolvedItems > 0) {
    return {
      classification: FAILURE_CLASSES.F1_EVIDENCE,
      reason: unbackedRatio >= 0.5
        ? `Unbacked citation ratio ${unbackedRatio.toFixed(2)} >= 0.50`
        : `Exit gate passed with ${unresolvedItems} unresolved checklist items`,
      score,
      delivered,
    };
  }

  // F2, harness friction: harness itself blocked the agent (>=10 blocked tool calls or forced lock)
  const blockedCalls = Number(trajectory.blockedToolCalls ?? 0);
  const forcedUnlock = Boolean(trajectory.forcedCheckpointUnlock ?? false);
  if (blockedCalls >= 10 || forcedUnlock) {
    return {
      classification: FAILURE_CLASSES.F2_FRICTION,
      reason: blockedCalls >= 10
        ? `Harness blocked ${blockedCalls} tool calls (>= 10)`
        : 'Harness forced checkpoint unlock triggered',
      score,
      delivered,
    };
  }

  // F3, execution control: repeated tool call >= 3x, step budget >= 90%, or termination
  const maxRepeatCall = Number(trajectory.maxRepeatedToolCalls ?? 0);
  const stepBudgetPercent = Number(trajectory.stepBudgetUsedPercent ?? 0);
  const timedOut = Boolean(trajectory.timedOut ?? false);
  const loopDetected = Boolean(trajectory.loopDetected ?? (maxRepeatCall >= 3));

  if (loopDetected || maxRepeatCall >= 3 || stepBudgetPercent >= 90 || timedOut) {
    let reason = 'Execution control failure';
    if (loopDetected || maxRepeatCall >= 3) {
      reason = `Tool call repeated ${Math.max(maxRepeatCall, 3)} times in loop`;
    } else if (stepBudgetPercent >= 90) {
      reason = `Step budget exhausted (${stepBudgetPercent}% >= 90%)`;
    } else if (timedOut) {
      reason = 'Runtime step budget or execution timeout';
    }
    return {
      classification: FAILURE_CLASSES.F3_EXECUTION,
      reason,
      score,
      delivered,
    };
  }

  // F4, planning capacity: none of process signals fired; delivered plan scores below 0.5
  return {
    classification: FAILURE_CLASSES.F4_CONTENT,
    reason: delivered
      ? `Plan delivered cleanly without process signals, but score (${score.toFixed(2)}) < 0.50`
      : 'Undelivered trajectory without process signals',
    score,
    delivered,
  };
}

/**
 * Aggregates trajectory classifications and computes the mathematical score decomposition.
 *
 * @param {Array<Object>} trajectories
 * @param {Object} options
 * @returns {Object} Failure composition metrics
 */
function analyzeFailureComposition(trajectories = [], options = {}) {
  const total = trajectories.length;
  if (total === 0) {
    return {
      total: 0,
      deliveryRate: 0,
      meanQualityDelivered: 0,
      compositeScore: 0,
      counts: { HEALTHY: 0, F1_EVIDENCE: 0, F2_FRICTION: 0, F3_EXECUTION: 0, F4_CONTENT: 0 },
      shares: { HEALTHY: 0, F1_EVIDENCE: 0, F2_FRICTION: 0, F3_EXECUTION: 0, F4_CONTENT: 0 },
    };
  }

  const counts = {
    [FAILURE_CLASSES.HEALTHY]: 0,
    [FAILURE_CLASSES.F1_EVIDENCE]: 0,
    [FAILURE_CLASSES.F2_FRICTION]: 0,
    [FAILURE_CLASSES.F3_EXECUTION]: 0,
    [FAILURE_CLASSES.F4_CONTENT]: 0,
  };

  let deliveredCount = 0;
  let deliveredScoreSum = 0;
  let totalScoreSum = 0;

  const labeled = trajectories.map((traj) => {
    const result = classifyTrajectory(traj);
    counts[result.classification] = (counts[result.classification] || 0) + 1;
    totalScoreSum += result.score;
    if (result.delivered) {
      deliveredCount += 1;
      deliveredScoreSum += result.score;
    }
    return { ...traj, ...result };
  });

  const deliveryRate = deliveredCount / total;
  const meanQualityDelivered = deliveredCount > 0 ? (deliveredScoreSum / deliveredCount) : 0;
  // S = r * q_bar exactly (Eq. 2)
  const compositeScore = deliveryRate * meanQualityDelivered;

  const shares = {};
  for (const [key, count] of Object.entries(counts)) {
    shares[key] = count / total;
  }

  return {
    total,
    deliveryRate,
    meanQualityDelivered,
    compositeScore,
    counts,
    shares,
    labeled,
  };
}

/**
 * Decomposes Delta S into delivery gain vs quality gain (Eq. 2).
 * Delta S = Delta r * q_bar + r_prime * Delta q_bar
 *
 * @param {Object} seedMetrics
 * @param {Object} evolvedMetrics
 * @returns {Object} Decomposition components
 */
function decomposeScoreDelta(seedMetrics, evolvedMetrics) {
  const r = seedMetrics.deliveryRate;
  const q_bar = seedMetrics.meanQualityDelivered;
  const r_prime = evolvedMetrics.deliveryRate;
  const q_bar_prime = evolvedMetrics.meanQualityDelivered;

  const delta_r = r_prime - r;
  const delta_q_bar = q_bar_prime - q_bar;

  const deliveryTerm = delta_r * q_bar;
  const qualityTerm = r_prime * delta_q_bar;
  const totalDelta = evolvedMetrics.compositeScore - seedMetrics.compositeScore;

  return {
    totalDelta,
    deliveryTerm,
    qualityTerm,
    reconstructedDelta: deliveryTerm + qualityTerm,
    deliveryShare: Math.abs(totalDelta) > 0.0001 ? (deliveryTerm / totalDelta) : 0,
    qualityShare: Math.abs(totalDelta) > 0.0001 ? (qualityTerm / totalDelta) : 0,
  };
}

/**
 * Proposition 1: Computes the Selection Optimism Bound.
 * E[max_{k} epsilon_k] <= s * sqrt(2 * ln(K))
 * where s = sigma / sqrt(m)
 *
 * @param {number} numCandidates K
 * @param {number} sigma Baseline rollout standard deviation (default: 0.023)
 * @param {number} numRollouts m (default: 4)
 * @returns {{ s: number, bound: number, isResolvable: boolean }}
 */
function computeSelectionOptimismBound(numCandidates = 10, sigma = DEFAULT_NOISE_SIGMA, numRollouts = 4) {
  const K = Math.max(1, Number(numCandidates) || 1);
  const m = Math.max(1, Number(numRollouts) || 1);
  const s = sigma / Math.sqrt(m);
  const bound = K > 1 ? s * Math.sqrt(2 * Math.log(K)) : 0;
  return {
    numCandidates: K,
    numRollouts: m,
    perReadingStdDev: s,
    selectionOptimismBound: bound,
    resolvableDeltaThreshold: Math.max(DEFAULT_RESOLVABILITY_THRESHOLD, bound),
  };
}

/**
 * Diagnostic Rule: Selects whether to evolve the harness or train weights.
 *
 * Branching Logic (Section 7, Tian et al. 2026):
 * 1. If delivered plans score below ~0.18: MODEL_CAPACITY_INSUFFICIENT (harness cannot save it).
 * 2. If F2 (harness friction) > 20%: HARNESS_FRICTION_CALIBRATION (relax overzealous PreToolUse blocks).
 * 3. If delivery < 80% or F3 (loops/timeouts) dominant: HARNESS_EVOLUTION (loop breakers, state ledger).
 * 4. If delivery >= 85% and F4 (poor quality) dominant: WEIGHT_TRAINING_CEILING (harness has ceilinged; train weights/DPO).
 * 5. If healthy >= 75%: OPTIMAL_STABILITY.
 *
 * @param {Object} metrics Output of analyzeFailureComposition
 * @returns {Object} Actionable diagnosis
 */
function diagnoseIntervention(metrics = {}) {
  const { deliveryRate = 0, meanQualityDelivered = 0, shares = {} } = metrics;
  const f1 = shares.F1_EVIDENCE || 0;
  const f2 = shares.F2_FRICTION || 0;
  const f3 = shares.F3_EXECUTION || 0;
  const f4 = shares.F4_CONTENT || 0;
  const healthy = shares.HEALTHY || 0;

  if (healthy >= 0.75) {
    return {
      recommendation: 'MAINTAIN_STABLE',
      primaryLever: 'NONE',
      reason: `System is performing reliably (${(healthy * 100).toFixed(1)}% healthy trajectories).`,
      actions: ['Retain current harness and weight checkpoint.', 'Monitor drift via active lesson feedback.'],
    };
  }

  // Branch 1: Base capacity floor
  if (meanQualityDelivered < 0.18 && deliveryRate > 0.5) {
    return {
      recommendation: 'MODEL_CAPACITY_INSUFFICIENT',
      primaryLever: 'UPGRADE_MODEL',
      reason: `Delivered plans score only ${meanQualityDelivered.toFixed(3)} (< 0.18). Harness edits only shift process failures into F4 content errors without increasing true task completion.`,
      actions: [
        'Upgrade to higher-capacity base model or reasoning tier (e.g. Qwen 9B/35B, Claude, GPT-4).',
        'Do not spend compute on harness evolution loops for this model size.',
      ],
    };
  }

  // Branch 2: Harness Friction Interdiction
  if (f2 >= 0.20) {
    return {
      recommendation: 'HARNESS_FRICTION_CALIBRATION',
      primaryLever: 'RELAX_GATE_RULES',
      reason: `Harness friction (F2) accounts for ${(f2 * 100).toFixed(1)}% of failures. Overzealous PreToolUse gates or forced locks are choking agent progress.`,
      actions: [
        'Prune or loosen high-false-positive PreToolUse deny rules.',
        'Downgrade non-credential hard blocks to review warnings.',
        'Ensure checkpoint unlock conditions are reachable.',
      ],
    };
  }

  // Branch 3: Harness Evolution (Process & Execution Control)
  if (deliveryRate < 0.80 || f3 >= 0.30 || f1 >= 0.25) {
    return {
      recommendation: 'HARNESS_EVOLUTION',
      primaryLever: 'HARNESS_RUNTIME',
      reason: `Process failures dominate: delivery rate ${(deliveryRate * 100).toFixed(1)}% < 80%, loops/timeouts (F3) at ${(f3 * 100).toFixed(1)}%, evidence failures (F1) at ${(f1 * 100).toFixed(1)}%.`,
      actions: [
        'Inject state ledger tool or progress checklist to eliminate tool thrashing loops.',
        'Add pre-action loop breaker (block identical tool call >= 3x).',
        'Add deterministic citation/evidence diode before final submission.',
        'Do not fine-tune weights yet — harness has not reached process saturation.',
      ],
    };
  }

  // Branch 4: Weight Training Ceiling
  if (deliveryRate >= 0.85 && f4 >= 0.40) {
    return {
      recommendation: 'WEIGHT_TRAINING_CEILING',
      primaryLever: 'WEIGHT_TRAINING_DPO',
      reason: `Harness evolution has ceilinged! Delivery is saturated at ${(deliveryRate * 100).toFixed(1)}%, but content failures (F4) dominate at ${(f4 * 100).toFixed(1)}% of trajectories. Process signals show zero errors, so the harness cannot improve output quality further.`,
      actions: [
        'Export verified trajectories using `thumbgate export-dpo` for preference training.',
        'Train LoRA / QLoRA adapter on successful trajectories (attention + MLP for knowledge tasks).',
        'Distill accepted harness edits into model weights to eliminate runtime latency.',
      ],
    };
  }

  // Default balanced
  return {
    recommendation: 'HYBRID_TUNING',
    primaryLever: 'CO_EVOLUTION',
    reason: `Mixed failure distribution (F1=${(f1 * 100).toFixed(0)}%, F2=${(f2 * 100).toFixed(0)}%, F3=${(f3 * 100).toFixed(0)}%, F4=${(f4 * 100).toFixed(0)}%).`,
    actions: [
      'Address residual process loops in the harness first.',
      'Collect healthy trajectory buffer for subsequent LoRA fine-tuning.',
    ],
  };
}

/**
 * Classifies an edit surface into "What Model Writes" vs "What Model Sees".
 *
 * Paper Finding:
 * - Edits that change what the model WRITES (tool invocation schemas, output format, system prompt instructions)
 *   can be trained into model weights.
 * - Edits that change what the model SEES (context window length, state ledger, retrieval augmentation, history buffer)
 *   must remain in the harness runtime.
 *
 * @param {Array<string>} modifiedPaths
 * @returns {{ writes: Array<string>, sees: Array<string>, distillablePercentage: number }}
 */
function classifyEditSurface(modifiedPaths = []) {
  const writes = [];
  const sees = [];

  const SEES_PATTERNS = [
    /context/i,
    /history/i,
    /ledger/i,
    /memory/i,
    /retriev/i,
    /page/i,
    /window/i,
    /buffer/i,
    /observation/i,
    /rag/i,
  ];

  const WRITES_PATTERNS = [
    /prompt/i,
    /schema/i,
    /output/i,
    /formatter/i,
    /tool-definition/i,
    /rule/i,
    /instruction/i,
    /policy/i,
  ];

  for (const item of modifiedPaths) {
    const str = String(item);
    const matchesSees = SEES_PATTERNS.some((pat) => pat.test(str));
    const matchesWrites = WRITES_PATTERNS.some((pat) => pat.test(str));

    if (matchesSees && !matchesWrites) {
      sees.push(str);
    } else if (matchesWrites && !matchesSees) {
      writes.push(str);
    } else if (matchesSees && matchesWrites) {
      // Hybrid, conservative default
      sees.push(str);
    } else {
      // Default to writes if unclassified
      writes.push(str);
    }
  }

  const total = writes.length + sees.length;
  return {
    writes,
    sees,
    distillablePercentage: total > 0 ? (writes.length / total) * 100 : 0,
    guidance: sees.length > 0
      ? 'Changes affect what the model SEES (context/history/memory). These cannot be replaced by weight training and must remain in the harness runtime.'
      : 'Changes affect what the model WRITES (prompts/tools/rules). These behaviors can be internalized into LoRA weights via DPO trajectory training.',
  };
}

/**
 * Generates synthetic benchmark fixtures representing realistic agent evaluation sets.
 */
function generateFixtureTrajectories(profile = 'ceilinged') {
  if (profile === 'process_heavy') {
    return [
      { score: 0.1, delivered: false, maxRepeatedToolCalls: 4, loopDetected: true },
      { score: 0.0, delivered: false, stepBudgetUsedPercent: 95, timedOut: true },
      { score: 0.2, delivered: false, blockedToolCalls: 12 },
      { score: 0.15, delivered: true, unbackedCitationRatio: 0.65 },
      { score: 0.75, delivered: true },
      { score: 0.80, delivered: true },
      { score: 0.0, delivered: false, maxRepeatedToolCalls: 3 },
      { score: 0.25, delivered: true, unresolvedChecklistItems: 2 },
    ];
  }

  if (profile === 'ceilinged') {
    // Saturated delivery (87.5%), but high F4 content failures
    return [
      { score: 0.35, delivered: true }, // F4
      { score: 0.40, delivered: true }, // F4
      { score: 0.45, delivered: true }, // F4
      { score: 0.85, delivered: true }, // Healthy
      { score: 0.90, delivered: true }, // Healthy
      { score: 0.30, delivered: true }, // F4
      { score: 0.25, delivered: true }, // F4
      { score: 0.0, delivered: false, maxRepeatedToolCalls: 3 }, // F3
    ];
  }

  if (profile === 'harness_friction') {
    return [
      { score: 0.1, delivered: false, blockedToolCalls: 14 },
      { score: 0.2, delivered: false, blockedToolCalls: 11 },
      { score: 0.0, delivered: false, forcedCheckpointUnlock: true },
      { score: 0.8, delivered: true },
      { score: 0.85, delivered: true },
    ];
  }

  // Default balanced
  return [
    { score: 0.85, delivered: true },
    { score: 0.75, delivered: true },
    { score: 0.35, delivered: true },
    { score: 0.1, delivered: false, maxRepeatedToolCalls: 3 },
  ];
}

// CLI handler
function runCli() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const mapOnly = args.includes('--map-only');

  if (mapOnly) {
    const map = {
      name: 'harness-ceiling-diagnostics',
      paper: 'arXiv:2610.11655',
      title: 'Harness Evolution Hits a Ceiling: When Weight Training Should Begin',
      authors: ['Yuan Tian', 'Bing Hu', 'Hao Wang', 'Binghang Lu', 'Fang Wu'],
      date: 'October 2026',
      taxonomy: FAILURE_CLASSES,
      noiseFloor: {
        sigma: DEFAULT_NOISE_SIGMA,
        boundFormula: 's * sqrt(2 * ln(K))',
        resolvabilityThreshold: DEFAULT_RESOLVABILITY_THRESHOLD,
      },
      scoreIdentity: 'S = r * q_bar, Delta S = Delta r * q_bar + r_prime * Delta q_bar',
      branches: [
        'MODEL_CAPACITY_INSUFFICIENT (q_bar < 0.18)',
        'HARNESS_FRICTION_CALIBRATION (F2 >= 20%)',
        'HARNESS_EVOLUTION (r < 0.80 or F3 >= 30%)',
        'WEIGHT_TRAINING_CEILING (r >= 0.85 and F4 >= 40%)',
      ],
      writesVsSeesRule: 'Gains in what model writes train into weights; gains in what model sees stay in harness.',
    };
    console.log(JSON.stringify(map, null, 2));
    return;
  }

  let tracePath = null;
  let profile = 'ceilinged';
  for (const arg of args) {
    if (arg.startsWith('--trace=')) {
      tracePath = arg.slice('--trace='.length);
    } else if (arg.startsWith('--profile=')) {
      profile = arg.slice('--profile='.length);
    }
  }

  let trajectories;
  if (tracePath && fs.existsSync(tracePath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
      trajectories = Array.isArray(raw) ? raw : (raw.trajectories || [raw]);
    } catch (err) {
      console.error(`Failed to parse trace file ${tracePath}: ${err.message}`);
      process.exit(1);
    }
  } else {
    trajectories = generateFixtureTrajectories(profile);
  }

  const analysis = analyzeFailureComposition(trajectories);
  const diagnosis = diagnoseIntervention(analysis);
  const optimism = computeSelectionOptimismBound(10, DEFAULT_NOISE_SIGMA, 4);

  const report = {
    source: 'thumbgate-harness-ceiling-diagnostics',
    paper: 'arXiv:2610.11655',
    profile,
    optimismBound: optimism,
    analysis: {
      total: analysis.total,
      deliveryRate: Number(analysis.deliveryRate.toFixed(4)),
      meanQualityDelivered: Number(analysis.meanQualityDelivered.toFixed(4)),
      compositeScore: Number(analysis.compositeScore.toFixed(4)),
      counts: analysis.counts,
      shares: Object.fromEntries(
        Object.entries(analysis.shares).map(([k, v]) => [k, Number(v.toFixed(4))])
      ),
    },
    diagnosis,
  };

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('\n=== ThumbGate Harness Ceiling & Failure Diagnostics (arXiv:2610.11655) ===');
    console.log(`Evaluated: ${analysis.total} trajectories | Delivery: ${(analysis.deliveryRate * 100).toFixed(1)}% | Quality: ${analysis.meanQualityDelivered.toFixed(3)} | Score: ${analysis.compositeScore.toFixed(3)}`);
    console.log('\n--- Failure Composition ---');
    console.log(`  Healthy:     ${(analysis.shares.HEALTHY * 100).toFixed(1)}% (${analysis.counts.HEALTHY})`);
    console.log(`  F1 Evidence: ${(analysis.shares.F1_EVIDENCE * 100).toFixed(1)}% (${analysis.counts.F1_EVIDENCE})`);
    console.log(`  F2 Friction: ${(analysis.shares.F2_FRICTION * 100).toFixed(1)}% (${analysis.counts.F2_FRICTION})`);
    console.log(`  F3 Process:  ${(analysis.shares.F3_EXECUTION * 100).toFixed(1)}% (${analysis.counts.F3_EXECUTION})`);
    console.log(`  F4 Content:  ${(analysis.shares.F4_CONTENT * 100).toFixed(1)}% (${analysis.counts.F4_CONTENT})`);
    console.log('\n--- Diagnostic Verdict ---');
    console.log(`  Recommendation: ${diagnosis.recommendation}`);
    console.log(`  Primary Lever:  ${diagnosis.primaryLever}`);
    console.log(`  Reason:         ${diagnosis.reason}`);
    console.log('  Actions:');
    for (const act of diagnosis.actions) {
      console.log(`    - ${act}`);
    }
    console.log(`\nSelection Optimism Bound (K=10, m=4): ${optimism.selectionOptimismBound.toFixed(4)} (resolvable above ${optimism.resolvableDeltaThreshold.toFixed(4)})\n`);
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  FAILURE_CLASSES,
  DEFAULT_NOISE_SIGMA,
  DEFAULT_RESOLVABILITY_THRESHOLD,
  classifyTrajectory,
  analyzeFailureComposition,
  decomposeScoreDelta,
  computeSelectionOptimismBound,
  diagnoseIntervention,
  classifyEditSurface,
  generateFixtureTrajectories,
};
