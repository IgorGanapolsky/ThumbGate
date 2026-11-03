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

const REQUIRED_LORA_MLP_MODULES = ['gate_proj', 'up_proj', 'down_proj'];
const RECOMMENDED_LORA_ALL_MODULES = [
  'q_proj',
  'k_proj',
  'v_proj',
  'o_proj',
  'gate_proj',
  'up_proj',
  'down_proj',
];

/**
 * Thinking Machines Lab ("LoRA Without Regret" — Schulman et al.):
 * 1. Apply LoRA to all layers, especially MLP/MoE (attention-only LoRA underperforms even at matched params).
 * 2. Optimal LoRA learning rate is ~10x FullFT LR (15x for short runs), rank-invariant via alpha/r scaling.
 * 3. Capacity bound: ~2 bits/param; SFT requires ~2 bits/token, whereas policy-gradient RL absorbs ~1 bit/episode.
 * 4. Compute cost: ~2/3 (0.667x) of FullFT FLOPs per token.
 */
function evaluateLoraWithoutRegretPlan(input = {}) {
  const mode = String(input.mode || 'sft').toLowerCase();
  const rank = Math.max(1, Math.floor(Number(input.rank ?? (RL_MODES.includes(mode) ? 8 : 32))));
  const numLayers = Math.max(1, Math.floor(Number(input.numLayers || 32)));
  const hiddenSize = Math.max(64, Math.floor(Number(input.hiddenSize || 4096)));
  const targetModules = Array.isArray(input.targetModules) && input.targetModules.length > 0
    ? input.targetModules
    : RECOMMENDED_LORA_ALL_MODULES;
  const hasMlpModules = REQUIRED_LORA_MLP_MODULES.every((mod) => targetModules.includes(mod))
    || targetModules.includes('all-linear')
    || targetModules.includes('mlp')
    || targetModules.includes('moe');

  const fullFtLearningRate = Number(input.fullFtLearningRate || 0.00002);
  const isShortRun = Boolean(input.shortRun || (input.steps && Number(input.steps) <= 1500));
  const recommendedLrMultiplier = isShortRun ? 15 : 10;
  const recommendedLoraLr = Number((fullFtLearningRate * recommendedLrMultiplier).toPrecision(4));
  const configuredLoraLr = input.loraLearningRate !== undefined
    ? Number(input.loraLearningRate)
    : recommendedLoraLr;
  const lrRatioToFullFt = fullFtLearningRate > 0
    ? Number((configuredLoraLr / fullFtLearningRate).toFixed(2))
    : recommendedLrMultiplier;

  // Trainable params ~ 2 * r * numLayers * hiddenSize * numMatrices
  const numMatrices = targetModules.includes('all-linear') ? 7 : targetModules.length;
  const trainableParams = 2 * rank * numLayers * hiddenSize * numMatrices;
  const capacityBits = trainableParams * 2;

  // RL policy gradient extracts ~1 bit per episode; SFT extracts ~2 bits per target token
  const rlEpisodes = Math.max(0, Math.floor(Number(input.rlEpisodes || 0)));
  const datasetTokens = Math.max(0, Math.floor(Number(input.datasetTokens || 0)));
  const requiredInformationBits = RL_MODES.includes(mode)
    ? Math.max(1, rlEpisodes * 1)
    : Math.max(1, datasetTokens * 2);
  const capacityHeadroomRatio = Number((capacityBits / requiredInformationBits).toFixed(2));

  const issues = [];
  if (!hasMlpModules) {
    issues.push('attention_only_lora_underperforms_include_mlp_or_moe');
  }
  if (lrRatioToFullFt < 5 || lrRatioToFullFt > 20) {
    issues.push('suboptimal_lora_lr_ratio_expected_10x_to_15x_full_ft');
  }
  if (capacityBits < requiredInformationBits) {
    issues.push('lora_rank_capacity_exceeded_for_dataset_information_bits');
  }

  return {
    mode,
    rank,
    targetModules,
    hasMlpModules,
    fullFtLearningRate,
    configuredLoraLr,
    recommendedLoraLr,
    lrRatioToFullFt,
    trainableParams,
    capacityBits,
    requiredInformationBits,
    capacityHeadroomRatio,
    flopsMultiplierVsFullFt: 0.667,
    tinkerPrimitives: ['forward_backward', 'optim_step', 'sample', 'save_state'],
    issues,
    decision: issues.length === 0 ? 'allow' : 'warn',
  };
}
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
  const loraEvaluation = input.loraConfig
    ? evaluateLoraWithoutRegretPlan({ mode, ...input.loraConfig })
    : null;
  if (loraEvaluation && loraEvaluation.issues.length > 0) {
    issues.push(...loraEvaluation.issues);
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
    loraEvaluation,
  };
}

module.exports = {
  evaluatePostTrainingPlan,
  evaluateLoraWithoutRegretPlan,
  RECOMMENDED_LORA_ALL_MODULES,
  RL_MODES,
};

