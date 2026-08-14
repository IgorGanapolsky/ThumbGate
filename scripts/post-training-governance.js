#!/usr/bin/env node
'use strict';

/**
 * Post-training plan governance.
 *
 * EdotEnv transfer (harder-next-round / research harness): RL / GRPO / GSPO
 * plans must show a verified research cycle and safety hillclimb evidence —
 * not just a dataset + spend cap. SFT stays on the lighter path.
 */

const RL_MODES = ['rl', 'grpo', 'gspo'];

function evaluatePostTrainingPlan(input = {}) {
  const mode = String(input.mode || '').toLowerCase();
  const issues = [];
  if (!['sft', ...RL_MODES].includes(mode)) issues.push('unsupported_post_training_mode');
  if (!input.dataset) issues.push('missing_dataset');
  if (!input.baseCheckpoint) issues.push('missing_base_checkpoint');
  if (input.piiRedacted !== true) issues.push('pii_redaction_required');
  if (input.holdoutEval !== true) issues.push('holdout_eval_required');
  if (input.rewardSpecRequired !== false && RL_MODES.includes(mode) && !input.rewardSpec) {
    issues.push('missing_reward_spec');
  }
  if (input.maxSpendCents === undefined) issues.push('missing_spend_cap');

  // EdotEnv-inspired: multi-step research agents claim progress only after verify.
  // RL post-training inherits the same contract at plan time.
  if (RL_MODES.includes(mode)) {
    const cycle = input.researchCycleEvidence || input.researchCycle;
    if (!cycle || cycle.verified !== true) {
      issues.push('research_cycle_verify_required');
    }
    if (input.claimWithoutVerify === true) {
      issues.push('claim_without_verify_forbidden');
    }
    const hill = input.safetyHillclimb || input.rsiHillclimb;
    if (!hill || hill.passed !== true) {
      issues.push('safety_hillclimb_required');
    }
    if (input.requireHarderNextRound !== false) {
      const frontier = input.difficultyFrontier || input.harderNextRound;
      if (!frontier || frontier.enabled !== true) {
        issues.push('harder_next_round_frontier_required');
      }
    }
  }

  const requiredArtifacts = [
    'dataset manifest',
    'PII redaction report',
    'base checkpoint',
    'holdout eval report',
    'spend cap',
    RL_MODES.includes(mode) ? 'reward specification' : null,
    RL_MODES.includes(mode) ? 'verified research cycle evidence' : null,
    RL_MODES.includes(mode) ? 'safety hillclimb pass receipt' : null,
    RL_MODES.includes(mode) ? 'harder-next-round difficulty frontier' : null,
  ].filter(Boolean);

  return {
    mode,
    decision: issues.length === 0 ? 'allow' : 'warn',
    issues,
    requiredArtifacts,
    edotenvTransfer:
      'RL plans require research-cycle verify + safety hillclimb + difficulty frontier (EdotEnv pattern, ThumbGate runtime).',
  };
}

module.exports = {
  evaluatePostTrainingPlan,
  RL_MODES,
};

