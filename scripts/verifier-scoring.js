'use strict';

function buildVerifierScoringRubric(options = {}) {
  const criteria = options.criteria || [
    'evidence_cited',
    'scope_respected',
    'tests_or_proof_run',
    'claim_matches_artifacts',
  ];
  const granularity = Number.isFinite(options.granularity) ? options.granularity : 100;
  const repeats = Number.isFinite(options.repeats) ? options.repeats : 3;

  return {
    rubricId: 'granular_llm_verifier',
    criteria,
    granularity,
    repeats,
    scoring: 'probability_weighted_average',
    passThreshold: Number.isFinite(options.passThreshold) ? options.passThreshold : 0.82,
    caveats: [
      'calibrate against held-out human labels before production blocking',
      'fall back to coarse scores when model cannot expose score-token probabilities',
      'never use verifier score alone for destructive actions',
    ],
  };
}

function computeVerifierScore({ scores = [], rubric = buildVerifierScoringRubric() } = {}) {
  const flattened = scores
    .flatMap((criterion) => Array.isArray(criterion.repeats) ? criterion.repeats : [])
    .filter((value) => Number.isFinite(value));

  if (flattened.length === 0) {
    return {
      score: 0,
      decision: 'warn',
      issues: ['missing_verifier_scores'],
    };
  }

  const normalized = flattened.map((value) => value > 1 ? value / rubric.granularity : value);
  const score = normalized.reduce((sum, value) => sum + value, 0) / normalized.length;
  const issues = [];
  if (scores.length < rubric.criteria.length) issues.push('missing_criteria_scores');
  if (flattened.length < rubric.criteria.length * rubric.repeats) issues.push('missing_repeat_verifications');

  return {
    score: Number(score.toFixed(4)),
    decision: score >= rubric.passThreshold && issues.length === 0 ? 'allow' : 'warn',
    issues,
  };
}

function evaluateVerifierSetup(setup = {}) {
  const issues = [];
  if (!setup.criteria || setup.criteria.length < 3) issues.push('too_few_criteria');
  if (!setup.repeats || setup.repeats < 2) issues.push('repeat_verification_required');
  if (!setup.heldoutCalibration) issues.push('heldout_calibration_required');
  if (setup.destructiveAction && !setup.humanReview) issues.push('human_review_required_for_destructive_action');

  return {
    decision: issues.length ? 'warn' : 'allow',
    issues,
  };
}

module.exports = {
  buildVerifierScoringRubric,
  computeVerifierScore,
  evaluateVerifierSetup,
};
