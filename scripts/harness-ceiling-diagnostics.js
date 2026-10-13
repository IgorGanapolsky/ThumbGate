#!/usr/bin/env node
'use strict';

/**
 * ThumbGate Harness Ceiling & Failure Composition Diagnostics
 *
 * FORMAT steal from arXiv:2610.11655 (Tian et al., October 2026):
 * "Harness Evolution Hits a Ceiling: When Weight Training Should Begin"
 *
 * A trajectory is labeled by the first signal that fires:
 *   F1 evidence, F2 harness friction, F3 execution, then healthy,
 *   then F4 content only for a delivered low score.
 *   An undelivered row with no earlier signal is not F4.
 * Composite score S = r * q_bar. Delta S = q_bar * Delta r + r' * Delta q_bar.
 * Process classes (F2, F3) are the harness lever. F4 is a content ceiling
 * because process signals do not separate it from a healthy delivery.
 *
 * This doctor reads a supplied trace. It does not invent a sample, and it
 * does not run a training job. 0.023, 0.035, and 0.18 are the paper's
 * DeepPlanning numbers, not ThumbGate measurements.
 */

const fs = require('node:fs');
const path = require('node:path');

const FAILURE_CLASSES = Object.freeze({
  HEALTHY: 'HEALTHY',
  F1_EVIDENCE: 'F1_EVIDENCE',
  F2_FRICTION: 'F2_FRICTION',
  F3_EXECUTION: 'F3_EXECUTION',
  F4_CONTENT: 'F4_CONTENT',
  UNDELIVERED: 'UNDELIVERED',
});

const PAPER_DEEP_PLANNING = Object.freeze({
  source: 'arXiv:2610.11655 DeepPlanning, not a ThumbGate measurement',
  sigma: 0.023,
  resolvableFloor: 0.035,
  capacityFloor: 0.18,
});

const DEFAULT_NOISE_SIGMA = PAPER_DEEP_PLANNING.sigma;
const DEFAULT_RESOLVABILITY_THRESHOLD = PAPER_DEEP_PLANNING.resolvableFloor;
const DISCLAIMER = 'Does not train weights.';
const PAPER_NUMBERS_NOTE = '0.023, 0.035, and 0.18 are arXiv:2610.11655 DeepPlanning numbers, not ThumbGate measurements. Does not train weights.';
const HARD_FLOOR = 'Keep the hard floor: secrets, self-protect, and outbound email stay blocked.';
const STOP_REWRITE = 'Stop the harness rewrite. This doctor does not run a training job.';

const SOURCE = 'thumbgate-harness-ceiling-diagnostics';
const PAPER_ID = 'arXiv:2610.11655';

/**
 * Delivery is true only when the trace says so. A score or an output field
 * is not a delivery flag.
 *
 * @param {Object} trajectory
 * @returns {{ classification: string, reason: string, score: number, delivered: boolean }}
 */
function classifyTrajectory(trajectory = {}) {
  const score = Number.isFinite(Number(trajectory.score)) ? Number(trajectory.score) : 0;
  const delivered = trajectory.delivered === true;

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

  if (delivered && score >= 0.5) {
    return {
      classification: FAILURE_CLASSES.HEALTHY,
      reason: 'Delivered valid plan with score >= 0.5 and no earlier signal',
      score,
      delivered: true,
    };
  }

  if (delivered) {
    return {
      classification: FAILURE_CLASSES.F4_CONTENT,
      reason: `Plan delivered cleanly without process signals, but score (${score.toFixed(2)}) < 0.50`,
      score,
      delivered: true,
    };
  }

  return {
    classification: FAILURE_CLASSES.UNDELIVERED,
    reason: 'Undelivered trajectory without an evidence, friction, or execution signal',
    score,
    delivered: false,
  };
}

/**
 * @param {Array<Object>} trajectories
 * @returns {Object}
 */
function analyzeFailureComposition(trajectories = []) {
  const total = trajectories.length;
  const emptyCounts = {
    HEALTHY: 0,
    F1_EVIDENCE: 0,
    F2_FRICTION: 0,
    F3_EXECUTION: 0,
    F4_CONTENT: 0,
    UNDELIVERED: 0,
  };
  if (total === 0) {
    return {
      total: 0,
      deliveryRate: 0,
      meanQualityDelivered: 0,
      compositeScore: 0,
      counts: { ...emptyCounts },
      shares: { ...emptyCounts },
    };
  }

  const counts = {
    [FAILURE_CLASSES.HEALTHY]: 0,
    [FAILURE_CLASSES.F1_EVIDENCE]: 0,
    [FAILURE_CLASSES.F2_FRICTION]: 0,
    [FAILURE_CLASSES.F3_EXECUTION]: 0,
    [FAILURE_CLASSES.F4_CONTENT]: 0,
    [FAILURE_CLASSES.UNDELIVERED]: 0,
  };

  let deliveredCount = 0;
  let deliveredScoreSum = 0;

  const labeled = trajectories.map((traj) => {
    const result = classifyTrajectory(traj);
    counts[result.classification] = (counts[result.classification] || 0) + 1;
    if (result.delivered) {
      deliveredCount += 1;
      deliveredScoreSum += result.score;
    }
    return { ...traj, ...result };
  });

  const deliveryRate = deliveredCount / total;
  const meanQualityDelivered = deliveredCount > 0 ? (deliveredScoreSum / deliveredCount) : 0;
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
 * Delta S = Delta r * q_bar + r_prime * Delta q_bar.
 *
 * @param {Object} seedMetrics
 * @param {Object} evolvedMetrics
 * @returns {Object}
 */
function decomposeScoreDelta(seedMetrics, evolvedMetrics) {
  const qBar = seedMetrics.meanQualityDelivered;
  const rPrime = evolvedMetrics.deliveryRate;
  const deltaR = rPrime - seedMetrics.deliveryRate;
  const deltaQBar = evolvedMetrics.meanQualityDelivered - qBar;
  const deliveryTerm = deltaR * qBar;
  const qualityTerm = rPrime * deltaQBar;
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
 * Selection optimism bound s * sqrt(2 * ln(K)), with s = sigma / sqrt(m).
 * A missing sigma is unmeasured: bound and threshold stay null.
 * The paper's DeepPlanning floor 0.035 is applied only when sigma is passed.
 * Sigma 0 is finite and measured.
 *
 * @param {number} numCandidates
 * @param {number} [sigma]
 * @param {number} [numRollouts]
 * @returns {Object}
 */
function computeSelectionOptimismBound(numCandidates = 10, sigma, numRollouts = 4) {
  const candidateCount = Math.max(1, Number(numCandidates) || 1);
  const rolloutCount = Math.max(1, Number(numRollouts) || 1);
  const sigmaWasPassed = arguments.length >= 2 && Number.isFinite(Number(sigma));
  if (!sigmaWasPassed) {
    return {
      numCandidates: candidateCount,
      numRollouts: rolloutCount,
      perReadingStdDev: null,
      selectionOptimismBound: null,
      resolvableDeltaThreshold: null,
      noiseMeasured: false,
    };
  }

  const measuredSigma = Number(sigma);
  const perReadingStdDev = measuredSigma / Math.sqrt(rolloutCount);
  const selectionOptimismBound = candidateCount > 1
    ? perReadingStdDev * Math.sqrt(2 * Math.log(candidateCount))
    : 0;
  return {
    numCandidates: candidateCount,
    numRollouts: rolloutCount,
    perReadingStdDev,
    selectionOptimismBound,
    resolvableDeltaThreshold: Math.max(DEFAULT_RESOLVABILITY_THRESHOLD, selectionOptimismBound),
    noiseMeasured: true,
  };
}

/**
 * First matching branch wins. Content saturation stops a harness rewrite.
 * The 0.18 capacity floor is the paper's DeepPlanning number.
 *
 * @param {Object} metrics
 * @returns {Object}
 */
function diagnoseIntervention(metrics = {}) {
  const total = Number(metrics.total);
  if (!(total > 0)) {
    return {
      recommendation: 'NONE',
      primaryLever: 'NONE',
      reason: 'No measured trajectories.',
      actions: [],
    };
  }

  const { deliveryRate = 0, meanQualityDelivered = 0, shares = {} } = metrics;
  const f1 = shares.F1_EVIDENCE || 0;
  const f2 = shares.F2_FRICTION || 0;
  const f3 = shares.F3_EXECUTION || 0;
  const f4 = shares.F4_CONTENT || 0;
  const healthy = shares.HEALTHY || 0;

  if (meanQualityDelivered < PAPER_DEEP_PLANNING.capacityFloor && deliveryRate > 0.5) {
    return {
      recommendation: 'MODEL_CAPACITY_INSUFFICIENT',
      primaryLever: 'PAPER_CAPACITY_FLOOR',
      reason: `Mean quality among delivered plans is ${meanQualityDelivered.toFixed(3)}, below the paper's DeepPlanning floor of 0.18. That floor is not a ThumbGate measurement.`,
      actions: [
        STOP_REWRITE,
        'This doctor does not name a replacement model.',
      ],
    };
  }

  if (f2 >= 0.20) {
    return {
      recommendation: 'HARNESS_FRICTION_CALIBRATION',
      primaryLever: 'CALIBRATE_FALSE_POSITIVES',
      reason: `Harness friction (F2) accounts for ${(f2 * 100).toFixed(1)}% of trajectories. Calibrate false positives. The hard floor stays blocked.`,
      actions: [
        'Calibrate false-positive PreToolUse denies that block the task without a safety reason.',
        'Make checkpoint unlock conditions reachable when the task is allowed.',
        HARD_FLOOR,
      ],
    };
  }

  if (deliveryRate < 0.80 || f3 >= 0.30 || f1 >= 0.25) {
    return {
      recommendation: 'HARNESS_EVOLUTION',
      primaryLever: 'HARNESS_RUNTIME',
      reason: `Process failures dominate: delivery rate ${(deliveryRate * 100).toFixed(1)}% < 80%, loops or timeouts (F3) at ${(f3 * 100).toFixed(1)}%, evidence failures (F1) at ${(f1 * 100).toFixed(1)}%.`,
      actions: [
        'Inject a state ledger or progress checklist so the same tool call is not repeated.',
        'Block an identical tool call once it has already run 3 times.',
        'Require a citation check before the exit gate can pass with unresolved items.',
        'Process failures are still the harness lever.',
      ],
    };
  }

  if (deliveryRate >= 0.85 && f4 >= 0.40) {
    return {
      recommendation: 'CONTENT_CEILING',
      primaryLever: 'STOP_HARNESS_REWRITE',
      reason: `Delivery is ${(deliveryRate * 100).toFixed(1)}% and content failures (F4) are ${(f4 * 100).toFixed(1)}% of trajectories. Process signals do not separate this mix from a healthy run, so another harness rewrite is the wrong lever.`,
      actions: [
        STOP_REWRITE,
        'Keep the harness that already delivers and measure content quality on a real trace.',
      ],
    };
  }

  if (healthy >= 0.75) {
    return {
      recommendation: 'MAINTAIN_STABLE',
      primaryLever: 'NONE',
      reason: `System is performing reliably (${(healthy * 100).toFixed(1)}% healthy trajectories).`,
      actions: ['Retain the harness and monitor drift.'],
    };
  }

  return {
    recommendation: 'HYBRID_TUNING',
    primaryLever: 'CO_EVOLUTION',
    reason: `Mixed failure distribution (F1=${(f1 * 100).toFixed(0)}%, F2=${(f2 * 100).toFixed(0)}%, F3=${(f3 * 100).toFixed(0)}%, F4=${(f4 * 100).toFixed(0)}%).`,
    actions: [
      'Address residual process loops in the harness.',
      HARD_FLOOR,
    ],
  };
}

/**
 * A path that changes what the model sees stays in the harness.
 * An unknown path stays sees. A path that matches both stays sees.
 *
 * @param {Array<string>} modifiedPaths
 * @returns {{ writes: Array<string>, sees: Array<string>, distillablePercentage: number, guidance: string }}
 */
function classifyEditSurface(modifiedPaths = []) {
  const writes = [];
  const sees = [];
  const seesPatterns = [
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
  const writesPatterns = [
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
    const filePath = String(item);
    const matchesSees = seesPatterns.some((pattern) => pattern.test(filePath));
    const matchesWrites = writesPatterns.some((pattern) => pattern.test(filePath));
    if (matchesWrites && !matchesSees) {
      writes.push(filePath);
    } else {
      sees.push(filePath);
    }
  }

  const total = writes.length + sees.length;
  return {
    writes,
    sees,
    distillablePercentage: total > 0 ? (writes.length / total) * 100 : 0,
    guidance: sees.length > 0
      ? 'Changes include what the model SEES. A sees path stays in the harness. An unknown path stays sees.'
      : 'Changes match write paths only. A sees path still stays in the harness.',
  };
}

/**
 * Unit-test fixtures. The CLI never calls this.
 *
 * @param {string} profile
 * @returns {Array<Object>}
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
    return [
      { score: 0.35, delivered: true },
      { score: 0.40, delivered: true },
      { score: 0.45, delivered: true },
      { score: 0.85, delivered: true },
      { score: 0.90, delivered: true },
      { score: 0.30, delivered: true },
      { score: 0.25, delivered: true },
      { score: 0.0, delivered: false, maxRepeatedToolCalls: 3 },
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

  return [
    { score: 0.85, delivered: true },
    { score: 0.75, delivered: true },
    { score: 0.35, delivered: true },
    { score: 0.1, delivered: false, maxRepeatedToolCalls: 3 },
  ];
}

function emit(line) {
  const text = String(line);
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}

function failClosed(status, extra = {}) {
  const payload = {
    ...extra,
    source: SOURCE,
    paper: PAPER_ID,
    status,
    ok: false,
    recommendation: 'NONE',
    disclaimer: DISCLAIMER,
    diagnosis: {
      recommendation: 'NONE',
      primaryLever: 'NONE',
      reason: extra.reason || 'No measured trace.',
      actions: [],
    },
  };
  emit(JSON.stringify(payload, null, 2));
  process.exit(1);
}

function traceArgument(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--trace') {
      const next = args[index + 1];
      if (!next || next.startsWith('--')) return '';
      return next;
    }
    if (arg.startsWith('--trace=')) return arg.slice('--trace='.length);
  }
  return null;
}

function loadTrace(tracePath) {
  let rawText;
  try {
    rawText = fs.readFileSync(tracePath, 'utf8');
  } catch (err) {
    failClosed('trace_unreadable', { path: tracePath, error: err.message });
  }

  let raw;
  try {
    raw = JSON.parse(rawText);
  } catch (err) {
    failClosed('trace_parse_error', { path: tracePath, error: err.message });
  }

  let trajectories;
  if (Array.isArray(raw)) {
    trajectories = raw;
  } else if (raw && Array.isArray(raw.trajectories)) {
    trajectories = raw.trajectories;
  } else if (raw && typeof raw === 'object') {
    trajectories = [raw];
  } else {
    trajectories = [];
  }

  if (trajectories.length === 0) {
    failClosed('empty', { path: tracePath, reason: 'Trace has no trajectories.' });
  }
  return trajectories;
}

function buildReport(trajectories, tracePath) {
  const analysis = analyzeFailureComposition(trajectories);
  const diagnosis = diagnoseIntervention(analysis);
  const optimism = computeSelectionOptimismBound(10);
  return {
    source: SOURCE,
    paper: PAPER_ID,
    status: 'traced',
    ok: true,
    recommendation: diagnosis.recommendation,
    disclaimer: PAPER_NUMBERS_NOTE,
    tracePath,
    optimismBound: optimism,
    analysis: {
      total: analysis.total,
      deliveryRate: Number(analysis.deliveryRate.toFixed(4)),
      meanQualityDelivered: Number(analysis.meanQualityDelivered.toFixed(4)),
      compositeScore: Number(analysis.compositeScore.toFixed(4)),
      counts: analysis.counts,
      shares: Object.fromEntries(
        Object.entries(analysis.shares).map(([key, value]) => [key, Number(value.toFixed(4))])
      ),
    },
    diagnosis,
  };
}

function printTextReport(report) {
  const { analysis, diagnosis, optimismBound } = report;
  const share = (key) => `${(analysis.shares[key] * 100).toFixed(1)}% (${analysis.counts[key]})`;
  emit('\n=== ThumbGate Harness Ceiling Diagnostics (arXiv:2610.11655) ===');
  emit(report.disclaimer);
  emit(`Evaluated: ${analysis.total} trajectories | Delivery: ${(analysis.deliveryRate * 100).toFixed(1)}% | Quality: ${analysis.meanQualityDelivered.toFixed(3)} | Score: ${analysis.compositeScore.toFixed(3)}`);
  emit('\n--- Failure Composition ---');
  emit(`  Healthy:      ${share('HEALTHY')}`);
  emit(`  F1 Evidence:  ${share('F1_EVIDENCE')}`);
  emit(`  F2 Friction:  ${share('F2_FRICTION')}`);
  emit(`  F3 Process:   ${share('F3_EXECUTION')}`);
  emit(`  F4 Content:   ${share('F4_CONTENT')}`);
  emit(`  Undelivered:  ${share('UNDELIVERED')}`);
  emit('\n--- Diagnostic Verdict ---');
  emit(`  Recommendation: ${diagnosis.recommendation}`);
  emit(`  Primary Lever:  ${diagnosis.primaryLever}`);
  emit(`  Reason:         ${diagnosis.reason}`);
  emit('  Actions:');
  for (const action of diagnosis.actions) {
    emit(`    - ${action}`);
  }
  const boundText = optimismBound.noiseMeasured
    ? String(optimismBound.selectionOptimismBound)
    : 'unmeasured';
  emit(`\nSelection optimism (K=10): ${boundText}. A score delta is not called resolvable without a measured sigma.\n`);
}

function mapOnlyReport() {
  return {
    name: 'harness-ceiling-diagnostics',
    paper: PAPER_ID,
    title: 'Harness Evolution Hits a Ceiling: When Weight Training Should Begin',
    disclaimer: DISCLAIMER,
    taxonomy: FAILURE_CLASSES,
    noiseFloor: {
      source: PAPER_DEEP_PLANNING.source,
      sigma: DEFAULT_NOISE_SIGMA,
      boundFormula: 's * sqrt(2 * ln(K))',
      resolvableDeltaThreshold: DEFAULT_RESOLVABILITY_THRESHOLD,
      capacityFloor: PAPER_DEEP_PLANNING.capacityFloor,
    },
    scoreIdentity: 'S = r * q_bar, Delta S = Delta r * q_bar + r_prime * Delta q_bar',
    branches: [
      'NONE (total is 0)',
      'MODEL_CAPACITY_INSUFFICIENT (paper DeepPlanning q_bar < 0.18)',
      'HARNESS_FRICTION_CALIBRATION (F2 >= 20%, hard floor stays)',
      'HARNESS_EVOLUTION (r < 0.80 or F3 >= 30% or F1 >= 25%)',
      'CONTENT_CEILING (r >= 0.85 and F4 >= 40%)',
      'MAINTAIN_STABLE (healthy >= 75% after the failure branches)',
      'HYBRID_TUNING (residual after the branches above)',
    ],
    writesVsSeesRule: 'A path that changes what the model sees stays in the harness. An unknown path stays sees.',
  };
}

module.exports = {
  FAILURE_CLASSES,
  PAPER_DEEP_PLANNING,
  DEFAULT_NOISE_SIGMA,
  DEFAULT_RESOLVABILITY_THRESHOLD,
  DISCLAIMER,
  HARD_FLOOR,
  classifyTrajectory,
  analyzeFailureComposition,
  decomposeScoreDelta,
  computeSelectionOptimismBound,
  diagnoseIntervention,
  classifyEditSurface,
  generateFixtureTrajectories,
};

function runCli() {
  const args = process.argv.slice(2);
  if (args.includes('--map-only')) {
    emit(JSON.stringify(mapOnlyReport(), null, 2));
    return;
  }

  const tracePath = traceArgument(args);
  if (!tracePath || !String(tracePath).trim()) {
    failClosed('no_trace', {
      reason: 'Pass --trace=<file> with a recorded trajectory list, or --map-only for the rail map. A profile flag is not a trace.',
    });
  }

  const trajectories = loadTrace(tracePath);
  const report = buildReport(trajectories, tracePath);
  if (args.includes('--json')) {
    emit(JSON.stringify(report, null, 2));
    return;
  }
  printTextReport(report);
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  runCli();
}
