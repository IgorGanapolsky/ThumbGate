'use strict';

/**
 * tests/mailer.test.js — unit tests for scripts/mailer.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const mailerPath = require.resolve('../scripts/mailer');

function freshMailer() {
  delete require.cache[require.resolve('../scripts/mailer/resend-mailer')];
  delete require.cache[mailerPath];
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

test('sendTrialWelcomeEmail returns {sent:false, reason:no_api_key} when RESEND_API_KEY is missing', async () => {
  const restore = savingEnv(['RESEND_API_KEY', 'THUMBGATE_RESEND_API_KEY', 'RESEND_FROM_EMAIL']);
  delete process.env.RESEND_API_KEY;
  delete process.env.THUMBGATE_RESEND_API_KEY;
  const { sendTrialWelcomeEmail } = freshMailer();

  let calls = 0;
  const fakeFetch = () => { calls++; return Promise.resolve({ ok: true, status: 200, text: async () => '{}' }); };

  const res = await sendTrialWelcomeEmail({
    to: 'test@example.com',
    licenseKey: 'tg_test_key_123',
    customerId: 'cus_abc',
    fetchImpl: fakeFetch,
  });

  assert.deepEqual(res, { sent: false, reason: 'no_api_key' });
  assert.equal(calls, 0, 'fetch must not be called when API key is missing');
  restore();
});

test('sendTrialWelcomeEmail accepts THUMBGATE_RESEND_API_KEY as a fallback for the bare RESEND_API_KEY', async () => {
  const restore = savingEnv(['RESEND_API_KEY', 'THUMBGATE_RESEND_API_KEY', 'RESEND_FROM_EMAIL']);
  delete process.env.RESEND_API_KEY;
  process.env.THUMBGATE_RESEND_API_KEY = 're_prefixed_fallback_key';
  const { sendTrialWelcomeEmail } = freshMailer();

  let captured = null;
  const fakeFetch = async (url, init) => {
    captured = { url, headers: init.headers };
    return { ok: true, status: 200, text: async () => '{"id":"email_fallback_1"}' };
  };

  const res = await sendTrialWelcomeEmail({
    to: 'fallback@example.com',
    licenseKey: 'tg_fallback_key',
    customerId: 'cus_fallback',
    fetchImpl: fakeFetch,
  });

  assert.equal(res.sent, true, 'email must send when only THUMBGATE_RESEND_API_KEY is set');
  assert.equal(captured.url, 'https://api.resend.com/emails');
  assert.equal(captured.headers.Authorization, 'Bearer re_prefixed_fallback_key');
  restore();
});

test('sendTrialWelcomeEmail POSTs to Resend with correct headers, reply_to, and payload shape', async () => {
  const restore = savingEnv([
    'RESEND_API_KEY',
    'RESEND_FROM_EMAIL',
    'THUMBGATE_TRIAL_EMAIL_REPLY_TO',
    'THUMBGATE_VERIFIED_SENDER_DOMAINS',
    'THUMBGATE_BUSINESS_ADDRESS',
  ]);
  process.env.RESEND_API_KEY = 're_test_123';
  process.env.RESEND_FROM_EMAIL = 'hello@thumbgate.app';
  process.env.THUMBGATE_VERIFIED_SENDER_DOMAINS = 'thumbgate.app';
  delete process.env.THUMBGATE_TRIAL_EMAIL_REPLY_TO;
  delete process.env.THUMBGATE_BUSINESS_ADDRESS;
  const { sendTrialWelcomeEmail } = freshMailer();

  let captured = null;
  const fakeFetch = (url, init) => {
    captured = { url, init };
    return Promise.resolve({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: 'email_xyz' }),
    });
  };

  const res = await sendTrialWelcomeEmail({
    to: 'igor@example.com',
    licenseKey: 'tg_09239a0a433649ba442467567af1825b',
    customerId: 'cus_Pro42',
    customerName: 'Igor Ganapolsky',
    trialEndAt: new Date(Date.UTC(2026, 3, 24)), // Apr 24, 2026
    fetchImpl: fakeFetch,
  });

  assert.equal(res.sent, true);
  assert.equal(res.id, 'email_xyz');
  assert.ok(captured, 'fetch must have been called');
  assert.equal(captured.url, 'https://api.resend.com/emails');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers.Authorization, 'Bearer re_test_123');
  assert.equal(captured.init.headers['Content-Type'], 'application/json');

  const body = JSON.parse(captured.init.body);
  assert.deepEqual(body.to, ['igor@example.com']);
  assert.equal(body.from, 'hello@thumbgate.app');
  // Subject is personalized with the first name when available.
  assert.equal(body.subject, 'Igor, your ThumbGate Pro key is inside');
  // reply_to defaults to a deliverable operator inbox until thumbgate.app is registered.
  assert.equal(body.reply_to, 'igor.ganapolsky@gmail.com');

  // License key + activation command present in both bodies.
  assert.ok(body.html && body.html.includes('tg_09239a0a433649ba442467567af1825b'));
  assert.ok(body.text && body.text.includes('tg_09239a0a433649ba442467567af1825b'));
  assert.ok(body.html.includes('npx thumbgate pro --activate --key=tg_09239a0a433649ba442467567af1825b'));
  assert.ok(body.text.includes('npx thumbgate pro --activate --key=tg_09239a0a433649ba442467567af1825b'));

  // Greeting uses the first name, not "Hi there".
  assert.ok(body.html.includes('Hi Igor,'), 'html greeting must use first name');
  assert.ok(body.text.includes('Hi Igor,'), 'text greeting must use first name');

  // Immediate paid access is rendered without trial-end promises.
  assert.ok(body.html.includes('Your paid Pro access is active'), 'html must describe active paid access');
  assert.ok(body.text.includes('Your paid Pro access is active'), 'text must describe active paid access');
  assert.ok(!body.html.includes('Apr 24, 2026'), 'html must not show a trial end date');
  assert.ok(!body.text.includes('Apr 24, 2026'), 'text must not show a trial end date');

  // P.S. line present — highest-read section of any email.
  assert.ok(body.html.includes('first 10 minutes'), 'html must include the P.S. / first-10-min framing');
  assert.ok(body.text.includes('P.S.'), 'text must carry a P.S. line');

  // CAN-SPAM compliance: business name + physical address + unsubscribe.
  assert.ok(body.html.includes('Max Smith KDP LLC'), 'html footer must carry business name');
  assert.ok(body.html.includes('2261 Market Street #4242, San Francisco, CA 94114'), 'html footer must carry business address');
  assert.ok(body.html.includes('igor.ganapolsky@gmail.com'), 'html footer must expose a deliverable unsubscribe mailto');
  assert.ok(body.text.includes('Max Smith KDP LLC'), 'text footer must carry business name');
  assert.ok(body.text.includes('Unsubscribe:'), 'text footer must carry unsubscribe instruction');

  // Sender personalization.
  assert.ok(body.html.includes('Igor, founder of ThumbGate'), 'html must carry founder signoff');
  assert.ok(body.text.includes('Igor, founder of ThumbGate'), 'text must carry founder signoff');

  // Parse the dashboard link out of the HTML and verify the URL components
  // explicitly. Substring-only checks trip CodeQL's
  // js/incomplete-url-substring-sanitization rule (evil.com/?x=...our-url...
  // would technically match). Parsing with URL() is unambiguous.
  const hrefMatch = body.html.match(/href="([^"]+\/dashboard[^"]*)"/);
  assert.ok(hrefMatch, 'dashboard href missing in html body');
  const htmlDashUrl = new URL(hrefMatch[1]);
  assert.equal(htmlDashUrl.host, 'thumbgate-production.up.railway.app');
  assert.equal(htmlDashUrl.pathname, '/dashboard');
  const textUrlMatch = body.text.match(/(https?:\/\/\S+\/dashboard\S*)/);
  assert.ok(textUrlMatch, 'dashboard URL missing in text body');
  const textDashUrl = new URL(textUrlMatch[1]);
  assert.equal(textDashUrl.host, 'thumbgate-production.up.railway.app');
  assert.equal(textDashUrl.pathname, '/dashboard');
  restore();
});

test('sendTrialWelcomeEmail falls back to "Hi there" greeting and generic subject when customerName is missing', async () => {
  const restore = savingEnv(['RESEND_API_KEY']);
  process.env.RESEND_API_KEY = 're_test_123';
  const { sendTrialWelcomeEmail } = freshMailer();

  let captured = null;
  const fakeFetch = (_url, init) => {
    captured = { init };
    return Promise.resolve({ ok: true, status: 200, text: async () => '{}' });
  };

  await sendTrialWelcomeEmail({
    to: 'anon@example.com',
    licenseKey: 'tg_xyz',
    fetchImpl: fakeFetch,
  });

  const body = JSON.parse(captured.init.body);
  assert.equal(body.subject, 'Your ThumbGate Pro key is inside');
  assert.ok(body.html.includes('Hi there,'));
  assert.ok(body.text.includes('Hi there,'));
  assert.ok(body.html.includes('Your paid Pro access is active'));
  assert.doesNotMatch(body.html, /Trial ends [A-Z][a-z]{2} \d{1,2}, \d{4}/);
  restore();
});

test('sendTrialWelcomeEmail defaults RESEND_FROM_EMAIL to onboarding@resend.dev', async () => {
  const restore = savingEnv(['RESEND_API_KEY', 'RESEND_FROM_EMAIL']);
  process.env.RESEND_API_KEY = 're_test_123';
  delete process.env.RESEND_FROM_EMAIL;
  const { sendTrialWelcomeEmail } = freshMailer();

  let captured = null;
  const fakeFetch = (url, init) => {
    captured = { url, init };
    return Promise.resolve({ ok: true, status: 200, text: async () => '{}' });
  };

  await sendTrialWelcomeEmail({
    to: 'a@b.com',
    licenseKey: 'tg_xyz',
    fetchImpl: fakeFetch,
  });

  const body = JSON.parse(captured.init.body);
  assert.equal(body.from, 'onboarding@resend.dev');
  restore();
});

test('sendTrialWelcomeEmail falls back to resend.dev when configured sender lacks Resend DNS', async () => {
  const restore = savingEnv([
    'RESEND_API_KEY',
    'RESEND_FROM_EMAIL',
    'THUMBGATE_TRIAL_EMAIL_FROM',
    'THUMBGATE_VERIFIED_SENDER_DOMAINS',
    'THUMBGATE_ALLOW_UNVERIFIED_SENDER',
  ]);
  process.env.RESEND_API_KEY = 're_test_123';
  process.env.RESEND_FROM_EMAIL = 'ThumbGate <onboarding@thumbgate.app>';
  delete process.env.THUMBGATE_TRIAL_EMAIL_FROM;
  delete process.env.THUMBGATE_VERIFIED_SENDER_DOMAINS;
  delete process.env.THUMBGATE_ALLOW_UNVERIFIED_SENDER;
  const { sendTrialWelcomeEmail } = freshMailer();

  const dnsResolver = {
    resolveTxt: async () => { throw Object.assign(new Error('queryTxt ENOTFOUND'), { code: 'ENOTFOUND' }); },
    resolveMx: async () => { throw Object.assign(new Error('queryMx ENOTFOUND'), { code: 'ENOTFOUND' }); },
  };

  let captured = null;
  const fakeFetch = (_url, init) => {
    captured = { init };
    return Promise.resolve({ ok: true, status: 200, text: async () => '{"id":"email_safe"}' });
  };

  const res = await sendTrialWelcomeEmail({
    to: 'safe@example.com',
    licenseKey: 'tg_safe',
    fetchImpl: fakeFetch,
    dnsResolver,
  });

  assert.equal(res.sent, true);
  assert.equal(res.id, 'email_safe');
  assert.equal(res.senderFallback.reason, 'resend_dns_not_ready');
  assert.equal(res.senderFallback.domain, 'thumbgate.app');
  const body = JSON.parse(captured.init.body);
  assert.equal(body.from, 'onboarding@resend.dev');
  restore();
});

test('sendTrialWelcomeEmail respects THUMBGATE_BUSINESS_ADDRESS override', async () => {
  const restore = savingEnv(['RESEND_API_KEY', 'THUMBGATE_BUSINESS_ADDRESS']);
  process.env.RESEND_API_KEY = 're_test_123';
  process.env.THUMBGATE_BUSINESS_ADDRESS = 'PO Box 1234, Brooklyn, NY 11201';
  const { sendTrialWelcomeEmail } = freshMailer();

  let captured = null;
  const fakeFetch = (_url, init) => {
    captured = { init };
    return Promise.resolve({ ok: true, status: 200, text: async () => '{}' });
  };

  await sendTrialWelcomeEmail({ to: 'a@b.com', licenseKey: 'tg_xyz', fetchImpl: fakeFetch });
  const body = JSON.parse(captured.init.body);
  assert.ok(body.html.includes('PO Box 1234, Brooklyn, NY 11201'));
  assert.ok(body.text.includes('PO Box 1234, Brooklyn, NY 11201'));
  restore();
});

test('sendTrialWelcomeEmail throws on missing `to`', async () => {
  const { sendTrialWelcomeEmail } = freshMailer();
  await assert.rejects(
    () => sendTrialWelcomeEmail({ licenseKey: 'tg_x' }),
    /`to` is required/,
  );
});

test('sendTrialWelcomeEmail throws on missing `licenseKey`', async () => {
  const { sendTrialWelcomeEmail } = freshMailer();
  await assert.rejects(
    () => sendTrialWelcomeEmail({ to: 'a@b.com' }),
    /`licenseKey` is required/,
  );
});

test('sendEmail validates required fields', async () => {
  const { sendEmail } = freshMailer();
  await assert.rejects(() => sendEmail({ subject: 's', text: 't' }), /`to` is required/);
  await assert.rejects(() => sendEmail({ to: 'a@b.com', text: 't' }), /`subject` is required/);
  await assert.rejects(
    () => sendEmail({ to: 'a@b.com', subject: 's' }),
    /`html` or `text` is required/,
  );
});

test('sendEmail returns {sent:false, reason:api_error} on non-2xx response', async () => {
  const restore = savingEnv(['RESEND_API_KEY']);
  process.env.RESEND_API_KEY = 're_test_fail';
  const { sendEmail } = freshMailer();

  const fakeFetch = () => Promise.resolve({
    ok: false,
    status: 422,
    text: async () => JSON.stringify({ message: 'bad sender' }),
  });

  const res = await sendEmail({
    to: 'x@y.com',
    subject: 'Hi',
    text: 'body',
    fetchImpl: fakeFetch,
  });

  assert.equal(res.sent, false);
  assert.equal(res.reason, 'api_error');
  assert.equal(res.status, 422);
  restore();
});

test('sendEmail catches network exceptions and returns structured failure', async () => {
  const restore = savingEnv(['RESEND_API_KEY']);
  process.env.RESEND_API_KEY = 're_test_net';
  const { sendEmail } = freshMailer();

  const fakeFetch = () => Promise.reject(new Error('ECONNREFUSED'));

  const res = await sendEmail({
    to: 'x@y.com',
    subject: 'Hi',
    text: 'body',
    fetchImpl: fakeFetch,
  });

  assert.equal(res.sent, false);
  assert.equal(res.reason, 'exception');
  assert.match(res.error, /ECONNREFUSED/);
  restore();
});

test('renderTrialWelcomeBodies embeds license key, activation command, dashboard URL, paid access, and CAN-SPAM footer', () => {
  const { renderTrialWelcomeBodies } = freshMailer();
  const { html, text, activationCommand, greeting, unsubscribeEmail, businessName, businessAddress } = renderTrialWelcomeBodies({
    licenseKey: 'tg_abc',
    customerId: 'cus_42',
    customerName: 'Ada Lovelace',
    trialEndAt: new Date(Date.UTC(2026, 3, 24)),
  });
  assert.equal(activationCommand, 'npx thumbgate pro --activate --key=tg_abc');
  assert.equal(greeting, 'Hi Ada,');
  assert.equal(unsubscribeEmail, 'igor.ganapolsky@gmail.com');
  assert.equal(businessName, 'Max Smith KDP LLC');
  assert.ok(businessAddress.length > 0);
  for (const fragment of [
    'tg_abc',
    'npx thumbgate pro --activate --key=tg_abc',
    'https://thumbgate-production.up.railway.app/dashboard',
    'ThumbGate Pro',
    'Your paid Pro access is active',
    'Hi Ada,',
    'Max Smith KDP LLC',
  ]) {
    assert.ok(html.includes(fragment), `html missing: ${fragment}`);
    assert.ok(text.includes(fragment), `text missing: ${fragment}`);
  }
  assert.ok(!html.includes('Apr 24, 2026'));
  assert.ok(!text.includes('Apr 24, 2026'));
  assert.ok(html.includes('igor.ganapolsky@gmail.com'));
  assert.ok(text.includes('igor.ganapolsky@gmail.com'));
  // Customer ID shows in the html footer only — not in the customer-visible body prose.
  assert.ok(html.includes('cus_42'));
  // Customer ID must NOT appear in the text body — we want to stop leaking debug IDs in
  // the plain-text version too, but keeping it in the html for support handoffs is OK.
  // (Keep the invariant narrow — assert it's below the footer separator.)
  const cusIdxHtml = html.indexOf('cus_42');
  const footerIdxHtml = html.indexOf('Customer ID (for support)');
  assert.ok(cusIdxHtml > 0 && cusIdxHtml >= footerIdxHtml, 'cus_id should live inside the support footer');
});
