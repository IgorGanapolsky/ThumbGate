'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseArgs,
  bucketSessions,
  bucketPaymentIntentErrors,
  extractSessionAttribution,
  isPlaceholderIdentityEmail,
  summarizeSessionEvidence,
  summarizeSessionRecency,
  classifyCheckoutFunnel,
  runDiagnostic,
  renderMarkdown,
} = require('../scripts/stripe-checkout-diagnostic');

test('parseArgs reads --json and --limit', () => {
  assert.equal(parseArgs(['--json']).json, true);
  assert.equal(parseArgs([]).json, false);
  assert.equal(parseArgs(['--limit=50']).limit, 50);
  assert.equal(parseArgs([]).limit, 10000);
  // Negative / non-integer falls back to default
  assert.equal(parseArgs(['--limit=-1']).limit, 10000);
  assert.equal(parseArgs(['--limit=banana']).limit, 10000);
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

test('classifyCheckoutFunnel refuses to call anonymous raw sessions buyer abandonment', () => {
  const anonymous = classifyCheckoutFunnel({
    sessions: Array.from({ length: 30 }, (_, i) => ({
      status: i % 2 ? 'expired' : 'open',
      payment_status: 'unpaid',
    })),
    paymentIntents: [],
    account: { configured: true, chargesEnabled: true },
  });
  assert.equal(anonymous.primaryDiagnosis, 'unverified_session_noise_or_pre_payment_exit');
  assert.equal(anonymous.checkoutConversionRate, 0);
  assert.equal(anonymous.paymentIntentsTotal, 0);
  assert.equal(anonymous.strongIntentEvidenceSessions, 0);
  assert.equal(anonymous.rawOnlySessions, 30);
  assert.match(anonymous.recommendation, /do not prove buyer abandonment/);

  const blocked = classifyCheckoutFunnel({
    sessions: [{ status: 'expired', payment_status: 'unpaid' }],
    paymentIntents: [],
    account: { configured: true, chargesEnabled: false },
  });
  assert.equal(blocked.primaryDiagnosis, 'stripe_account_blocked');
});

test('classifyCheckoutFunnel distinguishes identified pre-payment dropoff', () => {
  const sessions = Array.from({ length: 30 }, (_, index) => ({
    status: index % 2 ? 'expired' : 'open',
    payment_status: 'unpaid',
    customer_email: index === 0 ? 'procurement@buyer-company.com' : null,
  }));
  const result = classifyCheckoutFunnel({
    sessions,
    paymentIntents: [],
    account: { configured: true, chargesEnabled: true },
  });
  assert.equal(result.primaryDiagnosis, 'identified_pre_payment_dropoff');
  assert.equal(result.strongIntentEvidenceSessions, 1);
  assert.match(result.recommendation, /Identified checkout entrants/);
});

test('extractSessionAttribution restores source and plan from the compact reference', () => {
  const attribution = extractSessionAttribution({
    client_reference_id: 'tg207website0025acq_mrmhxlrm_a7393664311317sprint_diagnostic',
  });
  assert.equal(attribution.source, 'website');
  assert.equal(attribution.planId, 'sprint_diagnostic');
  assert.equal(attribution.hasAcquisitionId, true);
});

test('placeholder identity detection excludes reserved and synthetic test emails', () => {
  assert.equal(isPlaceholderIdentityEmail('buyer@example.com'), true);
  assert.equal(isPlaceholderIdentityEmail('test+checkout@company.test'), true);
  assert.equal(isPlaceholderIdentityEmail('qa-123@vendor.io'), true);
  assert.equal(isPlaceholderIdentityEmail('procurement@buyer-company.com'), false);
  assert.equal(isPlaceholderIdentityEmail(null), false);
});

test('summarizeSessionEvidence separates attribution-only sessions and flags multi-offer probe clusters', () => {
  const sessions = [
    {
      id: 'cs_pro',
      created: 100,
      status: 'open',
      payment_status: 'unpaid',
      metadata: { source: 'website', planId: 'pro' },
    },
    {
      id: 'cs_diagnostic',
      created: 102,
      status: 'open',
      payment_status: 'unpaid',
      metadata: { source: 'website', planId: 'sprint_diagnostic' },
    },
    {
      id: 'cs_identified',
      created: 200,
      status: 'open',
      payment_status: 'unpaid',
      customer_email: 'procurement@buyer-company.com',
      metadata: { source: 'reddit', planId: 'sprint_diagnostic' },
    },
    {
      id: 'cs_paid',
      created: 300,
      status: 'complete',
      payment_status: 'paid',
      payment_intent: 'pi_paid',
      metadata: { source: 'linkedin', planId: 'pro' },
    },
  ];
  const summary = summarizeSessionEvidence(sessions);
  assert.equal(summary.totalSessions, 4);
  assert.equal(summary.strongIntentEvidenceSessions, 2);
  assert.equal(summary.credibleIdentifiedSessions, 1);
  assert.equal(summary.placeholderIdentitySessions, 0);
  assert.equal(summary.rawOnlySessions, 2);
  assert.equal(summary.attributionOnlySessions, 2);
  assert.equal(summary.possibleAutomationClusters, 1);
  assert.equal(summary.possibleAutomationSessions, 2);
  assert.deepEqual(summary.byPlan, { pro: 2, sprint_diagnostic: 2 });
});

test('summarizeSessionRecency separates current signals from historical conversion without exposing identity', () => {
  const now = 2_000_000;
  const summary = summarizeSessionRecency([
    { created: now - 60 * 60, status: 'open', payment_status: 'unpaid' },
    { created: now - 2 * 24 * 60 * 60, status: 'open', payment_status: 'unpaid', customer_email: 'ops@buyer-company.com' },
    { created: now - 10 * 24 * 60 * 60, status: 'complete', payment_status: 'paid' },
    { created: now - 40 * 24 * 60 * 60, status: 'complete', payment_status: 'paid' },
    { created: now + 60, status: 'complete', payment_status: 'paid' },
  ], now);

  assert.deepEqual(summary.windows.last24Hours, {
    totalSessions: 1,
    completedEvidenceSessions: 0,
    paymentAttemptSessions: 0,
    credibleIdentifiedSessions: 0,
    strongIntentEvidenceSessions: 0,
    rawOnlySessions: 1,
  });
  assert.equal(summary.windows.last7Days.totalSessions, 2);
  assert.equal(summary.windows.last7Days.credibleIdentifiedSessions, 1);
  assert.equal(summary.windows.last30Days.totalSessions, 3);
  assert.equal(summary.windows.last30Days.completedEvidenceSessions, 1);
  assert.equal(summary.latestCompletedAt, new Date((now - 10 * 24 * 60 * 60) * 1000).toISOString());
  assert.equal(summary.latestCredibleIdentityAt, new Date((now - 2 * 24 * 60 * 60) * 1000).toISOString());
  assert.equal(Object.hasOwn(summary, 'customerEmail'), false);
});

test('classifyCheckoutFunnel distinguishes historical conversion from recent completion evidence', () => {
  const now = 2_000_000;
  const historical = classifyCheckoutFunnel({
    sessions: [{
      created: now - 40 * 24 * 60 * 60,
      status: 'complete',
      payment_status: 'paid',
    }],
    account: { configured: true, chargesEnabled: true },
    nowEpochSeconds: now,
  });
  assert.equal(historical.primaryDiagnosis, 'historical_checkout_conversion_no_recent_payment_evidence');
  assert.equal(historical.recent30DayCompletedEvidenceSessions, 0);
  assert.match(historical.recommendation, /converted historically/);

  const recent = classifyCheckoutFunnel({
    sessions: [{
      created: now - 60 * 60,
      status: 'complete',
      payment_status: 'paid',
    }],
    account: { configured: true, chargesEnabled: true },
    nowEpochSeconds: now,
  });
  assert.equal(recent.primaryDiagnosis, 'checkout_can_convert');
  assert.equal(recent.recent30DayCompletedEvidenceSessions, 1);
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

test('runDiagnostic recent-sessions table includes PI error codes without exposing PII or checkout URLs', async () => {
  const stripeClient = fakeStripe({
    sessions: [
      {
        id: 'cs_a', status: 'expired', payment_status: 'unpaid',
        created: 1700000000,
        customer_email: 'buyer@example.com',
        amount_total: 1900, currency: 'usd',
        payment_intent: 'pi_a',
        url: 'https://checkout.stripe.com/private-session-url',
        metadata: { source: 'reddit', planId: 'pro' },
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
  assert.equal(report.recentSessions[0].hasCustomerIdentity, true);
  assert.equal(report.recentSessions[0].identityEvidence, 'placeholder_email');
  assert.equal(report.recentSessions[0].hasPaymentIntent, true);
  assert.equal(report.recentSessions[0].attribution.source, 'reddit');
  assert.equal(Object.hasOwn(report.recentSessions[0], 'customerEmail'), false);
  assert.equal(Object.hasOwn(report.recentSessions[0], 'url'), false);
  assert.equal(Object.hasOwn(report.recentSessions[0], 'paymentIntentId'), false);
  const md = renderMarkdown(report);
  assert.doesNotMatch(md, /buyer@example\.com|private-session-url|pi_a/);
  assert.match(md, /Identity evidence/);
  assert.match(md, /reddit/);
  assert.match(md, /card_declined/);
  assert.match(md, /insufficient_funds/);
});

test('renderMarkdown emits an evidence-limited diagnosis when anonymous sessions have no payment attempts', async () => {
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
  assert.match(md, /Primary diagnosis: `unverified_session_noise_or_pre_payment_exit`/);
  assert.match(md, /raw Stripe Checkout session is not proof of a buyer/);
  assert.match(md, /Recency boundary/);
  assert.match(md, /Historical conversion proves that checkout has worked before/);
  assert.match(md, /No session produced a PaymentIntent/);
  assert.doesNotMatch(md, /Buyers are leaving|buyers are abandoning|price too high/);
  assert.match(md, /Checkout completion rate: 0\.00%/);
});

test('summarizeRecentSegments splits sessions by site, CTA and entry route without emails', () => {
  const { summarizeRecentSegments } = require('../scripts/stripe-checkout-diagnostic');
  const now = 2_000_000_000;
  const summary = summarizeRecentSegments([
    {
      created: now - 60,
      amount_total: 1900,
      currency: 'usd',
      mode: 'subscription',
      status: 'expired',
      payment_status: 'unpaid',
      success_url: 'https://thumbgate.ai/success?session_id={CHECKOUT_SESSION_ID}',
      metadata: { traceId: 'tr_1', planId: 'pro', ctaId: 'pricing_pro_buy', entryRoute: 'go:pro-direct' },
    },
    {
      created: now - 120,
      amount_total: 300000,
      currency: 'usd',
      mode: 'payment',
      status: 'open',
      payment_status: 'unpaid',
      payment_intent: 'pi_1',
      customer_email: 'buyer@example.org',
      success_url: 'https://deals.example.com/thanks',
      metadata: {},
    },
    { created: now - 40 * 24 * 60 * 60, metadata: {} },
  ], now);
  assert.equal(summary.sessions, 2);
  assert.deepEqual(summary.entryRoute[0], ['go:pro-direct', 1]);
  assert.ok(summary.successHost.some(([host]) => host === 'deals.example.com'));
  assert.equal(summary.intentSessions.length, 1);
  assert.equal(summary.intentSessions[0].successHost, 'deals.example.com');
  assert.ok(!JSON.stringify(summary).includes('buyer@example.org'));
});

test('maskEmail keeps only the first character and top-level domain', () => {
  const { maskEmail } = require('../scripts/stripe-checkout-diagnostic');
  assert.equal(maskEmail('jane.doe@gmail.com'), 'j***@g***.com');
  assert.equal(maskEmail(''), null);
  assert.equal(maskEmail('not-an-email'), null);
});

test('collectPaymentAttemptForensics reports link, product, PI error and masked buyer', async () => {
  const { collectPaymentAttemptForensics } = require('../scripts/stripe-checkout-diagnostic');
  const now = 2_000_000_000;
  const stripe = {
    checkout: { sessions: { listLineItems: async () => ({ data: [{ description: 'x', price: { id: 'price_1', product: { name: 'Deal Pack' } } }] }) } },
    paymentIntents: {
      retrieve: async () => ({
        status: 'requires_payment_method',
        payment_method_types: ['card'],
        last_payment_error: { type: 'card_error', code: 'card_declined', decline_code: 'insufficient_funds', payment_method: { type: 'card' } },
        latest_charge: { status: 'failed', outcome: { network_status: 'declined_by_network', reason: 'insufficient_funds', risk_level: 'normal' } },
      }),
    },
  };
  const rows = await collectPaymentAttemptForensics(stripe, [
    { id: 'cs_1', created: now - 60, payment_intent: 'pi_1', payment_link: 'plink_1', amount_total: 300000, currency: 'usd', customer_details: { email: 'buyer@example.org', address: { country: 'US' } }, success_url: 'https://stripe.com/x', status: 'open' },
    { id: 'cs_2', created: now - 60, payment_intent: null },
  ], now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].paymentLink, 'plink_1');
  assert.deepEqual(rows[0].products, ['Deal Pack (price_1)']);
  assert.equal(rows[0].piError, 'card_error / card_declined / insufficient_funds');
  assert.equal(rows[0].maskedEmail, 'b***@e***.org');
  assert.ok(!JSON.stringify(rows).includes('buyer@example.org'));
});

test('payment-attempt forensics survive Stripe lookup failures and render in markdown', async () => {
  const { collectPaymentAttemptForensics, renderMarkdown, maskEmail } = require('../scripts/stripe-checkout-diagnostic');
  assert.equal(maskEmail('a@localhost'), 'a***@l***');
  const now = 2_000_000_000;
  const failing = {
    checkout: { sessions: { listLineItems: async () => { throw new Error('boom'); } } },
    paymentIntents: { retrieve: async () => { throw new Error('boom'); } },
  };
  const rows = await collectPaymentAttemptForensics(failing, [
    { id: 'cs_9', created: now - 10, payment_intent: 'pi_9', payment_link: { id: 'plink_9' }, amount_total: null, success_url: 'not a url', status: 'expired' },
  ], now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].paymentLink, 'plink_9');
  assert.equal(rows[0].piStatus, null);
  assert.equal(rows[0].successHost, 'unknown');

  const okStripe = {
    checkout: { sessions: { listLineItems: async () => ({ data: [{ description: 'Pilot', price: { id: 'price_2', product: 'prod_2' } }] }) } },
    paymentIntents: { retrieve: async () => ({ status: 'requires_action', payment_method_types: ['card'], last_payment_error: null, latest_charge: null }) },
  };
  const okRows = await collectPaymentAttemptForensics(okStripe, [
    { id: 'cs_10', created: now - 10, payment_intent: 'pi_10', amount_total: 300000, currency: 'usd', status: 'open' },
  ], now);
  assert.deepEqual(okRows[0].products, ['Pilot (price_2)']);
  assert.equal(okRows[0].paymentMethodType, 'card');

  const md = renderMarkdown({
    configured: true,
    generatedAt: new Date(now * 1000).toISOString(),
    sessionsExamined: 1,
    paymentIntentsExamined: 1,
    sessionBuckets: { byStatus: { open: 1 }, byPaymentStatus: { unpaid: 1 } },
    paymentAttemptForensics: [...okRows, ...rows],
    paymentIntentErrors: { intentsTotal: 1, intentsWithError: 0, byCode: {}, byDeclineCode: {}, byType: {} },
    funnelDiagnosis: { primary: 'x', recommendation: 'y', completionRate: 0, paidRate: 0, expiredOrOpenRate: 1 },
    account: { configured: false, gap: 'n/a' },
    webhooks: { configured: false, gap: 'n/a' },
    recentSessions: [],
  });
  assert.match(md, /Payment attempts in the last 30 days/);
  assert.match(md, /plink_9/);
  assert.match(md, /requires_action/);
});
