'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MODEL_STUDIO_DEFAULT_BASE_URL,
  QWEN_MODELS,
  buildQwenModelStudioConfig,
  validateQwenEgressGate,
} = require('../adapters/qwen');

test('adapters/qwen exports canonical constants', () => {
  assert.equal(MODEL_STUDIO_DEFAULT_BASE_URL, 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1');
  assert.equal(QWEN_MODELS.QWEN_3_8_MAX, 'qwen3.8-max');
  assert.equal(QWEN_MODELS.QWEN_3_7_PLUS, 'qwen3.7-plus');
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

test('validateQwenEgressGate detects and audits Model Studio API calls', () => {
  const match = validateQwenEgressGate({
    url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
  });

  assert.equal(match.isMatch, true);
  assert.equal(match.action, 'warn');

  const nonMatch = validateQwenEgressGate({
    url: 'https://api.openai.com/v1/chat/completions',
  });

  assert.equal(nonMatch.isMatch, false);
  assert.equal(nonMatch.action, 'allow');
});
