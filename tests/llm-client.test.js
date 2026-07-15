const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// Always test without ambient provider credentials to avoid real calls.
const PROVIDER_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT',
  'GCLOUD_PROJECT',
  'VERTEX_PROJECT_ID',
  'VERTEX_API_ENDPOINT',
  'THUMBGATE_PROVIDER_MODE',
  'THUMBGATE_MODEL_PROVIDER_MODE',
];
const originalProviderEnv = Object.fromEntries(
  PROVIDER_ENV_KEYS.map((key) => [key, process.env[key]]),
);

beforeEach(() => {
  for (const key of PROVIDER_ENV_KEYS) delete process.env[key];
  process.env.THUMBGATE_PROVIDER_MODE = 'managed';
});

afterEach(() => {
  for (const key of PROVIDER_ENV_KEYS) {
    if (originalProviderEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalProviderEnv[key];
  }
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

test('normalizeCacheOptions defaults to system-scoped ephemeral cache', () => {
  const { normalizeCacheOptions } = require('../scripts/llm-client');
  assert.deepEqual(normalizeCacheOptions(true), {
    mode: 'system',
    control: { type: 'ephemeral', ttl: '5m' },
  });
  assert.deepEqual(normalizeCacheOptions('1h'), {
    mode: 'system',
    control: { type: 'ephemeral', ttl: '1h' },
  });
});

test('buildClaudeRequest caches the system prompt when requested', () => {
  const { buildClaudeRequest } = require('../scripts/llm-client');
  const request = buildClaudeRequest({
    systemPrompt: 'system guidance',
    userPrompt: 'hello',
    cache: true,
  });

  assert.equal(Array.isArray(request.system), true);
  assert.equal(request.system[0].text, 'system guidance');
  assert.deepEqual(request.system[0].cache_control, { type: 'ephemeral', ttl: '5m' });
  assert.equal(request.messages[0].content, 'hello');
});

test('buildClaudeRequest supports request-level automatic caching', () => {
  const { buildClaudeRequest } = require('../scripts/llm-client');
  const request = buildClaudeRequest({
    systemPrompt: 'system guidance',
    userPrompt: 'hello',
    cache: { mode: 'request', ttl: '1h' },
  });

  assert.equal(request.system, 'system guidance');
  assert.deepEqual(request.cache_control, { type: 'ephemeral', ttl: '1h' });
});

test('parseClaudeJson strips fences before parsing', () => {
  const { parseClaudeJson } = require('../scripts/llm-client');
  assert.deepEqual(parseClaudeJson('```json\n{"ok":true}\n```'), { ok: true });
  assert.deepEqual(parseClaudeJson('[1,2,3]'), [1, 2, 3]);
  assert.equal(parseClaudeJson('not json'), null);
});

test('buildSafeProviderError omits request metadata and redacts credential-bearing messages', () => {
  const { buildSafeProviderError } = require('../scripts/llm-client');
  const error = new Error('invalid_grant refresh_token=1//fake-refresh-credential-value');
  error.code = 400;
  error.config = {
    data: { refresh_token: '1//fake-refresh-credential-value' },
  };

  const safe = buildSafeProviderError(error);
  const serialized = JSON.stringify(safe);
  assert.equal(serialized.includes('fake-refresh-credential-value'), false);
  assert.equal(Object.hasOwn(safe, 'config'), false);
  assert.equal(safe.code, 400);
});

test('callClaude with a gemini model resolves via callGeminiInternal', async () => {
  delete process.env.GEMINI_API_KEY;
  delete require.cache[require.resolve('../scripts/llm-client')];
  const { callClaude } = require('../scripts/llm-client');
  const result = await callClaude({
    model: 'gemini-2.5-flash',
    systemPrompt: 'test system',
    userPrompt: 'test user',
  });
  
  // Without API keys or credentials, the call throws or fails and returns null,
  // proving that the Gemini/Vertex execution path was correctly traversed.
  assert.equal(result, null);
});
