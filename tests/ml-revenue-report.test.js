'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseArgs,
  parseSince,
  buildUtmSurfaces,
  buildCtaSurfaces,
  buildReport,
  renderReport,
  OWNER_EMAILS,
} = require('../scripts/ml-revenue-report');

test('parseArgs: --json, --output, --since, --app-origin', () => {
  assert.deepStrictEqual(parseArgs([]), { json: false, output: null, since: null, appOrigin: null });
  assert.strictEqual(parseArgs(['--json']).json, true);
  assert.strictEqual(parseArgs(['--output', 'x.md']).output, 'x.md');
  assert.strictEqual(parseArgs(['--since', '30d']).since, '30d');
  assert.strictEqual(parseArgs(['--app-origin', 'https://x.test']).appOrigin, 'https://x.test');
});

test('parseSince: relative windows', () => {
  const NOW = Date.parse('2026-05-19T13:00:00Z');
  assert.strictEqual(parseSince('1d', NOW), '2026-05-18T13:00:00.000Z');
  assert.strictEqual(parseSince('7d', NOW), '2026-05-12T13:00:00.000Z');
  assert.strictEqual(parseSince('30d', NOW), '2026-04-19T13:00:00.000Z');
});

test('parseSince: defaults to last 7 days', () => {
  const NOW = Date.parse('2026-05-19T13:00:00Z');
  assert.strictEqual(parseSince(null, NOW), '2026-05-12T13:00:00.000Z');
});

test('OWNER_EMAILS: founder email is excluded so self-purchases dont distort the rate', () => {
  assert.ok(OWNER_EMAILS.has('iganapolsky@gmail.com'));
});

test('buildUtmSurfaces: groups page_views by utm_source, joins charges by metadata.utm_source', () => {
  const telemetry = [
    { eventType: 'page_view', utm_source: 'reddit' },
    { eventType: 'page_view', utm_source: 'reddit' },
    { eventType: 'page_view', utm_source: 'threads' },
    { eventType: 'page_view' }, // direct
    { eventType: 'checkout_interstitial_view', utm_source: 'reddit' },
    { eventType: 'cta_click', utm_source: 'ignored' }, // not a view event
  ];
  const charges = [
    { metadata: { utm_source: 'reddit' }, billing_details: { email: 'a@x.com' } },
    { metadata: { utm_source: 'reddit' }, billing_details: { email: 'b@x.com' } },
    { metadata: {}, billing_details: { email: 'c@x.com' } }, // unattributed
  ];
  const surfaces = buildUtmSurfaces(telemetry, charges);
  const byKey = Object.fromEntries(surfaces.map((s) => [s.surface, s]));
  assert.strictEqual(byKey['utm_source=reddit'].visitors, 3); // 2 page_view + 1 checkout_interstitial_view
  assert.strictEqual(byKey['utm_source=reddit'].charges, 2);
  assert.strictEqual(byKey['utm_source=threads'].visitors, 1);
  assert.strictEqual(byKey['utm_source=threads'].charges, 0);
  assert.strictEqual(byKey['utm_source=(direct)'].visitors, 1);
  assert.strictEqual(byKey['utm_source=(unattributed)'].charges, 1);
});

test('buildCtaSurfaces: groups CTA-click events by ctaId, joins charges by metadata.cta_id', () => {
  const telemetry = [
    { eventType: 'cta_click', ctaId: 'pro_checkout_confirmed' },
    { eventType: 'checkout_interstitial_cta_clicked', ctaId: 'pro_checkout_confirmed' },
    { eventType: 'cta_click', ctaId: 'team_self_serve' },
    { eventType: 'page_view', ctaId: 'ignored' }, // not a click event
  ];
  const charges = [
    { metadata: { cta_id: 'pro_checkout_confirmed' } },
    { metadata: {} },
  ];
  const surfaces = buildCtaSurfaces(telemetry, charges);
  const byKey = Object.fromEntries(surfaces.map((s) => [s.surface, s]));
  assert.strictEqual(byKey['cta_id=pro_checkout_confirmed'].visitors, 2);
  assert.strictEqual(byKey['cta_id=pro_checkout_confirmed'].charges, 1);
  assert.strictEqual(byKey['cta_id=team_self_serve'].visitors, 1);
  assert.strictEqual(byKey['cta_id=(unattributed)'].charges, 1);
});

test('buildReport: end-to-end with mocked telemetry + stripe', async () => {
  const fakeFetch = async (url) => ({
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({
      since: '2026-05-12T00:00:00Z',
      telemetry: {
        rows: [
          { eventType: 'page_view', utm_source: 'reddit' },
          { eventType: 'page_view', utm_source: 'reddit' },
          { eventType: 'page_view', utm_source: 'reddit' },
          { eventType: 'page_view', utm_source: 'threads' },
        ],
      },
      funnel: { rows: [] },
    }),
  });
  const fakeStripeFactory = () => ({
    charges: {
      list: async () => ({
        data: [
          { created: Math.floor(Date.now() / 1000), paid: true, metadata: { utm_source: 'reddit', cta_id: 'pro' }, billing_details: { email: 'real@buyer.com' } },
          { created: Math.floor(Date.now() / 1000), paid: true, metadata: {}, billing_details: { email: 'iganapolsky@gmail.com' } }, // owner, excluded
        ],
        has_more: false,
      }),
    },
  });

  const report = await buildReport({
    appOrigin: 'https://test.local',
    apiKey: 'thumbgate-key',
    stripeSecret: 'sk_test',
    since: new Date(Date.now() - 86400 * 1000).toISOString(),
    fetchImpl: fakeFetch,
    stripeFactory: fakeStripeFactory,
  });

  assert.strictEqual(report.telemetryCount, 4);
  assert.strictEqual(report.chargeCount, 1); // founder charge excluded
  assert.ok(Array.isArray(report.utmRanked));
  assert.ok(Array.isArray(report.ctaRanked));
});

test('buildReport: missing THUMBGATE_API_KEY throws', async () => {
  await assert.rejects(
    () => buildReport({ appOrigin: 'x', stripeSecret: 'sk' }),
    /THUMBGATE_API_KEY/
  );
});

test('buildReport: missing STRIPE_SECRET_KEY throws', async () => {
  await assert.rejects(
    () => buildReport({ appOrigin: 'x', apiKey: 'k' }),
    /STRIPE_SECRET_KEY/
  );
});

test('renderReport: includes Bayesian framing + sections', () => {
  const md = renderReport({
    generatedAt: '2026-05-19T13:00:00Z',
    since: '2026-05-12T13:00:00Z',
    telemetryCount: 100,
    chargeCount: 0,
    utmRanked: [],
    ctaRanked: [],
  });
  assert.match(md, /# ML Revenue Report/);
  assert.match(md, /Beta-binomial Bayesian posterior/);
  assert.match(md, /Per UTM source/);
  assert.match(md, /Per CTA placement/);
  assert.match(md, /uninformative.*genuinely do not know/i);
});
