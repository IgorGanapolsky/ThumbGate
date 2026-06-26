'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const originalEnv = {
  OMLX_BASE_URL: process.env.OMLX_BASE_URL,
  OMLX_MODEL: process.env.OMLX_MODEL,
  THUMBGATE_OMLX_BASE_URL: process.env.THUMBGATE_OMLX_BASE_URL,
  THUMBGATE_OMLX_ENABLED: process.env.THUMBGATE_OMLX_ENABLED,
  THUMBGATE_OMLX_MODEL: process.env.THUMBGATE_OMLX_MODEL,
};
const originalFetch = global.fetch;

function resetModule() {
  delete require.cache[require.resolve('../scripts/llm-client')];
  delete require.cache[require.resolve('../scripts/omlx-smoke')];
}

test.beforeEach(() => {
  for (const key of Object.keys(originalEnv)) delete process.env[key];
  global.fetch = originalFetch;
  process.exitCode = undefined;
  resetModule();
});

test.afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value) process.env[key] = value;
    else delete process.env[key];
  }
  global.fetch = originalFetch;
  process.exitCode = undefined;
  resetModule();
});

test('parseArgs accepts json, live, chat, base URL, and model flags', () => {
  const { parseArgs } = require('../scripts/omlx-smoke');
  assert.deepEqual(parseArgs(['--json', '--require-live', '--chat', '--base-url', 'http://x/v1', '--model', 'local-model']), {
    json: true,
    requireLive: true,
    chat: true,
    baseUrl: 'http://x/v1',
    model: 'local-model',
  });
});

test('normalizeBaseUrl strips endpoint suffixes', () => {
  const { normalizeBaseUrl } = require('../scripts/omlx-smoke');
  assert.equal(normalizeBaseUrl('http://localhost:8000/v1/chat/completions/'), 'http://localhost:8000/v1');
  assert.equal(normalizeBaseUrl('http://localhost:8000/v1/models'), 'http://localhost:8000/v1');
});

test('extractModels reads OpenAI-compatible model payloads', () => {
  const { extractModels } = require('../scripts/omlx-smoke');
  assert.deepEqual(extractModels({
    data: [
      { id: 'qwen3-coder' },
      { name: 'kimi-k2' },
      'deepseek-v4',
      {},
    ],
  }), ['qwen3-coder', 'kimi-k2', 'deepseek-v4']);
});

test('fetchModels returns explicit endpoint failure evidence', async () => {
  const { fetchModels } = require('../scripts/omlx-smoke');
  const result = await fetchModels('http://localhost:8000/v1', async () => ({
    ok: false,
    status: 503,
  }));

  assert.equal(result.ok, false);
  assert.equal(result.status, 'models_endpoint_failed');
  assert.equal(result.httpStatus, 503);
  assert.equal(result.url, 'http://localhost:8000/v1/models');
});

test('run reports models_ready without sending a chat request by default', async () => {
  const { run } = require('../scripts/omlx-smoke');
  const calls = [];
  const result = await run({
    baseUrl: 'http://localhost:8123/v1',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'mlx-local-model' }] }),
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'models_ready');
  assert.equal(result.model, 'mlx-local-model');
  assert.equal(calls.length, 1);
});

test('run with --chat proves OpenAI-compatible inference path', async () => {
  const { run } = require('../scripts/omlx-smoke');
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/models')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'mlx-chat-model' }] }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'chatcmpl-local',
        model: 'mlx-chat-model',
        choices: [{ message: { content: 'ThumbGate local oMLX inference is reachable.' } }],
        usage: { prompt_tokens: 10, completion_tokens: 8 },
      }),
    };
  };

  const result = await run({
    baseUrl: 'http://127.0.0.1:8123/v1',
    chat: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'ready');
  assert.equal(result.textPreview, 'ThumbGate local oMLX inference is reachable.');
  assert.equal(calls[0].url, 'http://127.0.0.1:8123/v1/models');
  assert.equal(calls[1].url, 'http://127.0.0.1:8123/v1/chat/completions');
  assert.equal(JSON.parse(calls[1].options.body).model, 'mlx-chat-model');
});
