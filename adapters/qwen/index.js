'use strict';

/**
 * Qwen / Alibaba Cloud Model Studio adapter for ThumbGate.
 *
 * High-ROI ideas stolen from Model Studio (role tiers, Token Plan economics,
 * OpenAI-compatible egress, embedding API) — ThumbGate still owns gates,
 * routing policy, and proof. This module is catalog + config + pure policy,
 * not a second agent runtime.
 */

const MODEL_STUDIO_DEFAULT_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
const DEFAULT_EMBED_MODEL = 'text-embedding-v4';
const DEFAULT_EMBED_DIMENSIONS = 1024;

const QWEN_MODELS = Object.freeze({
  QWEN_3_8_MAX: 'qwen3.8-max',
  QWEN_3_7_PLUS: 'qwen3.7-plus',
  QWEN_3_6_FLASH: 'qwen3.6-flash',
  QWEN_3_5_OMNI_PLUS: 'qwen3.5-omni-plus',
  TEXT_EMBEDDING_V4: DEFAULT_EMBED_MODEL,
});

/**
 * Token-plan style role map (Lite/Standard/Pro → Flash/Plus/Max).
 * Workload ids match config/model-candidates.json.
 */
const WORKLOAD_ROLE_ROUTES = Object.freeze({
  'pretool-gating': {
    role: 'gate',
    model: QWEN_MODELS.QWEN_3_6_FLASH,
    candidateId: 'alibaba/qwen3.6-flash',
    costClass: 'low',
    reason: 'Cheap, fast gate judgments before tools run.',
  },
  'cheap-fast-path': {
    role: 'triage',
    model: QWEN_MODELS.QWEN_3_6_FLASH,
    candidateId: 'alibaba/qwen3.6-flash',
    costClass: 'low',
    reason: 'First-pass triage; escalate only when ambiguous.',
  },
  'long-trace-review': {
    role: 'heavy',
    model: QWEN_MODELS.QWEN_3_8_MAX,
    candidateId: 'alibaba/qwen3.8-max',
    costClass: 'medium',
    reason: 'Long-horizon coding / multi-day agent traces.',
  },
  'dashboard-analysis': {
    role: 'analysis',
    model: QWEN_MODELS.QWEN_3_7_PLUS,
    candidateId: 'alibaba/qwen3.7-plus',
    costClass: 'low',
    reason: 'Vision-capable analysis without flagship cost.',
  },
  'claw-style-enterprise-agent': {
    role: 'heavy',
    model: QWEN_MODELS.QWEN_3_8_MAX,
    candidateId: 'alibaba/qwen3.8-max',
    costClass: 'medium',
    reason: 'Screen/tool-heavy claw workloads need flagship reasoning under gates.',
  },
  'context-engineering': {
    role: 'coding',
    model: QWEN_MODELS.QWEN_3_7_PLUS,
    candidateId: 'alibaba/qwen3.7-plus',
    costClass: 'low',
    reason: 'Agentic coding + tool use for context packing work.',
  },
});

const DEFAULT_ROLE_ROUTE = Object.freeze({
  role: 'default',
  model: QWEN_MODELS.QWEN_3_7_PLUS,
  candidateId: 'alibaba/qwen3.7-plus',
  costClass: 'low',
  reason: 'Balanced Model Studio default when workload is unknown.',
});

function normalizeWorkloadId(workload) {
  return String(workload || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
}

function buildQwenModelStudioConfig(options = {}) {
  const env = options.env || process.env;
  const apiKey = options.apiKey
    || env.DASHSCOPE_API_KEY
    || env.QWEN_API_KEY
    || null;
  const baseUrl = options.baseUrl
    || env.DASHSCOPE_BASE_URL
    || env.QWEN_BASE_URL
    || MODEL_STUDIO_DEFAULT_BASE_URL;
  const model = options.model || QWEN_MODELS.QWEN_3_7_PLUS;

  return {
    apiKey,
    baseUrl: String(baseUrl).replace(/\/+$/, ''),
    model,
    isConfigured: Boolean(apiKey),
    isOpenAICompatible: true,
    chatCompletionsPath: '/chat/completions',
    embeddingsPath: '/embeddings',
  };
}

/**
 * Resolve which Qwen Model Studio model to use for a ThumbGate workload.
 * Env overrides: THUMBGATE_QWEN_ROLE_<ROLE> or THUMBGATE_QWEN_MODEL.
 */
function resolveQwenRoleRoute(workload, options = {}) {
  const env = options.env || process.env;
  const workloadId = normalizeWorkloadId(workload) || 'pretool-gating';
  const base = WORKLOAD_ROLE_ROUTES[workloadId]
    ? { ...WORKLOAD_ROLE_ROUTES[workloadId] }
    : { ...DEFAULT_ROLE_ROUTE, workloadId: workloadId || null };

  const roleEnvKey = `THUMBGATE_QWEN_ROLE_${String(base.role || 'default').toUpperCase()}`;
  const model = options.model
    || env.THUMBGATE_QWEN_MODEL
    || env[roleEnvKey]
    || base.model;

  return {
    workloadId,
    role: base.role,
    model,
    candidateId: base.candidateId,
    costClass: base.costClass,
    reason: base.reason,
    config: buildQwenModelStudioConfig({ ...options, model, env }),
  };
}

/**
 * LiteLLM / OpenAI-SDK env map for Hermes gateway wiring (no secrets printed).
 */
function buildLiteLLMProviderEnv(options = {}) {
  const config = buildQwenModelStudioConfig(options);
  const route = resolveQwenRoleRoute(options.workload || 'pretool-gating', options);
  return {
    OPENAI_API_BASE: config.baseUrl,
    OPENAI_BASE_URL: config.baseUrl,
    // Caller injects real key from Keychain/env — never hardcode.
    OPENAI_API_KEY: config.isConfigured ? '${DASHSCOPE_API_KEY}' : null,
    LITELLM_MODEL: `openai/${route.model}`,
    THUMBGATE_QWEN_MODEL: route.model,
    THUMBGATE_QWEN_WORKLOAD: route.workloadId,
    DASHSCOPE_BASE_URL: config.baseUrl,
    configured: config.isConfigured,
  };
}

function buildQwenEmbeddingConfig(options = {}) {
  const env = options.env || process.env;
  const studio = buildQwenModelStudioConfig(options);
  const model = options.model
    || env.THUMBGATE_QWEN_EMBED_MODEL
    || env.THUMBGATE_OPENAI_EMBED_MODEL
    || DEFAULT_EMBED_MODEL;
  const dimensions = Number(
    options.dimensions
    || env.THUMBGATE_QWEN_EMBED_DIM
    || env.THUMBGATE_OPENAI_EMBED_DIM
    || DEFAULT_EMBED_DIMENSIONS,
  );
  const enabled = Boolean(
    options.enabled
    || env.THUMBGATE_EMBED_PROVIDER === 'dashscope'
    || env.THUMBGATE_EMBED_PROVIDER === 'qwen'
    || env.THUMBGATE_EMBED_PROVIDER === 'model-studio'
    || (env.THUMBGATE_OPENAI_EMBED_BASE_URL && /dashscope/i.test(String(env.THUMBGATE_OPENAI_EMBED_BASE_URL))),
  );

  return {
    enabled: enabled && studio.isConfigured,
    provider: 'dashscope',
    apiKey: studio.apiKey,
    baseUrl: studio.baseUrl,
    model,
    dimensions: Number.isFinite(dimensions) && dimensions > 0 ? Math.floor(dimensions) : DEFAULT_EMBED_DIMENSIONS,
    endpoint: `${studio.baseUrl}/embeddings`,
  };
}

/**
 * Hybrid local-first, cloud-escalation decision (steal: cheap local, escalate
 * only when needed — without shipping PII blindly to Model Studio).
 */
function decideHybridQwenRoute(context = {}) {
  const sensitive = Boolean(context.sensitive || context.hasPii || context.hasSecrets);
  const complex = Boolean(context.complex || context.longHorizon || context.failedLocalAttempts > 0);
  const localAvailable = context.localAvailable !== false;
  const cloudConfigured = Boolean(
    context.cloudConfigured
    || buildQwenModelStudioConfig({ env: context.env || process.env }).isConfigured,
  );

  if (sensitive && !context.allowCloudOnSensitive) {
    return {
      route: 'local-only',
      model: context.localModel || null,
      escalate: false,
      reason: 'Sensitive payload — keep local; do not escalate to Model Studio.',
    };
  }

  if (localAvailable && !complex) {
    return {
      route: 'local-first',
      model: context.localModel || null,
      escalate: false,
      reason: 'Local path sufficient for non-complex work.',
    };
  }

  if (cloudConfigured && complex) {
    const role = resolveQwenRoleRoute(context.workload || 'long-trace-review', {
      env: context.env || process.env,
    });
    return {
      route: 'cloud-escalate',
      model: role.model,
      candidateId: role.candidateId,
      escalate: true,
      reason: role.reason,
      requiresBudgetApproval: true,
    };
  }

  return {
    route: localAvailable ? 'local-first' : 'blocked',
    model: context.localModel || null,
    escalate: false,
    reason: cloudConfigured
      ? 'Cloud available but no escalation trigger.'
      : 'Model Studio not configured; stay local or fail closed.',
  };
}

/**
 * Token-plan style monthly budget gate (pure policy).
 */
function checkTokenPlanBudget(options = {}) {
  const monthlyBudgetUsd = Number(options.monthlyBudgetUsd ?? process.env.THUMBGATE_QWEN_MONTHLY_BUDGET_USD ?? 18);
  const spentUsd = Number(options.spentUsd || 0);
  const estimatedCostUsd = Number(options.estimatedCostUsd || 0);
  const budget = Number.isFinite(monthlyBudgetUsd) && monthlyBudgetUsd > 0 ? monthlyBudgetUsd : 18;
  const spent = Number.isFinite(spentUsd) ? Math.max(0, spentUsd) : 0;
  const estimate = Number.isFinite(estimatedCostUsd) ? Math.max(0, estimatedCostUsd) : 0;
  const projected = spent + estimate;
  const remaining = budget - spent;
  const utilization = budget > 0 ? projected / budget : 1;

  let action = 'allow';
  if (projected > budget) action = 'block';
  else if (utilization >= 0.85) action = 'warn';

  return {
    action,
    monthlyBudgetUsd: budget,
    spentUsd: spent,
    estimatedCostUsd: estimate,
    projectedUsd: projected,
    remainingUsd: remaining,
    utilization,
    reason: action === 'block'
      ? 'Projected Model Studio spend exceeds monthly Token Plan budget.'
      : action === 'warn'
        ? 'Approaching Token Plan budget (85%+ utilization).'
        : 'Within Token Plan budget.',
  };
}

function validateQwenEgressGate(actionPayload = {}) {
  const url = String(actionPayload.url || actionPayload.endpoint || '');
  const isQwenEgress = /dashscope(-intl)?\.aliyuncs\.com/i.test(url);

  if (!isQwenEgress) {
    return { isMatch: false, action: 'allow' };
  }

  const budget = checkTokenPlanBudget({
    estimatedCostUsd: actionPayload.estimatedCostUsd,
    spentUsd: actionPayload.spentUsd,
    monthlyBudgetUsd: actionPayload.monthlyBudgetUsd,
  });

  if (budget.action === 'block' && !actionPayload.hasBudgetApproval) {
    return {
      isMatch: true,
      action: 'block',
      reason: budget.reason,
      budget,
    };
  }

  if (actionPayload.hasBudgetApproval) {
    return {
      isMatch: true,
      action: 'allow',
      reason: 'Qwen Model Studio egress approved with budget evidence.',
      budget,
    };
  }

  return {
    isMatch: true,
    action: budget.action === 'warn' ? 'warn' : 'warn',
    reason: 'Auditing Qwen Model Studio egress for telemetry and cost control.',
    budget,
  };
}

module.exports = {
  MODEL_STUDIO_DEFAULT_BASE_URL,
  DEFAULT_EMBED_MODEL,
  DEFAULT_EMBED_DIMENSIONS,
  QWEN_MODELS,
  WORKLOAD_ROLE_ROUTES,
  buildQwenModelStudioConfig,
  resolveQwenRoleRoute,
  buildLiteLLMProviderEnv,
  buildQwenEmbeddingConfig,
  decideHybridQwenRoute,
  checkTokenPlanBudget,
  validateQwenEgressGate,
};
