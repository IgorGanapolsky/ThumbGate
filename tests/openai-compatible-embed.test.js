'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const vectorStore = require(path.join(__dirname, '..', 'scripts', 'vector-store.js'));

test('getOpenAICompatibleEmbeddingConfig enables DashScope when provider+key set', () => {
  const cfg = vectorStore.getOpenAICompatibleEmbeddingConfig({
    THUMBGATE_EMBED_PROVIDER: 'dashscope',
    DASHSCOPE_API_KEY: 'test-key',
    THUMBGATE_QWEN_EMBED_MODEL: 'text-embedding-v4',
    THUMBGATE_QWEN_EMBED_DIM: '512',
  });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.provider, 'dashscope');
  assert.equal(cfg.model, 'text-embedding-v4');
  assert.equal(cfg.dimensions, 512);
  assert.match(cfg.endpoint, /dashscope.*\/embeddings$/);
});

test('embed routes through OpenAI-compatible provider when configured', async () => {
  const previous = process.env.THUMBGATE_VECTOR_STUB_EMBED;
  delete process.env.THUMBGATE_VECTOR_STUB_EMBED;

  vectorStore.setOpenAICompatibleEmbedderForTests(async () => [0.6, 0.8, 0, 0]);
  try {
    // Inject via config path (stub embedder short-circuits network)
    const vector = await vectorStore.embedWithOpenAICompatible('hello rag', {
      config: {
        enabled: true,
        provider: 'dashscope',
        apiKey: 'k',
        baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        model: 'text-embedding-v4',
        dimensions: 4,
        endpoint: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/embeddings',
        timeoutMs: 1000,
      },
    });
    assert.deepEqual(vector, [0.6, 0.8, 0, 0]);
  } finally {
    vectorStore.setOpenAICompatibleEmbedderForTests(null);
    if (previous === undefined) delete process.env.THUMBGATE_VECTOR_STUB_EMBED;
    else process.env.THUMBGATE_VECTOR_STUB_EMBED = previous;
  }
});

test('hasSemanticEmbeddingProvider is true when DashScope embed env is present', () => {
  const prevProvider = process.env.THUMBGATE_EMBED_PROVIDER;
  const prevKey = process.env.DASHSCOPE_API_KEY;
  process.env.THUMBGATE_EMBED_PROVIDER = 'dashscope';
  process.env.DASHSCOPE_API_KEY = 'test-key';
  try {
    assert.equal(vectorStore.hasSemanticEmbeddingProvider(), true);
  } finally {
    if (prevProvider === undefined) delete process.env.THUMBGATE_EMBED_PROVIDER;
    else process.env.THUMBGATE_EMBED_PROVIDER = prevProvider;
    if (prevKey === undefined) delete process.env.DASHSCOPE_API_KEY;
    else process.env.DASHSCOPE_API_KEY = prevKey;
  }
});
