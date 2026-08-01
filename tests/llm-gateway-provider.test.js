// tests/llm-gateway-provider.test.js
'use strict';

// Every LLM-dependent capability gated on ANTHROPIC_API_KEY and degraded to
// heuristics in silence when it was absent. An operator paying for GLM or Kimi
// through a local OpenAI-compatible gateway still got the heuristic path with no
// signal that the model tier was never consulted.
//
// These tests pin the contract. They are hermetic — no gateway required.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getGatewayConfig,
  isGatewayConfigured,
  describeInferenceAvailability,
  isAvailable,
  resolveGatewayModel,
  MODELS,
} = require('../scripts/llm-client');

test('gateway is opt-in: absent config means no gateway', () => {
  // A published install must never start firing requests at someone's localhost
  // just because a port happens to be open.
  assert.strictEqual(getGatewayConfig({}), null);
  assert.strictEqual(isGatewayConfigured({}), false);
});

test('gateway config derives from env, with a default model', () => {
  const cfg = getGatewayConfig({ THUMBGATE_LLM_GATEWAY_URL: 'http://127.0.0.1:4010/v1/' });
  assert.strictEqual(cfg.baseUrl, 'http://127.0.0.1:4010/v1', 'trailing slash is normalized');
  assert.strictEqual(cfg.model, 'glm-5.2');
});

test('gateway model is overridable', () => {
  const cfg = getGatewayConfig({
    THUMBGATE_LLM_GATEWAY_URL: 'http://127.0.0.1:4010/v1',
    THUMBGATE_LLM_GATEWAY_MODEL: 'kimi-code-k3',
  });
  assert.strictEqual(cfg.model, 'kimi-code-k3');
});

test('gateway dispatch ignores generic provider model IDs unless override is gateway-specific', () => {
  const config = {
    baseUrl: 'http://127.0.0.1:4010/v1',
    model: 'kimi-code-k3',
  };
  assert.strictEqual(resolveGatewayModel({ model: MODELS.FAST }, config), 'kimi-code-k3');
  assert.strictEqual(
    resolveGatewayModel({ model: MODELS.SMART, gatewayModel: 'glm-5.2' }, config),
    'glm-5.2',
  );
});

test('availability reports WHICH provider is live, not just a boolean', () => {
  // The whole point: callers reporting a scoring mode must be able to say
  // "deterministic because no provider" vs "model-backed via gateway".
  assert.deepStrictEqual(
    describeInferenceAvailability({ ANTHROPIC_API_KEY: 'x' }),
    { available: true, provider: 'anthropic' }
  );

  const viaGateway = describeInferenceAvailability({ THUMBGATE_LLM_GATEWAY_URL: 'http://127.0.0.1:4010/v1' });
  assert.strictEqual(viaGateway.provider, 'gateway');
  assert.strictEqual(viaGateway.model, 'glm-5.2');

  const none = describeInferenceAvailability({});
  assert.strictEqual(none.available, false);
  assert.strictEqual(none.provider, 'none');
  assert.match(none.reason, /ANTHROPIC_API_KEY/);
});

test('isAvailable is true for a gateway with no Anthropic key', () => {
  // The regression that mattered: this returned false, so six capabilities
  // concluded "no LLM" while a paid gateway sat one port away.
  assert.strictEqual(isAvailable({}), false);
  assert.strictEqual(isAvailable({ THUMBGATE_LLM_GATEWAY_URL: 'http://127.0.0.1:4010/v1' }), true);
});

// --- Review findings from #3138 (chatgpt-codex-connector) ---------------------
// Three real defects the reviewer caught, two of them pre-existing consumers
// that bypassed the abstraction and one regression this PR introduced.

test('gateway forwards a supplied message history instead of dropping it', () => {
  // Regression introduced by this PR: callGatewayInternal built messages from
  // systemPrompt/userPrompt only, so a caller passing `messages` had its whole
  // history discarded and one empty user message sent. The Anthropic path
  // preserves options.messages in buildClaudeRequest; the gateway must match.
  const { buildGatewayMessages } = require('../scripts/llm-client');
  const history = [
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'reply' },
    { role: 'user', content: 'second' },
  ];
  const built = buildGatewayMessages({ systemPrompt: 'sys', messages: history });
  assert.strictEqual(built.length, 4, 'system + 3 history entries');
  assert.deepStrictEqual(built.slice(1), history, 'history preserved verbatim');

  const single = buildGatewayMessages({ userPrompt: 'only' });
  assert.deepStrictEqual(single, [{ role: 'user', content: 'only' }]);
});

test('managed lesson runs report the model that actually ran', () => {
  // Was hard-coded to 'claude-haiku-4-5' off a boolean, so a gateway-backed run
  // persisted a manifest claiming Claude produced the lessons.
  const { describeInferenceAvailability } = require('../scripts/llm-client');
  const viaGateway = describeInferenceAvailability({
    THUMBGATE_LLM_GATEWAY_URL: 'http://127.0.0.1:4010/v1',
    THUMBGATE_LLM_GATEWAY_MODEL: 'kimi-code-k3',
  });
  assert.strictEqual(viaGateway.provider, 'gateway');
  assert.strictEqual(viaGateway.model, 'kimi-code-k3',
    'the manifest label must come from this, never a hard-coded vendor string');
});
