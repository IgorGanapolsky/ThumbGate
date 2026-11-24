'use strict';

// thumbgate.ai/tiktok: TikTok captions and end cards cannot hold a clickable link, so people
// type a short path. It must 302 to the install page with TikTok utms and record the hit.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-tiktok-'));
const FEEDBACK_DIR = path.join(tmp, 'feedback');
fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
Object.assign(process.env, {
  _TEST_FUNNEL_LEDGER_PATH: path.join(tmp, 'funnel.jsonl'),
  _TEST_REVENUE_LEDGER_PATH: path.join(tmp, 'revenue.jsonl'),
  THUMBGATE_FEEDBACK_DIR: FEEDBACK_DIR,
  THUMBGATE_API_KEY: `test_key_${'x'.repeat(24)}`,
  RAILWAY_ENVIRONMENT_ID: '',
  RAILWAY_PROJECT_ID: '',
});

const { startServer } = require('../src/api/server');

const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const BOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const TELEMETRY = path.join(FEEDBACK_DIR, 'telemetry-pings.jsonl');
const TARGET = '/install?utm_source=tiktok&utm_medium=video&utm_campaign=profile';

let handle = null;
let origin = '';

function get(urlPath, ua) {
  return new Promise((resolve, reject) => {
    http.get(origin + urlPath, { headers: { 'user-agent': ua } }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, headers: res.headers }));
    }).on('error', reject);
  });
}

function tiktokRows() {
  if (!fs.existsSync(TELEMETRY)) return [];
  return fs.readFileSync(TELEMETRY, 'utf8').split('\n').filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row) => row.pageType === 'tiktok_short_link');
}

describe('thumbgate.ai/tiktok short link', () => {
  before(async () => {
    handle = await startServer({ port: 0, host: '127.0.0.1' });
    origin = `http://127.0.0.1:${handle.port}`;
  });

  after(() => {
    if (handle) handle.server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('REQ-01: GET /tiktok answers 302 to the install page with the TikTok utms', async () => {
    const res = await get('/tiktok', CHROME_UA);
    assert.equal(res.status, 302);
    assert.equal(res.location, TARGET);
    assert.equal(res.headers['cache-control'], 'no-store');
  });

  it('REQ-02: a trailing slash goes to the same place', async () => {
    const res = await get('/tiktok/', CHROME_UA);
    assert.equal(res.status, 302);
    assert.equal(res.location, TARGET);
  });

  it('REQ-03: the hit is recorded with utm_source=tiktok, medium video, campaign profile', async () => {
    await get('/tiktok', CHROME_UA);
    const rows = tiktokRows();
    assert.ok(rows.length >= 1, 'a telemetry row exists for the hit');
    const row = rows[rows.length - 1];
    assert.equal(row.eventType, 'landing_page_view');
    assert.equal(row.utmSource, 'tiktok');
    assert.equal(row.utmMedium, 'video');
    assert.equal(row.utmCampaign, 'profile');
    assert.equal(row.landingPath, '/tiktok');
  });

  it('REQ-04: a person and a crawler are told apart on the recorded row', async () => {
    const before = tiktokRows().length;
    await get('/tiktok', CHROME_UA);
    await get('/tiktok', BOT_UA);
    const added = tiktokRows().slice(before);
    assert.equal(added.length, 2);
    assert.equal(added[0].isBotTraffic, false);
    assert.equal(added[1].isBotTraffic, true);
  });

  it('REQ-05: a non-matching path is not captured', async () => {
    const res = await get('/tiktokx', CHROME_UA);
    assert.notEqual(res.location, TARGET);
  });
});
