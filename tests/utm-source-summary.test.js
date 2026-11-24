'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const NOW = new Date('2026-11-18T12:00:00.000Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'utm-source-summary-'));
const feedbackDir = path.join(tmpRoot, 'feedback');
fs.mkdirSync(feedbackDir, { recursive: true });

const rows = [
  // linkedin: 2 visits in 7d (one visitor twice), 1 more at 20d, 1 at 40d (outside both)
  { receivedAt: daysAgo(1), clientType: 'web', eventType: 'landing_page_view', utmSource: 'linkedin', source: 'linkedin', visitorId: 'v1' },
  { receivedAt: daysAgo(2), clientType: 'web', eventType: 'landing_page_view', utmSource: 'LinkedIn', source: 'linkedin', visitorId: 'v1' },
  { receivedAt: daysAgo(20), clientType: 'web', eventType: 'landing_page_view', utmSource: 'linkedin', source: 'linkedin', visitorId: 'v2' },
  { receivedAt: daysAgo(40), clientType: 'web', eventType: 'landing_page_view', utmSource: 'linkedin', source: 'linkedin', visitorId: 'v3' },
  // checkout starts and installs by source
  { receivedAt: daysAgo(1), clientType: 'web', eventType: 'checkout_start', utmSource: 'linkedin', source: 'linkedin', visitorId: 'v1' },
  { receivedAt: daysAgo(15), clientType: 'web', eventType: 'checkout_bootstrap', utmSource: 'linkedin', source: 'linkedin', visitorId: 'v2' },
  { receivedAt: daysAgo(3), clientType: 'cli', eventType: 'cli_init', utmSource: 'linkedin', source: 'linkedin', installId: 'inst_a' },
  { receivedAt: daysAgo(4), clientType: 'cli', eventType: 'cli_init', utmSource: 'linkedin', source: 'linkedin', installId: 'inst_a' },
  { receivedAt: daysAgo(25), clientType: 'cli', eventType: 'cli_init', source: 'reddit', installId: 'inst_b' },
  // reddit visit in 7d, taken from `source` because utmSource is missing
  { receivedAt: daysAgo(5), clientType: 'web', eventType: 'landing_page_view', source: 'reddit', visitorId: 'v4' },
  // our own traffic is not counted
  { receivedAt: daysAgo(1), clientType: 'web', eventType: 'landing_page_view', utmSource: 'linkedin', source: 'linkedin', visitorId: 'owner', userAgent: 'github-actions', audienceReasons: ['internal_operator_or_ci'] },
  // no source at all: the loader files it under direct
  { receivedAt: daysAgo(6), clientType: 'web', eventType: 'landing_page_view', visitorId: 'v5' },
];

before(() => {
  fs.writeFileSync(path.join(feedbackDir, 'telemetry-pings.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
});

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('getUtmSourceSummary', () => {
  const { getUtmSourceSummary } = require('../scripts/utm-source-summary');

  it('groups visits, installs and checkout starts by utm_source for the last 7 and 30 days', () => {
    const out = getUtmSourceSummary(feedbackDir, { now: NOW });
    assert.deepEqual(out.windows.map((w) => w.days), [7, 30]);
    const seven = Object.fromEntries(out.windows[0].sources.map((s) => [s.source, s]));
    const thirty = Object.fromEntries(out.windows[1].sources.map((s) => [s.source, s]));

    assert.deepEqual(
      { visits: seven.linkedin.visits, visitors: seven.linkedin.visitors, installs: seven.linkedin.installs, checkoutStarts: seven.linkedin.checkoutStarts },
      { visits: 2, visitors: 1, installs: 1, checkoutStarts: 1 },
    );
    assert.deepEqual(
      { visits: thirty.linkedin.visits, visitors: thirty.linkedin.visitors, installs: thirty.linkedin.installs, checkoutStarts: thirty.linkedin.checkoutStarts },
      { visits: 3, visitors: 2, installs: 1, checkoutStarts: 2 },
    );
  });

  it('falls back to source, keeps no-source traffic as direct, and never counts internal traffic', () => {
    const out = getUtmSourceSummary(feedbackDir, { now: NOW });
    const seven = Object.fromEntries(out.windows[0].sources.map((s) => [s.source, s]));
    assert.equal(seven.reddit.visits, 1);
    assert.equal(seven.direct.visits, 1);
    assert.equal(seven.linkedin.visits, 2, 'the internal row is excluded');
    const thirty = Object.fromEntries(out.windows[1].sources.map((s) => [s.source, s]));
    assert.equal(thirty.reddit.installs, 1);
  });

  it('sorts by visits, then name, and reports totals and the as-of time', () => {
    const out = getUtmSourceSummary(feedbackDir, { now: NOW });
    assert.deepEqual(out.windows[0].sources.map((s) => s.source), ['linkedin', 'direct', 'reddit']);
    assert.deepEqual(out.windows[0].totals, { visits: 4, visitors: 3, installs: 1, checkoutStarts: 1 });
    assert.equal(out.asOf, NOW.toISOString());
  });

  it('an empty feedback directory gives empty windows, not an error', () => {
    const empty = fs.mkdtempSync(path.join(tmpRoot, 'empty-'));
    const out = getUtmSourceSummary(empty, { now: NOW });
    assert.deepEqual(out.windows.map((w) => w.sources.length), [0, 0]);
  });
});

describe('GET /v1/analytics/sources', () => {
  const ENV = {
    THUMBGATE_FEEDBACK_DIR: feedbackDir,
    THUMBGATE_API_KEY: ['unit', 'test', 'api', 'access'].join('-'),
    _TEST_API_KEYS_PATH: path.join(tmpRoot, 'api-keys.json'),
    _TEST_FUNNEL_LEDGER_PATH: path.join(tmpRoot, 'funnel-events.jsonl'),
    _TEST_REVENUE_LEDGER_PATH: path.join(tmpRoot, 'revenue-events.jsonl'),
  };
  const saved = {};
  let handle;
  let origin = '';

  before(async () => {
    for (const [k, v] of Object.entries(ENV)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    const { startServer } = require('../src/api/server');
    handle = await startServer({ port: 0, host: '127.0.0.1' });
    origin = `http://127.0.0.1:${handle.port}`;
  });

  after(() => {
    if (handle) handle.server.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('refuses a request with no key', async () => {
    const res = await fetch(`${origin}/v1/analytics/sources`);
    assert.ok([401, 403].includes(res.status), `status ${res.status}`);
  });

  it('refuses a wrong key', async () => {
    const res = await fetch(`${origin}/v1/analytics/sources`, { headers: { authorization: 'Bearer wrong-key' } });
    assert.ok([401, 403].includes(res.status), `status ${res.status}`);
  });

  it('returns both windows to the owner key and is read-only', async () => {
    const res = await fetch(`${origin}/v1/analytics/sources`, { headers: { authorization: `Bearer ${ENV.THUMBGATE_API_KEY}` } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.windows.map((w) => w.days), [7, 30]);
    assert.ok(Array.isArray(body.windows[0].sources));
    const post = await fetch(`${origin}/v1/analytics/sources`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ENV.THUMBGATE_API_KEY}`, 'content-type': 'application/json' },
      body: '{}',
    });
    assert.notEqual(post.status, 200);
  });
});
