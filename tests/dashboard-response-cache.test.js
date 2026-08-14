'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  __test__: {
    buildLiveDashboardCacheKey,
    loadCachedLiveDashboardData,
  },
} = require('../src/api/server');

describe('live dashboard response cache', () => {
  it('normalizes query order in cache keys', () => {
    const first = new URL('https://thumbgate.ai/v1/dashboard?window=today&timezone=UTC');
    const second = new URL('https://thumbgate.ai/v1/dashboard?timezone=UTC&window=today');

    assert.equal(
      buildLiveDashboardCacheKey(first, '/var/lib/thumbgate'),
      buildLiveDashboardCacheKey(second, '/var/lib/thumbgate'),
    );
  });

  it('coalesces concurrent builds and reuses the result during the TTL', async () => {
    const cache = new Map();
    const parsed = new URL('https://thumbgate.ai/v1/dashboard?window=today');
    let builds = 0;
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const build = async () => {
      builds += 1;
      await pending;
      return { data: { operational: { source: 'live' } } };
    };
    const options = { build, cache, ttlMs: 30_000, now: () => 1_000 };

    const first = loadCachedLiveDashboardData(parsed, '/feedback', options);
    const second = loadCachedLiveDashboardData(parsed, '/feedback', options);
    release();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    const thirdResult = await loadCachedLiveDashboardData(parsed, '/feedback', options);

    assert.equal(builds, 1);
    assert.strictEqual(firstResult, secondResult);
    assert.strictEqual(secondResult, thirdResult);
  });

  it('rebuilds expired entries and does not cache failures', async () => {
    const cache = new Map();
    const parsed = new URL('https://thumbgate.ai/v1/dashboard');
    let currentTime = 1_000;
    let builds = 0;
    const build = async () => {
      builds += 1;
      if (builds === 1) throw new Error('temporary failure');
      return { data: { generation: builds } };
    };
    const options = { build, cache, ttlMs: 10, now: () => currentTime };

    await assert.rejects(
      loadCachedLiveDashboardData(parsed, '/feedback', options),
      /temporary failure/,
    );
    const recovered = await loadCachedLiveDashboardData(parsed, '/feedback', options);
    currentTime += 11;
    const refreshed = await loadCachedLiveDashboardData(parsed, '/feedback', options);

    assert.equal(recovered.data.generation, 2);
    assert.equal(refreshed.data.generation, 3);
    assert.equal(builds, 3);
  });

  it('caps admission before starting concurrent builds', async () => {
    const cache = new Map();
    let builds = 0;
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const build = async () => {
      builds += 1;
      await pending;
      return { data: { builds } };
    };
    const options = { build, cache, maxEntries: 2, now: () => 1_000 };

    const first = loadCachedLiveDashboardData(
      new URL('https://thumbgate.ai/v1/dashboard?window=today'),
      '/feedback',
      options,
    );
    const second = loadCachedLiveDashboardData(
      new URL('https://thumbgate.ai/v1/dashboard?window=week'),
      '/feedback',
      options,
    );

    await assert.rejects(
      loadCachedLiveDashboardData(
        new URL('https://thumbgate.ai/v1/dashboard?window=month'),
        '/feedback',
        options,
      ),
      (error) => error.code === 'DASHBOARD_BUILD_CAPACITY',
    );
    assert.equal(cache.size, 2);
    assert.equal(builds, 2);

    release();
    await Promise.all([first, second]);
  });

  it('bypasses caching when the entry cap is zero', async () => {
    const cache = new Map();
    let builds = 0;
    const options = {
      cache,
      maxEntries: 0,
      build: async () => ({ data: { builds: ++builds } }),
    };
    const parsed = new URL('https://thumbgate.ai/v1/dashboard');

    await loadCachedLiveDashboardData(parsed, '/feedback', options);
    await loadCachedLiveDashboardData(parsed, '/feedback', options);

    assert.equal(builds, 2);
    assert.equal(cache.size, 0);
  });
});
