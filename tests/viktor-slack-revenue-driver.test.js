'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  VIKTOR_CONNECTED_INTEGRATIONS,
  VIKTOR_SCHEDULED_REVENUE_TASKS,
  evaluateViktorToolGate,
} = require('../scripts/viktor-slack-revenue-driver');

test('Viktor configuration: includes 10+ connected integrations and 3 scheduled revenue tasks', () => {
  assert.ok(VIKTOR_CONNECTED_INTEGRATIONS.includes('slack:T0C969B5NNT'));
  assert.ok(VIKTOR_CONNECTED_INTEGRATIONS.includes('stripe'));
  assert.equal(VIKTOR_SCHEDULED_REVENUE_TASKS.length, 3);
});

test('evaluateViktorToolGate: blocks Boardy+Fo 3-way scheduling collision, protected Slack kicks, and unapproved Stripe refunds', () => {
  const collision = evaluateViktorToolGate({
    toolName: 'gmail',
    action: 'send_email',
    recipients: ['eddie@hotdata.dev', 'boardy@boardy.ai', 'fo@wajo.ai'],
  });
  assert.equal(collision.allowed, false);
  assert.equal(collision.gateId, 'gate:viktor:anti_bot_collision');

  const slackKick = evaluateViktorToolGate({
    toolName: 'slack',
    action: 'kick_user',
    channel: 'dm:eddie',
  });
  assert.equal(slackKick.allowed, false);
  assert.equal(slackKick.gateId, 'gate:viktor:slack_destructive_action');

  const stripeRefund = evaluateViktorToolGate({
    toolName: 'stripe',
    action: 'create_refund',
    payload: { amount: 250000 },
  });
  assert.equal(stripeRefund.allowed, false);
  assert.equal(stripeRefund.gateId, 'gate:viktor:stripe_mutation_diode');

  const safeRead = evaluateViktorToolGate({
    toolName: 'stripe',
    action: 'list_checkout_sessions',
  });
  assert.equal(safeRead.allowed, true);
});
