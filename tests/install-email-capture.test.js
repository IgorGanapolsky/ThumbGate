'use strict';

/**
 * Tests for the npm-postinstall email-capture wedge:
 *   - POST /v1/marketing/install-email server route (validation, persistence,
 *     mailer integration boundary)
 *   - OPTIONS /v1/marketing/install-email CORS preflight
 *   - postinstall banner contains the subscribe affordance
 *
 * The CLI side (bin/cli.js `subscribe` subcommand) is verified by the
 * existing postinstall.test.js banner check plus a separate integration
 * test that boots the server, runs the subcommand against it, and
 * asserts the round-trip.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'install-email-'));
const savedEnv = {};
const ENV = {
  _TEST_API_KEYS_PATH: path.join(tmpRoot, 'api-keys.json'),
  _TEST_FUNNEL_LEDGER_PATH: path.join(tmpRoot, 'funnel-events.jsonl'),
  _TEST_REVENUE_LEDGER_PATH: path.join(tmpRoot, 'revenue-events.jsonl'),
  _TEST_LOCAL_CHECKOUT_SESSIONS_PATH: path.join(tmpRoot, 'local-checkout-sessions.json'),
  THUMBGATE_FEEDBACK_DIR: path.join(tmpRoot, 'feedback'),
  THUMBGATE_API_KEY: 'test-api-key-install-email',
  RESEND_API_KEY: '', // empty → mailer returns { sent: false, reason: 'no_api_key' }
  STRIPE_SECRET_KEY: '',
  STRIPE_PRICE_ID: '',
};
for (const [k, v] of Object.entries(ENV)) {
  savedEnv[k] = process.env[k];
  process.env[k] = v;
}
fs.mkdirSync(ENV.THUMBGATE_FEEDBACK_DIR, { recursive: true });

const { startServer } = require('../src/api/server');

let handle;
let origin = '';

function readTelemetry() {
  const p = path.join(ENV.THUMBGATE_FEEDBACK_DIR, 'telemetry-pings.jsonl');
  try {
    return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function readCaptureLedger() {
  // The dedicated install-email capture ledger. Lives alongside the
  // telemetry-pings.jsonl in the feedback dir. Email + remote addr
  // are persisted here, NOT in telemetry-pings (PII filtered).
  const p = path.join(ENV.THUMBGATE_FEEDBACK_DIR, 'marketing-install-emails.jsonl');
  try {
    return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function clearLedgers() {
  for (const name of ['telemetry-pings.jsonl', 'marketing-install-emails.jsonl']) {
    try { fs.unlinkSync(path.join(ENV.THUMBGATE_FEEDBACK_DIR, name)); } catch {}
  }
}

describe('/v1/marketing/install-email', () => {
  before(async () => {
    handle = await startServer({ port: 0, host: '127.0.0.1' });
    origin = `http://127.0.0.1:${handle.port}`;
  });

  after(async () => {
    if (handle) handle.server.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('OPTIONS returns CORS preflight headers', async () => {
    const res = await fetch(`${origin}/v1/marketing/install-email`, { method: 'OPTIONS' });
    assert.ok(res.status === 200 || res.status === 204, `expected preflight 2xx, got ${res.status}`);
    assert.ok(res.headers.get('access-control-allow-origin'), 'must set Access-Control-Allow-Origin');
  });

  it('POST with valid email returns ok:true, writes capture ledger AND telemetry ping', async () => {
    clearLedgers();
    const res = await fetch(`${origin}/v1/marketing/install-email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'buyer@company.example',
        source: 'cli_subscribe',
        installId: 'inst_test_abc',
        cliVersion: '1.20.0',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.captured, true);
    // RESEND_API_KEY is empty in this test env → mailer returns sent:false
    // with reason 'no_api_key'. The capture must still succeed.
    assert.equal(body.mailerSent, false);
    assert.match(body.mailerReason || '', /no_api_key|not_attempted|mailer/);

    // Email + identifying fields land in the dedicated capture ledger,
    // NOT in the privacy-sanitized telemetry-pings file.
    const captures = readCaptureLedger();
    assert.equal(captures.length, 1, 'one capture ledger row');
    const captured = captures[0];
    assert.equal(captured.email, 'buyer@company.example');
    assert.equal(captured.source, 'cli_subscribe');
    assert.equal(captured.installId, 'inst_test_abc');
    assert.equal(captured.cliVersion, '1.20.0');
    assert.ok(captured.capturedAt, 'capturedAt timestamp present');

    // Telemetry ping for the funnel exists but does NOT contain the email
    // (sanitizer would strip it anyway; we don't pass it in).
    const events = readTelemetry();
    const telemetry = events.find((e) => e.eventType === 'marketing_install_email_captured');
    assert.ok(telemetry, 'funnel telemetry ping fired');
    assert.equal(telemetry.email, undefined, 'telemetry ping must not carry email (PII)');
    assert.equal(telemetry.utmCampaign, 'install_email_capture');
  });

  it('POST without email returns 400 invalid_email', async () => {
    const res = await fetch(`${origin}/v1/marketing/install-email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'cli_subscribe' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'invalid_email');
  });

  it('POST with malformed email returns 400 invalid_email', async () => {
    const res = await fetch(`${origin}/v1/marketing/install-email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'invalid_email');
  });

  it('POST with invalid JSON returns 400 invalid_json', async () => {
    const res = await fetch(`${origin}/v1/marketing/install-email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not valid json',
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'invalid_json');
  });

  it('POST with oversized body returns 413 payload_too_large', async () => {
    const huge = 'x'.repeat(3000);
    const res = await fetch(`${origin}/v1/marketing/install-email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `${huge}@a.com` }),
    });
    assert.equal(res.status, 413);
  });

  it('POST clips overlong source/installId/cliVersion fields instead of crashing', async () => {
    // Defense-in-depth: oversized strings are accepted but clipped/ignored.
    // We constrain source ≤64, installId ≤128, cliVersion ≤32. Anything
    // longer is dropped to defaults (source) or null (installId, cliVersion).
    // The body still has to fit under MAX_BODY=2048 — these 500-char strings
    // together with the rest of the payload total ~1700 bytes, well under.
    clearLedgers();
    const res = await fetch(`${origin}/v1/marketing/install-email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'short@example.com',
        source: 's'.repeat(500),
        installId: 'i'.repeat(500),
        cliVersion: 'v'.repeat(500),
      }),
    });
    assert.equal(res.status, 200);
    const captures = readCaptureLedger();
    const captured = captures.find((c) => c.email === 'short@example.com');
    assert.ok(captured, 'ledger row exists');
    // Oversized fields fall back to defaults (source) or null (installId, cliVersion).
    assert.equal(captured.source, 'cli_subscribe');
    assert.equal(captured.installId, null);
    assert.equal(captured.cliVersion, null);
  });
});

describe('postinstall banner contains subscribe affordance', () => {
  it('postinstall.js renders the npx thumbgate subscribe line', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'postinstall.js'), 'utf8');
    assert.match(src, /npx thumbgate subscribe/);
    assert.match(src, /5-min setup guide \+ weekly tips/);
  });
});
