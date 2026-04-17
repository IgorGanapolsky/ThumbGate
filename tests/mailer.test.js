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
  const restore = savingEnv(['RESEND_API_KEY', 'RESEND_FROM_EMAIL']);
  delete process.env.RESEND_API_KEY;
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

test('sendTrialWelcomeEmail POSTs to Resend with correct headers and payload shape', async () => {
  const restore = savingEnv(['RESEND_API_KEY', 'RESEND_FROM_EMAIL']);
  process.env.RESEND_API_KEY = 're_test_123';
  process.env.RESEND_FROM_EMAIL = 'hello@thumbgate.app';
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
  assert.equal(body.subject, 'Welcome to ThumbGate Pro — your license key inside');
  assert.ok(body.html && body.html.includes('tg_09239a0a433649ba442467567af1825b'));
  assert.ok(body.text && body.text.includes('tg_09239a0a433649ba442467567af1825b'));
  assert.ok(body.html.includes('npx thumbgate pro --activate --key=tg_09239a0a433649ba442467567af1825b'));
  assert.ok(body.text.includes('npx thumbgate pro --activate --key=tg_09239a0a433649ba442467567af1825b'));
  assert.ok(body.html.includes('https://thumbgate-production.up.railway.app/dashboard'));
  assert.ok(body.text.includes('https://thumbgate-production.up.railway.app/dashboard'));
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

test('renderTrialWelcomeBodies embeds license key, activation command, dashboard URL, and description', () => {
  const { renderTrialWelcomeBodies } = freshMailer();
  const { html, text, activationCommand } = renderTrialWelcomeBodies({
    licenseKey: 'tg_abc',
    customerId: 'cus_42',
  });
  assert.equal(activationCommand, 'npx thumbgate pro --activate --key=tg_abc');
  for (const fragment of [
    'tg_abc',
    'npx thumbgate pro --activate --key=tg_abc',
    'https://thumbgate-production.up.railway.app/dashboard',
    'ThumbGate Pro',
  ]) {
    assert.ok(html.includes(fragment), `html missing: ${fragment}`);
    assert.ok(text.includes(fragment), `text missing: ${fragment}`);
  }
  assert.ok(html.includes('hello@thumbgate.app'));
  assert.ok(text.includes('hello@thumbgate.app'));
});
