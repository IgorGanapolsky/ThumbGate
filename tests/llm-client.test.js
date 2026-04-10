const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// Always test without API key to avoid real calls
const originalKey = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  if (originalKey) process.env.ANTHROPIC_API_KEY = originalKey;
  else delete process.env.ANTHROPIC_API_KEY;
});

test('isAvailable returns false without ANTHROPIC_API_KEY', () => {
  delete process.env.ANTHROPIC_API_KEY;
  // Re-require to get fresh state
  delete require.cache[require.resolve('../scripts/llm-client')];
  const { isAvailable } = require('../scripts/llm-client');
  assert.equal(isAvailable(), false);
});

test('isAvailable returns true with ANTHROPIC_API_KEY', () => {
  process.env.ANTHROPIC_API_KEY = 'sk-test-fake-key';
  delete require.cache[require.resolve('../scripts/llm-client')];
  const { isAvailable } = require('../scripts/llm-client');
  assert.equal(isAvailable(), true);
});

test('callClaude returns null without API key', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  delete require.cache[require.resolve('../scripts/llm-client')];
  const { callClaude } = require('../scripts/llm-client');
  const result = await callClaude({ systemPrompt: 'test', userPrompt: 'test' });
  assert.equal(result, null);
});

test('stripCodeFences removes json fences', () => {
  const { stripCodeFences } = require('../scripts/llm-client');
  assert.equal(stripCodeFences('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(stripCodeFences('```\n{"a":1}\n```'), '{"a":1}');
  assert.equal(stripCodeFences('{"a":1}'), '{"a":1}');
  assert.equal(stripCodeFences('  {"a":1}  '), '{"a":1}');
});

test('stripCodeFences handles null/empty', () => {
  const { stripCodeFences } = require('../scripts/llm-client');
  assert.equal(stripCodeFences(null), null);
  assert.equal(stripCodeFences(''), '');
});

test('MODELS constants are defined', () => {
  const { MODELS } = require('../scripts/llm-client');
  assert.ok(MODELS.FAST);
  assert.ok(MODELS.SMART);
  assert.ok(MODELS.FAST.includes('haiku'));
});
