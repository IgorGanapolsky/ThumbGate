'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function freshMailer() {
  delete require.cache[require.resolve('../scripts/mailer/resend-mailer')];
  delete require.cache[require.resolve('../scripts/mailer')];
  return require('../scripts/mailer');
}

function savingEnv(keys) {
  const saved = {};
  for (const k of keys) saved[k] = process.env[k];
  return () => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  };
}

test('day-0 signup welcome email renders two CTA buttons, postal address, and opt-out, and blocks test/owner addresses', async () => {
  const restore = savingEnv([
    'RESEND_API_KEY',
    'RESEND_FROM_EMAIL',
    'THUMBGATE_PUBLIC_APP_ORIGIN',
    'THUMBGATE_BUSINESS_NAME',
    'THUMBGATE_BUSINESS_ADDRESS',
    'THUMBGATE_UNSUBSCRIBE_EMAIL',
  ]);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-crusoe-welcome-'));
  try {
    process.env.RESEND_API_KEY = 're_test_crusoe_123';
    process.env.THUMBGATE_PUBLIC_APP_ORIGIN = 'https://thumbgate.ai';
    process.env.THUMBGATE_BUSINESS_NAME = 'Max Smith KDP LLC';
    process.env.THUMBGATE_BUSINESS_ADDRESS = '2261 Market Street #4242, San Francisco, CA 94114';
    process.env.THUMBGATE_UNSUBSCRIBE_EMAIL = 'igor@igorganapolsky.com';

    const {
      renderSignupWelcomeBodies,
      isBlockedSignupWelcomeRecipient,
      sendSignupWelcomeEmail,
      dispatchSignupWelcomeEmail,
    } = freshMailer();

    const blockedAddresses = [
      'igor@igorganapolsky.com',
      'iganapolsky@gmail.com',
      'igor.ganapolsky@gmail.com',
      'iganapolsky+crusoe@gmail.com',
      'i.ganapolsky@gmail.com',
      'ops@thumbgate.ai',
      'user@example.com',
      'test@acmedev.io',
      'maya+test@acmedev.io',
      'probe@formtests.info',
      'colleague@ecisolutions.com',
      'relay@privaterelay.appleid.com',
      'test.ci@acmedev.io',
      'no-reply@acmedev.io',
      'maya+e2e_1@acmedev.io',
    ];
    for (const addr of blockedAddresses) {
      assert.equal(isBlockedSignupWelcomeRecipient(addr), true, `expected ${addr} to be blocked`);
      let fetchCalls = 0;
      const blockedRes = await sendSignupWelcomeEmail({
        to: addr,
        fetchImpl: async () => {
          fetchCalls += 1;
          return { ok: true, status: 200, text: async () => '{"id":"bad"}' };
        },
      });
      assert.deepEqual(blockedRes, { sent: false, reason: 'blocked_test_or_owner_recipient' });
      assert.equal(fetchCalls, 0);
    }

    assert.equal(isBlockedSignupWelcomeRecipient('maya@acmedev.io'), false);
    assert.equal(isBlockedSignupWelcomeRecipient('tester@acmedev.io'), false);
    const rendered = renderSignupWelcomeBodies({ customerName: 'Maya Lin' });
    const anchorHrefs = [...rendered.html.matchAll(/<a\s+href="([^"]+)"/gi)].map((m) => m[1]);
    assert.deepEqual(anchorHrefs, [
      'https://thumbgate.ai/#install',
      'https://thumbgate.ai/diagnostic',
      'mailto:igor@igorganapolsky.com?subject=unsubscribe&amp;body=Please%20remove%20me%20from%20ThumbGate%20emails.',
    ]);
    assert.match(rendered.html, /Install ThumbGate free/);
    assert.match(rendered.html, /Book the \$499 diagnostic/);
    assert.match(rendered.html, /2261 Market Street #4242, San Francisco, CA 94114/);
    assert.match(rendered.html, /Unsubscribe/);
    assert.doesNotMatch(rendered.html, /checkout\.stripe\.com/i);
    assert.match(rendered.text, /npx thumbgate init/);
    assert.match(rendered.text, /https:\/\/thumbgate\.ai\/diagnostic/);
    assert.match(rendered.text, /Unsubscribe: igor@igorganapolsky\.com/);
    assert.match(rendered.text, /2261 Market Street #4242, San Francisco, CA 94114/);

    const payloads = [];
    const fakeFetch = async (url, init) => {
      payloads.push({ url, body: JSON.parse(init.body), headers: init.headers });
      return { ok: true, status: 200, text: async () => '{"id":"email_crusoe_1"}' };
    };

    const first = await dispatchSignupWelcomeEmail({
      to: 'Maya Lin <Maya@AcmeDev.io>',
      customerName: 'Maya Lin',
      source: 'sso_google',
      feedbackDir: tmpDir,
      fetchImpl: fakeFetch,
    });
    assert.equal(first.sent, true);
    assert.equal(payloads.length, 1);
    assert.deepEqual(payloads[0].body.to, ['maya@acmedev.io']);
    assert.equal(payloads[0].body.subject, 'Maya, welcome to ThumbGate');
    assert.equal(payloads[0].headers['Idempotency-Key'], 'signup-welcome:maya@acmedev.io');

    // Corrupted earlier ledger line must not break duplicate suppression.
    const ledgerPath = path.join(tmpDir, 'signup-welcome-emails.jsonl');
    fs.writeFileSync(ledgerPath, `not-json\n${fs.readFileSync(ledgerPath, 'utf8')}`);
    const second = await dispatchSignupWelcomeEmail({
      to: 'maya@acmedev.io',
      customerName: 'Maya Lin',
      source: 'sso_google',
      feedbackDir: tmpDir,
      fetchImpl: fakeFetch,
    });
    assert.deepEqual(second, { sent: false, reason: 'already_sent' });
    assert.equal(payloads.length, 1, 'repeat SSO login must not send duplicate day-0 email');

    // Concurrent dispatches for the same address must send only once.
    const concurrentResults = await Promise.all([
      dispatchSignupWelcomeEmail({ to: 'dev@cloudteam.io', feedbackDir: tmpDir, fetchImpl: fakeFetch }),
      dispatchSignupWelcomeEmail({ to: 'dev@cloudteam.io', feedbackDir: tmpDir, fetchImpl: fakeFetch }),
    ]);
    assert.equal(concurrentResults.filter((r) => r.sent).length, 1);
    assert.equal(concurrentResults.filter((r) => r.reason === 'already_sent').length, 1);
    assert.equal(payloads.length, 2);
  } finally {
    restore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('free-tier limit Talk to us button writes lead into operator intake queue (eligible + intakeClicks)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-crusoe-intake-'));
  const restore = savingEnv([
    'THUMBGATE_FEEDBACK_DIR',
    'THUMBGATE_API_KEY',
    'THUMBGATE_ALLOW_INSECURE',
    'THUMBGATE_OPERATOR_KEY',
    'RESEND_API_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_PRICE_ID',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    '_TEST_API_KEYS_PATH',
  ]);
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  process.env.THUMBGATE_API_KEY = 'tg_admin_crusoe_test';
  process.env.THUMBGATE_OPERATOR_KEY = 'tg_op_crusoe_test';
  process.env.RESEND_API_KEY = '';
  process.env.STRIPE_SECRET_KEY = '';
  process.env.STRIPE_PRICE_ID = '';
  process.env._TEST_API_KEYS_PATH = path.join(tmpDir, 'api-keys.json');

  const serverMod = require('../src/api/server');
  const { startServer } = serverMod;
  const { formatReport, normalizeWindowSummary, normalizeWorkflowIntakeQueue } = require('../scripts/revenue-status');
  const handle = await startServer({ port: 0, host: '127.0.0.1' });
  const origin = `http://127.0.0.1:${handle.port}`;
  try {
    const lessonsHtml = await (await fetch(`${origin}/lessons`)).text();
    assert.match(lessonsHtml, /data-talk-to-us/);
    assert.match(lessonsHtml, /Talk to us/);
    assert.match(lessonsHtml, /free_tier_limit/);

    const dashboardHtml = await (await fetch(`${origin}/dashboard`)).text();
    assert.match(dashboardHtml, /data-talk-to-us/);
    assert.match(dashboardHtml, /submitDashboardTalkToUs/);
    assert.match(dashboardHtml, /Talk to us/);

    // Newsletter signup exercises server.js dispatchSignupWelcomeEmail path (skips send cleanly when RESEND_API_KEY is unset).
    const nlRes = await fetch(`${origin}/api/newsletter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: 'email=newsignup%40cloudteam.io',
    });
    assert.equal(nlRes.status, 200);

    // Google SSO Free-tier sign-in exercises completeSsoSessionAndRedirect (!hasPaidKey) + 1-click Talk to us using sso_free cookie.
    const crypto = require('node:crypto');
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'crusoe-kid', alg: 'RS256', use: 'sig' };
    process.env.GOOGLE_CLIENT_ID = 'crusoe-google-client.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'crusoe-google-secret';
    const jwtHeader = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'crusoe-kid' })).toString('base64url');
    const jwtPayload = Buffer.from(JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: 'crusoe-google-client.apps.googleusercontent.com',
      exp: Math.floor(Date.now() / 1000) + 600,
      email: 'ssofree@cloudteam.io',
      email_verified: true,
      sub: 'google_sso_free_crusoe_1',
    })).toString('base64url');
    const idToken = `${jwtHeader}.${jwtPayload}.${crypto.sign('RSA-SHA256', Buffer.from(`${jwtHeader}.${jwtPayload}`), privateKey).toString('base64url')}`;
    serverMod.__test__.setGoogleOAuthFetchForTests(async (url) => (
      String(url) === 'https://oauth2.googleapis.com/token'
        ? { ok: true, status: 200, json: async () => ({ access_token: 'ya29.crusoe', id_token: idToken }) }
        : { ok: true, status: 200, json: async () => ({ keys: [publicJwk] }) }
    ));
    const authStart = await fetch(`${origin}/v1/cloud/sso/authorize?provider=google`, { redirect: 'manual' });
    assert.equal(authStart.status, 302);
    const stateCookie = (authStart.headers.get('set-cookie') || '').split(';')[0];
    const stateVal = new URL(authStart.headers.get('location')).searchParams.get('state');
    const ssoCb = await fetch(`${origin}/v1/cloud/sso/callback?provider=google&code=code_crusoe_1&state=${encodeURIComponent(stateVal)}`, {
      headers: { Cookie: stateCookie },
      redirect: 'manual',
    });
    assert.equal(ssoCb.status, 302);
    const sessionCookie = (ssoCb.headers.getSetCookie ? ssoCb.headers.getSetCookie() : [ssoCb.headers.get('set-cookie') || ''])
      .map((c) => c.split(';')[0])
      .find((c) => c.startsWith('thumbgate_auth_session='));
    assert.ok(sessionCookie, 'expected thumbgate_auth_session cookie from SSO callback');

    const ssoIntakeRes = await fetch(`${origin}/v1/intake/workflow-sprint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie, 'x-forwarded-for': '203.0.113.88' },
      body: JSON.stringify({
        workflow: 'Free-tier dashboard sign-in (Talk to us)',
        urgency: 'Hit free-tier limit on /dashboard',
        ctaId: 'workflow_sprint_intake',
        ctaPlacement: 'free_tier_limit',
        page: '/dashboard',
      }),
    });
    assert.equal(ssoIntakeRes.status, 201);

    // Anonymous free-tier click without SSO cookie returns 400 so the UI reveals the email input, then 201 once submitted.
    const missingEmailRes = await fetch(`${origin}/v1/intake/workflow-sprint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.89' },
      body: JSON.stringify({
        ctaId: 'workflow_sprint_intake',
        ctaPlacement: 'free_tier_limit',
        page: '/lessons',
      }),
    });
    assert.equal(missingEmailRes.status, 400);

    const intakeRes = await fetch(`${origin}/v1/intake/workflow-sprint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'alex@cloudteam.io',
        workflow: 'Free-tier dashboard limit (Talk to us)',
        urgency: 'Hit free-tier limit on /dashboard',
        planId: 'diagnostic',
        ctaId: 'workflow_sprint_intake',
        ctaPlacement: 'free_tier_limit',
        page: '/dashboard',
      }),
    });
    assert.equal(intakeRes.status, 201);
    const intakeBody = await intakeRes.json();
    assert.equal(intakeBody.ok, true);
    assert.equal(intakeBody.status, 'new');
    assert.equal(intakeBody.offer, 'workflow_hardening_diagnostic');

    const summaryRes = await fetch(`${origin}/v1/billing/summary?window=30d&include_intake_queue=1`, {
      headers: { Authorization: 'Bearer tg_op_crusoe_test' },
    });
    assert.equal(summaryRes.status, 200);
    const summary = await summaryRes.json();
    assert.equal(summary.intakeQueue.total, 2);
    assert.equal(summary.intakeQueue.eligibleTotal, 2);
    assert.equal(summary.intakeQueue.byStatus.new, 2);
    assert.equal(summary.ctas.checkoutInterstitialWorkflowIntakeClicks, 2);

    const queueRes = await fetch(`${origin}/v1/intake/workflow-sprint/queue`, {
      headers: { Authorization: 'Bearer tg_op_crusoe_test' },
    });
    assert.equal(queueRes.status, 200);
    const queuePayload = await queueRes.json();
    const normalizedQueue = normalizeWorkflowIntakeQueue(queuePayload);
    assert.equal(normalizedQueue.eligibleTotal, 2);

    const normalized30d = normalizeWindowSummary(200, summary);
    const reportText = formatReport({
      generatedAt: '2026-11-12T19:00:00.000Z',
      source: 'test',
      diagnosis: {
        primaryIssue: 'conversion_or_pricing_gap',
        trackingImplemented: true,
        telemetryIngressWorking: true,
        hostedSummaryWorking: true,
        hostedTrafficObserved: true,
        hostedRevenueObserved: false,
        externalCustomerRevenueObserved: false,
        hostedAuditMethod: 'http',
        runtimePresenceKnown: false,
        gaps: [],
      },
      publicProbe: { health: { status: 200, version: '1.39.1' }, telemetryPing: { status: 204 } },
      hostedAudit: {
        runtimePresence: {},
        summaries: { today: normalized30d, '30d': normalized30d, lifetime: normalized30d },
        intakeQueue: normalizedQueue,
      },
    });
    assert.match(reportText, /intakeClicks 2/);
    assert.match(reportText, /Operator intake queue: eligible 2/);
  } finally {
    serverMod.__test__.setGoogleOAuthFetchForTests(null);
    handle.server.closeAllConnections?.();
    await new Promise((resolve) => handle.server.close(resolve));
    restore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
