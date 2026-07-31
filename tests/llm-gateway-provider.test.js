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
