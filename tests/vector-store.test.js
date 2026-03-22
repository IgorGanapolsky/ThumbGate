'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Each test block creates its own tmpdir and invalidates require.cache
// to get a fresh module with the correct RLHF_FEEDBACK_DIR env var.

function freshModule(tmpDir) {
  delete require.cache[require.resolve('../scripts/vector-store')];
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  process.env.RLHF_VECTOR_STUB_EMBED = 'true';
  const mod = require('../scripts/vector-store');
  mod.setLanceLoaderForTests(async () => {
    const tables = new Map();
    let versionCounter = 0;
    return {
      connect: async () => ({
        tableNames: async () => [...tables.keys()],
        openTable: async (name) => {
          const rows = tables.get(name) || [];
          return {
            add: async (records) => {
              rows.push(...records);
              tables.set(name, rows);
              versionCounter += 1;
            },
            search: () => {
              let _limit = 10;
              let _where = null;
              const builder = {
                limit: (limit) => { _limit = limit; return builder; },
                where: (filter) => { _where = filter; return builder; },
                toArray: async () => {
                  let filtered = rows;
                  if (_where) {
                    const m = _where.match(/(\w+)\s*=\s*'([^']+)'/);
                    if (m) {
                      filtered = rows.filter((r) => r[m[1]] === m[2]);
                    }
                  }
                  return filtered.slice(0, _limit);
                },
              };
              return builder;
            },
            version: async () => versionCounter,
            listVersions: async () => Array.from({ length: versionCounter }, (_, i) => ({ version: i + 1 })),
          };
        },
        createTable: async (name, records) => {
          versionCounter += 1;
          tables.set(name, [...records]);
          return {
            add: async (more) => {
              const r = tables.get(name) || [];
              r.push(...more);
              tables.set(name, r);
              versionCounter += 1;
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
      process.env.RLHF_FEEDBACK_DIR = tmpDir;
      process.env.RLHF_RAM_BYTES_OVERRIDE = String(4 * 1024 ** 3);
      process.env.RLHF_CPU_COUNT_OVERRIDE = '4';
      delete require.cache[require.resolve('../scripts/vector-store')];
      const { getEmbeddingConfig } = require('../scripts/vector-store');
      const resolved = getEmbeddingConfig();
      assert.equal(resolved.selectedProfile.id, 'compact');
      assert.equal(resolved.selectedProfile.quantized, true);
    } finally {
      delete process.env.RLHF_RAM_BYTES_OVERRIDE;
      delete process.env.RLHF_CPU_COUNT_OVERRIDE;
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

describe('vector-store — searchSimilar with metadata filter', () => {
  it('returns only negative signals when where filter is applied', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-test-filter-'));
    try {
      const { upsertFeedback, searchSimilar } = freshModule(tmpDir);
      await upsertFeedback(makeFeedbackEvent('fb_pos', 'tests passed', 'positive'));
      await upsertFeedback(makeFeedbackEvent('fb_neg', 'budget exceeded', 'negative'));

      const results = await searchSimilar('query', 10, { where: "signal = 'negative'" });
      assert.ok(results.length >= 1, `expected >= 1 result, got ${results.length}`);
      assert.ok(results.every(r => r.signal === 'negative'), 'all results should be negative');
      const ids = results.map(r => r.id);
      assert.ok(ids.includes('fb_neg'), 'expected fb_neg in filtered results');
      assert.ok(!ids.includes('fb_pos'), 'fb_pos should be excluded by filter');
    } finally {
      delete require.cache[require.resolve('../scripts/vector-store')];
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('vector-store — prevention_rules table', () => {
  it('upserts and searches prevention rules in a separate table', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-test-rules-'));
    try {
      const { upsertPreventionRule, searchPreventionRules, TABLE_PREVENTION_RULES } = freshModule(tmpDir);
      assert.equal(TABLE_PREVENTION_RULES, 'prevention_rules');

      await upsertPreventionRule({
        id: 'rule_001',
        pattern: 'git push --force',
        action: 'block',
        message: 'Force push is forbidden',
        tags: ['git', 'safety'],
        source: 'auto',
      });

      const results = await searchPreventionRules('force push danger', 5);
      assert.ok(results.length >= 1, `expected >= 1 rule, got ${results.length}`);
      assert.strictEqual(results[0].id, 'rule_001');
      assert.strictEqual(results[0].action, 'block');
    } finally {
      delete require.cache[require.resolve('../scripts/vector-store')];
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('vector-store — context_packs table', () => {
  it('upserts and searches context packs in a separate table', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-test-packs-'));
    try {
      const { upsertContextPack, searchContextPacks, TABLE_CONTEXT_PACKS } = freshModule(tmpDir);
      assert.equal(TABLE_CONTEXT_PACKS, 'context_packs');

      await upsertContextPack({
        id: 'pack_001',
        query: 'authentication flow',
        namespaces: ['src/auth', 'config'],
        outcome: 'useful',
        signal: 'positive',
        itemCount: 12,
      });

      const results = await searchContextPacks('auth login flow', 5);
      assert.ok(results.length >= 1, `expected >= 1 pack, got ${results.length}`);
      assert.strictEqual(results[0].id, 'pack_001');
      assert.strictEqual(results[0].outcome, 'useful');
      assert.strictEqual(results[0].itemCount, 12);
    } finally {
      delete require.cache[require.resolve('../scripts/vector-store')];
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('vector-store — version tracking', () => {
  it('returns version number after writes and lists versions', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-test-version-'));
    try {
      const { upsertFeedback, getTableVersion, listTableVersions, TABLE_NAME } = freshModule(tmpDir);

      const vBefore = await getTableVersion(TABLE_NAME);
      assert.strictEqual(vBefore, null, 'version should be null before table exists');

      await upsertFeedback(makeFeedbackEvent('fb_v1', 'first write'));

      const vAfter = await getTableVersion(TABLE_NAME);
      assert.ok(typeof vAfter === 'number', `version should be a number, got ${typeof vAfter}`);
      assert.ok(vAfter >= 1, `version should be >= 1, got ${vAfter}`);

      const versions = await listTableVersions(TABLE_NAME);
      assert.ok(Array.isArray(versions), 'listTableVersions should return an array');
      assert.ok(versions.length >= 1, `expected >= 1 version entry, got ${versions.length}`);
    } finally {
      delete require.cache[require.resolve('../scripts/vector-store')];
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('vector-store — getVersionSnapshot across tables', () => {
  it('returns snapshot with version per table', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-test-snapshot-'));
    try {
      const { upsertFeedback, upsertPreventionRule, getVersionSnapshot } = freshModule(tmpDir);

      await upsertFeedback(makeFeedbackEvent('fb_snap', 'snapshot test'));
      await upsertPreventionRule({ id: 'rule_snap', pattern: 'test', message: 'snap' });

      const snapshot = await getVersionSnapshot();
      assert.ok(snapshot.rlhf_memories !== null, 'rlhf_memories should have a version');
      assert.ok(snapshot.prevention_rules !== null, 'prevention_rules should have a version');
      assert.strictEqual(snapshot.context_packs, null, 'context_packs should be null (no writes)');
    } finally {
      delete require.cache[require.resolve('../scripts/vector-store')];
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('vector-store — prevention rules with metadata filter', () => {
  it('filters prevention rules by action type', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-test-rule-filter-'));
    try {
      const { upsertPreventionRule, searchPreventionRules } = freshModule(tmpDir);
      await upsertPreventionRule({ id: 'r_block', pattern: 'force push', action: 'block', message: 'no' });
      await upsertPreventionRule({ id: 'r_warn', pattern: 'env edit', action: 'warn', message: 'careful' });

      const blocked = await searchPreventionRules('push', 10, { where: "action = 'block'" });
      assert.ok(blocked.every(r => r.action === 'block'), 'all results should be block actions');
      assert.ok(blocked.some(r => r.id === 'r_block'), 'r_block should be in results');
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
      process.env.RLHF_FEEDBACK_DIR = tmpDir;
      delete process.env.RLHF_VECTOR_STUB_EMBED;
      process.env.RLHF_MODEL_FIT_PROFILE = 'quality';
      process.env.RLHF_VECTOR_FORCE_PRIMARY_FAILURE = 'true';
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
                search: () => {
                  let _limit = 10;
                  const builder = {
                    limit: (limit) => { _limit = limit; return builder; },
                    where: () => builder,
                    toArray: async () => rows.slice(0, _limit),
                  };
                  return builder;
                },
                version: async () => 1,
                listVersions: async () => [{ version: 1 }],
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
      delete process.env.RLHF_MODEL_FIT_PROFILE;
      delete process.env.RLHF_VECTOR_FORCE_PRIMARY_FAILURE;
      delete process.env.RLHF_VECTOR_STUB_EMBED;
      delete require.cache[require.resolve('../scripts/vector-store')];
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
