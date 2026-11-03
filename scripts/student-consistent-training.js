'use strict';

function buildStudentConsistentTrainingPlan(options = {}) {
  const student = options.student || 'target-agent-policy';
  const teacher = options.teacher || 'frontier-reviewer';
  const dataset = options.dataset || 'thumbgate-feedback-lessons';
  const holdout = options.holdout || 'feedback-gate-holdout';

  return {
    method: 'student_consistent_synthetic_sft',
    dataset,
    teacher,
    student,
    generationContract: {
      teacherRole: 'adds capability tokens: corrected decision, missing evidence, safer action',
      studentRole: 'preserves target agent style: terse format, tool discipline, gate vocabulary',
      rejectIf: [
        'teacher rewrites the answer into unsupported style',
        'lesson cannot be traced to source feedback',
        'sample contains secrets or private customer context',
        'sample teaches a shortcut that bypasses evidence gates',
      ],
    },
    requiredArtifacts: [
      'source feedback id',
      'student baseline response',
      'teacher correction',
      'student-consistent final sample',
      'redaction report',
      'holdout eval result',
    ],
    evals: {
      holdout,
      compareAgainst: ['raw_teacher_sft', 'self_distill_only', 'no_training_baseline'],
      metrics: ['gate_precision', 'gate_recall', 'unsupported_claim_rate', 'style_drift_rate'],
    },
  };
}

function evaluateStudentConsistentTrainingSample(sample = {}) {
  const issues = [];

  if (!sample.sourceFeedbackId) issues.push('missing_source_feedback_id');
  if (!sample.studentBaseline) issues.push('missing_student_baseline');
  if (!sample.teacherCorrection) issues.push('missing_teacher_correction');
  if (!sample.finalSample) issues.push('missing_final_sample');
  if (!sample.redacted) issues.push('redaction_required');
  if (!sample.holdoutEval) issues.push('holdout_eval_required');

  const text = [
    sample.studentBaseline,
    sample.teacherCorrection,
    sample.finalSample,
  ].filter(Boolean).join('\n');
  if (/(api[_-]?key|secret|token|password)\s*[:=]/i.test(text)) {
    issues.push('secret_like_content');
  }

  if (sample.styleDriftRate !== undefined && Number(sample.styleDriftRate) > 0.15) {
    issues.push('style_drift_too_high');
  }

  return {
    decision: issues.length ? 'warn' : 'allow',
    issues,
    onPolicy: !issues.includes('style_drift_too_high') && Boolean(sample.studentBaseline),
  };
}


/**
 * Thinking Machines Lab ("On-Policy Distillation" — Lu, Labonne, Schulman et al.):
 * Samples trajectories on-policy from the student (y ~ pi_theta) and grades every token
 * with the teacher's log-probabilities using Reverse KL: D_KL(pi_theta || pi_teacher).
 * Delivers O(N) dense bits per token (vs 1 bit/episode sparse RL), 9x-30x compute savings,
 * and recovers instruction-following (45% -> 83% IF-eval) without ground-truth verifiers.
 */
function buildOnPolicyDistillationPlan(options = {}) {
  const student = options.student || 'qwen3-8b-student';
  const teacher = options.teacher || 'qwen3-32b-teacher';
  const dataset = options.dataset || 'thumbgate-feedback-prompts-only';
  const klPenaltyCoef = Number(options.klPenaltyCoef ?? 1.0);
  const sequenceLengthTokens = Math.max(64, Math.floor(Number(options.sequenceLengthTokens || 2048)));

  // Sparse RL yields ~1 bit per episode; On-Policy Distillation yields O(N) token-level feedback
  const sparseRlBitsPerEpisode = 1;
  const denseDistillationSupervisionTokens = sequenceLengthTokens;
  const supervisionDensityMultiplier = sequenceLengthTokens / sparseRlBitsPerEpisode;

  return {
    method: 'on_policy_distillation_reverse_kl',
    divergence: 'reverse_kl',
    samplingDistribution: 'on_policy_student',
    gradingDistribution: 'dense_per_token_teacher_logprobs',
    student,
    teacher,
    dataset,
    klPenaltyCoef,
    requiresGroundTruthVerifier: false,
    supervisionDensityMultiplier,
    computeReductionFactorRange: [9, 30],
    expectedIfEvalRecovery: {
      before: 0.45,
      after: 0.83,
    },
    tinkerLoopSteps: [
      'sample trajectories y ~ pi_student(x) on-policy',
      'compute teacher logprobs log pi_teacher(y_t | x, y_<t) on every token',
      'compute reverse-KL token advantage A_t = log pi_teacher(y_t) - log pi_student(y_t)',
      'run forward_backward + optim_step on LoRA adapter weights',
    ],
  };
}

/**
 * Thinking Machines Lab ("Interaction Models"):
 * Decouples the fast front-of-house Interaction Model (<=200ms TTFT, interruptible micro-turns,
 * context scoping) from the Background Execution Model (deep multi-file edits & verification).
 */
function planInteractionModelSplit(options = {}) {
  const interactionModel = options.interactionModel || 'qwen3.6-flash';
  const backgroundModel = options.backgroundModel || 'qwen3.8-max';
  const targetMicroTurnLatencyMs = Math.max(50, Math.floor(Number(options.targetMicroTurnLatencyMs || 200)));
  const maxScopedToolsPerWorker = Math.min(4, Math.max(1, Math.floor(Number(options.maxScopedToolsPerWorker || 4))));

  return {
    architecture: 'thinking_machines_interaction_background_split',
    interactionLayer: {
      model: interactionModel,
      targetTtftMs: targetMicroTurnLatencyMs,
      interruptibleMicroTurns: true,
      responsibilities: [
        'sub-200ms user turn acknowledgment and premise alignment',
        'context scoping and <=4 tool selection for background workers',
        'live streaming progress and mid-flight course correction without restart',
      ],
    },
    backgroundLayer: {
      model: backgroundModel,
      maxScopedToolsPerWorker,
      deterministicBatchInvariantEval: true,
      responsibilities: [
        'isolated worktree multi-file implementation',
        'pre-action ThumbGate diode verification',
        'zero-context Goldfish artifact verification',
      ],
    },
  };
}
module.exports = {
  buildStudentConsistentTrainingPlan,
  evaluateStudentConsistentTrainingSample,
  buildOnPolicyDistillationPlan,
  planInteractionModelSplit,
};
