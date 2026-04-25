#!/usr/bin/env node
'use strict';

function evaluatePostTrainingPlan(input = {}) {
  const mode = String(input.mode || '').toLowerCase();
  const issues = [];
  if (!['sft', 'rl', 'grpo', 'gspo'].includes(mode)) issues.push('unsupported_post_training_mode');
  if (!input.dataset) issues.push('missing_dataset');
  if (!input.baseCheckpoint) issues.push('missing_base_checkpoint');
  if (input.piiRedacted !== true) issues.push('pii_redaction_required');
  if (input.holdoutEval !== true) issues.push('holdout_eval_required');
  if (input.rewardSpecRequired !== false && ['rl', 'grpo', 'gspo'].includes(mode) && !input.rewardSpec) {
    issues.push('missing_reward_spec');
  }
  if (input.maxSpendCents === undefined) issues.push('missing_spend_cap');

  return {
    mode,
    decision: issues.length === 0 ? 'allow' : 'warn',
    issues,
    requiredArtifacts: [
      'dataset manifest',
      'PII redaction report',
      'base checkpoint',
      'holdout eval report',
      'spend cap',
      ['rl', 'grpo', 'gspo'].includes(mode) ? 'reward specification' : null,
    ].filter(Boolean),
  };
}

module.exports = {
  evaluatePostTrainingPlan,
};
