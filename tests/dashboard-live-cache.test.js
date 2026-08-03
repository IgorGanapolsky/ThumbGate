'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveLiveDashboardCacheTtlMs,
  loadCachedLiveDashboardData,
} = require('../src/api/server').__test__;

test('hosted dashboard cache is opt-in by runtime and explicitly configurable', () => {
  assert.equal(resolveLiveDashboardCacheTtlMs({}), 0);
  assert.equal(resolveLiveDashboardCacheTtlMs({ RAILWAY_PROJECT_ID: 'project' }), 60_000);
  assert.equal(resolveLiveDashboardCacheTtlMs({
    RAILWAY_PROJECT_ID: 'project',
    THUMBGATE_DASHBOARD_CACHE_TTL_MS: '2500',
  }), 2500);
  assert.equal(resolveLiveDashboardCacheTtlMs({
    RAILWAY_PROJECT_ID: 'project',
    THUMBGATE_DASHBOARD_CACHE_TTL_MS: '0',
  }), 0);
});

test('hosted dashboard cache coalesces in-flight scans and retains the completed proof snapshot', async () => {
  const cache = new Map();
  let now = 0;
  let calls = 0;
  let release;
  const loader = () => {
    calls += 1;
    return new Promise((resolve) => { release = resolve; });
  };
  const options = { cache, ttlMs: 100, nowFn: () => now };

  const first = loadCachedLiveDashboardData('dashboard', loader, options);
  const second = loadCachedLiveDashboardData('dashboard', loader, options);
  await Promise.resolve();
  assert.equal(calls, 1);
  release({ data: { operational: { source: 'live' } } });
  assert.deepEqual(await first, await second);

  const cached = await loadCachedLiveDashboardData('dashboard', loader, options);
  assert.equal(cached.data.operational.source, 'live');
  assert.equal(calls, 1);

  now = 101;
  const refreshedPromise = loadCachedLiveDashboardData('dashboard', () => {
    calls += 1;
    return { data: { operational: { source: 'live' }, generation: 2 } };
  }, options);
  const refreshed = await refreshedPromise;
  assert.equal(refreshed.data.generation, 2);
  assert.equal(calls, 2);
});

test('failed dashboard loads are evicted so the next request can recover', async () => {
  const cache = new Map();
  const options = { cache, ttlMs: 100, nowFn: () => 0 };
  await assert.rejects(
    loadCachedLiveDashboardData('dashboard', async () => {
      throw new Error('temporary failure');
    }, options),
    /temporary failure/,
  );

  const recovered = await loadCachedLiveDashboardData(
    'dashboard',
    async () => ({ ok: true }),
    options,
  );
  assert.deepEqual(recovered, { ok: true });
});
