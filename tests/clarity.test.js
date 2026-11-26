'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const clarity = require('../scripts/clarity');

const page = '<html><head><title>x</title></head><body><form action="/x"><input type="email" name="e"><textarea></textarea></form><script>const s = "<input type=\\"text\\">";</script></body></html>';

test('tag goes on public pages with form fields masked and script strings untouched', () => {
  const out = clarity.injectClarityTag(page, { pathname: '/pricing', headers: {}, env: {} });
  assert.match(out, /'https:\/\/www\.clarity\.ms\/tag\/'\+cfg\.clarity/);
  assert.match(out, /"clarity":"zjaflwztgq"/);
  assert.match(out, /<form data-clarity-mask="True" action/);
  assert.match(out, /<input data-clarity-mask="True" type="email"/);
  assert.match(out, /<textarea data-clarity-mask="True">/);
  assert.ok(out.includes('const s = "<input type=\\"text\\">";'), 'markup inside scripts stays as written');
  assert.ok(out.indexOf('clarity.ms') < out.indexOf('</head>'));
  assert.equal(clarity.injectClarityTag(out, { pathname: '/pricing', env: {} }), out, 'never injected twice');
});

test('no tag on private paths, privacy signals, or when switched off', () => {
  for (const pathname of ['/admin', '/admin/', '/admin.html', '/dashboard', '/dashboard/x', '/signin', '/checkout/pro', '/success', '/billing/portal', '/v1/admin/money', '/lessons', '/lessons.html', '/lessons/abc']) {
    assert.equal(clarity.injectClarityTag(page, { pathname, env: {} }), page, pathname);
  }
  assert.equal(clarity.injectClarityTag(page, { pathname: '/', headers: { 'sec-gpc': '1' }, env: {} }), page);
  assert.equal(clarity.injectClarityTag(page, { pathname: '/', headers: { dnt: '1' }, env: {} }), page);
  assert.equal(clarity.injectClarityTag(page, { pathname: '/', env: { THUMBGATE_CLARITY_PROJECT_ID: 'off', THUMBGATE_ORION: 'off' } }), page);
  const orionOnly = clarity.injectClarityTag(page, { pathname: '/', env: { THUMBGATE_CLARITY_PROJECT_ID: 'off' } });
  assert.match(orionOnly, /"clarity":""/, 'Clarity off: the consent tag carries no Clarity project');
  assert.doesNotMatch(orionOnly, /data-clarity-mask/);
  assert.ok(clarity.injectClarityTag(page, { pathname: '/signing-guide', env: {} }).includes('clarity.ms'), 'prefix match is per segment');
  assert.equal(clarity.resolveClarityProjectId({ THUMBGATE_CLARITY_PROJECT_ID: 'abc123def' }), 'abc123def');
  assert.equal(clarity.resolveClarityProjectId({ THUMBGATE_CLARITY_PROJECT_ID: '"><script>' }), 'zjaflwztgq');
});

const sample = (dim) => [
  { metricName: 'Traffic', information: dim ? [
    { totalSessionCount: '3', totalBotSessionCount: '1', distinctUserCount: '2', pagesPerSessionPercentage: 1.5, [dim]: 'b' },
    { totalSessionCount: '9', totalBotSessionCount: '0', distinctUserCount: '7', pagesPerSessionPercentage: 2, [dim]: 'a' },
  ] : [{ totalSessionCount: '12', totalBotSessionCount: '4', distantUserCount: '9', PagesPerSessionPercentage: 1.75 }] },
  { metricName: 'RageClickCount', information: [{ sessionsCount: '1', sessionsWithMetricPercentage: 8.3, sessionsWithoutMetricPercentage: 91.7 }] },
  { metricName: 'ScrollDepth', information: [{ averageScrollDepth: 41.2 }] },
];

test('export snapshot: 3 calls, cached on disk, token never returned', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clarity-'));
  const token = 'synthetic-clarity-token-0123456789';
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization });
    const dim = new URL(url).searchParams.get('dimension1');
    return { ok: true, status: 200, json: async () => sample(dim) };
  };
  const env = { THUMBGATE_CLARITY_API_TOKEN: token };
  const now = Date.UTC(2026, 10, 25, 18);
  const first = await clarity.collectClarity({ feedbackDir: dir, env, fetchImpl, now });
  assert.equal(calls.length, 3);
  assert.ok(calls.every((c) => c.auth === `Bearer ${token}` && c.url.startsWith(clarity.EXPORT_URL)));
  assert.deepEqual(first.warnings, []);
  assert.equal(first.data.summary.sessions, 12);
  assert.equal(first.data.summary.distinctUsers, 9);
  assert.equal(first.data.summary.rageClickSessionsPercent, 8.3);
  assert.equal(first.data.summary.averageScrollDepthPercent, 41.2);
  assert.equal(first.data.topPages[0].url, 'a');
  assert.equal(first.data.topSources[0].sessions, 9);
  assert.ok(!JSON.stringify(first).includes(token));
  const second = await clarity.collectClarity({ feedbackDir: dir, env, fetchImpl, now: now + 60000 });
  assert.equal(calls.length, 3, 'cached snapshot spends no export calls');
  assert.equal(second.data.summary.sessions, 12);
  await clarity.collectClarity({ feedbackDir: dir, env, fetchImpl, now: now + clarity.REFRESH_MS + 1 });
  assert.equal(calls.length, 6, 'refreshes after the window');
});

test('export: missing token and rejected token are reported, not zeroed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clarity-'));
  const none = await clarity.collectClarity({ feedbackDir: dir, env: {}, fetchImpl: async () => { throw new Error('no call'); } });
  assert.deepEqual(none.warnings, ['clarity_export_token_missing']);
  assert.equal(none.data.summary, undefined);
  assert.equal(none.data.tagEnabled, true);
  let calls = 0;
  const env = { THUMBGATE_CLARITY_API_TOKEN: 'synthetic-clarity-token-0123456789' };
  const rejected = await clarity.collectClarity({ feedbackDir: dir, env, fetchImpl: async () => { calls += 1; return { ok: false, status: 401 }; } });
  assert.ok(rejected.warnings.includes('clarity_token_rejected'));
  assert.equal(rejected.data.summary, null);
  await clarity.collectClarity({ feedbackDir: dir, env, fetchImpl: async () => { calls += 1; return { ok: false, status: 429 }; }, now: Date.now() + 1000 });
  assert.equal(calls, 1, 'a failure waits before the next try');
});

test('export: busiest traffic rows survive trimming, and another project\'s cache is ignored', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clarity-'));
  const rows = Array.from({ length: 30 }, (_, i) => ({ totalSessionCount: String(i), Url: 'p' + i }));
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { ok: true, status: 200, json: async () => [{ metricName: 'Traffic', information: rows }] }; };
  const env = { THUMBGATE_CLARITY_API_TOKEN: 'synthetic-clarity-token-0123456789' };
  const now = Date.UTC(2026, 10, 25, 18);
  const out = await clarity.collectClarity({ feedbackDir: dir, env, fetchImpl, now });
  assert.equal(out.data.topPages[0].url, 'p29');
  assert.equal(out.data.topPages.length, 25);
  assert.equal(out.data.metrics[0].rows[0].totalSessionCount, 29);
  await clarity.collectClarity({ feedbackDir: dir, env: { ...env, THUMBGATE_CLARITY_PROJECT_ID: 'otherproj1' }, fetchImpl, now: now + 1000 });
  assert.equal(calls, 6, 'a different project refreshes instead of reusing the cache');
});

test('local dev and test servers get no tag, and loopback pages stay out of the console tables', () => {
  const html = '<html><head></head><body></body></html>';
  const env = { THUMBGATE_CLARITY_PROJECT_ID: 'zjaflwztgq' };
  for (const host of ['localhost:3000', '127.0.0.1:18901', '[::1]:8080', 'localhost']) {
    assert.equal(clarity.injectAnalyticsTags(html, { pathname: '/', headers: { host }, env }), html, host);
  }
  assert.match(clarity.injectAnalyticsTags(html, { pathname: '/', headers: { host: 'thumbgate.ai' }, env }), /data-thumbgate-consent/);
  const rows = clarity.breakdown([{ name: 'Traffic', rows: [
    { Url: 'https://thumbgate.ai/', totalSessionCount: '3' },
    { Url: 'http://127.0.0.1:18901/pricing', totalSessionCount: '0' },
    { Url: 'http://localhost:3000/', totalSessionCount: '1' },
  ] }], 'Url');
  assert.deepEqual(rows.map((r) => r.url), ['https://thumbgate.ai/']);
  const sources = clarity.breakdown([{ name: 'Traffic', rows: [{ Source: '127.0.0.1', totalSessionCount: '0' }, { Source: 'google', totalSessionCount: '2' }] }], 'Source');
  assert.deepEqual(sources.map((r) => r.source), ['google']);
});
