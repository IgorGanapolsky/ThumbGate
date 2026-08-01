'use strict';

/**
 * Hard cost + latency budgets for model tier routing.
 *
 * Complements FrontierBudget (session token cap) with:
 *   - per-request max cost (cents)
 *   - per-request max latency budget (ms) for planning/degrade
 *   - max frontier invocations per day (process-local counter)
 *
 * Env (optional):
 *   THUMBGATE_MAX_COST_CENTS_PER_REQUEST
 *   THUMBGATE_MAX_LATENCY_MS
 *   THUMBGATE_MAX_FRONTIER_PER_DAY
 */

const { TIERS, classifyTask, FrontierBudget } = require('./model-tier-router');

const DEFAULTS = Object.freeze({
  maxCostCentsPerRequest: 25, // $0.25
  maxLatencyMs: 30_000,
  maxFrontierPerDay: 50,
});

/** @type {Map<string, number>} dayKey → frontier invocation count */
const frontierDayCounts = new Map();

function dayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function readEnvNumber(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function getBudgetConfig(overrides = {}) {
  return {
    maxCostCentsPerRequest: overrides.maxCostCentsPerRequest
      ?? readEnvNumber('THUMBGATE_MAX_COST_CENTS_PER_REQUEST', DEFAULTS.maxCostCentsPerRequest),
    maxLatencyMs: overrides.maxLatencyMs
      ?? readEnvNumber('THUMBGATE_MAX_LATENCY_MS', DEFAULTS.maxLatencyMs),
    maxFrontierPerDay: overrides.maxFrontierPerDay
      ?? readEnvNumber('THUMBGATE_MAX_FRONTIER_PER_DAY', DEFAULTS.maxFrontierPerDay),
  };
}

/**
 * Estimate request cost cents from tier + token budget.
 * @param {string} tier
 * @param {number} estimatedTokens
 */
function estimateTierCostCents(tier, estimatedTokens = 4000) {
  const t = TIERS[tier] || TIERS.mini;
  // Base: ~$3/M input + $15/M out blended as ~$6/M total for coding
  const basePerM = 6;
  const usd = (estimatedTokens / 1e6) * basePerM * (t.costMultiplier ?? 1);
  return Number((usd * 100).toFixed(4));
}

/**
 * Enforce hard budgets on a classification result.
 *
 * @param {object} task — same shape as classifyTask
 * @param {object} [options]
 * @param {object} [options.classification] — precomputed classifyTask result
 * @param {FrontierBudget} [options.frontierBudget]
 * @param {number} [options.estimatedTokens]
 * @param {number} [options.nowMs]
 * @returns {{
 *   allowed: boolean,
 *   tier: string,
 *   action: 'allow'|'degrade'|'deny',
 *   reasons: string[],
 *   classification: object,
 *   estimatedCostCents: number,
 *   budget: object,
 * }}
 */
function enforceTierBudgets(task = {}, options = {}) {
  const config = getBudgetConfig(options);
  const classification = options.classification || classifyTask(task);
  let tier = classification.tier;
  const reasons = [];
  const estimatedTokens = Number(options.estimatedTokens) || 4000;
  let estimatedCostCents = estimateTierCostCents(tier, estimatedTokens);
  let action = 'allow';

  // Daily frontier cap (process-local)
  if (tier === 'frontier') {
    const key = dayKey(options.nowMs);
    const used = frontierDayCounts.get(key) || 0;
    if (used >= config.maxFrontierPerDay) {
      reasons.push(`frontier_daily_cap:${used}/${config.maxFrontierPerDay}`);
      tier = 'mini';
      action = 'degrade';
      estimatedCostCents = estimateTierCostCents(tier, estimatedTokens);
    }
  }

  // Per-request cost cap → degrade tier then deny if still over
  if (estimatedCostCents > config.maxCostCentsPerRequest) {
    if (tier === 'frontier') {
      reasons.push(`cost_over_cap_degrade:${estimatedCostCents}>${config.maxCostCentsPerRequest}`);
      tier = 'mini';
      action = 'degrade';
      estimatedCostCents = estimateTierCostCents(tier, estimatedTokens);
    }
  }
  if (estimatedCostCents > config.maxCostCentsPerRequest && tier !== 'nano' && tier !== 'localFrontier') {
    reasons.push(`cost_over_cap_degrade_nano:${estimatedCostCents}>${config.maxCostCentsPerRequest}`);
    tier = 'nano';
    action = 'degrade';
    estimatedCostCents = estimateTierCostCents(tier, estimatedTokens);
  }
  if (estimatedCostCents > config.maxCostCentsPerRequest && (TIERS[tier]?.costMultiplier || 0) > 0) {
    reasons.push(`cost_deny:${estimatedCostCents}>${config.maxCostCentsPerRequest}`);
    action = 'deny';
  }

  // Session frontier token budget
  const frontierBudget = options.frontierBudget || null;
  if (frontierBudget && tier === 'frontier' && typeof frontierBudget.canSpend === 'function') {
    const check = frontierBudget.canSpend(estimatedTokens, task.reason || classification.reason || 'routed_frontier');
    if (!check.allowed) {
      reasons.push(`frontier_session_budget:${check.reason}`);
      tier = 'mini';
      action = action === 'deny' ? 'deny' : 'degrade';
      estimatedCostCents = estimateTierCostCents(tier, estimatedTokens);
    }
  }

  // Latency budget is advisory for planning (caller may still enforce timeouts)
  if (Number(task.expectedLatencyMs) > config.maxLatencyMs) {
    reasons.push(`latency_budget_exceeded_plan:${task.expectedLatencyMs}>${config.maxLatencyMs}`);
    if (tier === 'frontier') {
      tier = 'mini';
      action = action === 'deny' ? 'deny' : 'degrade';
    }
  }

  const allowed = action !== 'deny';
  return {
    allowed,
    tier,
    action,
    reasons,
    classification,
    estimatedCostCents,
    budget: {
      ...config,
      estimatedTokens,
    },
  };
}

/**
 * Record a frontier invocation against the daily counter (call only when actually used).
 */
function recordFrontierInvocation(nowMs = Date.now()) {
  const key = dayKey(nowMs);
  frontierDayCounts.set(key, (frontierDayCounts.get(key) || 0) + 1);
  return frontierDayCounts.get(key);
}

/** Test helper */
function _resetFrontierDayCounts() {
  frontierDayCounts.clear();
}

function getFrontierDayUsage(nowMs = Date.now()) {
  const key = dayKey(nowMs);
  return { day: key, count: frontierDayCounts.get(key) || 0 };
}

module.exports = {
  DEFAULTS,
  getBudgetConfig,
  estimateTierCostCents,
  enforceTierBudgets,
  recordFrontierInvocation,
  getFrontierDayUsage,
  _resetFrontierDayCounts,
};
