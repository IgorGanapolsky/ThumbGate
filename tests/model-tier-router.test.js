'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  TIERS,
  classifyTask,
  shouldEscalate,
  FrontierBudget,
  recommendExecutionPlan,
  inferProvider,
  normalizeGenerationResult,
  resolveGenerationTarget,
  createOpenAiCompatibleAdapter,
  createDefaultGenerationAdapters,
  createJsonlTelemetrySink,
  executeRoutedGeneration,
  evaluateRoutingHoldout,
} = require('../scripts/model-tier-router');

const config = require('../config/model-tiers.json');

// ---------------------------------------------------------------------------
// classifyTask — nano tier
// ---------------------------------------------------------------------------

test('classifyTask routes classification → nano', () => {
  const r = classifyTask({ type: 'classification' });
  assert.equal(r.tier, 'nano');
  assert.equal(r.escalated, false);
});

test('classifyTask routes extraction → nano', () => {
  const r = classifyTask({ type: 'extraction' });
  assert.equal(r.tier, 'nano');
});

test('classifyTask routes labeling → nano', () => {
  const r = classifyTask({ type: 'labeling' });
  assert.equal(r.tier, 'nano');
});

test('classifyTask routes summarization → nano', () => {
  const r = classifyTask({ type: 'summarization' });
  assert.equal(r.tier, 'nano');
});

test('classifyTask routes ranking → nano', () => {
  const r = classifyTask({ type: 'ranking' });
  assert.equal(r.tier, 'nano');
});

// ---------------------------------------------------------------------------
// classifyTask — mini tier
// ---------------------------------------------------------------------------

test('classifyTask routes code-edit → mini', () => {
  const r = classifyTask({ type: 'code-edit' });
  assert.equal(r.tier, 'mini');
  assert.equal(r.escalated, false);
});

test('classifyTask routes test-generation → mini', () => {
  const r = classifyTask({ type: 'test-generation' });
  assert.equal(r.tier, 'mini');
});

test('classifyTask routes review → mini', () => {
  const r = classifyTask({ type: 'review' });
  assert.equal(r.tier, 'mini');
});

// ---------------------------------------------------------------------------
// classifyTask — frontier tier
// ---------------------------------------------------------------------------

test('classifyTask routes architecture → frontier', () => {
  const r = classifyTask({ type: 'architecture' });
  assert.equal(r.tier, 'frontier');
  assert.equal(r.escalated, false);
});

test('classifyTask routes cross-file → frontier', () => {
  const r = classifyTask({ type: 'cross-file' });
  assert.equal(r.tier, 'frontier');
});

// ---------------------------------------------------------------------------
// classifyTask — escalation overrides
// ---------------------------------------------------------------------------

test('classifyTask escalates to frontier when context > 200k', () => {
  const r = classifyTask({ type: 'code-edit', contextTokens: 250000 });
  assert.equal(r.tier, 'frontier');
  assert.equal(r.escalated, true);
  assert.ok(r.reason.includes('250000'));
});

test('classifyTask escalates high risk + 2 retries to frontier', () => {
  const r = classifyTask({ type: 'code-edit', riskLevel: 'high', retryCount: 2 });
  assert.equal(r.tier, 'frontier');
  assert.equal(r.escalated, true);
});

test('classifyTask escalates architecture tag to frontier', () => {
  const r = classifyTask({ type: 'code-edit', tags: ['cross-file'] });
  assert.equal(r.tier, 'frontier');
  assert.equal(r.escalated, true);
});

test('classifyTask does NOT escalate high risk with only 1 retry', () => {
  const r = classifyTask({ type: 'code-edit', riskLevel: 'high', retryCount: 1 });
  assert.equal(r.tier, 'mini');
  assert.equal(r.escalated, false);
});

// ---------------------------------------------------------------------------
// classifyTask — unknown type
// ---------------------------------------------------------------------------

test('classifyTask defaults unknown type to mini', () => {
  const r = classifyTask({ type: 'banana-split' });
  assert.equal(r.tier, 'mini');
  assert.equal(r.escalated, false);
  assert.ok(r.reason.includes('unknown'));
});

// ---------------------------------------------------------------------------
// FrontierBudget — canSpend
// ---------------------------------------------------------------------------

test('FrontierBudget.canSpend returns true when under cap', () => {
  const budget = new FrontierBudget({ tokenCap: 100000 });
  const r = budget.canSpend(50000, 'architecture refactor');
  assert.equal(r.allowed, true);
  assert.equal(r.remaining, 100000);
});

test('FrontierBudget.canSpend returns false when over cap', () => {
  const budget = new FrontierBudget({ tokenCap: 100000 });
  const r = budget.canSpend(150000, 'huge task');
  assert.equal(r.allowed, false);
  assert.equal(r.remaining, 100000);
});

test('FrontierBudget.canSpend rejects missing reason when requireReason=true', () => {
  const budget = new FrontierBudget({ requireReason: true });
  const r = budget.canSpend(1000);
  assert.equal(r.allowed, false);
  assert.ok(r.reason.includes('reason is required'));
});

// ---------------------------------------------------------------------------
// FrontierBudget — spend
// ---------------------------------------------------------------------------

test('FrontierBudget.spend deducts correctly and logs reason', () => {
  const budget = new FrontierBudget({ tokenCap: 100000 });
  const r = budget.spend(30000, 'cross-file refactor');
  assert.equal(r.success, true);
  assert.equal(r.spent, 30000);
  assert.equal(r.remaining, 70000);
  assert.ok(r.reason.includes('cross-file refactor'));
});

test('FrontierBudget.spend refuses when over budget', () => {
  const budget = new FrontierBudget({ tokenCap: 10000 });
  const r = budget.spend(50000, 'too expensive');
  assert.equal(r.success, false);
  assert.equal(r.spent, 0);
});

test('FrontierBudget.spend tracks multiple invocations', () => {
  const budget = new FrontierBudget({ tokenCap: 100000 });
  budget.spend(10000, 'first');
  budget.spend(20000, 'second');
  const s = budget.status();
  assert.equal(s.spent, 30000);
  assert.equal(s.invocations, 2);
});

// ---------------------------------------------------------------------------
// FrontierBudget — status
// ---------------------------------------------------------------------------

test('FrontierBudget.status returns correct remaining', () => {
  const budget = new FrontierBudget({ tokenCap: 500000 });
  budget.spend(100000, 'initial');
  const s = budget.status();
  assert.equal(s.spent, 100000);
  assert.equal(s.remaining, 400000);
  assert.equal(s.cap, 500000);
  assert.equal(s.invocations, 1);
});

// ---------------------------------------------------------------------------
// FrontierBudget — reset
// ---------------------------------------------------------------------------

test('FrontierBudget.reset clears spent', () => {
  const budget = new FrontierBudget({ tokenCap: 500000 });
  budget.spend(200000, 'session work');
  budget.reset();
  const s = budget.status();
  assert.equal(s.spent, 0);
  assert.equal(s.remaining, 500000);
  assert.equal(s.invocations, 0);
});

// ---------------------------------------------------------------------------
// shouldEscalate
// ---------------------------------------------------------------------------

test('shouldEscalate returns escalation for two consecutive mini failures', () => {
  const task = { type: 'code-edit' };
  const history = [
    { tier: 'mini', success: false },
    { tier: 'mini', success: false },
  ];
  const r = shouldEscalate(task, history);
  assert.equal(r.escalate, true);
  assert.equal(r.from, 'mini');
  assert.equal(r.to, 'frontier');
  assert.ok(r.reason.includes('consecutive'));
});

test('shouldEscalate returns no escalation for single failure', () => {
  const task = { type: 'code-edit' };
  const history = [{ tier: 'mini', success: false }];
  const r = shouldEscalate(task, history);
  assert.equal(r.escalate, false);
});

test('shouldEscalate returns no escalation when last attempt succeeded', () => {
  const task = { type: 'code-edit' };
  const history = [
    { tier: 'mini', success: false },
    { tier: 'mini', success: true },
  ];
  const r = shouldEscalate(task, history);
  assert.equal(r.escalate, false);
});

test('shouldEscalate detects context-based escalation', () => {
  const task = { type: 'code-edit', contextTokens: 300000 };
  const r = shouldEscalate(task, []);
  // classifyTask already routes to frontier for >200k, so shouldEscalate
  // won't double-escalate — it checks currentTier !== 'frontier'
  // But classifyTask already returns frontier, so escalate is false
  assert.equal(r.escalate, false);
});

// ---------------------------------------------------------------------------
// Config congruence
// ---------------------------------------------------------------------------

test('TIERS constants match config/model-tiers.json', () => {
  assert.equal(TIERS.nano.maxContext, config.tiers.nano.maxContextTokens);
  assert.equal(TIERS.mini.maxContext, config.tiers.mini.maxContextTokens);
  assert.equal(TIERS.frontier.maxContext, config.tiers.frontier.maxContextTokens);
  assert.equal(TIERS.nano.costMultiplier, config.tiers.nano.costMultiplier);
  assert.equal(TIERS.mini.costMultiplier, config.tiers.mini.costMultiplier);
  assert.equal(TIERS.frontier.costMultiplier, config.tiers.frontier.costMultiplier);
});

test('config version is 1', () => {
  assert.equal(config.version, 1);
});

test('frontier tier is pinned to GPT-5.5 while cheaper tiers stay explicit', () => {
  assert.equal(config.tiers.frontier.label, 'GPT-5.5');
  assert.equal(config.tiers.frontier.modelId, 'gpt-5.5');
  assert.equal(config.tiers.mini.modelId, 'gpt-5.4-mini');
  assert.equal(config.tiers.nano.modelId, 'gpt-5.4-nano');
});

test('config escalation threshold matches TIERS.mini.maxContext', () => {
  assert.equal(config.escalationRules.contextThreshold, TIERS.mini.maxContext);
});

test('recommendExecutionPlan combines tier escalation with IndexCache-aware backend recommendation', () => {
  const plan = recommendExecutionPlan({
    type: 'code-edit',
    contextTokens: 260000,
    tags: ['retrieval-heavy'],
  }, {
    THUMBGATE_PROVIDER_MODE: 'local',
    THUMBGATE_LOCAL_MODEL_FAMILY: 'deepseek-v3',
    THUMBGATE_LOCAL_MODEL_SERVER: 'sglang',
    THUMBGATE_INDEXCACHE_ENABLED: 'true',
  });

  assert.equal(plan.tier, 'frontier');
  assert.equal(plan.indexCacheEligible, true);
  assert.equal(plan.indexCacheEnabled, true);
  assert.equal(plan.recommendationClass, 'indexcache_active');
  assert.ok(plan.reason.includes('IndexCache-ready'));
});

// ---------------------------------------------------------------------------
// GLM 5.1 localFrontier routing
// ---------------------------------------------------------------------------

test('TIERS includes localFrontier with zero cost multiplier', () => {
  assert.equal(TIERS.localFrontier.costMultiplier, 0.0);
  assert.equal(TIERS.localFrontier.maxContext, TIERS.frontier.maxContext);
});

test('recommendExecutionPlan routes frontier tasks to localFrontier when local GLM is active', () => {
  const plan = recommendExecutionPlan({
    type: 'architecture',
  }, {
    THUMBGATE_PROVIDER_MODE: 'local',
    THUMBGATE_LOCAL_MODEL_FAMILY: 'glm-z1',
    THUMBGATE_LOCAL_MODEL_SERVER: 'vllm',
  });

  assert.equal(plan.tier, 'localFrontier');
  assert.equal(plan.providerMode, 'local');
});

test('recommendExecutionPlan does NOT use localFrontier for non-frontier tasks with GLM', () => {
  const plan = recommendExecutionPlan({
    type: 'code-edit',
  }, {
    THUMBGATE_PROVIDER_MODE: 'local',
    THUMBGATE_LOCAL_MODEL_FAMILY: 'glm-z1',
    THUMBGATE_LOCAL_MODEL_SERVER: 'vllm',
  });

  assert.equal(plan.tier, 'mini');
});

test('recommendExecutionPlan keeps frontier tier when no local GLM backend', () => {
  const plan = recommendExecutionPlan({
    type: 'architecture',
  }, {});

  assert.equal(plan.tier, 'frontier');
});

test('execution plan calls the architecture risk-aware routing, not MoE', () => {
  const plan = recommendExecutionPlan({ type: 'review' }, {});
  assert.equal(plan.architecture, 'risk-aware-model-routing');
  assert.equal(plan.mixtureOfExperts, false);
});

test('provider inference distinguishes local, OpenAI, Anthropic, Gemini, and custom models', () => {
  assert.equal(inferProvider('local-model', 'localFrontier'), 'openai-compatible');
  assert.equal(inferProvider('gpt-5.5', 'frontier'), 'openai');
  assert.equal(inferProvider('o3', 'frontier'), 'openai');
  assert.equal(inferProvider('claude-opus-4', 'frontier'), 'anthropic');
  assert.equal(inferProvider('gemini-3-pro', 'frontier'), 'gemini');
  assert.equal(inferProvider('vertex-gemini', 'frontier'), 'gemini');
  assert.equal(inferProvider('private-router-v1', 'mini'), 'custom');
});

test('generation result normalization supports text adapters and rejects empty results', () => {
  assert.deepEqual(normalizeGenerationResult('ok', {
    model: 'gpt-test',
    provider: 'openai',
  }), {
    text: 'ok',
    model: 'gpt-test',
    provider: 'openai',
    usage: null,
    costCents: null,
  });
  assert.throws(() => normalizeGenerationResult(null), /returned no result/);
  assert.deepEqual(normalizeGenerationResult({ text: 42 }, {
    model: 'fallback-model',
    provider: 'custom',
  }), {
    text: '42',
    model: 'fallback-model',
    provider: 'custom',
    usage: null,
    costCents: null,
  });
  assert.equal(normalizeGenerationResult({ text: 'unknown', costCents: null }).costCents, null);
  assert.equal(normalizeGenerationResult({ text: 'unknown' }).costCents, null);
  assert.equal(normalizeGenerationResult({ text: 'known', costCents: '0.25' }).costCents, 0.25);
});

test('local execution target uses the activated model family instead of a hard-coded model', () => {
  const env = {
    THUMBGATE_PROVIDER_MODE: 'local',
    THUMBGATE_LOCAL_MODEL_FAMILY: 'glm-z1',
  };
  const plan = recommendExecutionPlan({ type: 'architecture' }, env);
  const target = resolveGenerationTarget(
    plan,
    { type: 'architecture' },
    config.tiers[plan.tier],
    {},
    env,
  );
  assert.equal(target.provider, 'openai-compatible');
  assert.equal(target.model, 'glm-z1-9b');
  assert.notEqual(target.model, 'glm-5.1');
});

test('default adapters share the OpenAI-compatible contract and JSONL telemetry is durable', async (t) => {
  const adapters = createDefaultGenerationAdapters({
    env: { THUMBGATE_LOCAL_MODEL_BASE_URL: 'http://127.0.0.1:9000/v1' },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'local-ok' } }] }),
    }),
  });
  assert.equal(adapters.openai, adapters['openai-compatible']);
  const local = await adapters['openai-compatible']({
    request: { messages: [{ role: 'user', content: 'hello' }] },
    model: 'local-model',
    provider: 'openai-compatible',
  });
  assert.equal(local.text, 'local-ok');
  assert.equal(local.model, 'local-model');

  assert.throws(() => createJsonlTelemetrySink(), /file path is required/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-route-telemetry-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'nested', 'routes.jsonl');
  const sink = createJsonlTelemetrySink(file);
  sink({ tier: 'nano', outcome: 'success' });
  assert.deepEqual(
    fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line)),
    [{ tier: 'nano', outcome: 'success' }],
  );
});

test('OpenAI-compatible adapter enforces credentials and reports upstream HTTP failures', async () => {
  const noKey = createOpenAiCompatibleAdapter({
    env: {},
    fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
  });
  await assert.rejects(
    noKey({ request: {}, model: 'gpt-test', provider: 'openai' }),
    /OPENAI_API_KEY is required/,
  );

  const upstreamFailure = createOpenAiCompatibleAdapter({
    env: { OPENAI_API_KEY: 'test-key' },
    fetchImpl: async () => ({ ok: false, status: 429 }),
  });
  await assert.rejects(
    upstreamFailure({ request: { prompt: 'hello' }, model: 'gpt-test', provider: 'openai' }),
    /HTTP 429/,
  );
});

test('executeRoutedGeneration dispatches the selected adapter and emits prompt-free telemetry', async () => {
  const events = [];
  const result = await executeRoutedGeneration({
    type: 'classification',
    riskLevel: 'low',
  }, {
    userPrompt: 'secret prompt body must not enter telemetry',
  }, {
    adapters: {
      openai: async ({ model, provider }) => ({
        text: 'classified',
        model,
        provider,
        usage: { prompt_tokens: 11, completion_tokens: 3 },
        costCents: 0.2,
      }),
    },
    telemetrySink: (event) => events.push(event),
    now: (() => {
      const times = [1000, 1025];
      return () => times.shift();
    })(),
  });

  assert.equal(result.text, 'classified');
  assert.equal(result.route.tier, 'nano');
  assert.equal(result.telemetry.outcome, 'success');
  assert.equal(result.telemetry.inputTokens, 11);
  assert.equal(result.telemetry.outputTokens, 3);
  assert.equal(result.telemetry.latencyMs, 25);
  assert.equal(events.length, 1);
  assert.equal(JSON.stringify(events).includes('secret prompt body'), false);
});

test('privacy-local execution cannot fall through to a configured cloud provider', async () => {
  let fetchedUrl = null;
  const result = await executeRoutedGeneration({
    type: 'classification',
    privacyRoute: 'local',
  }, {
    userPrompt: 'private prompt',
  }, {
    env: {
      THUMBGATE_PROVIDER_MODE: 'local',
      THUMBGATE_LOCAL_MODEL_FAMILY: 'glm-z1',
      THUMBGATE_LOCAL_MODEL_BASE_URL: 'http://127.0.0.1:9000/v1',
      OPENAI_API_KEY: 'cloud-key-must-not-be-used',
    },
    fetchImpl: async (url, options) => {
      fetchedUrl = url;
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(JSON.parse(options.body).model, 'glm-z1-9b');
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'local-only' } }] }),
      };
    },
  });
  assert.equal(fetchedUrl, 'http://127.0.0.1:9000/v1/chat/completions');
  assert.equal(result.provider, 'openai-compatible');
  assert.equal(result.model, 'glm-z1-9b');
});

test('privacy-local execution fails closed without a local backend or with a cloud override', async () => {
  await assert.rejects(
    executeRoutedGeneration({ type: 'classification', privacyRoute: 'local' }, {}, {
      env: { OPENAI_API_KEY: 'cloud-key-must-not-be-used' },
    }),
    /requires a configured local inference backend/,
  );

  await assert.rejects(
    executeRoutedGeneration({ type: 'classification', privacyRoute: 'local' }, {}, {
      env: {
        THUMBGATE_PROVIDER_MODE: 'local',
        THUMBGATE_LOCAL_MODEL_FAMILY: 'deepseek-v3',
        THUMBGATE_LOCAL_MODEL_BASE_URL: 'http://127.0.0.1:9000/v1',
      },
      providerOverrides: { nano: 'openai' },
    }),
    /cannot use a cloud provider override/,
  );
});

test('OpenAI-compatible adapter uses the selected model and standard endpoint contract', async () => {
  let observed;
  const adapter = createOpenAiCompatibleAdapter({
    env: { OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: 'https://models.example/v1/' },
    fetchImpl: async (url, options) => {
      observed = { url, options };
      return {
        ok: true,
        json: async () => ({
          model: 'gpt-test',
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 2, completion_tokens: 1 },
        }),
      };
    },
  });
  const result = await adapter({
    request: { userPrompt: 'hello' },
    model: 'gpt-test',
    provider: 'openai',
  });

  assert.equal(observed.url, 'https://models.example/v1/chat/completions');
  assert.equal(JSON.parse(observed.options.body).model, 'gpt-test');
  assert.equal(result.text, 'ok');
  assert.equal(result.costCents, null);
});

test('failed routed generation emits a redacted error outcome', async () => {
  const events = [];
  await assert.rejects(
    executeRoutedGeneration({ type: 'review' }, { userPrompt: 'private' }, {
      adapters: {
        openai: async () => {
          throw new Error('request failed with sk-testsecretvalue1234567890');
        },
      },
      telemetrySink: (event) => events.push(event),
    }),
    /request failed/,
  );
  assert.equal(events[0].outcome, 'error');
  assert.equal(events[0].error.includes('sk-testsecretvalue'), false);
  assert.match(events[0].error, /REDACTED/);
});

test('routing holdout reports quality regret and cost against a fixed baseline', async () => {
  const cases = [
    { id: 'simple', expected: 'safe', task: { type: 'classification' } },
    { id: 'complex', expected: 'correct', task: { type: 'architecture' } },
  ];
  const report = await evaluateRoutingHoldout(cases, {
    routedGenerate: async (testCase) => ({
      text: testCase.expected,
      model: testCase.id === 'simple' ? 'nano' : 'frontier',
      route: { tier: testCase.task.type === 'classification' ? 'nano' : 'frontier' },
      costCents: testCase.id === 'simple' ? 0.1 : 0.8,
      telemetry: { latencyMs: 10 },
    }),
    fixedGenerate: async (testCase) => ({
      text: testCase.expected,
      model: 'fixed-frontier',
      costCents: 1,
      telemetry: { latencyMs: 25 },
    }),
    scoreOutput: (output, testCase) => output.text === testCase.expected ? 1 : 0,
    maxQualityRegret: 0,
  });

  assert.equal(report.caseCount, 2);
  assert.equal(report.judgeStage, 'external-scorer');
  assert.equal(report.metrics.averageQualityRegret, 0);
  assert.equal(report.metrics.worstCaseQualityRegret, 0);
  assert.equal(report.metrics.routedCostCents, 0.45);
  assert.equal(report.metrics.fixedCostCents, 1);
  assert.equal(report.metrics.costSavingsCents, 0.55);
  assert.deepEqual(report.metrics.costCoverage, { measuredCases: 2, totalCases: 2 });
  assert.equal(report.passed, true);
});

test('routing holdout refuses to self-judge without an external scorer', async () => {
  await assert.rejects(
    evaluateRoutingHoldout([{ id: 'one' }], { fixedGenerate: async () => ({ text: 'x' }) }),
    /scoreOutput is required/,
  );
});

test('routing holdout fails on one regressed case even when averages cancel out', async () => {
  const cases = [{ id: 'regression' }, { id: 'improvement' }];
  const routedScores = { regression: 0, improvement: 1 };
  const fixedScores = { regression: 1, improvement: 0 };
  const report = await evaluateRoutingHoldout(cases, {
    routedGenerate: async (testCase) => ({ text: String(routedScores[testCase.id]) }),
    fixedGenerate: async (testCase) => ({ text: String(fixedScores[testCase.id]) }),
    scoreOutput: (output) => Number(output.text),
    maxQualityRegret: 0,
  });

  assert.equal(report.metrics.averageQualityRegret, 0);
  assert.equal(report.metrics.worstCaseQualityRegret, 1);
  assert.equal(report.passed, false);
});
