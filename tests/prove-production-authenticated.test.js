'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_BASE_URL,
  DEFAULT_PRODUCTION_PROOF_HOSTS,
  buildProductionHostAllowlist,
  validateBaseUrl,
  parseArgs,
  runAuthenticatedProductionProof,
  renderHuman,
} = require('../scripts/prove-production-authenticated');

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return body; },
  };
}

function passingBody(url) {
  if (url.endsWith('/health')) {
    return { status: 'ok', degraded: false, version: '1.32.0', buildSha: 'abc123' };
  }
  if (url.includes('/v1/lessons/search')) {
    return {
      query: 'thumbgate',
      backend: 'jsonl-jaccard',
      results: [{ id: 'lesson-1', evidenceScore: 0.8 }],
      returned: 1,
      totalLessons: 4,
    };
  }
  if (url.includes('/v1/search')) {
    return {
      query: 'thumbgate',
      source: 'all',
      engine: 'hybrid-parent-child',
      returned: 1,
      total: 1,
      results: [{ id: 'result-1', source: 'feedback', score: 0.8 }],
    };
  }
  if (url.endsWith('/v1/dashboard')) {
    return {
      operational: { source: 'live' },
      approval: { total: 2 },
      gateStats: { totalGates: 3 },
      health: {},
      harness: {},
      liveMetrics: {},
      lessonPipeline: {},
    };
  }
  if (url.endsWith('/v1/dpo/export')) {
    return {
      pairs: 1,
      pairCount: 1,
      errors: 1,
      learnings: 1,
      outputPath: null,
      records: [{ prompt: 'Prompt', chosen: 'Correct', rejected: 'Incorrect' }],
    };
  }
  throw new Error(`Unexpected URL: ${url}`);
}

function passingFetch(url, options) {
  if (url.includes('/v1/search') && url.includes('limit=1') && !options.headers.authorization) {
    return response(401, { error: 'Unauthorized' });
  }
  return response(200, passingBody(url));
}

test('parseArgs captures release identity and retry controls', () => {
  const args = parseArgs([
    '--json',
    '--base-url=https://example.test/',
    '--expected-sha=abc123',
    '--expected-version=1.32.0',
    '--query=release proof',
    '--timeout-ms=5000',
    '--max-attempts=4',
    '--retry-delay-ms=250',
  ]);
  assert.equal(args.json, true);
  assert.equal(args.baseUrl, 'https://example.test');
  assert.equal(args.expectedSha, 'abc123');
  assert.equal(args.expectedVersion, '1.32.0');
  assert.equal(args.query, 'release proof');
  assert.equal(args.timeoutMs, 5000);
  assert.equal(args.maxAttempts, 4);
  assert.equal(args.retryDelayMs, 250);
});

test('proof passes only when exact build, search, dashboard, and export contracts pass', async () => {
  const calls = [];
  const report = await runAuthenticatedProductionProof({
    apiKey: 'secret-test-key',
    baseUrl: DEFAULT_BASE_URL,
    expectedSha: 'abc123',
    expectedVersion: '1.32.0',
    maxAttempts: 1,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return passingFetch(url, options);
    },
  });

  assert.equal(report.verdict, 'pass');
  assert.equal(report.checks.length, 6);
  assert.ok(report.checks.every((check) => check.ok));
  assert.equal(calls[0].options.headers.authorization, undefined, 'health stays public');
  assert.equal(calls[1].options.headers.authorization, undefined, 'auth boundary stays anonymous');
  assert.equal(calls[2].options.headers.authorization, 'Bearer secret-test-key');
  assert.equal(calls[5].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[5].options.body), { includePairs: true });
});

test('proof fails closed when API key is missing', async () => {
  const report = await runAuthenticatedProductionProof({
    apiKey: '',
    baseUrl: DEFAULT_BASE_URL,
    expectedSha: 'abc123',
    expectedVersion: '1.32.0',
  });
  assert.equal(report.verdict, 'fail');
  assert.match(report.reason, /unavailable/);
  assert.deepEqual(report.checks, []);
});

test('401 fails without leaking the credential into report output', async () => {
  const secret = 'must-never-appear';
  const report = await runAuthenticatedProductionProof({
    apiKey: secret,
    baseUrl: DEFAULT_BASE_URL,
    expectedSha: 'abc123',
    expectedVersion: '1.32.0',
    maxAttempts: 1,
    fetchImpl: async (url) => url.endsWith('/health')
      ? response(200, passingBody(url))
      : response(401, { detail: `bad credential ${secret}` }),
  });

  assert.equal(report.verdict, 'fail');
  assert.ok(report.checks.slice(2).every((check) => check.status === 401));
  assert.doesNotMatch(JSON.stringify(report), new RegExp(secret));
  assert.doesNotMatch(renderHuman(report), new RegExp(secret));
});

test('empty retrieval results fail even when transport returns 200', async () => {
  const report = await runAuthenticatedProductionProof({
    apiKey: 'secret-test-key',
    baseUrl: DEFAULT_BASE_URL,
    expectedSha: 'abc123',
    expectedVersion: '1.32.0',
    maxAttempts: 1,
    fetchImpl: async (url, options) => {
      if (url.includes('/v1/search') && url.includes('limit=1') && !options.headers.authorization) {
        return response(401, { error: 'Unauthorized' });
      }
      if (url.includes('/v1/search') && !url.includes('/lessons/')) return response(200, { results: [] });
      return response(200, passingBody(url));
    },
  });

  assert.equal(report.verdict, 'fail');
  const search = report.checks.find((check) => check.name === 'search');
  assert.equal(search.ok, false);
  assert.equal(search.results, 0);
});

test('health identity mismatch fails before a stale build can be certified', async () => {
  const report = await runAuthenticatedProductionProof({
    apiKey: 'secret-test-key',
    baseUrl: DEFAULT_BASE_URL,
    expectedSha: 'new-sha',
    expectedVersion: '1.32.0',
    maxAttempts: 1,
    fetchImpl: async (url, options) => passingFetch(url, options),
  });

  assert.equal(report.verdict, 'fail');
  const health = report.checks.find((check) => check.name === 'health_identity');
  assert.equal(health.ok, false);
  assert.equal(health.buildSha, 'abc123');
});

test('proof rejects missing release identity before making requests', async () => {
  let calls = 0;
  const report = await runAuthenticatedProductionProof({
    apiKey: 'secret-test-key',
    baseUrl: DEFAULT_BASE_URL,
    fetchImpl: async () => { calls += 1; return response(200, {}); },
  });
  assert.equal(report.verdict, 'fail');
  assert.match(report.reason, /SHA and version/);
  assert.equal(calls, 0);
});

test('proof rejects credential destinations outside the production allowlist', async () => {
  const report = await runAuthenticatedProductionProof({
    apiKey: 'secret-test-key',
    baseUrl: 'http://user:password@attacker.example.test/leak?token=1',
    expectedSha: 'abc123',
    expectedVersion: '1.32.0',
  });
  assert.equal(report.verdict, 'fail');
  assert.match(report.reason, /allowlist/);
  assert.doesNotMatch(JSON.stringify(report), /user|password|token=1/);
});

test('proof accepts the public thumbgate.ai origin used by deploy workflows', async () => {
  const report = await runAuthenticatedProductionProof({
    apiKey: 'secret-test-key',
    baseUrl: 'https://thumbgate.ai',
    expectedSha: 'abc123',
    expectedVersion: '1.32.0',
    maxAttempts: 1,
    fetchImpl: passingFetch,
  });
  assert.equal(report.verdict, 'pass', report.reason || JSON.stringify(report.checks));
  assert.equal(report.baseUrl, 'https://thumbgate.ai');
});

test('buildProductionHostAllowlist includes Railway and public buyer hosts', () => {
  const hosts = buildProductionHostAllowlist();
  for (const host of DEFAULT_PRODUCTION_PROOF_HOSTS) {
    assert.equal(hosts.has(host), true, host);
  }
  assert.equal(validateBaseUrl('https://thumbgate.ai').valid, true);
  assert.equal(validateBaseUrl('https://www.thumbgate.ai').valid, true);
  assert.equal(validateBaseUrl('https://thumbgate-production.up.railway.app').valid, true);
  assert.equal(validateBaseUrl('https://evil.example').valid, false);
});

test('proof rejects shallow dashboard and zero-record export responses', async () => {
  const report = await runAuthenticatedProductionProof({
    apiKey: 'secret-test-key',
    baseUrl: DEFAULT_BASE_URL,
    expectedSha: 'abc123',
    expectedVersion: '1.32.0',
    maxAttempts: 1,
    fetchImpl: async (url, options) => {
      if (url.endsWith('/v1/dashboard')) return response(200, { error: 'backend unavailable' });
      if (url.endsWith('/v1/dpo/export')) {
        return response(200, { pairs: 0, pairCount: 0, errors: 0, learnings: 0, records: [] });
      }
      return passingFetch(url, options);
    },
  });
  assert.equal(report.verdict, 'fail');
  assert.equal(report.checks.find((check) => check.name === 'dashboard_data').ok, false);
  assert.equal(report.checks.find((check) => check.name === 'dpo_export').ok, false);
});

test('proof retries transient throttling and valid-HTTP deployment lag', async () => {
  let healthCalls = 0;
  let searchCalls = 0;
  const report = await runAuthenticatedProductionProof({
    apiKey: 'secret-test-key',
    baseUrl: DEFAULT_BASE_URL,
    expectedSha: 'abc123',
    expectedVersion: '1.32.0',
    maxAttempts: 3,
    retryDelayMs: 1,
    fetchImpl: async (url, options) => {
      if (url.endsWith('/health')) {
        healthCalls += 1;
        if (healthCalls === 1) return response(200, { ...passingBody(url), buildSha: 'old-sha' });
      }
      if (url.includes('/v1/search') && !url.includes('/lessons/') && options.headers.authorization) {
        searchCalls += 1;
        if (searchCalls === 1) return response(429, { error: 'retry later' });
      }
      return passingFetch(url, options);
    },
  });
  assert.equal(report.verdict, 'pass', JSON.stringify(report));
  assert.equal(healthCalls, 2);
  assert.equal(searchCalls, 2);
});
