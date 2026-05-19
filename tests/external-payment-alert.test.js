'use strict';

/**
 * Tests for the external-payment alerter that fires when a non-owner
 * customer completes a Stripe checkout session. Previously the only
 * way to learn about a real customer payment was the next daily revenue
 * loop run — up to 24h lag. Now it fires Slack + Resend + structured
 * log in real time from the webhook handler.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  emitExternalPaymentAlert,
  isOwnerEmailForAlert,
} = require('../scripts/billing');

function fakeOkResponse() {
  return { ok: true, status: 200, async text() { return ''; } };
}

describe('isOwnerEmailForAlert', () => {
  it('returns true for default owner emails (case-insensitive)', () => {
    assert.equal(isOwnerEmailForAlert('iganapolsky@gmail.com', {}), true);
    assert.equal(isOwnerEmailForAlert('  Igor.Ganapolsky@gmail.COM  ', {}), true);
  });

  it('returns false for non-owner emails', () => {
    assert.equal(isOwnerEmailForAlert('buyer@company.example', {}), false);
    assert.equal(isOwnerEmailForAlert('hello@stripe.com', {}), false);
  });

  it('returns false for empty / null / undefined', () => {
    assert.equal(isOwnerEmailForAlert('', {}), false);
    assert.equal(isOwnerEmailForAlert(null, {}), false);
    assert.equal(isOwnerEmailForAlert(undefined, {}), false);
  });

  it('honors THUMBGATE_OWNER_EMAILS env override', () => {
    const env = { THUMBGATE_OWNER_EMAILS: 'alice@example.com, bob@example.com' };
    assert.equal(isOwnerEmailForAlert('alice@example.com', env), true);
    assert.equal(isOwnerEmailForAlert('BOB@EXAMPLE.COM', env), true);
    // Default owner is no longer in the list when env override is set
    assert.equal(isOwnerEmailForAlert('iganapolsky@gmail.com', env), false);
  });
});

describe('emitExternalPaymentAlert', () => {
  it('skips when customerEmail is missing', async () => {
    const result = await emitExternalPaymentAlert({
      session: { id: 'cs_test_1' },
      customerEmail: '',
      customerId: 'cus_x',
    });
    assert.equal(result.alerted, false);
    assert.equal(result.reason, 'no_email_on_session');
  });

  it('skips when customerEmail is owner (no alert fired even with Slack URL set)', async () => {
    const slackCalls = [];
    const result = await emitExternalPaymentAlert({
      session: { id: 'cs_test_2' },
      customerEmail: 'iganapolsky@gmail.com',
      customerId: 'cus_owner',
    }, {
      env: { THUMBGATE_SLACK_ALERT_WEBHOOK_URL: 'https://slack.test/x' },
      fetchImpl: async (url, init) => { slackCalls.push({ url, body: init?.body }); return fakeOkResponse(); },
    });
    assert.equal(result.alerted, false);
    assert.equal(result.reason, 'owner_email');
    assert.equal(slackCalls.length, 0, 'must not call Slack for owner email');
  });

  it('fires Slack alert when URL configured and external email', async () => {
    const slackCalls = [];
    const logs = [];
    const result = await emitExternalPaymentAlert({
      session: { id: 'cs_test_3', mode: 'subscription' },
      customerEmail: 'buyer@company.example',
      customerName: 'Real Buyer',
      customerId: 'cus_buyer',
      installId: 'inst_abc',
      traceId: 'trace_xyz',
      attribution: { utmSource: 'reddit', utmMedium: 'organic', utmCampaign: 'first_dollar' },
      amountCents: 1900,
      currency: 'usd',
    }, {
      env: { THUMBGATE_SLACK_ALERT_WEBHOOK_URL: 'https://slack.test/hook', RESEND_API_KEY: '' },
      fetchImpl: async (url, init) => { slackCalls.push({ url, body: init?.body }); return fakeOkResponse(); },
      logger: (msg) => logs.push(msg),
    });
    assert.equal(result.alerted, true);
    assert.ok(result.channels.includes('slack'));
    assert.ok(result.channels.includes('log'));
    assert.equal(slackCalls.length, 1);
    const slackPayload = JSON.parse(slackCalls[0].body);
    assert.match(slackPayload.text, /buyer@company\.example/);
    assert.match(slackPayload.text, /19\.00 USD/);
    assert.match(slackPayload.text, /reddit/);
  });

  it('fires Resend email when RESEND_API_KEY configured (via injected sendEmailImpl)', async () => {
    const emailCalls = [];
    const logs = [];
    const result = await emitExternalPaymentAlert({
      session: { id: 'cs_test_4' },
      customerEmail: 'pro@startup.example',
      customerId: 'cus_4',
      amountCents: 14900,
      currency: 'usd',
    }, {
      env: { RESEND_API_KEY: 'resend_test_key', THUMBGATE_OPERATOR_ALERT_EMAIL: 'ops@thumbgate.example' },
      sendEmailImpl: async (params) => { emailCalls.push(params); return { sent: true, id: 'em_1' }; },
      logger: (msg) => logs.push(msg),
    });
    assert.equal(result.alerted, true);
    assert.ok(result.channels.includes('email'));
    assert.ok(result.channels.includes('log'));
    assert.equal(emailCalls.length, 1);
    assert.equal(emailCalls[0].to, 'ops@thumbgate.example');
    assert.match(emailCalls[0].subject, /pro@startup\.example/);
    assert.match(emailCalls[0].text, /149\.00 USD/);
  });

  it('falls back to log channel only when no transport configured', async () => {
    const logs = [];
    const result = await emitExternalPaymentAlert({
      session: { id: 'cs_test_5' },
      customerEmail: 'paid@solo.example',
      customerId: 'cus_5',
    }, {
      env: {}, // no Slack, no Resend
      logger: (msg) => logs.push(msg),
    });
    assert.equal(result.alerted, true);
    assert.deepEqual(result.channels, ['log']);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /\[external-payment-alert\]/);
    assert.match(logs[0], /paid@solo\.example/);
  });

  it('does not crash when Slack fetch throws', async () => {
    const logs = [];
    const result = await emitExternalPaymentAlert({
      session: { id: 'cs_test_6' },
      customerEmail: 'crash@example.com',
      customerId: 'cus_6',
    }, {
      env: { THUMBGATE_SLACK_ALERT_WEBHOOK_URL: 'https://slack.test/x' },
      fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
      logger: (msg) => logs.push(msg),
    });
    // Slack failed but log channel still fires.
    assert.equal(result.alerted, true);
    assert.deepEqual(result.channels, ['log']);
  });

  it('does not crash when Resend send throws', async () => {
    const logs = [];
    const result = await emitExternalPaymentAlert({
      session: { id: 'cs_test_7' },
      customerEmail: 'crash2@example.com',
      customerId: 'cus_7',
    }, {
      env: { RESEND_API_KEY: 'rk_test' },
      sendEmailImpl: async () => { throw new Error('boom'); },
      logger: (msg) => logs.push(msg),
    });
    assert.equal(result.alerted, true);
    assert.deepEqual(result.channels, ['log']);
  });

  it('formats unknown amount cleanly when amountCents missing', async () => {
    const logs = [];
    await emitExternalPaymentAlert({
      session: { id: 'cs_test_8' },
      customerEmail: 'nopiamount@example.com',
      customerId: 'cus_8',
      amountCents: null,
      currency: null,
    }, { env: {}, logger: (msg) => logs.push(msg) });
    assert.match(logs[0], /\[external-payment-alert\]/);
    assert.match(logs[0], /nopiamount@example\.com/);
  });
});
