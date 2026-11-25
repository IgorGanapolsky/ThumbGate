'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseArgs,
  loadManifest,
  probePage,
  runVerification,
  renderHuman,
  DEFAULT_PROD_URL,
  DEFAULT_MANIFEST_PATH,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_RETRY_DELAY_MS,
} = require('../scripts/verify-marketing-pages-deployed');

function writeManifest(pages, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-vmpd-'));
  const file = path.join(dir, 'manifest.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, pages, ...extra }));
  return { dir, file };
}

function response(body, { status = 200, ok = true } = {}) {
  return {
    status,
    ok,
    async text() { return body; },
  };
}

test('parseArgs: defaults + each flag', () => {
  const def = parseArgs([]);
  assert.equal(def.prodUrl, process.env.THUMBGATE_PROD_URL || DEFAULT_PROD_URL);
  assert.equal(def.json, false);
  assert.equal(def.quiet, false);
  assert.equal(def.manifestPath, DEFAULT_MANIFEST_PATH);

  const flagged = parseArgs(['--json', '--quiet', '--prod-url=https://staging.example.com', '--manifest=/tmp/x.json', '--timeout-ms=5000', '--max-attempts=3', '--retry-delay-ms=250']);
  assert.equal(flagged.json, true);
  assert.equal(flagged.quiet, true);
  assert.equal(flagged.prodUrl, 'https://staging.example.com');
  assert.equal(flagged.manifestPath, '/tmp/x.json');
  assert.equal(flagged.timeoutMs, 5000);
  assert.equal(flagged.maxAttempts, 3);
  assert.equal(flagged.retryDelayMs, 250);

  // Negative + non-numeric --timeout-ms is ignored (defaults preserved)
  const bad = parseArgs(['--timeout-ms=not-a-number']);
  assert.equal(bad.timeoutMs, 12000);
  assert.equal(bad.maxAttempts, DEFAULT_MAX_ATTEMPTS);
  assert.equal(bad.retryDelayMs, DEFAULT_RETRY_DELAY_MS);
});

test('loadManifest: rejects empty pages array', () => {
  const { file } = writeManifest([]);
  assert.throws(() => loadManifest(file), /has no pages/);
});

test('loadManifest: rejects entry with missing route prefix', () => {
  const { file } = writeManifest([{ route: 'agent-manager', sentinel: 'x' }]);
  assert.throws(() => loadManifest(file), /Invalid route/);
});

test('loadManifest: rejects entry with empty sentinel', () => {
  const { file } = writeManifest([{ route: '/x', sentinel: '' }]);
  assert.throws(() => loadManifest(file), /Invalid sentinel/);
});

test('loadManifest: accepts a well-formed manifest', () => {
  const { file } = writeManifest([
    { route: '/x', sentinel: 'Hello', description: 'first' },
    { route: '/y', sentinel: 'World' },
  ]);
  const m = loadManifest(file);
  assert.equal(m.pages.length, 2);
  assert.equal(m.version, 1);
});

test('loadManifest: rejects invalid route-specific user agents', () => {
  const { file } = writeManifest([
    { route: '/checkout/pro', sentinel: 'Checkout', userAgent: '' },
  ]);
  assert.throws(() => loadManifest(file), /Invalid userAgent/);
});

test('probePage: ok=true when status 200 + sentinel present', async () => {
  const r = await probePage({
    prodUrl: 'https://x.test',
    route: '/agent-manager',
    sentinel: 'You own CLAUDE.md',
    fetchImpl: async () => response('...You own CLAUDE.md...'),
  });
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.equal(r.sentinelPresent, true);
});

test('probePage: ok=false when sentinel missing', async () => {
  const r = await probePage({
    prodUrl: 'https://x.test',
    route: '/agent-manager',
    sentinel: 'You own CLAUDE.md',
    fetchImpl: async () => response('some other body'),
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 200);
  assert.equal(r.sentinelPresent, false);
});

test('probePage: ok=false when forbidden content is present', async () => {
  const r = await probePage({
    prodUrl: 'https://x.test',
    route: '/checkout/pro',
    sentinel: 'Required so the checkout has attributable buyer intent and your receipt can be recovered.',
    mustNotContain: ['Optional. Stripe can collect your email on the secure checkout page.'],
    fetchImpl: async () => response('Required so the checkout has attributable buyer intent and your receipt can be recovered. Optional. Stripe can collect your email on the secure checkout page.'),
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.forbiddenPresent, ['Optional. Stripe can collect your email on the secure checkout page.']);
});

test('probePage: ok=true when sentinel is present and forbidden content is absent', async () => {
  const r = await probePage({
    prodUrl: 'https://x.test',
    route: '/checkout/pro',
    sentinel: 'Required so the checkout has attributable buyer intent and your receipt can be recovered.',
    mustNotContain: ['Optional. Stripe can collect your email on the secure checkout page.'],
    fetchImpl: async () => response('Required so the checkout has attributable buyer intent and your receipt can be recovered.'),
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.forbiddenPresent, []);
});

test('probePage: ok=false when HTTP status is non-2xx', async () => {
  const r = await probePage({
    prodUrl: 'https://x.test',
    route: '/down',
    sentinel: 'whatever',
    fetchImpl: async () => response('whatever', { status: 500, ok: false }),
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 500);
});

test('probePage: surfaces fetch errors as error field', async () => {
  const r = await probePage({
    prodUrl: 'https://x.test',
    route: '/whatever',
    sentinel: 'x',
    retryDelayMs: 0,
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /ECONNREFUSED/);
});

test('probePage: aborts on timeout', async () => {
  const r = await probePage({
    prodUrl: 'https://x.test',
    route: '/slow',
    sentinel: 'x',
    timeoutMs: 5,
    retryDelayMs: 0,
    fetchImpl: async (_url, opts) => new Promise((_, reject) => {
      if (opts?.signal) opts.signal.addEventListener('abort', () => {
        const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
      });
    }),
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /^timeout_after_/);
  assert.equal(r.attempts, DEFAULT_MAX_ATTEMPTS);
});

test('probePage: retries a transient timeout and records recovery', async () => {
  let calls = 0;
  const r = await probePage({
    prodUrl: 'https://x.test',
    route: '/',
    sentinel: 'buyer page',
    retryDelayMs: 0,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      }
      return response('buyer page');
    },
  });

  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
  assert.equal(r.recoveredAfterRetry, true);
  assert.equal(calls, 2);
});

test('probePage: retries a transient response-body disconnect', async () => {
  let calls = 0;
  const r = await probePage({
    prodUrl: 'https://x.test',
    route: '/',
    sentinel: 'buyer page',
    retryDelayMs: 0,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          status: 200,
          ok: true,
          async text() { throw new Error('terminated'); },
        };
      }
      return response('buyer page');
    },
  });

  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
  assert.equal(r.recoveredAfterRetry, true);
  assert.equal(calls, 2);
});

test('probePage: does not retry a deterministic content mismatch', async () => {
  let calls = 0;
  const r = await probePage({
    prodUrl: 'https://x.test',
    route: '/',
    sentinel: 'expected buyer page',
    retryDelayMs: 0,
    fetchImpl: async () => {
      calls += 1;
      return response('wrong content');
    },
  });

  assert.equal(r.ok, false);
  assert.equal(r.attempts, 1);
  assert.equal(calls, 1);
});

test('probePage: ok=false when fetch is unavailable', async () => {
  const r = await probePage({
    prodUrl: 'https://x.test',
    route: '/x',
    sentinel: 'y',
    fetchImpl: null,
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'fetch_unavailable');
});

test('runVerification: pass verdict when every page matches', async () => {
  const { file } = writeManifest([
    { route: '/a', sentinel: 'alpha' },
    { route: '/b', sentinel: 'beta' },
  ]);
  const fetchImpl = async (url) => {
    if (url.endsWith('/a')) return response('xxx alpha xxx');
    if (url.endsWith('/b')) return response('yyy beta yyy');
    return response('', { status: 404, ok: false });
  };
  const report = await runVerification({ prodUrl: 'https://x.test', manifestPath: file, fetchImpl });
  assert.equal(report.verdict, 'pass');
  assert.equal(report.passedCount, 2);
  assert.equal(report.failedCount, 0);
});

test('runVerification: fail verdict when ANY page sentinel is missing', async () => {
  const { file } = writeManifest([
    { route: '/a', sentinel: 'alpha' },
    { route: '/b', sentinel: 'beta-MISSING-IN-RESPONSE' },
  ]);
  const fetchImpl = async (url) => {
    if (url.endsWith('/a')) return response('xxx alpha xxx');
    if (url.endsWith('/b')) return response('only some other content');
    return response('', { status: 404, ok: false });
  };
  const report = await runVerification({ prodUrl: 'https://x.test', manifestPath: file, fetchImpl });
  assert.equal(report.verdict, 'fail');
  assert.equal(report.failedCount, 1);
  const failed = report.results.find((r) => !r.ok);
  assert.equal(failed.route, '/b');
});

test('renderHuman: shows per-route pass + fail lines and a summary', () => {
  const report = {
    prodUrl: 'https://x.test',
    totalRoutes: 3,
    passedCount: 2,
    failedCount: 1,
    verdict: 'fail',
    results: [
      { route: '/a', status: 200, bytes: 100, ok: true, sentinelPresent: true, sentinel: 'alpha' },
      { route: '/b', status: 200, bytes: 80, ok: false, sentinelPresent: false, sentinel: 'beta' },
      { route: '/c', ok: false, error: 'ECONNREFUSED', sentinel: 'gamma' },
    ],
  };
  const out = renderHuman(report);
  assert.match(out, /✅ \/a/);
  assert.match(out, /❌ \/b.*sentinel MISSING/);
  assert.match(out, /❌ \/c.*ERROR ECONNREFUSED/);
  assert.match(out, /Summary: 2\/3 pages passed/);
  assert.match(out, /verdict: FAIL/);
});

test('renderHuman: shows forbidden content failures', () => {
  const report = {
    prodUrl: 'https://x.test',
    totalRoutes: 1,
    passedCount: 0,
    failedCount: 1,
    verdict: 'fail',
    results: [
      {
        route: '/checkout/pro',
        status: 200,
        bytes: 100,
        ok: false,
        sentinelPresent: true,
        sentinel: 'Required so the checkout has attributable buyer intent and your receipt can be recovered.',
        forbiddenPresent: ['Optional. Stripe can collect your email on the secure checkout page.'],
      },
    ],
  };
  const out = renderHuman(report);
  assert.match(out, /forbidden content PRESENT/);
  assert.match(out, /Optional\. Stripe can collect your email/);
});

test('renderHuman: --quiet suppresses per-route lines but keeps summary', () => {
  const report = {
    prodUrl: 'https://x.test',
    totalRoutes: 2,
    passedCount: 2,
    failedCount: 0,
    verdict: 'pass',
    results: [
      { route: '/a', status: 200, bytes: 100, ok: true, sentinelPresent: true, sentinel: 'alpha' },
      { route: '/b', status: 200, bytes: 100, ok: true, sentinelPresent: true, sentinel: 'beta' },
    ],
  };
  const out = renderHuman(report, { quiet: true });
  assert.doesNotMatch(out, /✅ \/a/);
  assert.match(out, /Summary: 2\/2/);
});

test('manifest contract: shipped config/post-deploy-marketing-pages.json is valid', () => {
  // Lock the production manifest against the same loader the workflow
  // uses. If someone edits the manifest and breaks the schema, this
  // test catches it before the post-deploy step runs in CI.
  const m = loadManifest(DEFAULT_MANIFEST_PATH);
  assert.ok(m.pages.length >= 5, 'should cover at least the top-level marketing pages');
  // Spot-check that the home page is in the manifest with a stable
  // sentinel — losing this is the loudest possible regression.
  const home = m.pages.find((p) => p.route === '/');
  assert.ok(home, 'manifest must include /');
  assert.ok(home.sentinel.length > 0);
  const homeHtml = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(
    homeHtml.includes(home.sentinel),
    'home-page sentinel must match shipped public/index.html before deployment',
  );
  const diagnostic = m.pages.find((p) => p.route === '/diagnostic');
  assert.ok(diagnostic, 'manifest must include /diagnostic');
  const diagnosticHtml = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'diagnostic.html'), 'utf8');
  assert.ok(
    diagnosticHtml.includes(diagnostic.sentinel),
    'diagnostic sentinel must match shipped public/diagnostic.html before deployment',
  );
  const checkout = m.pages.find((p) => p.route === '/checkout/pro');
  assert.ok(checkout, 'manifest must include the revenue-critical Pro checkout route');
  assert.match(checkout.sentinel, /attributable buyer intent/);
  assert.ok(checkout.mustNotContain.includes('Optional. Stripe can collect your email on the secure checkout page.'));
  assert.equal(checkout.userAgent, 'curl/8.0.0');
  const serverSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'api', 'server.js'), 'utf8');
  assert.ok(
    serverSource.includes(checkout.sentinel),
    'checkout sentinel must match the shipped server-rendered intent page',
  );
  assert.doesNotMatch(serverSource, /Optional\. Stripe can collect your email on the secure checkout page\./);
});
