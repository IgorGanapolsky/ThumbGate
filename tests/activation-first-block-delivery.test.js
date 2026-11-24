'use strict';

// Revenue-funnel measurement (docs/decisions/2026-11-24-revenue-funnel-activation.md):
// the first gate firing is ThumbGate's activation event. These tests pin down
// that (1) the public KPI counts the event name production CLIs actually send,
// and (2) a rejected account key never loses the activation or causes a retry storm.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const tracker = require('../scripts/activation-tracker');

function startServer(handler) {
  return new Promise((resolve) => {
    const hits = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        hits.push({ path: req.url, auth: req.headers.authorization || null, body: body ? JSON.parse(body) : null });
        const status = handler(req);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, hits, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function tempStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tg-first-block-'));
}

function cleanEnv() {
  const env = { ...process.env };
  for (const k of ['THUMBGATE_NO_TELEMETRY', 'DO_NOT_TRACK', 'NODE_TEST_CONTEXT', 'NODE_ENV',
    'THUMBGATE_API_KEY', 'THUMBGATE_PRO_KEY', 'THUMBGATE_LICENSE', 'THUMBGATE_OPERATOR_KEY']) delete env[k];
  return env;
}

test('summarizeFirstBlockEvents counts production first_block events once per install', () => {
  const summary = tracker.summarizeFirstBlockEvents([
    { eventType: 'first_block', installId: 'a', visitorType: 'real_user' },
    { eventType: 'first_block', installId: 'a', visitorType: 'real_user' }, // retry duplicate
    { eventType: 'first_block', installId: 'b' },
    { eventType: 'first_blocked_tool_call', installId: 'c', minutesSinceInstall: 2 },
    { eventType: 'first_block', installId: 'd', visitorType: 'ci' },
    { eventType: 'first_block', installId: 'e', visitorType: 'owner' },
    { eventType: 'cli_capture', installId: 'f' },
  ]);
  assert.equal(summary.count, 3);
  assert.equal(summary.medianMinutes, 2);
});

test('summarizeActivationFunnel counts activated -> shown -> checkout, skipping internal traffic', () => {
  const funnel = tracker.summarizeActivationFunnel([
    { eventType: 'cli_init', clientType: 'cli', installId: 'a' },
    { eventType: 'cli_init', clientType: 'cli', installId: 'b' },
    { eventType: 'cli_init', clientType: 'cli', installId: 'z', visitorType: 'owner' },
    { eventType: 'first_block', clientType: 'cli', installId: 'a' },
    { eventType: 'first_block', clientType: 'cli', installId: 'a' },
    { eventType: 'first_block', clientType: 'cli', installId: 'z', visitorType: 'owner' },
    { eventType: 'first_block_upsell_shown', clientType: 'cli', installId: 'a' },
    { eventType: 'cli_limit_hit', clientType: 'cli', installId: 'b' },
    { eventType: 'checkout_interstitial_view', clientType: 'web', utmSource: 'cli', utmMedium: 'first_block' },
    { eventType: 'checkout_interstitial_view', clientType: 'web', utmSource: 'website' },
    { eventType: 'checkout_interstitial_cta_clicked', clientType: 'web', utmSource: 'cli' },
    { eventType: 'checkout_success_page_view', clientType: 'web', utmSource: 'cli_nudge' },
    { eventType: 'checkout_interstitial_view', utmSource: 'cli', visitorType: 'bot' },
  ]);
  assert.deepEqual(funnel, {
    cliInstalls: 2,
    activatedInstalls: 1,
    upsellShownInstalls: 1,
    limitHitInstalls: 1,
    cliCheckoutViews: 1,
    cliCheckoutClicks: 1,
    cliCheckoutPaidPageViews: 1,
    firstBlockCheckoutViews: 1,
  });
});

test('summarizeFirstBlockEvents keeps a later timing sample for an install already counted', () => {
  const summary = tracker.summarizeFirstBlockEvents([
    { eventType: 'first_block', installId: 'a', visitorType: 'real_user' },
    { eventType: 'first_blocked_tool_call', installId: 'a', visitorType: 'real_user', minutesSinceInstall: 2 },
    { eventType: 'first_block', installId: 'b', visitorType: 'real_user' },
  ]);
  assert.deepEqual(summary, { count: 2, medianMinutes: 2, under5MinutesCount: 1 });
});

test('the first_block payload carries the CLI visitor classification', async () => {
  const { server, hits, baseUrl } = await startServer(() => 204);
  const stateDir = tempStateDir();
  try {
    await tracker.reportFirstBlockActivation({
      awaitDelivery: true, apiBaseUrl: baseUrl, stateDir, env: cleanEnv(), installId: 'inst_v', homeDir: stateDir,
    });
    assert.equal(hits[0].path, '/v1/telemetry/ping');
    assert.ok(['real_user', 'owner', 'ci'].includes(hits[0].body.visitorType), `got ${hits[0].body.visitorType}`);
  } finally {
    server.close();
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('a 401 on the account route falls back to an anonymous ping and stops retrying that key', async () => {
  const { server, hits, baseUrl } = await startServer((req) => (req.url === '/v1/activation/first-block' ? 401 : 204));
  const stateDir = tempStateDir();
  const env = cleanEnv();
  try {
    const first = await tracker.reportFirstBlockActivation({
      awaitDelivery: true, apiKey: 'stale-key', apiBaseUrl: baseUrl, stateDir, env, installId: 'inst_1', homeDir: stateDir,
    });
    assert.equal(first.reported, true);
    assert.equal(first.fallback, 'anonymous');
    assert.deepEqual(hits.map((h) => h.path), ['/v1/activation/first-block', '/v1/telemetry/ping']);
    assert.equal(hits[1].auth, null, 'the anonymous ping must not carry the key');
    assert.equal(hits[1].body.eventType, 'first_block');

    const marker = JSON.parse(fs.readFileSync(path.join(stateDir, 'activation-recorded.json'), 'utf8'));
    assert.ok(marker.firstBlockAnonReportedAt);
    assert.ok(marker.firstBlockAuthRejectedKeyHash);
    assert.ok(!JSON.stringify(marker).includes('stale-key'), 'marker must never store the raw key');

    const second = await tracker.reportFirstBlockActivation({
      awaitDelivery: true, apiKey: 'stale-key', apiBaseUrl: baseUrl, stateDir, env, homeDir: stateDir,
    });
    assert.equal(second.alreadyReported, true);
    assert.equal(hits.length, 2, 'no further requests with the rejected key');

    // A new key gets one fresh try on the account route.
    await tracker.reportFirstBlockActivation({
      awaitDelivery: true, apiKey: 'new-key', apiBaseUrl: baseUrl, stateDir, env, homeDir: stateDir,
    });
    assert.equal(hits[2].path, '/v1/activation/first-block');
  } finally {
    server.close();
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('a valid key still reports on the account route only', async () => {
  const { server, hits, baseUrl } = await startServer(() => 200);
  const stateDir = tempStateDir();
  try {
    const res = await tracker.reportFirstBlockActivation({
      awaitDelivery: true, apiKey: 'good-key', apiBaseUrl: baseUrl, stateDir, env: cleanEnv(), homeDir: stateDir,
    });
    assert.equal(res.reported, true);
    assert.deepEqual(hits.map((h) => h.path), ['/v1/activation/first-block']);
    assert.equal(hits[0].auth, 'Bearer good-key');
  } finally {
    server.close();
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
