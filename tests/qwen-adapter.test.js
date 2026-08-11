'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MODEL_STUDIO_DEFAULT_BASE_URL,
  QWEN_MODELS,
  buildQwenModelStudioConfig,
  resolveQwenRoleRoute,
  buildLiteLLMProviderEnv,
  buildQwenEmbeddingConfig,
  decideHybridQwenRoute,
  checkTokenPlanBudget,
  validateQwenEgressGate,
} = require('../adapters/qwen');

test('adapters/qwen exports canonical constants', () => {
  assert.equal(MODEL_STUDIO_DEFAULT_BASE_URL, 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1');
  assert.equal(QWEN_MODELS.QWEN_3_8_MAX, 'qwen3.8-max');
  assert.equal(QWEN_MODELS.QWEN_3_7_PLUS, 'qwen3.7-plus');
  assert.equal(QWEN_MODELS.QWEN_3_6_FLASH, 'qwen3.6-flash');
  assert.equal(QWEN_MODELS.TEXT_EMBEDDING_V4, 'text-embedding-v4');
});

test('buildQwenModelStudioConfig builds valid OpenAI-compatible configuration', () => {
  const config = buildQwenModelStudioConfig({
    apiKey: 'test-dashscope-key',
    model: QWEN_MODELS.QWEN_3_8_MAX,
  });

  assert.equal(config.apiKey, 'test-dashscope-key');
  assert.equal(config.baseUrl, MODEL_STUDIO_DEFAULT_BASE_URL);
  assert.equal(config.model, 'qwen3.8-max');
  assert.equal(config.isConfigured, true);
  assert.equal(config.isOpenAICompatible, true);
});

test('resolveQwenRoleRoute maps workloads to Flash/Plus/Max tiers', () => {
  const gate = resolveQwenRoleRoute('pretool-gating', { env: {} });
  assert.equal(gate.model, 'qwen3.6-flash');
  assert.equal(gate.candidateId, 'alibaba/qwen3.6-flash');

  const heavy = resolveQwenRoleRoute('long-trace-review', { env: {} });
  assert.equal(heavy.model, 'qwen3.8-max');

  const forced = resolveQwenRoleRoute('pretool-gating', {
    env: { THUMBGATE_QWEN_MODEL: 'qwen3.7-plus' },
  });
  assert.equal(forced.model, 'qwen3.7-plus');
});

test('buildLiteLLMProviderEnv exposes OpenAI-compatible base without leaking secrets', () => {
  const envMap = buildLiteLLMProviderEnv({
    apiKey: 'sk-test',
    workload: 'cheap-fast-path',
  });
  assert.equal(envMap.OPENAI_BASE_URL, MODEL_STUDIO_DEFAULT_BASE_URL);
  assert.equal(envMap.LITELLM_MODEL, 'openai/qwen3.6-flash');
  assert.equal(envMap.OPENAI_API_KEY, '${DASHSCOPE_API_KEY}');
  assert.equal(envMap.configured, true);
});

test('decideHybridQwenRoute keeps sensitive work local and escalates complex work', () => {
  const local = decideHybridQwenRoute({
    sensitive: true,
    localAvailable: true,
    cloudConfigured: true,
  });
  assert.equal(local.route, 'local-only');
  assert.equal(local.escalate, false);

  const escalate = decideHybridQwenRoute({
    complex: true,
    localAvailable: true,
    cloudConfigured: true,
    workload: 'long-trace-review',
    env: { DASHSCOPE_API_KEY: 'k' },
  });
  assert.equal(escalate.route, 'cloud-escalate');
  assert.equal(escalate.model, 'qwen3.8-max');
  assert.equal(escalate.requiresBudgetApproval, true);
});

test('decideHybridQwenRoute uses local-first and fail-closed fallback routes', () => {
  const local = decideHybridQwenRoute({
    localAvailable: true,
    complexity: 'low',
    localModel: 'qwen-local',
  });
  assert.equal(local.route, 'local-first');
  assert.equal(local.model, 'qwen-local');

  const blocked = decideHybridQwenRoute({
    localAvailable: false,
    complexity: 'low',
    env: {},
  });
  assert.equal(blocked.route, 'blocked');
  assert.match(blocked.reason, /not configured/i);
});

test('checkTokenPlanBudget blocks over-budget Model Studio spend', () => {
  const ok = checkTokenPlanBudget({ monthlyBudgetUsd: 18, spentUsd: 2, estimatedCostUsd: 1 });
  assert.equal(ok.action, 'allow');

  const warn = checkTokenPlanBudget({ monthlyBudgetUsd: 10, spentUsd: 8, estimatedCostUsd: 1 });
  assert.equal(warn.action, 'warn');

  const block = checkTokenPlanBudget({ monthlyBudgetUsd: 10, spentUsd: 9, estimatedCostUsd: 2 });
  assert.equal(block.action, 'block');
});

test('validateQwenEgressGate detects Model Studio and enforces budget', () => {
  const match = validateQwenEgressGate({
    url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
  });
  assert.equal(match.isMatch, true);
  assert.equal(match.action, 'warn');

  const blocked = validateQwenEgressGate({
    url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    monthlyBudgetUsd: 5,
    spentUsd: 5,
    estimatedCostUsd: 1,
  });
  assert.equal(blocked.action, 'block');

  const approved = validateQwenEgressGate({
    url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
    monthlyBudgetUsd: 5,
    spentUsd: 5,
    estimatedCostUsd: 1,
    hasBudgetApproval: true,
  });
  assert.equal(approved.action, 'allow');

  const nonMatch = validateQwenEgressGate({
    url: 'https://api.openai.com/v1/chat/completions',
  });
  assert.equal(nonMatch.isMatch, false);
  assert.equal(nonMatch.action, 'allow');
});

test('buildQwenEmbeddingConfig enables dashscope text-embedding-v4 when key present', () => {
  const cfg = buildQwenEmbeddingConfig({
    env: {
      DASHSCOPE_API_KEY: 'k',
      THUMBGATE_EMBED_PROVIDER: 'dashscope',
    },
  });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.model, 'text-embedding-v4');
  assert.equal(cfg.provider, 'dashscope');
  assert.match(cfg.endpoint, /\/embeddings$/);
});
