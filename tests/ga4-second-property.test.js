'use strict';

// Google Analytics on thumbgate.ai: one measurement id (the ThumbGate property's stream, never the ApplyOps id a
// stale Railway variable carries), a tag on every public page including /pricing, /guide, /checkout/pro and
// /success, begin_checkout on the checkout page, purchase only on a Stripe-verified /success, Consent Mode v2 that
// follows the site's analytics banner, and nothing for GPC/DNT visitors or private pages.
// (File name kept from the earlier "second property" suite; package.json test:feedback-reward runs it.)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-ga4-'));
Object.assign(process.env, {
  _TEST_FUNNEL_LEDGER_PATH: path.join(tmp, 'funnel.jsonl'),
  _TEST_REVENUE_LEDGER_PATH: path.join(tmp, 'revenue.jsonl'),
  _TEST_API_KEYS_PATH: path.join(tmp, 'api-keys.json'),
  THUMBGATE_FEEDBACK_DIR: path.join(tmp, 'feedback'),
  THUMBGATE_API_KEY: ['unit', 'test', 'api', 'access'].join('-'),
  RAILWAY_ENVIRONMENT_ID: '',
  RAILWAY_PROJECT_ID: '',
});
fs.mkdirSync(process.env.THUMBGATE_FEEDBACK_DIR, { recursive: true });
delete process.env.THUMBGATE_GA_MEASUREMENT_ID;
delete process.env.THUMBGATE_GA_EXTRA_MEASUREMENT_ID;

const {
  DEFAULT_GA_MEASUREMENT_ID,
  resolveGaMeasurementId,
  resolveGaExtraMeasurementId,
  resolveGaMeasurementIds,
} = require('../scripts/hosted-config');
const gaTag = require('../scripts/ga-tag');
const { startServer } = require('../src/api/server');

const THUMBGATE_ID = 'G-QKENZBW1V8';
const APPLYOPS_ID = 'G-SZR5039QN4';
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
let handle;
let origin;

function get(urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(origin + urlPath, { headers: { 'user-agent': CHROME_UA, accept: 'text/html', ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

const loaders = (html) => (html.match(/googletagmanager\.com\/gtag\/js/g) || []).length;

test.before(async () => {
  handle = await startServer({ port: 0, host: '127.0.0.1' });
  origin = `http://127.0.0.1:${handle.port}`;
});

test.after(() => {
  if (handle) handle.server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.THUMBGATE_GA_MEASUREMENT_ID;
  delete process.env.THUMBGATE_GA_EXTRA_MEASUREMENT_ID;
});

test('REQ-01: one measurement id, the ThumbGate stream; the ApplyOps id is refused, "off" removes it', () => {
  assert.equal(DEFAULT_GA_MEASUREMENT_ID, THUMBGATE_ID);
  assert.equal(resolveGaMeasurementId(undefined), THUMBGATE_ID);
  assert.equal(resolveGaMeasurementId(APPLYOPS_ID), THUMBGATE_ID, 'the stale ApplyOps variable falls back');
  assert.equal(resolveGaMeasurementId('G-OTHER12345'), 'G-OTHER12345');
  assert.equal(resolveGaMeasurementId('not-an-id'), THUMBGATE_ID);
  assert.equal(resolveGaMeasurementId('off'), '');
  assert.equal(resolveGaExtraMeasurementId(undefined), '', 'no second property by default');
  assert.equal(resolveGaExtraMeasurementId(APPLYOPS_ID), '');
  assert.deepEqual(resolveGaMeasurementIds({ THUMBGATE_GA_MEASUREMENT_ID: APPLYOPS_ID }), [THUMBGATE_ID]);
  assert.deepEqual(resolveGaMeasurementIds({ THUMBGATE_GA_EXTRA_MEASUREMENT_ID: THUMBGATE_ID }), [THUMBGATE_ID]);
});

test('REQ-02: with the stale ApplyOps variable set, the home page loads only the ThumbGate id, once', async () => {
  process.env.THUMBGATE_GA_MEASUREMENT_ID = APPLYOPS_ID;
  const res = await get('/');
  assert.equal(res.status, 200);
  assert.equal(loaders(res.body), 1, 'one loader');
  assert.match(res.body, new RegExp(`gtag/js\\?id=${THUMBGATE_ID}`));
  assert.match(res.body, new RegExp(`gtag\\('config', '${THUMBGATE_ID}'`));
  assert.doesNotMatch(res.body, new RegExp(APPLYOPS_ID));
  assert.match(res.body, new RegExp(`const gaMeasurementId = '${THUMBGATE_ID}'`));
  delete process.env.THUMBGATE_GA_MEASUREMENT_ID;
});

test('REQ-03: /pricing, /guide and /checkout/pro each carry exactly one GA loader', async () => {
  for (const page of ['/pricing', '/guide', '/checkout/pro']) {
    const res = await get(page);
    assert.equal(res.status, 200, page);
    assert.equal(loaders(res.body), 1, `${page} has one loader`);
    assert.match(res.body, new RegExp(`gtag\\('config', '${THUMBGATE_ID}'`), page);
  }
});

test('REQ-04: /checkout/pro fires begin_checkout with the Pro item and no email', async () => {
  const res = await get('/checkout/pro?customer_email=buyer%40example.test&utm_source=test');
  assert.equal(res.status, 200);
  const line = res.body.split('\n').find((l) => l.includes("gtag('event', 'begin_checkout'"));
  assert.ok(line, 'begin_checkout event');
  assert.match(line, /"currency":"USD"/);
  assert.match(line, /"item_id":"pro"/);
  assert.doesNotMatch(line, /example\.test/, 'the event never carries the email');
});

test('REQ-05: /success is tagged, and an unverified session sends no purchase', async () => {
  const res = await get('/success?session_id=cs_test_notreal123');
  assert.equal(res.status, 200);
  assert.equal(loaders(res.body), 1);
  assert.doesNotMatch(res.body, /'purchase'/);
});

test('REQ-06: a purchase event carries the transaction id and value, and joins a page that has its own loader', () => {
  const bootstrap = gaTag.buildGaBootstrap([THUMBGATE_ID]);
  const page = `<html><head>${bootstrap}</head><body></body></html>`;
  const events = [{ name: 'purchase', params: { transaction_id: 'cs_test_abc', value: 19, currency: 'USD' } }];
  const out = gaTag.injectGaTag(page, { pathname: '/success', ids: [THUMBGATE_ID], events });
  assert.equal(loaders(out), 1, 'no second loader');
  assert.match(out, /gtag\('event', 'purchase', \{"transaction_id":"cs_test_abc","value":19,"currency":"USD"\}\)/);
  const fresh = gaTag.injectGaTag('<html><head></head></html>', { pathname: '/success', ids: [THUMBGATE_ID], events });
  assert.match(fresh, /gtag\('event', 'purchase'/);
  const hostile = gaTag.injectGaTag('<html><head></head></html>', {
    ids: [THUMBGATE_ID], events: [{ name: 'purchase', params: { x: '</script><script>alert(1)</script>' } }],
  });
  assert.doesNotMatch(hostile, /<\/script><script>alert/);
});

test('REQ-07: Consent Mode v2 denies ads always, denies analytics in the EEA/UK/CH, and follows the banner choice', () => {
  const tag = gaTag.buildGaBootstrap([THUMBGATE_ID]);
  const defaults = tag.split('\n').filter((l) => l.includes("gtag('consent', 'default'"));
  assert.equal(defaults.length, 2);
  assert.match(defaults[0], /"analytics_storage":"denied","region":\[[^\]]*"DE"[^\]]*"GB"[^\]]*"CH"\]/);
  assert.match(defaults[1], /"analytics_storage":"granted"/);
  for (const line of defaults) assert.match(line, /"ad_storage":"denied","ad_user_data":"denied","ad_personalization":"denied"/);
  assert.match(tag, /localStorage\.getItem\("thumbgate_analytics_consent"\)/);
  assert.ok(tag.indexOf("gtag('consent', 'default'") < tag.indexOf("gtag('config'"), 'consent defaults before config');
  const consentJs = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'clarity.js'), 'utf8');
  assert.match(consentJs, /w\.gtag\('consent','update',\{analytics_storage:v==='granted'\?'granted':'denied'\}\)/);
});

test('REQ-08: GPC/DNT visitors and private pages get no Google tag', async () => {
  for (const headers of [{ 'sec-gpc': '1' }, { dnt: '1' }]) {
    const res = await get('/pricing', headers);
    assert.equal(res.status, 200);
    assert.equal(loaders(res.body), 0, JSON.stringify(headers));
  }
  const home = await get('/', { 'sec-gpc': '1' });
  assert.equal(loaders(home.body), 0);
  for (const p of ['/admin', '/dashboard', '/signin', '/v1/health', '/lessons']) {
    assert.ok(gaTag.isSkippedPath(p), p);
  }
  assert.ok(!gaTag.isSkippedPath('/checkout/pro'));
  assert.ok(!gaTag.isSkippedPath('/success'));
});

test('REQ-09: "off" removes every Google tag', async () => {
  process.env.THUMBGATE_GA_MEASUREMENT_ID = 'off';
  const home = await get('/');
  const pricing = await get('/pricing');
  assert.equal(loaders(home.body), 0);
  assert.equal(loaders(pricing.body), 0);
  delete process.env.THUMBGATE_GA_MEASUREMENT_ID;
});

test('REQ-10: the home page checkout click sends checkout_cta_click, so begin_checkout is counted once', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const anchor = `querySelector('a[href="/checkout/pro"]').addEventListener('click', function () {`;
  const start = html.indexOf(anchor);
  assert.ok(start > 0, 'pro checkout click handler');
  const bodyStart = start + anchor.length;
  const bodyEnd = html.indexOf('\n      });', bodyStart);
  const calls = [];
  const handler = new Function('privacySignalOptOut', 'window', 'sendGa4Event', 'sendFirstPartyTelemetry', html.slice(bodyStart, bodyEnd));
  const click = (optOut) => handler(
    () => optOut,
    { plausible: (name, opts) => calls.push(['plausible', name, opts.props]) },
    (name, props) => calls.push(['ga4', name, props]),
    (name, props) => calls.push(['first-party', name, props]),
  );
  click(false);
  const ga4 = calls.filter((c) => c[0] === 'ga4');
  assert.deepEqual(ga4.map((c) => c[1]), ['checkout_cta_click']);
  assert.equal(ga4[0][2].planId, 'pro');
  calls.length = 0;
  click(true);
  assert.equal(calls.length, 0, 'a privacy opt-out sends nothing');
});

test('REQ-11: /tg-analytics.js serves the helper and the home page stores arrival campaign tags', async () => {
  const res = await get('/tg-analytics.js');
  assert.equal(res.status, 200);
  assert.match(res.body, /window\.tgUtm = tgUtm/);
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const helperAt = html.indexOf('<script src="/tg-analytics.js"></script>');
  assert.ok(helperAt > 0, 'home page loads the helper');
  assert.ok(html.indexOf('tgUtm();', helperAt) > helperAt, 'home page calls tgUtm() after the helper loads');
});
