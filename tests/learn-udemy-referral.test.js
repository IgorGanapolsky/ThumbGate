'use strict';

// /learn links to the Udemy course with the instructor referral code (so Udemy's Traffic report counts it)
// and carries the same Google tag the other marketing pages get.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-learn-'));
Object.assign(process.env, {
  _TEST_FUNNEL_LEDGER_PATH: path.join(tmp, 'funnel.jsonl'),
  _TEST_REVENUE_LEDGER_PATH: path.join(tmp, 'revenue.jsonl'),
  _TEST_API_KEYS_PATH: path.join(tmp, 'api-keys.json'),
  THUMBGATE_FEEDBACK_DIR: path.join(tmp, 'feedback'),
  THUMBGATE_API_KEY: ['unit', 'test', 'api', 'access'].join('-'),
  THUMBGATE_GA_MEASUREMENT_ID: 'G-TESTLEARN1',
  RAILWAY_ENVIRONMENT_ID: '',
  RAILWAY_PROJECT_ID: '',
});
fs.mkdirSync(process.env.THUMBGATE_FEEDBACK_DIR, { recursive: true });

const { startServer } = require('../src/api/server');
const CODE = 'referralCode=FB94D82DF875072CBA42';
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
let handle;
let origin;

function get(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(origin + urlPath, { headers: { 'user-agent': CHROME_UA } }, (res) => {
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
});

test('REQ-01: every Udemy course link in public/ and README carries the referral code', () => {
  const root = path.join(__dirname, '..');
  const files = [path.join(root, 'README.md'), ...fs.readdirSync(path.join(root, 'public'))
    .filter((f) => f.endsWith('.html')).map((f) => path.join(root, 'public', f))];
  for (const file of files) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/udemy\.com\/course\/[^\s"')<]*/g)) {
      assert.ok(m[0].includes(CODE), `${path.basename(file)}: ${m[0]}`);
    }
  }
});

test('REQ-02: served /learn has the referral link and keeps its utm parameters', async () => {
  const res = await get('/learn');
  assert.equal(res.status, 200);
  assert.ok(res.body.includes(`${CODE}&amp;utm_source=thumbgate&amp;utm_medium=learn&amp;utm_campaign=udemy_course`));
});

test('REQ-03: served /learn loads the Google tag and configures the property', async () => {
  const res = await get('/learn');
  assert.ok(res.body.includes('googletagmanager.com/gtag/js?id=G-TESTLEARN1'));
  assert.ok(res.body.includes("gtag('config', 'G-TESTLEARN1')"));
  assert.ok(!res.body.includes('__GA_BOOTSTRAP__'), 'placeholder must be filled');
});
