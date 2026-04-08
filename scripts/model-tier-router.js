#!/usr/bin/env node
'use strict';

/**
 * GPT-5.4 Tier Router — routes tasks to nano/mini/frontier based on
 * task complexity, context size, risk level, and retry count.
 * Includes frontier budget control.
 */

const path = require('path');
const { recommendInferenceBackend } = require('./local-model-profile');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'model-tiers.json');

// ---------------------------------------------------------------------------
// Load config
// ---------------------------------------------------------------------------

let _config;
function loadConfig() {
  if (!_config) _config = require(CONFIG_PATH);
  return _config;
}

// ---------------------------------------------------------------------------
// Model tiers
// ---------------------------------------------------------------------------

const TIERS = {
  nano: { label: 'nano', costMultiplier: 0.1, maxContext: 32000 },
  mini: { label: 'mini', costMultiplier: 0.4, maxContext: 200000 },
  frontier: { label: 'frontier', costMultiplier: 1.0, maxContext: 1000000 },
  // Self-hosted open-source frontier (e.g. GLM 5.1). Zero marginal cost.
  localFrontier: { label: 'local-frontier', costMultiplier: 0.0, maxContext: 1000000 },
};

// ---------------------------------------------------------------------------
// Task classification → tier mapping
// ---------------------------------------------------------------------------

/**
 * Classify a task and route it to the appropriate model tier.
 *
 * @param {object} task
 * @param {string}   task.type          — task type identifier
 * @param {number}   [task.contextTokens] — estimated context window usage
 * @param {string}   [task.riskLevel]   — 'low' | 'medium' | 'high'
 * @param {number}   [task.retryCount]  — how many times this task has been retried
 * @param {string[]} [task.tags]        — freeform tags for classification
 * @returns {{ tier: string, reason: string, escalated: boolean }}
 */
function classifyTask(task = {}) {
  const { type, contextTokens = 0, riskLevel, retryCount = 0, tags = [] } = task;
  const config = loadConfig();
  const escalation = config.escalationRules;
  const archTags = escalation.architectureTags || [];

  // --- Escalation checks (override normal routing) ---

  // 1. Context exceeds frontier threshold
  if (contextTokens > escalation.contextThreshold) {
    return {
      tier: 'frontier',
      reason: `context size ${contextTokens} exceeds threshold ${escalation.contextThreshold}`,
      escalated: true,
    };
  }

  // 2. High risk + retried enough
  if (riskLevel === 'high' && retryCount >= escalation.failureRetryThreshold) {
    return {
      tier: 'frontier',
      reason: `high risk with ${retryCount} retries (threshold: ${escalation.failureRetryThreshold})`,
      escalated: true,
    };
  }

  // 3. Architecture / cross-file tags
  const matchedTag = tags.find((t) => archTags.includes(t));
  if (matchedTag) {
    return {
      tier: 'frontier',
      reason: `tag "${matchedTag}" matches architecture escalation`,
      escalated: true,
    };
  }

  // --- Normal tier routing by task type ---

  const tiers = config.tiers;
  for (const tierName of ['nano', 'mini', 'frontier']) {
    if (tiers[tierName].taskTypes.includes(type)) {
      return {
        tier: tierName,
        reason: `task type "${type}" mapped to ${tierName}`,
        escalated: false,
      };
    }
  }

  // Unknown type defaults to mini
  return {
    tier: 'mini',
    reason: `unknown task type "${type}" — defaulting to mini`,
    escalated: false,
  };
}

// ---------------------------------------------------------------------------
// Escalation logic
// ---------------------------------------------------------------------------

/**
 * Determine whether a task should be escalated from its current tier.
 *
 * @param {object} task    — same shape as classifyTask input
 * @param {object[]} history — array of { tier, success } from previous attempts
 * @returns {{ escalate: boolean, from: string, to: string, reason: string }}
 */
function shouldEscalate(task = {}, history = []) {
  const { contextTokens = 0, riskLevel, retryCount = 0, tags = [] } = task;
  const config = loadConfig();
  const rules = config.escalationRules;
  const archTags = rules.architectureTags || [];

  const currentTier = classifyTask(task).tier;

  // 1. Context exceeds threshold
  if (contextTokens > rules.contextThreshold && currentTier !== 'frontier') {
    return {
      escalate: true,
      from: currentTier,
      to: 'frontier',
      reason: `context ${contextTokens} > threshold ${rules.contextThreshold}`,
    };
  }

  // 2. High risk + retries
  if (riskLevel === 'high' && retryCount >= rules.failureRetryThreshold && currentTier !== 'frontier') {
    return {
      escalate: true,
      from: currentTier,
      to: 'frontier',
      reason: `high risk with ${retryCount} retries`,
    };
  }

  // 3. Architecture tags
  const matchedTag = tags.find((t) => archTags.includes(t));
  if (matchedTag && currentTier !== 'frontier') {
    return {
      escalate: true,
      from: currentTier,
      to: 'frontier',
      reason: `architecture tag "${matchedTag}"`,
    };
  }

  // 4. Two consecutive failures at mini tier
  if (history.length >= 2) {
    const lastTwo = history.slice(-2);
    if (lastTwo.every((h) => h.tier === 'mini' && !h.success)) {
      return {
        escalate: true,
        from: 'mini',
        to: 'frontier',
        reason: 'two consecutive failures at mini tier',
      };
    }
  }

  return {
    escalate: false,
    from: currentTier,
    to: currentTier,
    reason: 'no escalation needed',
  };
}

// ---------------------------------------------------------------------------
// Frontier budget tracker
// ---------------------------------------------------------------------------

class FrontierBudget {
  /**
   * @param {object} [options]
   * @param {number} [options.tokenCap]       — max frontier tokens per session (default 500000)
   * @param {boolean} [options.requireReason]  — require a reason string for spend (default true)
   */
  constructor(options = {}) {
    const config = loadConfig();
    const defaults = config.tiers.frontier.budgetDefaults || {};
    this.tokenCap = options.tokenCap ?? defaults.tokenCap ?? 500000;
    this.requireReason = options.requireReason ?? defaults.requireReason ?? true;
    this.spent = 0;
    this.invocations = [];
  }

  /**
   * Check whether a spend is allowed without deducting.
   * @param {number} tokens
   * @param {string} [reason]
   * @returns {{ allowed: boolean, remaining: number, reason: string }}
   */
  canSpend(tokens, reason) {
    if (this.requireReason && !reason) {
      return {
        allowed: false,
        remaining: this.tokenCap - this.spent,
        reason: 'reason is required for frontier spend',
      };
    }
    const remaining = this.tokenCap - this.spent;
    if (tokens > remaining) {
      return {
        allowed: false,
        remaining,
        reason: `requested ${tokens} exceeds remaining ${remaining}`,
      };
    }
    return {
      allowed: true,
      remaining,
      reason: 'within budget',
    };
  }

  /**
   * Deduct tokens from the budget.
   * @param {number} tokens
   * @param {string} [reason]
   * @returns {{ success: boolean, spent: number, remaining: number, reason: string }}
   */
  spend(tokens, reason) {
    const check = this.canSpend(tokens, reason);
    if (!check.allowed) {
      return { success: false, spent: this.spent, remaining: check.remaining, reason: check.reason };
    }
    this.spent += tokens;
    this.invocations.push({ tokens, reason, timestamp: new Date().toISOString() });
    return {
      success: true,
      spent: this.spent,
      remaining: this.tokenCap - this.spent,
      reason: `spent ${tokens} tokens — ${reason}`,
    };
  }

  /**
   * Return current budget status.
   * @returns {{ spent: number, remaining: number, cap: number, invocations: number }}
   */
  status() {
    return {
      spent: this.spent,
      remaining: this.tokenCap - this.spent,
      cap: this.tokenCap,
      invocations: this.invocations.length,
    };
  }

  /** Reset the budget for a new session. */
  reset() {
    this.spent = 0;
    this.invocations = [];
  }
}

function recommendExecutionPlan(task = {}, env = process.env) {
  const classification = classifyTask(task);
  const inference = recommendInferenceBackend(task, env);

  // When a local GLM backend is active, frontier tasks run at zero cost.
  const isLocalGlm = inference.backend.providerMode === 'local'
    && inference.backend.modelFamily.startsWith('glm');
  const effectiveTier = isLocalGlm && classification.tier === 'frontier'
    ? 'localFrontier'
    : classification.tier;

  return {
    tier: effectiveTier,
    escalated: classification.escalated,
    tierReason: classification.reason,
    backendId: inference.backend.id,
    providerMode: inference.backend.providerMode,
    workloadClass: inference.workloadClass,
    recommendationClass: inference.recommendationClass,
    indexCacheEligible: inference.backend.indexCacheEligible,
    indexCacheEnabled: inference.backend.indexCacheEnabled,
    reason: `${classification.reason}; ${inference.reason}`,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { TIERS, classifyTask, shouldEscalate, FrontierBudget, recommendExecutionPlan };

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (require.main === module) {
  const taskType = process.argv[2] || 'code-edit';
  const result = classifyTask({ type: taskType });
  const execution = recommendExecutionPlan({ type: taskType });
  const budget = new FrontierBudget();
  console.log(JSON.stringify({ classification: result, execution, budget: budget.status() }, null, 2));
}
