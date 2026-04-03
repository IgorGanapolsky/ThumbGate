'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_CONFIG_PATH = path.join(PROJECT_ROOT, 'config', 'partner-routing.json');

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function loadPartnerRoutingConfig(configPath = DEFAULT_CONFIG_PATH) {
  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid partner routing config: expected object');
  }
  if (!parsed.defaultProfile || typeof parsed.defaultProfile !== 'string') {
    throw new Error('Invalid partner routing config: missing defaultProfile');
  }
  if (!parsed.profiles || typeof parsed.profiles !== 'object') {
    throw new Error('Invalid partner routing config: missing profiles');
  }

  return parsed;
}

function normalizePartnerProfile(partnerProfile, config = loadPartnerRoutingConfig()) {
  if (!partnerProfile) {
    return config.defaultProfile;
  }

  const raw = String(partnerProfile).trim().toLowerCase();
  const alias = config.aliases && config.aliases[raw];
  const resolved = alias || raw;

  if (!config.profiles[resolved]) {
    throw new Error(`Unknown partner profile: ${partnerProfile}`);
  }

  return resolved;
}

function getPartnerCategory(partnerProfile) {
  return `partner_${partnerProfile}`;
}

function scaleBudgetValue(value, multiplier) {
  if (!Number.isFinite(value) || value <= 0) {
    return value;
  }
  const effectiveMultiplier = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  return Math.max(1, Math.round(value * effectiveMultiplier));
}

function scaleTokenBudget(tokenBudget, multipliers = {}) {
  if (!tokenBudget || typeof tokenBudget !== 'object') {
    return null;
  }

  return {
    total: scaleBudgetValue(tokenBudget.total, multipliers.total),
    perAction: scaleBudgetValue(tokenBudget.perAction, multipliers.perAction),
    contextPack: scaleBudgetValue(tokenBudget.contextPack, multipliers.contextPack),
  };
}

function buildPartnerStrategy(options = {}) {
  const config = loadPartnerRoutingConfig(options.configPath);
  const profile = normalizePartnerProfile(options.partnerProfile, config);
  const profileConfig = config.profiles[profile] || {};

  return {
    profile,
    label: profileConfig.label || profile,
    description: profileConfig.description || '',
    verificationMode: profileConfig.verificationMode || 'standard',
    maxRetryDelta: Number.isFinite(profileConfig.maxRetryDelta) ? profileConfig.maxRetryDelta : 0,
    rewardBias: Number.isFinite(profileConfig.rewardBias) ? profileConfig.rewardBias : 0,
    partnerCategory: getPartnerCategory(profile),
    actionBiases: profileConfig.actionBiases || {},
    recommendedChecks: Array.isArray(profileConfig.recommendedChecks) ? profileConfig.recommendedChecks.slice() : [],
    tokenBudget: scaleTokenBudget(options.tokenBudget, profileConfig.tokenBudgetMultiplier || {}),
  };
}

function getPartnerActionBias(action, partnerStrategy) {
  if (!action || !partnerStrategy || !partnerStrategy.actionBiases) {
    return 0;
  }
  return Number(partnerStrategy.actionBiases[action.name] || 0);
}

function resolveVerificationRetries(baseMaxRetries, partnerStrategy) {
  const requested = Number.isFinite(baseMaxRetries) ? baseMaxRetries : 3;
  const delta = partnerStrategy && Number.isFinite(partnerStrategy.maxRetryDelta)
    ? partnerStrategy.maxRetryDelta
    : 0;
  return Math.max(1, requested + delta);
}

function computePartnerReward(params = {}) {
  const config = loadPartnerRoutingConfig(params.configPath);
  const rewardModel = config.rewardModel || {};
  const accepted = params.accepted === true;
  const attempts = Number.isFinite(params.attempts) ? params.attempts : 1;
  const violationCount = Number.isFinite(params.violationCount) ? params.violationCount : 0;
  const partnerStrategy = params.partnerStrategy || buildPartnerStrategy({
    partnerProfile: params.partnerProfile,
  });

  const baseReward = accepted ? Number(rewardModel.accepted || 1) : Number(rewardModel.rejected || -1);
  const attemptPenalty = Math.max(0, attempts - 1) * Number(rewardModel.attemptPenalty || 0);
  const violationPenalty = Math.min(
    violationCount * Number(rewardModel.violationPenalty || 0),
    Number(rewardModel.maxViolationPenalty || 0),
  );
  const rawReward = baseReward - attemptPenalty - violationPenalty + Number(partnerStrategy.rewardBias || 0);
  const reward = Math.round(clamp(rawReward, -1, 1) * 1000) / 1000;

  return {
    profile: partnerStrategy.profile,
    reward,
    weightMultiplier: 1 + Math.abs(reward),
    components: {
      baseReward,
      attemptPenalty,
      violationPenalty,
      rewardBias: Number(partnerStrategy.rewardBias || 0),
    },
  };
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  loadPartnerRoutingConfig,
  normalizePartnerProfile,
  getPartnerCategory,
  scaleTokenBudget,
  buildPartnerStrategy,
  getPartnerActionBias,
  resolveVerificationRetries,
  computePartnerReward,
};
