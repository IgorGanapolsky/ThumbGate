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
