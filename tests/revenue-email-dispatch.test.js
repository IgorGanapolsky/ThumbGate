'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CAMPAIGNS,
  isCliEntrypoint,
  parseArgs,
  renderMessage,
  main,
} = require('../scripts/revenue-email-dispatch');

test('unverified-cost revenue email is paused and contains only first-party buyer paths', () => {
  const message = renderMessage(CAMPAIGNS.aiventyx_marketplace_followup);
  assert.equal(message.to, 'qaisermehdi3@gmail.com');
  assert.equal(CAMPAIGNS.aiventyx_marketplace_followup.status, 'hold_unverified_cost');
  assert.match(message.text, /payment routing remains paused/i);
  assert.match(message.text, /https:\/\/thumbgate\.ai\/diagnostic/);
  assert.match(message.text, /https:\/\/thumbgate\.ai\/go\/sprint/);
  assert.doesNotMatch(message.text, /buy\.stripe\.com|paypal\.com\/ncp\/payment/);
  assert.match(message.text, /Max Smith KDP LLC/);
  assert.match(message.text, /Unsubscribe:/);
});

test('revenue email dispatch requires explicit confirm send', async () => {
  const result = await main(['--campaign=aiventyx_marketplace_followup'], {
    sendEmail: async () => {
      throw new Error('send should not run without confirmation');
    },
  });
  assert.equal(result.sent, false);
  assert.equal(result.dryRun, true);
});

test('revenue email dispatch fail-closes a confirmed unverified-cost campaign', async () => {
  const calls = [];
  await assert.rejects(
    () => main(['--campaign=aiventyx_marketplace_followup', '--confirm-send'], {
      sendEmail: async (payload) => {
        calls.push(payload);
        return { sent: true, id: 'email_123' };
      },
    }),
    /Revenue email blocked: hold_unverified_cost/,
  );
  assert.equal(calls.length, 0);
});

test('blocked campaign never reaches Resend even when the injected transport would reject', async () => {
  let called = false;
  await assert.rejects(
    () => main(['--campaign=aiventyx_marketplace_followup', '--confirm-send'], {
      sendEmail: async () => {
        called = true;
        return { sent: false, reason: 'api_error' };
      },
    }),
    /Revenue email blocked: hold_unverified_cost/,
  );
  assert.equal(called, false);
});

test('parseArgs captures campaign and guards', () => {
  assert.deepEqual(parseArgs(['--campaign=aiventyx_marketplace_followup', '--dry-run', '--confirm-send']), {
    campaign: 'aiventyx_marketplace_followup',
    dryRun: true,
    confirmSend: true,
  });
});

test('CLI entrypoint detection is path based', () => {
  assert.equal(isCliEntrypoint(require.resolve('../scripts/revenue-email-dispatch')), true);
  assert.equal(isCliEntrypoint(require.resolve('./revenue-email-dispatch.test')), false);
});
