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

test('revenue email campaign includes required commercial compliance footer and paid CTAs', () => {
  const message = renderMessage(CAMPAIGNS.aiventyx_marketplace_followup);
  assert.equal(message.to, 'qaisermehdi3@gmail.com');
  assert.match(message.text, /buy\.stripe\.com\/aFa8wPgH29Lo4lH35V3sI0w/);
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

test('revenue email dispatch sends through injected transport when confirmed', async () => {
  const calls = [];
  const result = await main(['--campaign=aiventyx_marketplace_followup', '--confirm-send'], {
    sendEmail: async (payload) => {
      calls.push(payload);
      return { sent: true, id: 'email_123' };
    },
  });
  assert.equal(result.sent, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].to, 'qaisermehdi3@gmail.com');
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
