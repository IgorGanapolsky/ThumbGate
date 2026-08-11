#!/usr/bin/env node
'use strict';

/**
 * Risk-aware model router — routes whole generation requests to an external
 * provider/model tier based on task complexity, context size, risk level, and
 * retry count. This is application-level routing, not a neural Mixture of
 * Experts (MoE): it never routes tokens through internal expert subnetworks.
 */

const fs = require('fs');
const path = require('path');
const { recommendInferenceBackend, resolveModelRole } = require('./local-model-profile');
const { redactSecrets } = require('./secret-redaction');

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
  // Cheap OpenAI-compatible cloud flagship (Qwen3.8-Max class) for steady
  // high-output workloads. Inert until its endpoint env vars are configured.
  bulkCloud: { label: 'bulk-cloud', costMultiplier: 0.25, maxContext: 1000000 },
  frontier: { label: 'frontier', costMultiplier: 1.0, maxContext: 1000000 },
  // Self-hosted open-source frontier (e.g. GLM 5.1). Zero marginal cost.
  localFrontier: { label: 'local-frontier', costMultiplier: 0.0, maxContext: 1000000 },
};

// Routing priority for task-type matching. Config-declared tiers missing from
// this list are appended after, before the frontier fallback semantics apply.
const TIER_ROUTING_ORDER = ['nano', 'mini', 'bulkCloud', 'frontier'];

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
  const declaredOrder = TIER_ROUTING_ORDER.filter((name) => tiers[name])
    .concat(Object.keys(tiers).filter((name) => !TIER_ROUTING_ORDER.includes(name)));
  for (const tierName of declaredOrder) {
    if (Array.isArray(tiers[tierName].taskTypes) && tiers[tierName].taskTypes.includes(type)) {
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

function isSwitchyardEnabled(task = {}, env = process.env) {
  const flag = String(env.THUMBGATE_SWITCHYARD || '').trim().toLowerCase();
  if (flag === '1' || flag === 'true' || flag === 'yes' || flag === 'on') return true;
  const tags = Array.isArray(task.tags) ? task.tags.map((t) => String(t).toLowerCase()) : [];
  return Boolean(
    Array.isArray(task.steps) && task.steps.length > 0
    || tags.includes('switchyard')
    || tags.includes('multi-model')
    || tags.includes('nemotron')
    || tags.includes('always-on'),
  );
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

  const plan = {
    architecture: 'risk-aware-model-routing',
    mixtureOfExperts: false,
    tier: effectiveTier,
    escalated: classification.escalated,
    tierReason: classification.reason,
    backendId: inference.backend.id,
    providerMode: inference.backend.providerMode,
    modelFamily: inference.backend.modelFamily,
    workloadClass: inference.workloadClass,
    recommendationClass: inference.recommendationClass,
    indexCacheEligible: inference.backend.indexCacheEligible,
    indexCacheEnabled: inference.backend.indexCacheEnabled,
    reason: `${classification.reason}; ${inference.reason}`,
  };

  // Optional NeMo Switchyard–style multi-model step plan (opt-in).
  if (isSwitchyardEnabled(task, env)) {
    try {
      const {
        routeAgentSteps,
        buildAlwaysOnAgentPlan,
      } = require('./switchyard-router');
      const steps = Array.isArray(task.steps) && task.steps.length
        ? task.steps
        : buildAlwaysOnAgentPlan({
          sensitive: task.privacyRoute === 'local' || task.sensitive,
          highVolume: task.highVolume || task.costPriority === 'primary',
          riskLevel: task.riskLevel,
          actType: task.type,
        });
      const switchyard = routeAgentSteps(steps);
      plan.switchyard = switchyard;
      plan.multiModel = switchyard.multiModel;
      plan.reason = `${plan.reason}; switchyard models=${switchyard.distinctModels.join(',')}`;
    } catch {
      // Switchyard optional; never break baseline routing.
    }
  }

  // Optional dual-stack cost lane (Qwen volume / Claude quality). Opt-in via
  // THUMBGATE_COST_ROUTE_QWEN=1 or task tags cost-sensitive|high-volume|bulk.
  if (isCostRouteQwenEnabled(task, env)) {
    try {
      const { recommendCostQualitySplit } = require('./qwen38-max-cost-optimizer');
      const split = recommendCostQualitySplit(task, {
        useTokenPlanPromo: String(env.THUMBGATE_QWEN_TOKEN_PLAN_PROMO || '').toLowerCase() === '1'
          || String(env.THUMBGATE_QWEN_TOKEN_PLAN_PROMO || '').toLowerCase() === 'true',
        localModel: env.THUMBGATE_LOCAL_MODEL || null,
      });
      plan.costQualitySplit = split;
      plan.costLane = split.lane;
      plan.preferredProvider = split.primaryProvider;
      plan.preferredModel = split.primaryModel;
      plan.reason = `${plan.reason}; cost-lane=${split.lane}→${split.primaryProvider}/${split.primaryModel}`;
    } catch {
      // Cost module optional at runtime; never fail routing.
    }
  }

  return plan;
}

// ---------------------------------------------------------------------------
// Executable generation routing
// ---------------------------------------------------------------------------

function inferProvider(modelId, tier) {
  if (tier === 'localFrontier') return 'openai-compatible';
  if (/^(gpt-|o\d)/i.test(modelId || '')) return 'openai';
  if (/^claude-/i.test(modelId || '')) return 'anthropic';
  if (/^(gemini|vertex)/i.test(modelId || '')) return 'gemini';
  return 'custom';
}

function normalizeGenerationResult(result, fallback = {}) {
  if (typeof result === 'string') {
    return {
      text: result,
      model: fallback.model,
      provider: fallback.provider,
      usage: null,
      costCents: null,
    };
  }
  if (!result || typeof result !== 'object') {
    throw new Error('generation adapter returned no result');
  }
  const rawCostCents = result.costCents;
  return {
    ...result,
    text: String(result.text || ''),
    model: result.model || fallback.model,
    provider: result.provider || fallback.provider,
    usage: result.usage || null,
    costCents: rawCostCents === null || rawCostCents === undefined || rawCostCents === ''
      ? null
      : (Number.isFinite(Number(rawCostCents)) ? Number(rawCostCents) : null),
  };
}

function resolveLocalGenerationModel(env, plan) {
  const role = resolveModelRole('normal', env);
  if (role.provider === 'local') return role.model;

  const configuredModel = [
    env.THUMBGATE_MODEL_ROLE_NORMAL,
    env.THUMBGATE_LOCAL_MODEL,
    env.THUMBGATE_MODEL_ID,
    env.THUMBGATE_LOCAL_MODEL_FAMILY,
    plan.modelFamily,
  ].find((value) => value && String(value).trim() && String(value).trim() !== 'unknown');
  if (configuredModel) return String(configuredModel).trim();
  throw new Error('a local model ID or family is required for local routing');
}

function resolveGenerationTarget(plan, task, tierConfig, options, env) {
  const modelOverride = options.modelOverrides?.[plan.tier];
  const providerOverride = options.providerOverrides?.[plan.tier];
  const localOnly = task.privacyRoute === 'local';

  if (localOnly && plan.providerMode !== 'local') {
    throw new Error('privacyRoute "local" requires a configured local inference backend');
  }

  if (plan.providerMode === 'local') {
    if (providerOverride && providerOverride !== 'openai-compatible') {
      throw new Error('local inference cannot use a cloud provider override');
    }
    return {
      model: modelOverride || resolveLocalGenerationModel(env, plan),
      provider: 'openai-compatible',
    };
  }

  const model = modelOverride || tierConfig.modelId;
  if (!model) throw new Error(`missing modelId for tier "${plan.tier}"`);
  const target = {
    model,
    provider: providerOverride || tierConfig.provider || inferProvider(model, plan.tier),
  };
  if (tierConfig.endpoint && typeof tierConfig.endpoint === 'object') {
    const { baseUrlEnv, apiKeyEnv } = tierConfig.endpoint;
    const baseUrl = baseUrlEnv ? env[baseUrlEnv] : undefined;
    const apiKey = apiKeyEnv ? env[apiKeyEnv] : undefined;
    if (!baseUrl || !apiKey) {
      const missing = [!baseUrl && baseUrlEnv, !apiKey && apiKeyEnv].filter(Boolean).join(', ');
      throw new Error(`tier "${plan.tier}" requires endpoint configuration; set ${missing}`);
    }
    target.endpoint = { baseUrl, apiKey };
  }
  return target;
}

/**
 * Estimate the USD cost of a generation for a tier that declares
 * pricingUsdPerMTok in config. Returns null when pricing is not declared.
 */
function estimateTierCostUsd(tierName, inputTokens, outputTokens, config = loadConfig()) {
  const pricing = config?.tiers?.[tierName]?.pricingUsdPerMTok;
  if (!pricing || !Number.isFinite(pricing.input) || !Number.isFinite(pricing.output)) return null;
  const inTok = Number.isFinite(inputTokens) ? Math.max(0, inputTokens) : 0;
  const outTok = Number.isFinite(outputTokens) ? Math.max(0, outputTokens) : 0;
  return (inTok * pricing.input + outTok * pricing.output) / 1_000_000;
}

function createOpenAiCompatibleAdapter(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || global.fetch;

  return async function openAiCompatibleAdapter({ request, model, provider, endpoint }) {
    if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
    const local = provider === 'openai-compatible';
    const baseUrl = endpoint?.baseUrl
      || (local ? env.THUMBGATE_LOCAL_MODEL_BASE_URL : (env.OPENAI_BASE_URL || 'https://api.openai.com/v1'));
    const apiKey = endpoint?.apiKey
      || (local ? env.THUMBGATE_LOCAL_MODEL_API_KEY : env.OPENAI_API_KEY);
    if (!baseUrl) throw new Error('THUMBGATE_LOCAL_MODEL_BASE_URL is required for local routing');
    if (!local && !apiKey) throw new Error('OPENAI_API_KEY is required for OpenAI routing');

    const messages = Array.isArray(request.messages) && request.messages.length > 0
      ? request.messages
      : [
        ...(request.systemPrompt ? [{ role: 'system', content: request.systemPrompt }] : []),
        { role: 'user', content: request.userPrompt || request.prompt || '' },
      ];
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const response = await fetchImpl(`${String(baseUrl).replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        max_tokens: request.maxTokens || 1024,
        temperature: Number.isFinite(request.temperature) ? request.temperature : 0,
      }),
    });
    if (!response.ok) throw new Error(`${provider} generation failed with HTTP ${response.status}`);
    const payload = await response.json();
    return {
      text: payload?.choices?.[0]?.message?.content || '',
      model: payload?.model || model,
      provider,
      usage: payload?.usage || null,
      costCents: null,
    };
  };
}

function createDefaultGenerationAdapters(options = {}) {
  const openAiCompatible = createOpenAiCompatibleAdapter(options);
  return {
    openai: openAiCompatible,
    'openai-compatible': openAiCompatible,
  };
}

function createJsonlTelemetrySink(filePath) {
  if (!filePath) throw new Error('telemetry file path is required');
  return (event) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, 'utf8');
  };
}

async function executeRoutedGeneration(task = {}, request = {}, options = {}) {
  const env = options.env || process.env;
  const config = options.config || loadConfig();
  const plan = recommendExecutionPlan(task, env);
  const tierConfig = config.tiers[plan.tier];
  if (!tierConfig) throw new Error(`missing configuration for tier "${plan.tier}"`);
  const now = options.now || (() => Date.now());
  const startedAt = now();
  // Resolution can fail (e.g. an unconfigured tier endpoint), so the base event
  // starts from tier config defaults and target resolution happens inside the
  // telemetry try block — misconfiguration emits an error event, not silence.
  const baseEvent = {
    timestamp: new Date().toISOString(),
    architecture: plan.architecture,
    taskType: task.type || 'unknown',
    riskLevel: task.riskLevel || 'unspecified',
    tier: plan.tier,
    provider: tierConfig.provider || null,
    model: tierConfig.modelId || null,
    escalated: plan.escalated,
    routeReason: plan.reason,
  };

  try {
    const { model, provider, endpoint } = resolveGenerationTarget(plan, task, tierConfig, options, env);
    baseEvent.provider = provider;
    baseEvent.model = model;
    const adapters = options.adapters || createDefaultGenerationAdapters({ env, fetchImpl: options.fetchImpl });
    const adapter = adapters[plan.tier] || adapters[provider];
    if (typeof adapter !== 'function') throw new Error(`no generation adapter registered for provider "${provider}"`);
    const raw = await adapter({ task, request, plan, model, provider, endpoint });
    const result = normalizeGenerationResult(raw, { model, provider });
    const inputTokens = Number(result.usage?.input_tokens || result.usage?.prompt_tokens || 0) || null;
    const outputTokens = Number(result.usage?.output_tokens || result.usage?.completion_tokens || 0) || null;
    // When the adapter reports no cost but the tier declares per-token pricing,
    // derive real cost from usage so telemetry and holdout cost math stay live.
    // Never derive when usage is entirely unmeasured (an unmeasured request is
    // unknown-cost, not free) or when execution actually ran on a local backend
    // (tier pricing describes the cloud endpoint, not local inference).
    let costCents = result.costCents;
    const usageMeasured = inputTokens !== null || outputTokens !== null;
    if ((costCents === null || costCents === undefined) && usageMeasured && plan.providerMode !== 'local') {
      const estimatedUsd = estimateTierCostUsd(plan.tier, inputTokens || 0, outputTokens || 0, config);
      costCents = estimatedUsd === null ? null : Number((estimatedUsd * 100).toFixed(4));
    }
    if (costCents === undefined) costCents = null;
    const event = {
      ...baseEvent,
      latencyMs: Math.max(0, now() - startedAt),
      inputTokens,
      outputTokens,
      costCents,
      outcome: 'success',
    };
    if (options.telemetrySink) await options.telemetrySink(event);
    return { ...result, costCents, route: plan, telemetry: event };
  } catch (error) {
    const event = {
      ...baseEvent,
      latencyMs: Math.max(0, now() - startedAt),
      inputTokens: null,
      outputTokens: null,
      costCents: null,
      outcome: 'error',
      error: redactSecrets(String(error?.message || error)).split('\n')[0].slice(0, 300),
    };
    if (options.telemetrySink) await options.telemetrySink(event);
    throw error;
  }
}

function average(values) {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

async function evaluateRoutingHoldout(cases, options = {}) {
  if (!Array.isArray(cases) || cases.length === 0) throw new Error('holdout cases are required');
  if (typeof options.fixedGenerate !== 'function') throw new Error('fixedGenerate baseline is required');
  if (typeof options.scoreOutput !== 'function') {
    throw new Error('scoreOutput is required; model routing and output judging must remain separate');
  }
  const routedGenerate = options.routedGenerate
    || ((testCase) => executeRoutedGeneration(testCase.task, testCase.request, options.routerOptions));
  const results = [];

  for (const testCase of cases) {
    const routed = await routedGenerate(testCase);
    const fixed = await options.fixedGenerate(testCase);
    const routedScore = Number(await options.scoreOutput(routed, testCase, 'routed'));
    const fixedScore = Number(await options.scoreOutput(fixed, testCase, 'fixed'));
    if (!Number.isFinite(routedScore) || !Number.isFinite(fixedScore)) {
      throw new Error(`non-numeric holdout score for case "${testCase.id || 'unknown'}"`);
    }
    results.push({
      id: testCase.id || `case-${results.length + 1}`,
      routed: {
        tier: routed.route?.tier || null,
        model: routed.model || null,
        score: routedScore,
        costCents: Number.isFinite(routed.costCents) ? routed.costCents : null,
        latencyMs: Number.isFinite(routed.telemetry?.latencyMs) ? routed.telemetry.latencyMs : null,
      },
      fixed: {
        model: fixed.model || options.fixedModel || null,
        score: fixedScore,
        costCents: Number.isFinite(fixed.costCents) ? fixed.costCents : null,
        latencyMs: Number.isFinite(fixed.telemetry?.latencyMs) ? fixed.telemetry.latencyMs : null,
      },
      qualityRegret: fixedScore - routedScore,
    });
  }

  const costPairs = results.filter((result) => (
    Number.isFinite(result.routed.costCents) && Number.isFinite(result.fixed.costCents)
  ));
  const routedCost = average(costPairs.map((result) => result.routed.costCents));
  const fixedCost = average(costPairs.map((result) => result.fixed.costCents));
  const averageQualityRegret = average(results.map((result) => result.qualityRegret));
  const worstCaseQualityRegret = Math.max(...results.map((result) => result.qualityRegret));
  const maxQualityRegret = Number.isFinite(options.maxQualityRegret) ? options.maxQualityRegret : 0;
  return {
    architecture: 'risk-aware-model-routing',
    judgeStage: 'external-scorer',
    caseCount: results.length,
    metrics: {
      routedQuality: average(results.map((result) => result.routed.score)),
      fixedQuality: average(results.map((result) => result.fixed.score)),
      averageQualityRegret,
      worstCaseQualityRegret,
      routedCostCents: routedCost,
      fixedCostCents: fixedCost,
      costSavingsCents: routedCost === null || fixedCost === null ? null : fixedCost - routedCost,
      costCoverage: { measuredCases: costPairs.length, totalCases: results.length },
    },
    thresholds: { maxQualityRegret },
    passed: worstCaseQualityRegret <= maxQualityRegret,
    results,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

function isCostRouteQwenEnabled(task = {}, env = process.env) {
  const flag = String(env.THUMBGATE_COST_ROUTE_QWEN || '').trim().toLowerCase();
  if (flag === '1' || flag === 'true' || flag === 'yes' || flag === 'on') return true;
  const tags = Array.isArray(task.tags) ? task.tags.map((t) => String(t).toLowerCase()) : [];
  return Boolean(
    task.costPriority === 'primary'
    || task.highVolume
    || tags.includes('cost-sensitive')
    || tags.includes('high-volume')
    || tags.includes('bulk')
    || tags.includes('qwen-volume'),
  );
}

module.exports = {
  isCostRouteQwenEnabled,
  TIERS,
  TIER_ROUTING_ORDER,
  classifyTask,
  estimateTierCostUsd,
  shouldEscalate,
  FrontierBudget,
  recommendExecutionPlan,
  isSwitchyardEnabled,
  inferProvider,
  normalizeGenerationResult,
  resolveGenerationTarget,
  createOpenAiCompatibleAdapter,
  createDefaultGenerationAdapters,
  createJsonlTelemetrySink,
  executeRoutedGeneration,
  evaluateRoutingHoldout,
};

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
