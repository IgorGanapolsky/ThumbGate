'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseArgs,
  bucketSessions,
  bucketPaymentIntentErrors,
  runDiagnostic,
  renderMarkdown,
} = require('../scripts/stripe-checkout-diagnostic');

test('parseArgs reads --json and --limit', () => {
  assert.equal(parseArgs(['--json']).json, true);
  assert.equal(parseArgs([]).json, false);
  assert.equal(parseArgs(['--limit=50']).limit, 50);
  assert.equal(parseArgs([]).limit, 100);
  // Negative / non-integer falls back to default
  assert.equal(parseArgs(['--limit=-1']).limit, 100);
  assert.equal(parseArgs(['--limit=banana']).limit, 100);
});

test('bucketSessions groups by status and payment_status', () => {
  const sessions = [
    { status: 'complete', payment_status: 'paid' },
    { status: 'expired', payment_status: 'unpaid' },
    { status: 'expired', payment_status: 'unpaid' },
    { status: 'open', payment_status: 'no_payment_required' },
  ];
  const buckets = bucketSessions(sessions);
  assert.deepEqual(buckets.byStatus, { complete: 1, expired: 2, open: 1 });
  assert.deepEqual(buckets.byPaymentStatus, { paid: 1, unpaid: 2, no_payment_required: 1 });
});

test('bucketSessions handles missing status fields', () => {
  const sessions = [{}, { status: 'complete' }, { payment_status: 'paid' }];
  const buckets = bucketSessions(sessions);
  assert.equal(buckets.byStatus.unknown, 2);
  assert.equal(buckets.byStatus.complete, 1);
  assert.equal(buckets.byPaymentStatus.none, 2);
});

test('bucketPaymentIntentErrors counts last_payment_error by code, type, and decline_code', () => {
  const intents = [
    { last_payment_error: { code: 'card_declined', type: 'card_error', decline_code: 'insufficient_funds' } },
    { last_payment_error: { code: 'card_declined', type: 'card_error', decline_code: 'generic_decline' } },
    { last_payment_error: { code: 'authentication_required', type: 'card_error', decline_code: null } },
    { /* no error — completed cleanly */ },
  ];
  const buckets = bucketPaymentIntentErrors(intents);
  assert.equal(buckets.intentsTotal, 4);
  assert.equal(buckets.intentsWithError, 3);
  assert.equal(buckets.byErrorCode.card_declined, 2);
  assert.equal(buckets.byErrorCode.authentication_required, 1);
  assert.equal(buckets.byErrorType.card_error, 3);
  assert.equal(buckets.byDeclineCode.insufficient_funds, 1);
  assert.equal(buckets.byDeclineCode.generic_decline, 1);
  assert.equal(buckets.byDeclineCode.no_decline_code, 1);
});

// runDiagnostic with an injected fake Stripe client ----------------------

function fakePage(rows) {
  return { data: rows, has_more: false };
}

function fakeStripe({ sessions = [], paymentIntents = [], account = null, webhooks = [] } = {}) {
  return {
    checkout: { sessions: { list: async () => fakePage(sessions) } },
    paymentIntents: {
      list: async () => fakePage(paymentIntents),
      retrieve: async (id) => paymentIntents.find((p) => p.id === id) || null,
    },
    accounts: { retrieve: async () => account },
    webhookEndpoints: { list: async () => fakePage(webhooks) },
  };
}

test('runDiagnostic returns a gap object when STRIPE_SECRET_KEY is missing', async () => {
  const report = await runDiagnostic({ secretKey: '' });
  assert.equal(report.configured, false);
  assert.match(report.gap, /STRIPE_SECRET_KEY/);
});

test('runDiagnostic surfaces account.charges_enabled = false as the binding diagnosis', async () => {
  const stripeClient = fakeStripe({
    sessions: [
      { id: 'cs_1', status: 'expired', payment_status: 'unpaid', created: 1700000000 },
    ],
    paymentIntents: [],
    account: {
      id: 'acct_test',
      type: 'standard',
      country: 'US',
      default_currency: 'usd',
      details_submitted: true,
      charges_enabled: false,
      payouts_enabled: false,
      requirements: {
        disabled_reason: 'requirements.past_due',
        currently_due: [],
        past_due: ['individual.id_number', 'individual.verification.document'],
        eventually_due: [],
        pending_verification: [],
      },
      capabilities: {},
    },
    webhooks: [],
  });
  const report = await runDiagnostic({ stripeClient });
  assert.equal(report.configured, true);
  assert.equal(report.account.chargesEnabled, false);
  assert.equal(report.account.payoutsEnabled, false);
  assert.deepEqual(report.account.pastDue, ['individual.id_number', 'individual.verification.document']);

  const md = renderMarkdown(report);
  assert.match(md, /charges_enabled: false/);
  assert.match(md, /requirements\.past_due/);
  assert.match(md, /This is the binding blocker/);
});

test('runDiagnostic flags missing webhook endpoints as a perception risk', async () => {
  const stripeClient = fakeStripe({
    sessions: [],
    paymentIntents: [],
    account: {
      id: 'acct_test',
      type: 'standard',
      country: 'US',
      default_currency: 'usd',
      details_submitted: true,
      charges_enabled: true,
      payouts_enabled: true,
      requirements: { disabled_reason: null, currently_due: [], past_due: [], eventually_due: [], pending_verification: [] },
      capabilities: {},
    },
    webhooks: [],
  });
  const report = await runDiagnostic({ stripeClient });
  const md = renderMarkdown(report);
  assert.match(md, /No webhook endpoints configured/);
});

test('runDiagnostic recent-sessions table includes PI error codes when present', async () => {
  const stripeClient = fakeStripe({
    sessions: [
      {
        id: 'cs_a', status: 'expired', payment_status: 'unpaid',
        created: 1700000000,
        customer_email: 'buyer@example.com',
        amount_total: 1900, currency: 'usd',
        payment_intent: 'pi_a',
      },
    ],
    paymentIntents: [
      { id: 'pi_a', last_payment_error: { code: 'card_declined', type: 'card_error', decline_code: 'insufficient_funds', message: 'card declined' } },
    ],
    account: {
      id: 'acct_test', type: 'standard', country: 'US', default_currency: 'usd',
      details_submitted: true, charges_enabled: true, payouts_enabled: true,
      requirements: { disabled_reason: null, currently_due: [], past_due: [], eventually_due: [], pending_verification: [] },
      capabilities: {},
    },
    webhooks: [],
  });
  const report = await runDiagnostic({ stripeClient });
  const md = renderMarkdown(report);
  assert.match(md, /buyer \(at\) example\.com/);
  assert.match(md, /card_declined/);
  assert.match(md, /insufficient_funds/);
});

test('renderMarkdown emits the abandonment diagnosis when there are no PI errors but many sessions', async () => {
  const sessions = Array.from({ length: 60 }, (_, i) => ({
    id: `cs_${i}`, status: i % 2 ? 'expired' : 'open', payment_status: 'unpaid', created: 1700000000,
  }));
  const stripeClient = fakeStripe({
    sessions,
    paymentIntents: [], // Zero intents = nobody attempted to pay
    account: {
      id: 'acct_test', type: 'standard', country: 'US', default_currency: 'usd',
      details_submitted: true, charges_enabled: true, payouts_enabled: true,
      requirements: { disabled_reason: null, currently_due: [], past_due: [], eventually_due: [], pending_verification: [] },
      capabilities: {},
    },
    webhooks: [{ id: 'we_1', url: 'https://thumbgate.ai/v1/billing/webhook', status: 'enabled', enabled_events: ['*'], api_version: '2024-12-18', created: 1700000000 }],
  });
  const report = await runDiagnostic({ stripeClient });
  const md = renderMarkdown(report);
  // Uniform-expiry diagnosis fires when 0 completions and >50 non-complete sessions
  assert.match(md, /uniformly expiring or staying open/);
});
