'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { AgentRetrievalCache } = require('../src/agent-retrieval-cache.js');

test('AgentRetrievalCache - concurrency, single-flight, and invalidation', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retrieval-cache-test-'));
  const testFile = path.join(tmpDir, 'schema.json');
  fs.writeFileSync(testFile, '{"v": 1}');

  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test('single-flight coalesces concurrent identical requests', async () => {
    const cache = new AgentRetrievalCache();
    let fetchCount = 0;

    const slowFetch = async () => {
      fetchCount++;
      await new Promise((r) => setTimeout(r, 50));
      return { data: 'context_pack_123' };
    };

    // Fire 5 concurrent requests simultaneously
    const results = await Promise.all([
      cache.getOrFetch('query:auth_flow', [testFile], slowFetch),
      cache.getOrFetch('query:auth_flow', [testFile], slowFetch),
      cache.getOrFetch('query:auth_flow', [testFile], slowFetch),
      cache.getOrFetch('query:auth_flow', [testFile], slowFetch),
      cache.getOrFetch('query:auth_flow', [testFile], slowFetch),
    ]);

    assert.equal(results.length, 5);
    assert.equal(results[0].data, 'context_pack_123');
    // Only 1 execution occurred despite 5 concurrent callers
    assert.equal(fetchCount, 1);
    const m = cache.getMetrics();
    assert.equal(m.misses, 1);
    assert.equal(m.coalesced, 4);
  });

  await t.test('invalidates cache entry when watched file is modified', async () => {
    const cache = new AgentRetrievalCache();
    let fetchCount = 0;

    const fetcher = async () => {
      fetchCount++;
      return { content: fs.readFileSync(testFile, 'utf8') };
    };

    const first = await cache.getOrFetch('schema_key', [testFile], fetcher);
    assert.equal(first.content, '{"v": 1}');
    assert.equal(fetchCount, 1);

    // Second call before file edit is a cache hit
    const second = await cache.getOrFetch('schema_key', [testFile], fetcher);
    assert.equal(second.content, '{"v": 1}');
    assert.equal(fetchCount, 1);

    // Sleep 10ms and modify file
    await new Promise((r) => setTimeout(r, 10));
    fs.writeFileSync(testFile, '{"v": 2}');

    // Third call detects mtime delta, invalidates, and re-fetches
    const third = await cache.getOrFetch('schema_key', [testFile], fetcher);
    assert.equal(third.content, '{"v": 2}');
    assert.equal(fetchCount, 2);
  });

  await t.test('filters slop/pollution paths from cache watch list', () => {
    assert.equal(AgentRetrievalCache.isPollutionPath('.system_generated/logs/t.jsonl'), true);
    assert.equal(AgentRetrievalCache.isPollutionPath('.claude/worktrees/agent-1/src/index.js'), true);
    assert.equal(AgentRetrievalCache.isPollutionPath('node_modules/express/index.js'), true);
    assert.equal(AgentRetrievalCache.isPollutionPath('src/core/router.js'), false);
  });
});
