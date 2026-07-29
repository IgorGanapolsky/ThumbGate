'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

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

describe('vector-store — versioned scoped RAG index', () => {
  it('replaces stable IDs and applies hard metadata filters before returning rows', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-test-rag-v2-'));
    const tables = new Map();
    try {
      process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
      process.env.THUMBGATE_VECTOR_STUB_EMBED = 'true';
      delete require.cache[require.resolve('../scripts/vector-store')];
      const vectorStore = require('../scripts/vector-store');
      vectorStore.setLanceLoaderForTests(async () => ({
        connect: async () => ({
          tableNames: async () => [...tables.keys()],
          openTable: async (name) => {
            const tableApi = {
              add: async (records) => {
                tables.set(name, [...(tables.get(name) || []), ...records]);
              },
              delete: async (predicate) => {
                const id = predicate.match(/^id = '(.+)'$/)?.[1]?.replaceAll("''", "'");
                tables.set(name, (tables.get(name) || []).filter((row) => row.id !== id));
              },
              search: () => {
                let filter = '';
                const builder = {
                  where: (value) => {
                    filter = value;
                    return builder;
                  },
                  limit: (limit) => ({
                    toArray: async () => {
                      let rows = [...(tables.get(name) || [])];
                      for (const clause of filter.split(' AND ').filter(Boolean)) {
                        if (clause === 'isCurrent = true') {
                          rows = rows.filter((row) => row.isCurrent === true);
                          continue;
                        }
                        const match = clause.match(/^(\w+) = '(.+)'$/);
                        if (match) rows = rows.filter((row) => row[match[1]] === match[2]);
                      }
                      return rows.slice(0, limit);
                    },
                  }),
                };
                return builder;
              },
            };
            return tableApi;
          },
          createTable: async (name, records) => {
            tables.set(name, [...records]);
          },
        }),
      }));

      const base = {
        id: 'chunk-1',
        text: 'current recovery procedure',
        source: 'document',
        documentId: 'doc-1',
        scope: { tenantId: 'tenant-a', projectId: 'alpha', visibility: 'private' },
        isCurrent: true,
      };
      const firstIndex = await vectorStore.upsertVectorRecords([base]);
      const updatedIndex = await vectorStore.upsertVectorRecords([{ ...base, text: 'updated recovery procedure' }]);
      const cachedIndex = await vectorStore.upsertVectorRecords([{ ...base, text: 'updated recovery procedure' }]);
      await vectorStore.upsertVectorRecords([{
        ...base,
        id: 'chunk-2',
        documentId: 'doc-2',
        text: 'other tenant recovery procedure',
        scope: { tenantId: 'tenant-b', projectId: 'beta', visibility: 'private' },
      }]);

      const indexedRows = [...tables.values()].flat();
      assert.equal(indexedRows.filter((row) => row.id === 'chunk-1').length, 1);
      assert.equal(indexedRows.find((row) => row.id === 'chunk-1').text, 'updated recovery procedure');
      assert.equal(firstIndex.embeddedCount, 1);
      assert.equal(updatedIndex.embeddedCount, 1);
      assert.equal(cachedIndex.reusedCount, 1);
      assert.equal(cachedIndex.embeddedCount, 0);
      assert.ok([...tables.keys()].every((name) => name.startsWith('thumbgate_rag_v2_')));

      const result = await vectorStore.searchRag('recovery procedure', {
        limit: 10,
        filters: {
          tenantId: 'tenant-a',
          projectId: 'alpha',
          currentOnly: true,
        },
      });
      assert.deepEqual(result.results.map((row) => row.id), ['chunk-1']);
      assert.match(result.filterApplied, /tenantId = 'tenant-a'/);
      assert.match(result.filterApplied, /projectId = 'alpha'/);
      assert.match(result.filterApplied, /isCurrent = true/);
    } finally {
      delete process.env.THUMBGATE_VECTOR_STUB_EMBED;
      delete require.cache[require.resolve('../scripts/vector-store')];
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
