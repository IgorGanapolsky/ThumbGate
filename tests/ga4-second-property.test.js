'use strict';

// AGENT-3667 item R: the second Google Analytics 4 property (G-QKENZBW1V8) is configured next to the first on every
// page the server injects the Google tag into, behind the same Global Privacy Control / Do Not Track suppression, and
// can be turned off or replaced with THUMBGATE_GA_EXTRA_MEASUREMENT_ID. No browser is opened here; the headless run
// that watches the real requests is described in the item report.
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

const { DEFAULT_GA_EXTRA_MEASUREMENT_ID, resolveGaExtraMeasurementId } = require('../scripts/hosted-config');
const { startServer } = require('../src/api/server');

const EXTRA = 'G-QKENZBW1V8';
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
let handle;
let origin;

function get(urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(origin + urlPath, { headers: { 'user-agent': CHROME_UA, ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

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

test('REQ-01: the extra property id defaults to the ThumbGate stream and can be replaced or turned off', () => {
  assert.equal(DEFAULT_GA_EXTRA_MEASUREMENT_ID, EXTRA);
  assert.equal(resolveGaExtraMeasurementId(undefined), EXTRA);
  assert.equal(resolveGaExtraMeasurementId('G-OTHER12345'), 'G-OTHER12345');
  assert.equal(resolveGaExtraMeasurementId('not-an-id'), EXTRA, 'a malformed value falls back to the default');
  assert.equal(resolveGaExtraMeasurementId('off'), '');
});

test('REQ-02: with the first property set, the home page configures both ids with one loader', async () => {
  process.env.THUMBGATE_GA_MEASUREMENT_ID = 'G-TEST1234';
  delete process.env.THUMBGATE_GA_EXTRA_MEASUREMENT_ID;
  const res = await get('/');
  assert.equal(res.status, 200);
  assert.equal((res.body.match(/googletagmanager\.com\/gtag\/js/g) || []).length, 1, 'one loader');
  assert.match(res.body, /gtag\/js\?id=G-TEST1234/);
  assert.match(res.body, /gtag\('config', 'G-TEST1234'\)/);
  assert.match(res.body, new RegExp(`gtag\\('config', '${EXTRA}'\\)`));
});

test('REQ-03: with no first property, the extra one still loads and the page checkout event guard sees an id', async () => {
  delete process.env.THUMBGATE_GA_MEASUREMENT_ID;
  const res = await get('/');
  assert.match(res.body, new RegExp(`gtag/js\\?id=${EXTRA}`));
  assert.match(res.body, new RegExp(`const gaMeasurementId = '${EXTRA}'`));
});

test('REQ-04: one home page checkout click sends one begin_checkout beside the Plausible checkout_start', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const anchor = `querySelector('a[href="/checkout/pro"]').addEventListener('click', function () {`;
  const start = html.indexOf(anchor);
  assert.ok(start > 0, 'pro checkout click handler');
  const bodyStart = start + anchor.length;
  const bodyEnd = html.indexOf('\n      });', bodyStart);
  assert.ok(bodyEnd > bodyStart, 'end of the click handler');
  const calls = [];
  // Run the page's own click handler with spies in place of the analytics senders.
  const handler = new Function('privacySignalOptOut', 'window', 'sendGa4Event', 'sendFirstPartyTelemetry', html.slice(bodyStart, bodyEnd));
  const click = (optOut) => handler(
    () => optOut,
    { plausible: (name, opts) => calls.push(['plausible', name, opts.props]) },
    (name, props) => calls.push(['ga4', name, props]),
    (name, props) => calls.push(['first-party', name, props]),
  );
  click(false);
  const ga4 = calls.filter((c) => c[0] === 'ga4');
  assert.equal(ga4.length, 1, 'exactly one GA4 event per click');
  assert.equal(ga4[0][1], 'begin_checkout');
  assert.equal(ga4[0][2].ctaId, 'homepage_pro_checkout');
  assert.equal(ga4[0][2].planId, 'pro');
  assert.equal(ga4[0][2].currency, 'USD');
  assert.deepEqual(calls.filter((c) => c[0] === 'plausible').map((c) => c[1]), ['checkout_start']);
  calls.length = 0;
  click(true);
  assert.equal(calls.length, 0, 'a privacy opt-out sends nothing');
});

test('REQ-05: a Global Privacy Control signal or "off" removes every Google tag', async () => {
  process.env.THUMBGATE_GA_MEASUREMENT_ID = 'G-TEST1234';
  const gpc = await get('/', { 'sec-gpc': '1' });
  assert.equal(gpc.status, 200);
  assert.doesNotMatch(gpc.body, /googletagmanager\.com|gtag\('config'/);
  process.env.THUMBGATE_GA_EXTRA_MEASUREMENT_ID = 'off';
  const off = await get('/');
  assert.equal(off.status, 200);
  assert.match(off.body, /gtag\('config', 'G-TEST1234'\)/);
  assert.doesNotMatch(off.body, new RegExp(EXTRA));
  delete process.env.THUMBGATE_GA_MEASUREMENT_ID;
  const none = await get('/');
  assert.equal(none.status, 200);
  assert.doesNotMatch(none.body, /googletagmanager\.com/);
});

test('REQ-06: /tg-analytics.js serves the helper and the home page stores arrival campaign tags', async () => {
  const res = await get('/tg-analytics.js');
  assert.equal(res.status, 200);
  assert.match(res.body, /window\.tgUtm = tgUtm/);
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const helperAt = html.indexOf('<script src="/tg-analytics.js"></script>');
  assert.ok(helperAt > 0, 'home page loads the helper');
  assert.ok(html.indexOf('tgUtm();', helperAt) > helperAt, 'home page calls tgUtm() after the helper loads');
});
