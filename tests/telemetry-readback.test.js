'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseArgs,
  parseSince,
  fetchTelemetry,
  aggregateTelemetry,
  renderMarkdown,
  topNByKey,
} = require('../scripts/telemetry-readback');

test('parseArgs: flags + paired values', () => {
  assert.deepStrictEqual(parseArgs([]).json, false);
  assert.strictEqual(parseArgs(['--json']).json, true);
  assert.strictEqual(parseArgs(['--since', '7d']).since, '7d');
  assert.strictEqual(parseArgs(['--limit', '500']).limit, 500);
  assert.strictEqual(parseArgs(['--output', '/tmp/x.md']).output, '/tmp/x.md');
  assert.strictEqual(parseArgs(['--app-origin', 'https://example.test']).appOrigin, 'https://example.test');
});

test('parseSince: relative windows', () => {
  const NOW = Date.parse('2026-05-18T20:00:00Z');
  assert.strictEqual(parseSince('1h', NOW), '2026-05-18T19:00:00.000Z');
  assert.strictEqual(parseSince('24h', NOW), '2026-05-17T20:00:00.000Z');
  assert.strictEqual(parseSince('7d', NOW), '2026-05-11T20:00:00.000Z');
});

test('parseSince: explicit ISO passes through', () => {
  const NOW = Date.parse('2026-05-18T20:00:00Z');
  assert.strictEqual(parseSince('2026-05-15T00:00:00Z', NOW), '2026-05-15T00:00:00.000Z');
});

test('parseSince: no argument defaults to last 24h', () => {
  const NOW = Date.parse('2026-05-18T20:00:00Z');
  assert.strictEqual(parseSince(null, NOW), '2026-05-17T20:00:00.000Z');
});

test('topNByKey: returns sorted top-N by frequency', () => {
  const rows = [
    { type: 'a' }, { type: 'a' }, { type: 'a' },
    { type: 'b' }, { type: 'b' },
    { type: 'c' },
  ];
  assert.deepStrictEqual(topNByKey(rows, (r) => r.type, 2), [['a', 3], ['b', 2]]);
});

test('topNByKey: ignores rows where key function returns falsy', () => {
  const rows = [{ type: 'a' }, { type: '' }, { type: null }, { type: 'a' }];
  assert.deepStrictEqual(topNByKey(rows, (r) => r.type), [['a', 2]]);
});

test('aggregateTelemetry: groups telemetry rows by eventType + ctaId + utm_source', () => {
  const payload = {
    since: '2026-05-17T00:00:00Z',
    telemetry: {
      totalAfterSince: 5,
      rows: [
        { eventType: 'page_view', ctaId: null },
        { eventType: 'page_view', ctaId: null },
        { eventType: 'cta_click', ctaId: 'pro_checkout_confirmed', ctaPlacement: 'checkout_interstitial', utm_source: 'website' },
        { eventType: 'cta_click', ctaId: 'pro_checkout_confirmed', ctaPlacement: 'checkout_interstitial', utm_source: 'website' },
        { eventType: 'lead_capture', ctaId: 'workflow_sprint_intake', utm_source: 'reddit' },
      ],
    },
    funnel: { totalAfterSince: 2, rows: [{ stage: 'pageview' }, { stage: 'checkout_started' }] },
  };
  const agg = aggregateTelemetry(payload);
  assert.strictEqual(agg.telemetryRowCount, 5);
  assert.strictEqual(agg.funnelRowCount, 2);
  assert.deepStrictEqual(agg.byEventType, [['page_view', 2], ['cta_click', 2], ['lead_capture', 1]]);
  assert.deepStrictEqual(agg.byCtaId, [
    ['pro_checkout_confirmed @ checkout_interstitial', 2],
    ['workflow_sprint_intake @ unknown', 1],
  ]);
  assert.deepStrictEqual(agg.byUtmSource, [['website', 2], ['reddit', 1]]);
  assert.deepStrictEqual(agg.byFunnelStage, [['pageview', 1], ['checkout_started', 1]]);
});

test('aggregateTelemetry: empty payload renders empty buckets, not crash', () => {
  const agg = aggregateTelemetry({});
  assert.strictEqual(agg.telemetryRowCount, 0);
  assert.strictEqual(agg.funnelRowCount, 0);
  assert.deepStrictEqual(agg.byEventType, []);
});

test('renderMarkdown: includes headers + table rows + "no data" placeholder', () => {
  const agg = aggregateTelemetry({
    since: '2026-05-17T00:00:00Z',
    telemetry: { totalAfterSince: 1, rows: [{ eventType: 'page_view' }] },
    funnel: { totalAfterSince: 0, rows: [] },
  });
  const md = renderMarkdown(agg);
  assert.match(md, /# ThumbGate Funnel Snapshot/);
  assert.match(md, /## Top eventTypes/);
  assert.match(md, /\| page_view \| 1 \|/);
  assert.match(md, /## Top funnel stages/);
  assert.match(md, /_no data in window_/);
});

test('fetchTelemetry: passes Authorization header + params + parses JSON', async () => {
  const seen = {};
  const fakeFetch = async (url, init) => {
    seen.url = url.toString();
    seen.auth = init.headers.authorization;
    return { ok: true, json: async () => ({ since: '2026-05-17T00:00:00Z', telemetry: { rows: [] }, funnel: { rows: [] } }) };
  };
  const result = await fetchTelemetry({
    appOrigin: 'https://example.test',
    apiKey: 'sk-test',
    since: '2026-05-17T00:00:00Z',
    limit: 500,
    fetchImpl: fakeFetch,
  });
  assert.match(seen.url, /\/v1\/telemetry\/export/);
  assert.match(seen.url, /since=2026-05-17T00%3A00%3A00Z/);
  assert.match(seen.url, /limit=500/);
  assert.match(seen.url, /source=both/);
  assert.strictEqual(seen.auth, 'Bearer sk-test');
  assert.strictEqual(result.telemetry.rows.length, 0);
});

test('fetchTelemetry: non-2xx throws with status code', async () => {
  const fakeFetch = async () => ({ ok: false, status: 401, text: async () => 'Unauthorized' });
  await assert.rejects(
    () => fetchTelemetry({ appOrigin: 'https://example.test', apiKey: 'wrong', since: '2026-05-17T00:00:00Z', limit: 100, fetchImpl: fakeFetch }),
    /HTTP 401/
  );
});
