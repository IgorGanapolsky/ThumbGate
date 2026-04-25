'use strict';

function buildExperienceReplayPolicy(options = {}) {
  const maxStalenessHours = Number.isFinite(options.maxStalenessHours) ? options.maxStalenessHours : 24;
  const replayRatio = Number.isFinite(options.replayRatio) ? options.replayRatio : 0.25;
  const minEntropy = Number.isFinite(options.minEntropy) ? options.minEntropy : 0.65;

  return {
    policyId: 'feedback_experience_replay',
    purpose: 'Reuse high-signal feedback trajectories without letting stale lessons dominate training.',
    buffer: {
      strategy: 'fifo_with_quality_filters',
      maxStalenessHours,
      replayRatio,
      sampleWithoutRemoval: true,
    },
    filters: [
      'redacted',
      'source_feedback_id_present',
      'outcome_evidence_present',
      'not_contradicted_by_newer_lesson',
      'not_low_confidence_or_vague_feedback',
    ],
    monitors: {
      maxStalenessHours,
      minEntropy,
      compareAgainstFreshOnly: true,
      metrics: ['gate_precision', 'gate_recall', 'unsupported_claim_rate', 'policy_entropy', 'compute_saved_percent'],
    },
  };
}

function evaluateReplayCandidate(candidate = {}, policy = buildExperienceReplayPolicy()) {
  const issues = [];
  if (!candidate.sourceFeedbackId) issues.push('missing_source_feedback_id');
  if (!candidate.redacted) issues.push('redaction_required');
  if (!candidate.outcomeEvidence) issues.push('missing_outcome_evidence');
  if (candidate.contradictedByNewerLesson) issues.push('contradicted_by_newer_lesson');
  if (candidate.vagueFeedback) issues.push('vague_feedback_not_replayable');

  const ageHours = Number(candidate.ageHours || 0);
  if (ageHours > policy.buffer.maxStalenessHours) issues.push('stale_replay_sample');

  return {
    decision: issues.length ? 'reject' : 'accept',
    issues,
    replayWeight: issues.length ? 0 : Math.min(policy.buffer.replayRatio, Number(candidate.qualityScore || 1)),
  };
}

function evaluateReplayRun(run = {}, policy = buildExperienceReplayPolicy()) {
  const issues = [];
  if (Number(run.replayRatio || 0) > 0.5) issues.push('replay_ratio_too_high');
  if (Number(run.policyEntropy || 0) < policy.monitors.minEntropy) issues.push('policy_entropy_too_low');
  if (!run.freshOnlyBaseline) issues.push('missing_fresh_only_baseline');
  if (!run.computeSavedPercent && run.computeSavedPercent !== 0) issues.push('missing_compute_saved_metric');

  return {
    decision: issues.length ? 'warn' : 'allow',
    issues,
    computeEfficient: Number(run.computeSavedPercent || 0) > 0 && Number(run.policyEntropy || 0) >= policy.monitors.minEntropy,
  };
}

module.exports = {
  buildExperienceReplayPolicy,
  evaluateReplayCandidate,
  evaluateReplayRun,
};
