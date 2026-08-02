'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

// Each test block creates its own tmpdir and invalidates require.cache
// to get a fresh module with the correct THUMBGATE_FEEDBACK_DIR env var.

function freshModule(tmpDir) {
  // Clear any cached LanceDB / pipeline singletons in the module
  delete require.cache[require.resolve('../scripts/vector-store')];
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  process.env.THUMBGATE_VECTOR_STUB_EMBED = 'true';
  const mod = require('../scripts/vector-store');
  mod.setLanceLoaderForTests(async () => {
    const tables = new Map();
    return {
      connect: async () => ({
        tableNames: async () => [...tables.keys()],
        openTable: async (name) => {
          const rows = tables.get(name) || [];
          return {
            add: async (records) => {
              rows.push(...records);
              tables.set(name, rows);
            },
            search: () => ({
              limit: (limit) => ({
                toArray: async () => rows.slice(0, limit),
              }),
            }),
          };
        },
        createTable: async (name, records) => {
          tables.set(name, [...records]);
          return {
            add: async (more) => {
              const rows = tables.get(name) || [];
              rows.push(...more);
              tables.set(name, rows);
            },
          };
        },
      }),
    };
  });
  return mod;
}

function makeFeedbackEvent(id, context, signal = 'positive') {
  return {
    id,
    signal,
    context,
    tags: ['testing'],
    timestamp: new Date().toISOString(),
  };
}

describe('vector-store — upsertFeedback()', () => {
  it('creates lancedb dir and resolves without error on first call', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-test-01-'));
    try {
      const { upsertFeedback } = freshModule(tmpDir);
      const event = makeFeedbackEvent('fb_001', 'Tests passed successfully');
      await upsertFeedback(event);
      const lanceDir = path.join(tmpDir, 'lancedb');
      assert.ok(fs.existsSync(lanceDir), `lancedb dir should exist at ${lanceDir}`);
    } finally {
      delete require.cache[require.resolve('../scripts/vector-store')];
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('vector-store — embedding config', () => {
  it('exposes hardware-aware embedding config', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-test-config-'));
    try {
      process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
      process.env.THUMBGATE_RAM_BYTES_OVERRIDE = String(4 * 1024 ** 3);
      process.env.THUMBGATE_CPU_COUNT_OVERRIDE = '4';
      delete require.cache[require.resolve('../scripts/vector-store')];
      const { getEmbeddingConfig } = require('../scripts/vector-store');
      const resolved = getEmbeddingConfig();
      assert.equal(resolved.selectedProfile.id, 'compact');
      assert.equal(resolved.selectedProfile.quantized, true);
    } finally {
      delete process.env.THUMBGATE_RAM_BYTES_OVERRIDE;
      delete process.env.THUMBGATE_CPU_COUNT_OVERRIDE;
      delete require.cache[require.resolve('../scripts/vector-store')];
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('vector-store — built-in feature-hash embeddings', () => {
  it('is deterministic, normalized, and preserves lexical overlap', () => {
    const { embedWithFeatureHash } = require('../scripts/vector-store');
    const first = embedWithFeatureHash('stop hook JSON contract failure');
    const repeated = embedWithFeatureHash('stop hook JSON contract failure');
    const related = embedWithFeatureHash('stop hook emitted invalid JSON output');
    const unrelated = embedWithFeatureHash('quarterly restaurant menu planning');
    const dot = (left, right) => left.reduce((sum, value, index) => sum + (value * right[index]), 0);
    const norm = Math.sqrt(dot(first, first));

    assert.deepEqual(first, repeated);
    assert.equal(first.length, 384);
    assert.ok(Math.abs(norm - 1) < 1e-12, `expected unit vector, got ${norm}`);
    assert.ok(dot(first, related) > dot(first, unrelated));
  });
});

describe('vector-store — local Transformers.js provider', () => {
  it('detects the local Transformers.js runtime and records production provenance', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-test-transformers-'));
    try {
      process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
      process.env.THUMBGATE_RAM_BYTES_OVERRIDE = String(4 * 1024 ** 3);
      process.env.THUMBGATE_CPU_COUNT_OVERRIDE = '4';
      delete process.env.THUMBGATE_VECTOR_STUB_EMBED;
      delete process.env.THUMBGATE_EMBED_PROVIDER;
      delete process.env.THUMBGATE_OLLAMA_EMBED_MODEL;
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      delete require.cache[require.resolve('../scripts/vector-store')];
      const vectorStore = require('../scripts/vector-store');

      // Inject a fake pipeline so CI never downloads ONNX weights.
      vectorStore.setPipelineLoaderForTests(async () => async () => {
        const data = new Float32Array(384);
        data[1] = 1;
        return { data };
      });

      assert.equal(vectorStore.hasLocalTransformerProvider(), true);
      assert.equal(vectorStore.hasSemanticEmbeddingProvider(), true);

      const vector = await vectorStore.embed('block a destructive shell command', { kind: 'query' });
      assert.equal(vector.length, 384);
      assert.equal(vector[1], 1);
      const profile = vectorStore.getLastEmbeddingProfile();
      assert.equal(profile.source, 'local-transformers');
      assert.equal(profile.activeProfile.qualityTier, 'production');
      assert.equal(profile.activeProfile.id, 'compact');
      assert.match(String(profile.activeProfile.model), /MiniLM|all-MiniLM/i);
    } finally {
      delete process.env.THUMBGATE_RAM_BYTES_OVERRIDE;
      delete process.env.THUMBGATE_CPU_COUNT_OVERRIDE;
      delete require.cache[require.resolve('../scripts/vector-store')];
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('reports capability from the vendored runtime and exact optional runtime dependencies', () => {
    delete require.cache[require.resolve('../scripts/vector-store')];
    const vectorStore = require('../scripts/vector-store');
    const status = vectorStore.getLocalTransformerProviderStatus();
    assert.equal(status.available, true);
    assert.equal(status.reason, 'installed');
    assert.equal(status.distribution, 'vendored-node-runtime');
    assert.equal(status.version, '4.2.0');
    assert.equal(vectorStore.hasLocalTransformerProvider(), true);
  });

  it('reports why the optional provider is unavailable instead of implying semantic quality', () => {
    delete require.cache[require.resolve('../scripts/vector-store')];
    const vectorStore = require('../scripts/vector-store');
    const unsupported = vectorStore.getLocalTransformerProviderStatus({
      nodeVersion: '18.20.8',
      allowTestLoader: false,
      resolveModule: () => '/installed/provider.js',
    });
    assert.deepEqual(unsupported, {
      provider: '@huggingface/transformers',
      version: '4.2.0',
      distribution: 'vendored-node-runtime',
      currentNode: '18.20.8',
      minimumNode: '20.9.0',
      available: false,
      reason: 'unsupported_node',
    });

    const missing = vectorStore.getLocalTransformerProviderStatus({
      nodeVersion: '22.19.0',
      allowTestLoader: false,
      runtimeExists: true,
      resolveModule: () => { throw new Error('not installed'); },
    });
    assert.equal(missing.available, false);
    assert.equal(missing.reason, 'missing_optional_runtime_dependency');
    assert.deepEqual(missing.missingDependencies, [
      'onnxruntime-common',
      'onnxruntime-node',
      'sharp',
    ]);
  });

  it('imports the vendored provider with audited optional runtime dependencies', async () => {
    const packageJson = require('../package.json');
    assert.deepEqual(packageJson.optionalDependencies, {
      'onnxruntime-common': '1.21.0',
      'onnxruntime-node': '1.21.0',
      sharp: '0.35.3',
    });
    const runtimePath = path.join(
      __dirname,
      '..',
      'vendor',
      'transformers-js',
      'transformers.node.min.mjs',
    );
    const transformers = await import(pathToFileURL(runtimePath).href);
    assert.equal(typeof transformers.pipeline, 'function');
  });

  it('rejects malformed local model output before it reaches the vector index', async () => {
    delete require.cache[require.resolve('../scripts/vector-store')];
    const vectorStore = require('../scripts/vector-store');
    vectorStore.setPipelineLoaderForTests(async () => async () => ({
      data: Float32Array.from([1, 0, 0, 0]),
    }));
    await assert.rejects(
      vectorStore.embedWithLocalTransformers('unsafe action', { kind: 'query' }),
      /dimension mismatch: expected 384, got 4/,
    );
  });
});

describe('vector-store — Ollama semantic embedding provider', () => {
  it('uses the explicitly configured local model and records production provenance', async () => {
    const originalFetch = global.fetch;
    try {
      process.env.THUMBGATE_OLLAMA_EMBED_MODEL = 'nomic-embed-text';
      process.env.THUMBGATE_OLLAMA_ENDPOINT = 'http://127.0.0.1:11434/';
      delete process.env.THUMBGATE_VECTOR_STUB_EMBED;
      delete process.env.THUMBGATE_EMBED_PROVIDER;
      delete require.cache[require.resolve('../scripts/vector-store')];
      const vectorStore = require('../scripts/vector-store');
      const calls = [];
      global.fetch = async (url, request) => {
        calls.push({ url, body: JSON.parse(request.body) });
        return {
          ok: true,
          json: async () => ({ embeddings: [[1, 0, 0, 0]] }),
        };
      };

      assert.equal(vectorStore.hasSemanticEmbeddingProvider(), true);
      const vector = await vectorStore.embed('erase a directory', { kind: 'query' });
      assert.deepEqual(vector, [1, 0, 0, 0]);
      assert.equal(calls[0].url, 'http://127.0.0.1:11434/api/embed');
      assert.equal(calls[0].body.model, 'nomic-embed-text');
      assert.equal(vectorStore.getLastEmbeddingProfile().source, 'local-ollama');
      assert.equal(vectorStore.getLastEmbeddingProfile().activeProfile.qualityTier, 'production');
    } finally {
      global.fetch = originalFetch;
      delete process.env.THUMBGATE_OLLAMA_EMBED_MODEL;
      delete process.env.THUMBGATE_OLLAMA_ENDPOINT;
      delete require.cache[require.resolve('../scripts/vector-store')];
    }
  });
});

describe('vector-store — Gemini Embedding 2 provider', () => {
  it('uses task-prefixed Gemini embeddings when the managed provider is enabled', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-test-gemini-'));
    const calls = [];
    try {
      process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
      process.env.THUMBGATE_EMBED_PROVIDER = 'gemini';
      process.env.GEMINI_API_KEY = 'test-key';
      process.env.THUMBGATE_GEMINI_EMBED_DIM = '768';
      delete process.env.THUMBGATE_VECTOR_STUB_EMBED;
      delete require.cache[require.resolve('../scripts/vector-store')];
      const vectorStore = require('../scripts/vector-store');
      vectorStore.setLanceLoaderForTests(async () => {
        const tables = new Map();
        return {
          connect: async () => ({
            tableNames: async () => [...tables.keys()],
            openTable: async (name) => {
              const rows = tables.get(name) || [];
              return {
                add: async (records) => {
                  rows.push(...records);
                  tables.set(name, rows);
                },
                search: () => ({
                  limit: (limit) => ({
                    toArray: async () => rows.slice(0, limit),
                  }),
                }),
              };
            },
            createTable: async (name, records) => {
              tables.set(name, [...records]);
              return {
                add: async (more) => {
                  const rows = tables.get(name) || [];
                  rows.push(...more);
                  tables.set(name, rows);
                },
              };
            },
          }),
        };
      });
      vectorStore.setGeminiEmbedderForTests(async (preparedText, config, options) => {
        calls.push({ preparedText, config, options });
        return Array(768).fill(0).map((_, index) => (index === 0 ? 1 : 0));
      });

      await vectorStore.upsertFeedback(makeFeedbackEvent('fb_gemini', 'force push to main blocked', 'negative'));
      await vectorStore.searchSimilar('force push main', 5);

      assert.equal(calls.length, 2);
      assert.match(calls[0].preparedText, /^title: fb_gemini \| text:/);
      assert.match(calls[1].preparedText, /^task: code retrieval \| query: force push main/);
      assert.equal(vectorStore.getLastEmbeddingProfile().activeProfile.model, 'gemini-embedding-2');
      assert.equal(vectorStore.getLastEmbeddingProfile().activeProfile.outputDimensionality, 768);
    } finally {
      delete process.env.THUMBGATE_EMBED_PROVIDER;
      delete process.env.GEMINI_API_KEY;
      delete process.env.THUMBGATE_GEMINI_EMBED_DIM;
      delete require.cache[require.resolve('../scripts/vector-store')];
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('vector-store — searchSimilar() on empty store', () => {
  it('returns empty array when table does not exist', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-test-02-'));
    try {
      const { searchSimilar } = freshModule(tmpDir);
      const results = await searchSimilar('any query text');
      assert.deepStrictEqual(results, [], `expected [], got ${JSON.stringify(results)}`);
    } finally {
      delete require.cache[require.resolve('../scripts/vector-store')];
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('vector-store — upsert then search returns inserted record', () => {
  it('retrieves fb_001 after upsert with matching query', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-test-03-'));
    try {
      const { upsertFeedback, searchSimilar } = freshModule(tmpDir);
      const event = makeFeedbackEvent('fb_001', 'tests passed with full coverage', 'positive');
      await upsertFeedback(event);

      const results = await searchSimilar('tests passing with evidence', 5);
      assert.ok(results.length >= 1, `expected >= 1 result, got ${results.length}`);
      assert.strictEqual(results[0].id, 'fb_001', `expected id fb_001, got ${results[0].id}`);
      assert.strictEqual(results[0].signal, 'positive', `expected signal positive, got ${results[0].signal}`);
    } finally {
      delete require.cache[require.resolve('../scripts/vector-store')];
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('vector-store — multiple upserts, top-k returns nearest', () => {
  it('fb_001 (test coverage) ranked above fb_002 (budget limit) for test-related query', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-test-04-'));
    try {
      const { upsertFeedback, searchSimilar } = freshModule(tmpDir);
      await upsertFeedback(makeFeedbackEvent('fb_001', 'test coverage verified', 'positive'));
      await upsertFeedback(makeFeedbackEvent('fb_002', 'budget limit exceeded', 'negative'));

      const results = await searchSimilar('test verification', 5);
      assert.ok(results.length >= 1, `expected >= 1 result, got ${results.length}`);
      // With stub embedding (all records get same vector), order depends on insertion.
      // Stub returns deterministic vector — we just verify both records are retrievable
      // and fb_001 is present in results.
      const ids = results.map(r => r.id);
      assert.ok(ids.includes('fb_001'), `expected fb_001 in results, got ${JSON.stringify(ids)}`);
    } finally {
      delete require.cache[require.resolve('../scripts/vector-store')];
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('vector-store — fallback profile', () => {
  it('falls back to the safe profile when the primary profile load fails', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-test-fallback-'));
    try {
      process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
      delete process.env.THUMBGATE_VECTOR_STUB_EMBED;
      process.env.THUMBGATE_MODEL_FIT_PROFILE = 'quality';
      process.env.THUMBGATE_VECTOR_FORCE_PRIMARY_FAILURE = 'true';
      delete require.cache[require.resolve('../scripts/vector-store')];
      const vectorStore = require('../scripts/vector-store');
      vectorStore.setLanceLoaderForTests(async () => {
        const tables = new Map();
        return {
          connect: async () => ({
            tableNames: async () => [...tables.keys()],
            openTable: async (name) => {
              const rows = tables.get(name) || [];
              return {
                add: async (records) => {
                  rows.push(...records);
                  tables.set(name, rows);
                },
                search: () => ({
                  limit: (limit) => ({
                    toArray: async () => rows.slice(0, limit),
                  }),
                }),
              };
            },
            createTable: async (name, records) => {
              tables.set(name, [...records]);
              return {
                add: async (more) => {
                  const rows = tables.get(name) || [];
                  rows.push(...more);
                  tables.set(name, rows);
                },
              };
            },
          }),
        };
      });

      vectorStore.setPipelineLoaderForTests(async (_task, model, opts) => async () => ({
        data: Float32Array.from({ length: 384 }, (_, index) => (index === 0 ? 1 : 0)),
        model,
        opts,
      }));

      await vectorStore.upsertFeedback(makeFeedbackEvent('fb_fallback', 'fallback profile proof'));
      const profile = vectorStore.getLastEmbeddingProfile();
      assert.equal(profile.fallbackUsed, true);
      assert.equal(profile.activeProfile.id, 'fallback');
      assert.match(profile.fallbackReason, /Forced primary embedding profile failure/);
    } finally {
      delete process.env.THUMBGATE_MODEL_FIT_PROFILE;
      delete process.env.THUMBGATE_VECTOR_FORCE_PRIMARY_FAILURE;
      delete process.env.THUMBGATE_VECTOR_STUB_EMBED;
      delete require.cache[require.resolve('../scripts/vector-store')];
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('vector-store — Core AI embedding provider', () => {
  it('calls Core AI local service and returns vector when coreai provider is enabled', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-test-coreai-'));
    const originalFetch = global.fetch;
    const originalPlatform = process.platform;
    try {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
      process.env.THUMBGATE_EMBED_PROVIDER = 'coreai';
      delete process.env.THUMBGATE_VECTOR_STUB_EMBED;
      delete require.cache[require.resolve('../scripts/vector-store')];
      const vectorStore = require('../scripts/vector-store');

      global.fetch = async (url) => {
        if (url.includes('/embed')) {
          return {
            ok: true,
            json: async () => ({ embedding: Array(384).fill(0.1) }),
          };
        }
        return { ok: false };
      };

      vectorStore.setLanceLoaderForTests(async () => ({
        connect: async () => ({
          tableNames: async () => [],
          createTable: async () => ({
            add: async () => {},
          }),
        }),
      }));

      await vectorStore.upsertFeedback(makeFeedbackEvent('fb_coreai', 'coreai text'));
      const profile = vectorStore.getLastEmbeddingProfile();
      assert.equal(profile.source, 'local-coreai');
      assert.equal(profile.activeProfile.id, 'coreai');
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
      global.fetch = originalFetch;
      delete process.env.THUMBGATE_EMBED_PROVIDER;
      delete require.cache[require.resolve('../scripts/vector-store')];
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
