#!/usr/bin/env node
'use strict';

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function classifyScalingClaim(claim) {
  const text = normalizeText(claim).toLowerCase();
  if (/\b(pretrain|pretraining|parameters|training tokens|flops|cross entropy|test loss)\b/.test(text)) {
    return 'pretraining_scaling';
  }
  if (/\b(rl|reinforcement|feedback|dpo|kto|reward|policy|thumbs[-\s]?(up|down)|gate|prevention rule)\b/.test(text)) {
    return 'feedback_policy_scaling';
  }
  return 'general_scaling';
}

function evaluateScalingClaim(input = {}) {
  const claim = normalizeText(input.claim);
  const claimType = classifyScalingClaim(claim);
  const evidence = Array.isArray(input.evidence) ? input.evidence.filter(Boolean) : [];
  const heldout = evidence.some((entry) => /held[-\s]?out|validation|eval|ablation|backtest/i.test(String(entry)));
  const production = evidence.some((entry) => /production|real user|workflow run|decision journal|blocked action/i.test(String(entry)));
  const rlCompute = evidence.some((entry) => /sampling compute|rollout|trajectory|policy update|reward model|rl compute/i.test(String(entry)));
  const sampling = evidence.some((entry) => /pass@|best-of-n|majority vote|sample budget|sampling/i.test(String(entry)));
  const issues = [];

  if (!claim) issues.push('missing_claim');
  if (claimType === 'feedback_policy_scaling' && !heldout) {
    issues.push('missing_heldout_feedback_eval');
  }
  if (claimType === 'feedback_policy_scaling' && /rl|reinforcement|sampling/i.test(claim) && !rlCompute) {
    issues.push('missing_rl_compute_evidence');
  }
  if (claimType === 'feedback_policy_scaling' && /sampling|best-of|vote|pass@/i.test(claim) && !sampling) {
    issues.push('missing_sampling_budget_evidence');
  }
  if (claimType === 'pretraining_scaling' && evidence.length === 0) {
    issues.push('missing_model_scaling_evidence');
  }
  if (/guarantee|always|never|100%|proves?/i.test(claim) && !production) {
    issues.push('absolute_claim_without_production_evidence');
  }

  return {
    claimType,
    decision: issues.length === 0 ? 'allow' : 'warn',
    issues,
    requiredEvidence: claimType === 'feedback_policy_scaling'
      ? ['held-out eval', 'ablation or backtest', 'RL/sampling compute budget when claimed', 'decision-journal production sample']
      : ['source data', 'validation metric', 'scope limits'],
  };
}

module.exports = {
  classifyScalingClaim,
  evaluateScalingClaim,
};
