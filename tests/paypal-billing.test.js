'use strict';

const { describe, test, beforeEach, afterEach, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

let tempDir;
let ledgerPath;
let billing;

function jsonResponse(status, payload, headers = {}) {
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => normalized[String(name).toLowerCase()] || null },
    json: async () => payload,
  };
}

function configurePayPalEnv() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-paypal-webhook-'));
  ledgerPath = path.join(tempDir, 'paypal-webhook-deliveries.jsonl');
  process.env._TEST_PAYPAL_WEBHOOK_LEDGER_PATH = ledgerPath;
  process.env.THUMBGATE_PAYPAL_CLIENT_ID = 'paypal-client-id';
  process.env.THUMBGATE_PAYPAL_CLIENT_SECRET = 'paypal-client-secret';
  process.env.THUMBGATE_PAYPAL_WEBHOOK_ID = '4ER123456789';
  process.env.THUMBGATE_PAYPAL_API_BASE_URL = 'https://api-m.paypal.com';
  delete require.cache[require.resolve('../scripts/billing')];
  billing = require('../scripts/billing');
}

function cleanupPayPalEnv() {
  delete process.env._TEST_PAYPAL_WEBHOOK_LEDGER_PATH;
  delete process.env.THUMBGATE_PAYPAL_CLIENT_ID;
  delete process.env.THUMBGATE_PAYPAL_CLIENT_SECRET;
  delete process.env.THUMBGATE_PAYPAL_WEBHOOK_ID;
  delete process.env.THUMBGATE_PAYPAL_API_BASE_URL;
  delete require.cache[require.resolve('../scripts/billing')];
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  ledgerPath = null;
}

function event(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: 'WH-4ER123456789',
    create_time: now,
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: {
      id: '6HM123456789',
      status: 'COMPLETED',
      amount: { currency_code: 'USD', value: '9.99' },
      custom_id: 'thumbgate-diagnostic',
    },
    ...overrides,
  };
}

function transmissionHeaders(overrides = {}) {
  return {
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-cert-url': 'https://api-m.paypal.com/certs/CERT-1',
    'paypal-transmission-id': '69cd13f0-d67a-11e5-baa3-778b53f4ae55',
    'paypal-transmission-sig': 'signed-value',
    'paypal-transmission-time': new Date().toISOString(),
    ...overrides,
  };
}

function successfulVerifier(requests = []) {
  return async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith('/v1/oauth2/token')) {
      return jsonResponse(200, { access_token: 'managed-access-token' });
    }
    return jsonResponse(200, { verification_status: 'SUCCESS' }, { 'paypal-debug-id': 'debug-reference-1' });
  };
}

describe('PayPal webhook evidence', { concurrency: false }, () => {
  beforeEach(() => configurePayPalEnv());
  afterEach(() => cleanupPayPalEnv());

  test('remote verification sends PayPal required fields and returns no credentials', async () => {
    const requests = [];
    const payload = event();
    const headers = transmissionHeaders();
    const result = await billing.verifyPayPalWebhookSignature({
      rawBody: Buffer.from(JSON.stringify(payload)),
      headers,
      fetchImpl: successfulVerifier(requests),
    });
    assert.equal(result.verified, true);
    assert.equal(requests.length, 2);
    assert.match(requests[0].url, /\/v1\/oauth2\/token$/);
    assert.match(requests[1].url, /\/v1\/notifications\/verify-webhook-signature$/);
    const verificationBody = JSON.parse(requests[1].options.body);
    assert.equal(verificationBody.auth_algo, headers['paypal-auth-algo']);
    assert.equal(verificationBody.cert_url, headers['paypal-cert-url']);
    assert.equal(verificationBody.transmission_id, headers['paypal-transmission-id']);
    assert.equal(verificationBody.transmission_sig, headers['paypal-transmission-sig']);
    assert.equal(verificationBody.transmission_time, headers['paypal-transmission-time']);
    assert.equal(verificationBody.webhook_id, '4ER123456789');
    assert.deepEqual(verificationBody.webhook_event, payload);
    assert.equal(JSON.stringify(result).includes('managed-access-token'), false);
    assert.equal(JSON.stringify(result).includes('paypal-client-secret'), false);
  });

  test('missing configuration, headers, stale timestamps, and unsupported events fail before network', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; throw new Error('network must not be called'); };
    delete process.env.THUMBGATE_PAYPAL_WEBHOOK_ID;
    delete require.cache[require.resolve('../scripts/billing')];
    billing = require('../scripts/billing');
    assert.equal((await billing.verifyPayPalWebhookSignature({
      rawBody: JSON.stringify(event()), headers: transmissionHeaders(), fetchImpl,
    })).reason, 'paypal_webhook_verification_not_configured');

    process.env.THUMBGATE_PAYPAL_WEBHOOK_ID = '4ER123456789';
    delete require.cache[require.resolve('../scripts/billing')];
    billing = require('../scripts/billing');
    assert.equal((await billing.verifyPayPalWebhookSignature({
      rawBody: JSON.stringify(event()), headers: {}, fetchImpl,
    })).reason, 'missing_paypal_transmission_headers');
    assert.equal((await billing.verifyPayPalWebhookSignature({
      rawBody: JSON.stringify(event()),
      headers: transmissionHeaders({ 'paypal-transmission-time': '2020-01-01T00:00:00.000Z' }),
      fetchImpl,
    })).reason, 'stale_or_future_paypal_transmission');
    assert.equal((await billing.verifyPayPalWebhookSignature({
      rawBody: JSON.stringify(event({ event_type: 'CHECKOUT.ORDER.APPROVED' })),
      headers: transmissionHeaders(),
      fetchImpl,
    })).reason, 'invalid_or_unsupported_paypal_webhook_event');
    assert.equal((await billing.verifyPayPalWebhookSignature({
      rawBody: '{not-json', headers: transmissionHeaders(), fetchImpl,
    })).reason, 'invalid_paypal_webhook_json');
    assert.equal((await billing.verifyPayPalWebhookSignature({
      rawBody: JSON.stringify(event()),
      headers: transmissionHeaders({ 'paypal-cert-url': 'http://attacker.example/cert' }),
      fetchImpl,
    })).reason, 'invalid_paypal_cert_url');
    assert.equal((await billing.verifyPayPalWebhookSignature({
      rawBody: JSON.stringify(event()),
      headers: transmissionHeaders({ 'paypal-transmission-time': '2099-01-01T00:00:00.000Z' }),
      fetchImpl,
    })).reason, 'stale_or_future_paypal_transmission');
    assert.equal((await billing.verifyPayPalWebhookSignature({
      rawBody: JSON.stringify(event()), headers: transmissionHeaders(), fetchImpl,
      apiBaseUrl: 'https://credentials.example',
    })).reason, 'untrusted_paypal_api_base_url');
    assert.equal((await billing.verifyPayPalWebhookSignature({
      rawBody: Buffer.alloc(1024 * 1024 + 1, 1), headers: transmissionHeaders(), fetchImpl,
    })).reason, 'paypal_webhook_body_too_large');
    assert.equal(calls, 0);
  });

  test('a non-SUCCESS PayPal verification response fails closed', async () => {
    let calls = 0;
    const result = await billing.verifyPayPalWebhookSignature({
      rawBody: JSON.stringify(event()),
      headers: transmissionHeaders(),
      fetchImpl: async (url) => {
        calls += 1;
        return calls === 1
          ? jsonResponse(200, { access_token: 'token' })
          : jsonResponse(200, { verification_status: 'FAILURE' });
      },
    });
    assert.equal(result.verified, false);
    assert.equal(result.reason, 'invalid_paypal_webhook_signature');

    calls = 0;
    const malformed = await billing.verifyPayPalWebhookSignature({
      rawBody: JSON.stringify(event()),
      headers: transmissionHeaders(),
      fetchImpl: async () => {
        calls += 1;
        return calls === 1 ? jsonResponse(200, { access_token: 'token' }) : jsonResponse(200, {});
      },
    });
    assert.deepEqual(malformed, { verified: false, reason: 'invalid_paypal_webhook_signature' });
  });

  test('OAuth and verification transport failures fail closed without reflecting provider payloads', async () => {
    const oauthRejected = await billing.verifyPayPalWebhookSignature({
      rawBody: JSON.stringify(event()),
      headers: transmissionHeaders(),
      fetchImpl: async () => jsonResponse(401, { error_description: 'paypal-client-secret' }),
    });
    assert.deepEqual(oauthRejected, { verified: false, reason: 'paypal_oauth_rejected' });

    let calls = 0;
    const verificationFailed = await billing.verifyPayPalWebhookSignature({
      rawBody: JSON.stringify(event()),
      headers: transmissionHeaders(),
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return jsonResponse(200, { access_token: 'managed-access-token' });
        throw new Error('provider unavailable');
      },
    });
    assert.deepEqual(verificationFailed, { verified: false, reason: 'paypal_signature_verification_request_failed' });
    assert.equal(JSON.stringify(verificationFailed).includes('managed-access-token'), false);
  });

  test('verified deliveries persist raw proof, dedupe, and reject transmission collisions', async () => {
    const body = Buffer.from(JSON.stringify(event()));
    const headers = transmissionHeaders();
    const fetchImpl = successfulVerifier();
    const first = await billing.recordPayPalWebhookDelivery({ rawBody: body, headers, fetchImpl });
    const duplicate = await billing.recordPayPalWebhookDelivery({ rawBody: body, headers, fetchImpl });
    const collisionBody = Buffer.from(JSON.stringify(event({ id: 'WH-COLLISION' })));
    const collision = await billing.recordPayPalWebhookDelivery({ rawBody: collisionBody, headers, fetchImpl });
    assert.deepEqual(
      { verified: first.verified, recorded: first.recorded, duplicate: first.duplicate },
      { verified: true, recorded: true, duplicate: false },
    );
    assert.equal(duplicate.duplicate, true);
    assert.equal(collision.verified, false);
    assert.equal(collision.reason, 'paypal_webhook_delivery_collision');
    const rows = billing.loadPayPalWebhookLedger();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].verificationStatus, 'SUCCESS');
    assert.equal(rows[0].verificationSource, 'paypal_verify_webhook_signature_api');
    assert.match(rows[0].payloadSha256, /^sha256:[a-f0-9]{64}$/);
    assert.equal(Buffer.from(rows[0].rawBodyBase64, 'base64').equals(body), true);
  });

  test('verified delivery returns retryable storage failure instead of acknowledging it', async () => {
    process.env._TEST_PAYPAL_WEBHOOK_LEDGER_PATH = tempDir;
    delete require.cache[require.resolve('../scripts/billing')];
    billing = require('../scripts/billing');
    const result = await billing.recordPayPalWebhookDelivery({
      rawBody: JSON.stringify(event()),
      headers: transmissionHeaders(),
      fetchImpl: successfulVerifier(),
    });
    assert.equal(result.verified, true);
    assert.equal(result.recorded, false);
    assert.equal(result.reason, 'paypal_webhook_ledger_unreadable');
  });

  test('a malformed existing ledger fails closed instead of silently dropping evidence', async () => {
    fs.writeFileSync(ledgerPath, '{malformed-json\n');
    const result = await billing.recordPayPalWebhookDelivery({
      rawBody: JSON.stringify(event()),
      headers: transmissionHeaders(),
      fetchImpl: successfulVerifier(),
    });
    assert.equal(result.verified, true);
    assert.equal(result.recorded, false);
    assert.equal(result.reason, 'paypal_webhook_ledger_unreadable');
    assert.equal(fs.readFileSync(ledgerPath, 'utf8'), '{malformed-json\n');
  });
});

describe('PayPal webhook API route', { concurrency: false }, () => {
  let server;
  let port;
  let originalFetch;

  before(async () => {
    configurePayPalEnv();
    process.env.THUMBGATE_ALLOW_INSECURE = 'true';
    originalFetch = globalThis.fetch;
    globalThis.fetch = successfulVerifier();
    delete require.cache[require.resolve('../src/api/server')];
    const started = await require('../src/api/server').startServer({ port: 0 });
    server = started.server;
    port = started.port;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    globalThis.fetch = originalFetch;
    delete process.env.THUMBGATE_ALLOW_INSECURE;
    delete require.cache[require.resolve('../src/api/server')];
    cleanupPayPalEnv();
  });

  function post(body, headers = transmissionHeaders()) {
    return new Promise((resolve, reject) => {
      const raw = JSON.stringify(body);
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/v1/billing/paypal-webhook',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(raw),
          ...headers,
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({
          status: res.statusCode,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        }));
      });
      req.on('error', reject);
      req.write(raw);
      req.end();
    });
  }

  test('accepts only remotely verified, durably stored payment events', async () => {
    const accepted = await post(event());
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.verified, true);
    assert.equal(accepted.body.recorded, true);
    assert.match(accepted.body.payloadSha256, /^sha256:[a-f0-9]{64}$/);
    assert.equal(billing.loadPayPalWebhookLedger().length, 1);

    const rejected = await post(event({ id: 'WH-UNSIGNED' }), {});
    assert.equal(rejected.status, 400);
    assert.match(rejected.body.title, /Invalid PayPal webhook delivery/i);
    assert.equal(billing.loadPayPalWebhookLedger().length, 1);

    const oversize = await post(event({ padding: 'x'.repeat(1024 * 1024) }));
    assert.equal(oversize.status, 413);
    assert.match(oversize.body.detail, /too large/i);
    assert.equal(billing.loadPayPalWebhookLedger().length, 1);
  });
});
