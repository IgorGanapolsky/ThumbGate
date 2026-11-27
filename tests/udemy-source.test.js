'use strict';

// AGENT-3667 item O: a visit from the free Udemy course is recorded with utm_source=udemy and can be followed to the
// first install event and a checkout start, using the existing source capture (landing attribution, the CLI ping and
// /v1/analytics/sources). Nothing here opens a checkout link: the Pro link is only read as text.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-udemy-'));
const FEEDBACK_DIR = path.join(tmp, 'feedback');
fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
const API_KEY = ['unit', 'test', 'api', 'access'].join('-');
Object.assign(process.env, {
  _TEST_FUNNEL_LEDGER_PATH: path.join(tmp, 'funnel.jsonl'),
  _TEST_REVENUE_LEDGER_PATH: path.join(tmp, 'revenue.jsonl'),
  _TEST_API_KEYS_PATH: path.join(tmp, 'api-keys.json'),
  THUMBGATE_FEEDBACK_DIR: FEEDBACK_DIR,
  THUMBGATE_API_KEY: API_KEY,
  RAILWAY_ENVIRONMENT_ID: '',
  RAILWAY_PROJECT_ID: '',
});

const { startServer } = require('../src/api/server');
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const MARKER = 'udemy-test-marker-1';

let handle = null;
let origin = '';

function request(method, urlPath, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(origin + urlPath, { method, headers: { 'user-agent': CHROME_UA, ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('thumbgate.ai/udemy', () => {
  before(async () => {
    handle = await startServer({ port: 0, host: '127.0.0.1' });
    origin = `http://127.0.0.1:${handle.port}`;
  });

  after(() => {
    if (handle) handle.server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('REQ-01 (a): the page loads and every link on it carries utm_source=udemy', async () => {
    const res = await request('GET', '/udemy');
    assert.equal(res.status, 200);
    const links = [...res.body.matchAll(/<a\s[^>]*href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
    assert.ok(links.length >= 6, `links found: ${links.length}`);
    for (const href of links) assert.match(href, /[?&]utm_source=udemy(&|$)/, `link without utm_source=udemy: ${href}`);
    assert.ok(links.some((h) => h.startsWith('/checkout/pro')), 'the Pro link is on the page');
  });

  it('REQ-02: the free install comes first and Pro is below it, labelled optional', async () => {
    const res = await request('GET', '/udemy');
    const install = res.body.indexOf('npx thumbgate init');
    const pro = res.body.indexOf('/checkout/pro');
    assert.ok(install > 0 && pro > install, 'install command appears before the Pro link');
    assert.match(res.body, /Optional: ThumbGate Pro/);
    assert.match(res.body, /THUMBGATE_INSTALL_SOURCE=udemy npx thumbgate init/);
  });

  it('the page carries SoftwareApplication structured data (AGENTS.md schema integrity)', async () => {
    const res = await request('GET', '/udemy');
    const block = res.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(block, 'JSON-LD block present');
    const data = JSON.parse(block[1]);
    assert.equal(data['@type'], 'SoftwareApplication');
    assert.equal(data.name, 'ThumbGate');
    assert.match(data.url, /\/udemy$/);
    assert.doesNotMatch(data.url, /__APP_ORIGIN__/, 'origin placeholder is substituted');
    assert.equal(data.offers.price, '0');
  });

  it('REQ-03 (b): a test visit and an install ping show as their own udemy row in /v1/analytics/sources', async () => {
    const visit = await request('GET', `/udemy?utm_source=udemy&utm_medium=course&utm_campaign=free_course&marker=${MARKER}`);
    assert.equal(visit.status, 200);
    const bare = await request('GET', '/udemy');
    assert.equal(bare.status, 200, 'a course link that lost its query string is still recorded as udemy');

    // The CLI side is tested in REQ-04 in a child process with its own HOME; never write the real ~/.thumbgate here.
    assert.equal(typeof require('../scripts/cli-telemetry').installSourceFields, 'function');
    const ping = await request('POST', '/v1/telemetry/ping', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventType: 'cli_init', clientType: 'cli', installId: `install-${MARKER}`, visitorType: 'real_user', source: 'udemy', utmSource: 'udemy', pkgVersion: '0.0.0-test' }),
    });
    assert.ok([200, 202, 204].includes(ping.status), `ping status ${ping.status}`);

    const res = await request('GET', '/v1/analytics/sources', { headers: { authorization: `Bearer ${API_KEY}` } });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    const row = body.windows[0].sources.find((s) => s.source === 'udemy');
    assert.ok(row, `udemy row missing: ${JSON.stringify(body.windows[0].sources)}`);
    assert.equal(row.visits >= 2, true, `visits ${row.visits}`);
    assert.equal(row.installs, 1, `installs ${row.installs}`);
    console.log('EXPORT ROW:', JSON.stringify(row));
  });
});

describe('install source on the CLI ping', () => {
  it('REQ-04: the source is read from THUMBGATE_INSTALL_SOURCE, kept in a file, and a bad value is ignored', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-udemy-cli-home-'));
    const code = `
      const t = require(${JSON.stringify(path.join(__dirname, '..', 'scripts', 'cli-telemetry.js'))});
      const first = t.installSourceFields({ THUMBGATE_INSTALL_SOURCE: 'udemy' });
      const later = t.installSourceFields({});
      const other = t.installSourceFields({ THUMBGATE_INSTALL_SOURCE: 'reddit' });
      process.stdout.write(JSON.stringify({ first, later, other }));
    `;
    const out = JSON.parse(require('node:child_process').execFileSync(process.execPath, ['-e', code], { env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8' }));
    assert.deepEqual(out.first, { source: 'udemy', utmSource: 'udemy' });
    assert.deepEqual(out.later, { source: 'udemy', utmSource: 'udemy' }, 'kept for later runs');
    assert.deepEqual(out.other, { source: 'udemy', utmSource: 'udemy' }, 'the first value wins');
    const bad = JSON.parse(require('node:child_process').execFileSync(process.execPath, ['-e', code.replace(/'udemy'/, "'Bad Value; rm -rf /'")], { env: { ...process.env, HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'tg-udemy-cli-home-')), USERPROFILE: home }, encoding: 'utf8' }));
    assert.deepEqual(bad.first, { source: 'git-clone', utmSource: 'git-clone' }, 'a value that is not a short word is dropped');
  });
});
