'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApiServer } = require('../src/api/server');

async function startTestServer(envOverrides = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-admin-portal-test-'));
  const prevEnv = {};
  const nextEnv = {
    THUMBGATE_API_KEY: 'test-admin-secret-key-999',
    THUMBGATE_OPERATOR_KEY: 'test-operator-key-888',
    THUMBGATE_DIALOGFLOW_WEBHOOK_SECRET: 'test-df-webhook-secret-777',
    THUMBGATE_FEEDBACK_DIR: tmpDir,
    _TEST_DISABLE_UPSTREAM_BRIDGE: '1',
    _TEST_DISABLE_GCP_METADATA: '1',
    ...envOverrides,
  };

  for (const [k, v] of Object.entries(nextEnv)) {
    prevEnv[k] = process.env[k];
    process.env[k] = v;
  }

  // Seed sample signup and paid order in tmpDir
  fs.writeFileSync(
    path.join(tmpDir, 'funnel-events.jsonl'),
    `${JSON.stringify({
      timestamp: '2026-10-28T15:00:00.000Z',
      stage: 'acquisition',
      event: 'checkout_session_created',
      email: 'founder@acme.dev',
      metadata: { email: 'founder@acme.dev', utmCampaign: 'pro_pack', utmSource: 'website' },
    })}\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(tmpDir, 'revenue-events.jsonl'),
    `${JSON.stringify({
      timestamp: '2026-10-28T15:05:00.000Z',
      status: 'paid',
      provider: 'stripe',
      event: 'checkout.session.completed',
      orderId: 'py_test_149',
      customerId: 'cus_test_acme',
      customerEmail: 'founder@acme.dev',
      amountCents: 14900,
      currency: 'USD',
      amountKnown: true,
    })}\n`,
    'utf8'
  );

  const server = createApiServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const close = async () => {
    await new Promise((resolve) => server.close(resolve));
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  };

  return { baseUrl, close, tmpDir };
}

test('Unauthenticated GET /admin renders server-side login gate and never leaks customer or profit data', async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const res = await fetch(`${baseUrl}/admin`);
    assert.equal(res.status, 401);
    const html = await res.text();
    assert.match(html, /ThumbGate Executive Admin/);
    assert.match(html, /action="\/admin\/login"/);
    assert.doesNotMatch(html, /cus_test_acme/);
    assert.doesNotMatch(html, /founder@acme\.dev/);
    assert.doesNotMatch(html, /admin-initial-state/);

    const realtimeRes = await fetch(`${baseUrl}/v1/admin/realtime`);
    assert.equal(realtimeRes.status, 401);

    const dfRes = await fetch(`${baseUrl}/v1/admin/dialogflow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'What are our profits?' }),
    });
    assert.equal(dfRes.status, 401);
  } finally {
    await close();
  }
});

test('POST /admin/login sets HttpOnly session cookie and unlocks real-time sign-ups, accounts, profits, and Dialogflow', async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const badLogin = await fetch(`${baseUrl}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'iganapolsky@gmail.com', apiKey: 'wrong-key' }),
    });
    assert.equal(badLogin.status, 401);

    const goodLogin = await fetch(`${baseUrl}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        email: 'iganapolsky@gmail.com',
        apiKey: 'test-admin-secret-key-999',
      }).toString(),
      redirect: 'manual',
    });
    assert.equal(goodLogin.status, 303);
    assert.equal(goodLogin.headers.get('location'), '/admin');
    const setCookie = goodLogin.headers.get('set-cookie') || '';
    assert.match(setCookie, /tg_admin_session=/);
    assert.match(setCookie, /HttpOnly/);
    const cookiePair = setCookie.split(';')[0];

    const portalRes = await fetch(`${baseUrl}/admin`, {
      headers: { Cookie: cookiePair },
    });
    assert.equal(portalRes.status, 200);
    const portalHtml = await portalRes.text();
    assert.match(portalHtml, /ThumbGate Google Cloud Admin &amp; Dialogflow Command Center/);
    assert.match(portalHtml, /Google Cloud Dialogflow Copilot/);
    assert.match(portalHtml, /cus_test_acme/);
    assert.match(portalHtml, /founder@acme\.dev/);
    assert.match(portalHtml, /\$390\.00/);

    const rtRes = await fetch(`${baseUrl}/v1/admin/realtime`, {
      headers: { Cookie: cookiePair },
    });
    assert.equal(rtRes.status, 200);
    const snap = await rtRes.json();
    assert.equal(snap.cloud.outOfPocketSpendCents, 0);
    assert.equal(snap.cloud.ultraCreditsAvailableDisplay, '$390.00');
    assert.ok(snap.customers.some((c) => c.customerId === 'cus_test_acme'));
    assert.ok(snap.signups.feed.some((s) => s.email === 'founder@acme.dev'));

    // Ask Dialogflow about profits
    const dfProfitRes = await fetch(`${baseUrl}/v1/admin/dialogflow`, {
      method: 'POST',
      headers: {
        Cookie: cookiePair,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: 'What are our net profits and Stripe fees?' }),
    });
    assert.equal(dfProfitRes.status, 200);
    const dfProfit = await dfProfitRes.json();
    assert.equal(dfProfit.ok, true);
    assert.equal(dfProfit.intent, 'admin.profits');
    assert.match(dfProfit.answer, /Net Profit is/);

    // Webhook fulfillment endpoint for Google Cloud Dialogflow ES/CX
    const webhookRes = await fetch(`${baseUrl}/v1/admin/dialogflow-webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-thumbgate-dialogflow-secret': 'test-df-webhook-secret-777',
      },
      body: JSON.stringify({
        queryResult: {
          queryText: 'Show all sign-ups in real-time',
          intent: { displayName: 'admin.signups' },
        },
      }),
    });
    assert.equal(webhookRes.status, 200);
    const webhookData = await webhookRes.json();
    assert.match(webhookData.fulfillmentText, /Real-Time Sign-Ups:/);
    assert.equal(webhookData.payload.intent, 'admin.signups');
  } finally {
    await close();
  }
});
