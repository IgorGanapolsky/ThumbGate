'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

describe('filesystem-search', () => {
  let tmpDir;
  let originalEnv;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-search-test-'));
    originalEnv = {
      THUMBGATE_FEEDBACK_DIR: process.env.THUMBGATE_FEEDBACK_DIR,
      THUMBGATE_CONTEXTFS_DIR: process.env.THUMBGATE_CONTEXTFS_DIR,
    };

    // Set up test data
    process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
    process.env.THUMBGATE_CONTEXTFS_DIR = path.join(tmpDir, 'contextfs');

    // Create feedback log
    const feedbackLog = [
      { id: 'fb1', signal: 'down', context: 'test mocking database failed in production', tags: ['testing', 'database'], whatWentWrong: 'mocked tests passed but real DB migration broke', timestamp: new Date().toISOString() },
      { id: 'fb2', signal: 'up', context: 'used real database for integration tests', tags: ['testing', 'integration'], whatWorked: 'caught migration bug before deploy', timestamp: new Date().toISOString() },
      { id: 'fb3', signal: 'down', context: 'forgot to run linter before commit', tags: ['ci', 'lint'], whatWentWrong: 'CI failed on formatting', timestamp: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() },
      { id: 'fb4', signal: 'up', context: 'pre-commit hook caught formatting issues', tags: ['ci', 'hooks'], whatWorked: 'never had CI format failures again', timestamp: new Date().toISOString() },
    ];
    fs.writeFileSync(
      path.join(tmpDir, 'feedback-log.jsonl'),
      feedbackLog.map((r) => JSON.stringify(r)).join('\n') + '\n'
    );

    // Create prevention rules
    fs.writeFileSync(
      path.join(tmpDir, 'prevention-rules.md'),
      '# Never mock databases in integration tests\nAlways use real database connections.\n\n# Run linter before every commit\nUse pre-commit hooks.\n'
    );

    // Create contextfs entries
    const contextDir = path.join(tmpDir, 'contextfs', 'memory', 'error');
    fs.mkdirSync(contextDir, { recursive: true });
    fs.writeFileSync(
      path.join(contextDir, 'error1.json'),
      JSON.stringify({ id: 'ctx1', context: 'database connection timeout during test', tags: ['database', 'timeout'], timestamp: new Date().toISOString() })
    );

    const learningDir = path.join(tmpDir, 'contextfs', 'memory', 'learning');
    fs.mkdirSync(learningDir, { recursive: true });
    fs.writeFileSync(
      path.join(learningDir, 'learn1.json'),
      JSON.stringify({ id: 'ctx2', context: 'successfully used connection pooling for tests', whatWorked: 'pool reduced test time by 60%', tags: ['database', 'performance'], timestamp: new Date().toISOString() })
    );
  });

  after(() => {
    process.env.THUMBGATE_FEEDBACK_DIR = originalEnv.THUMBGATE_FEEDBACK_DIR || '';
    process.env.THUMBGATE_CONTEXTFS_DIR = originalEnv.THUMBGATE_CONTEXTFS_DIR || '';
    if (!originalEnv.THUMBGATE_FEEDBACK_DIR) delete process.env.THUMBGATE_FEEDBACK_DIR;
    if (!originalEnv.THUMBGATE_CONTEXTFS_DIR) delete process.env.THUMBGATE_CONTEXTFS_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Clear module cache before each require to pick up env changes
  function loadModule() {
    delete require.cache[require.resolve('../scripts/filesystem-search')];
    return require('../scripts/filesystem-search');
  }

  describe('searchFeedbackLog', () => {
    it('finds relevant feedback by keyword match', () => {
      const mod = loadModule();
      const results = mod.searchFeedbackLog('database mock testing');
      assert.ok(results.length > 0, 'Should find at least 1 result');
      assert.ok(results[0]._score > 0, 'Score should be positive');
      assert.ok(results[0]._matchedTokens.includes('database'), 'Should match "database" token');
    });

    it('ranks more relevant results higher', () => {
      const mod = loadModule();
      const results = mod.searchFeedbackLog('database mock production');
      assert.ok(results.length >= 2, 'Should find multiple results');
      // The "down" feedback about mocking should score higher
      assert.equal(results[0].id, 'fb1', 'Most relevant result should be fb1 (database mock failure)');
    });

    it('filters by signal when options.where is provided', () => {
      const mod = loadModule();
      const results = mod.searchFeedbackLog('database', 5, { where: { signal: 'up' } });
      assert.ok(results.length > 0);
      results.forEach((r) => assert.equal(r.signal, 'up'));
    });

    it('returns low or zero scores for unrelated queries', () => {
      const mod = loadModule();
      const results = mod.searchFeedbackLog('quantum physics spacetime');
      // Unrelated queries should score very low (near zero)
      results.forEach((r) => assert.ok(r._score <= 0.2, `Unrelated result score should be <=0.2, got ${r._score}`));
    });
  });

  describe('searchContextFs', () => {
    it('searches across contextfs namespaces', () => {
      const mod = loadModule();
      const results = mod.searchContextFs('database connection', 5, {
        namespaces: ['memory/error', 'memory/learning'],
      });
      assert.ok(results.length > 0, 'Should find contextfs entries');
      assert.ok(results[0]._namespace, 'Results should include namespace');
      assert.ok(results[0]._source, 'Results should include source path');
    });

    it('finds entries by matching content', () => {
      const mod = loadModule();
      const results = mod.searchContextFs('connection pooling performance');
      assert.ok(results.some((r) => r.id === 'ctx2'), 'Should find the connection pooling learning');
    });
  });

  describe('searchPreventionRules', () => {
    it('finds matching prevention rules', () => {
      const mod = loadModule();
      const results = mod.searchPreventionRulesSync('mock database');
      assert.ok(results.length > 0);
      assert.ok(results[0].title.toLowerCase().includes('mock') || results[0].body.toLowerCase().includes('mock'),
        'Should find the database mocking rule');
    });

    it('finds linter rules', () => {
      const mod = loadModule();
      const results = mod.searchPreventionRulesSync('linter commit');
      assert.ok(results.length > 0);
      assert.ok(results[0]._score > 0);
    });
  });

  describe('searchAll (unified)', () => {
    it('merges results from all sources', () => {
      const mod = loadModule();
      const results = mod.searchAll('database');
      assert.ok(results.length > 0);
      const sourceTypes = new Set(results.map((r) => r._source_type));
      assert.ok(sourceTypes.size >= 2, `Should search multiple sources, got: ${[...sourceTypes].join(', ')}`);
    });

    it('results are sorted by score descending', () => {
      const mod = loadModule();
      const results = mod.searchAll('database mock testing', 10);
      for (let i = 1; i < results.length; i++) {
        assert.ok(results[i - 1]._score >= results[i]._score,
          `Results should be sorted: ${results[i - 1]._score} >= ${results[i]._score}`);
      }
    });
  });

  describe('vector-store.js compatibility', () => {
    it('exports all required vector-store.js interface functions', () => {
      const mod = loadModule();
      assert.equal(typeof mod.searchSimilar, 'function');
      assert.equal(typeof mod.upsertFeedback, 'function');
      assert.equal(typeof mod.upsertPreventionRule, 'function');
      assert.equal(typeof mod.upsertContextPack, 'function');
      assert.equal(typeof mod.searchContextPacks, 'function');
      assert.equal(typeof mod.getEmbeddingConfig, 'function');
      assert.equal(typeof mod.getLastEmbeddingProfile, 'function');
      assert.equal(typeof mod.getVersionSnapshot, 'function');
      assert.equal(typeof mod.setPipelineLoaderForTests, 'function');
      assert.equal(typeof mod.setLanceLoaderForTests, 'function');
      assert.equal(typeof mod.truncateForEmbedding, 'function');
      assert.equal(mod.TABLE_NAME, 'rlhf_memories');
      assert.equal(mod.TABLE_PREVENTION_RULES, 'prevention_rules');
      assert.equal(mod.TABLE_CONTEXT_PACKS, 'context_packs');
    });

    it('searchSimilar returns results (async compat)', async () => {
      const mod = loadModule();
      const results = await mod.searchSimilar('database test');
      assert.ok(Array.isArray(results));
    });

    it('upsertFeedback is a no-op that returns the event', async () => {
      const mod = loadModule();
      const event = { id: 'test', signal: 'up' };
      const result = await mod.upsertFeedback(event);
      assert.deepEqual(result, event);
    });

    it('getEmbeddingConfig returns filesystem profile', () => {
      const mod = loadModule();
      const config = mod.getEmbeddingConfig();
      assert.equal(config.selectedProfile.id, 'filesystem');
      assert.equal(config.selectedProfile.model, 'none');
    });
  });

  describe('getSearchStats', () => {
    it('returns diagnostic info', () => {
      const mod = loadModule();
      const stats = mod.getSearchStats();
      assert.equal(stats.engine, 'filesystem-search');
      assert.equal(stats.feedbackEntries, 4);
      assert.ok(stats.contextFsFiles >= 2);
      assert.equal(stats.preventionRulesExist, true);
    });
  });

  describe('performance: no binary dependencies', () => {
    it('loads instantly without downloading models', () => {
      const start = Date.now();
      const mod = loadModule();
      const loadTime = Date.now() - start;
      assert.ok(loadTime < 100, `Module should load in <100ms, took ${loadTime}ms`);
      assert.ok(mod.searchSimilar, 'Module should be functional');
    });

    it('searches 1000+ entries quickly', () => {
      // Write a larger test dataset
      const bigLog = [];
      for (let i = 0; i < 1000; i++) {
        bigLog.push({ id: `perf${i}`, signal: i % 2 === 0 ? 'up' : 'down', context: `test entry ${i} about ${i % 3 === 0 ? 'database' : 'formatting'} issues`, tags: ['perf'], timestamp: new Date().toISOString() });
      }
      const bigPath = path.join(tmpDir, 'feedback-log.jsonl');
      fs.writeFileSync(bigPath, bigLog.map((r) => JSON.stringify(r)).join('\n') + '\n');

      const mod = loadModule();
      const start = Date.now();
      const results = mod.searchFeedbackLog('database issues', 10);
      const searchTime = Date.now() - start;

      assert.ok(searchTime < 500, `Search over 1000 entries should take <500ms, took ${searchTime}ms`);
      assert.ok(results.length > 0, 'Should find results in large dataset');

      // Restore original smaller dataset for other tests
    });
  });
});
