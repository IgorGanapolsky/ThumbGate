'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  parseOwnerEmails,
  isOwnerEmail,
  classifyEmail,
  resolveStripeSecretKey,
  listAllPaged,
  monthlyRecurringCents,
  summarizeAttributedRevenueWindows,
  runAudit: runAuditWithCatalog,
  renderMarkdown,
} = require('../scripts/external-customer-audit');

const TEST_STRIPE_REVENUE_CATALOG = Object.freeze([
  Object.freeze({
    offerId: 'test_diagnostic',
    priceId: 'price_test_diagnostic',
    productId: 'prod_thumbgate',
    unitAmountCents: 49900,
    currency: 'usd',
    cadence: 'one_time',
    intervalCount: null,
    status: 'test',
    expectedPriceActive: true,
    expectedProductActive: true,
  }),
  Object.freeze({
    offerId: 'test_operations',
    priceId: 'price_test_operations',
    productId: 'prod_thumbgate_ops',
    unitAmountCents: 300000,
    currency: 'usd',
    cadence: 'one_time',
    intervalCount: null,
    status: 'test',
    expectedPriceActive: true,
    expectedProductActive: true,
  }),
  Object.freeze({
    offerId: 'test_pro_annual',
    priceId: 'price_test_pro_annual',
    productId: 'prod_thumbgate',
    unitAmountCents: 14900,
    currency: 'usd',
    cadence: 'year',
    intervalCount: 1,
    status: 'test',
    expectedPriceActive: true,
    expectedProductActive: true,
  }),
  Object.freeze({
    offerId: 'test_pro_monthly',
    priceId: 'price_test_pro_monthly',
    productId: 'prod_thumbgate',
    unitAmountCents: 1900,
    currency: 'usd',
    cadence: 'month',
    intervalCount: 1,
    status: 'test',
    expectedPriceActive: true,
    expectedProductActive: true,
  }),
]);

function runAudit(options = {}) {
  return runAuditWithCatalog({ productCatalog: TEST_STRIPE_REVENUE_CATALOG, ...options });
}

test('parseOwnerEmails defaults to the two known owner addresses', () => {
  const owners = parseOwnerEmails({});
  assert.ok(owners.includes('iganapolsky@gmail.com'));
  assert.ok(owners.includes('igor.ganapolsky@gmail.com'));
});

test('parseOwnerEmails reads THUMBGATE_OWNER_EMAILS as a comma-separated list, lowercased', () => {
  const owners = parseOwnerEmails({ THUMBGATE_OWNER_EMAILS: 'Foo@Example.com,bar@example.com ,, baz@example.com' });
  assert.deepEqual(owners, ['foo@example.com', 'bar@example.com', 'baz@example.com']);
});

test('isOwnerEmail matches case-insensitively and tolerates whitespace', () => {
  const owners = ['igor@example.com'];
  assert.equal(isOwnerEmail('Igor@Example.com', owners), true);
  assert.equal(isOwnerEmail('  igor@example.com  ', owners), true);
  assert.equal(isOwnerEmail('someone-else@example.com', owners), false);
  assert.equal(isOwnerEmail('', owners), false);
  assert.equal(isOwnerEmail(null, owners), false);
});

test('classifyEmail keeps missing identities unknown instead of treating them as external', () => {
  const owners = ['owner@example.com'];
  assert.equal(classifyEmail(null, owners), 'unknown');
  assert.equal(classifyEmail('  ', owners), 'unknown');
  assert.equal(classifyEmail('owner@example.com', owners), 'owner');
  assert.equal(classifyEmail('buyer@example.com', owners), 'external');
});

test('resolveStripeSecretKey prefers env and falls back to a managed file without exposing its path', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-stripe-audit-'));
  const secretPath = path.join(tmpDir, 'stripe.txt');
  fs.writeFileSync(secretPath, 'sk_live_managed_test_value\n', { mode: 0o600 });
  try {
    assert.deepEqual(resolveStripeSecretKey({
      env: { STRIPE_SECRET_KEY: 'sk_live_env_test_value' },
      secretPaths: [secretPath],
    }), { secretKey: 'sk_live_env_test_value', source: 'env' });
    assert.deepEqual(resolveStripeSecretKey({ env: {}, secretPaths: [secretPath] }), {
      secretKey: 'sk_live_managed_test_value',
      source: 'managed_file',
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('monthlyRecurringCents normalizes annual and multi-month prices', () => {
  assert.equal(monthlyRecurringCents({ amount: 14900, interval: 'year' }), 14900 / 12);
  assert.equal(monthlyRecurringCents({ unit_amount: 6000, recurring: { interval: 'month', interval_count: 3 } }), 2000);
});

test('listAllPaged terminates safely when Stripe reports has_more with an empty page', async () => {
  let calls = 0;
  const rows = await listAllPaged(async () => {
    calls += 1;
    return { data: [], has_more: true };
  });
  assert.deepEqual(rows, []);
  assert.equal(calls, 1);
});

test('attributed revenue windows use local calendar days and expose a complete 30-day series', () => {
  const toSeconds = (iso) => Math.floor(new Date(iso).getTime() / 1000);
  const windows = summarizeAttributedRevenueWindows([
    { id: 'today', created: toSeconds('2026-07-15T04:30:00.000Z'), amount: 49900, amount_refunded: 0 },
    { id: 'prior_local_day', created: toSeconds('2026-07-15T03:59:00.000Z'), amount: 1900, amount_refunded: 900 },
    { id: 'outside_30d', created: toSeconds('2026-06-15T12:00:00.000Z'), amount: 99900, amount_refunded: 0 },
  ], {
    now: '2026-07-15T16:00:00.000Z',
    timeZone: 'America/New_York',
  });
  assert.equal(windows.verified, true);
  assert.equal(windows.todayLocalDate, '2026-07-15');
  assert.equal(windows.trailing30DayStartLocalDate, '2026-06-16');
  assert.equal(windows.todayGrossRevenueCents, 49900);
  assert.equal(windows.todayNetRevenueCents, 49900);
  assert.equal(windows.trailing30DayGrossRevenueCents, 51800);
  assert.equal(windows.trailing30DayNetRevenueCents, 50900);
  assert.equal(Object.keys(windows.dailyGrossRevenueCents).length, 30);
  assert.equal(windows.dailyGrossRevenueCents['2026-07-14'], 1900);
  assert.equal(windows.dailyGrossRevenueCents['2026-07-15'], 49900);
});

test('missing Stripe created timestamps fail only time-window proof, not lifetime reconciliation', () => {
  const windows = summarizeAttributedRevenueWindows([
    { id: 'missing_created', amount: 49900, amount_refunded: 0 },
  ], {
    now: '2026-07-15T16:00:00.000Z',
    timeZone: 'America/New_York',
  });
  assert.equal(windows.verified, false);
  assert.equal(windows.missingCreatedAtCount, 1);
  assert.equal(windows.todayGrossRevenueCents, 0);
  assert.match(windows.gap, /created timestamp/i);
});

// runAudit with an injected fake Stripe client ----------------------------

function fakePage(rows) {
  return { data: rows, has_more: false };
}

function fakeStripe({
  charges = [],
  subscriptions = [],
  sessions = [],
  lineItemsBySession = {},
  productsById = {},
  supportsLineItems = true,
} = {}) {
  const stripe = {
    charges: { list: async () => fakePage(charges) },
    subscriptions: { list: async () => fakePage(subscriptions) },
    checkout: { sessions: { list: async () => fakePage(sessions) } },
    products: {
      retrieve: async (productId) => {
        if (!productsById[productId]) throw new Error('product not found');
        return productsById[productId];
      },
    },
  };
  if (supportsLineItems) {
    stripe.checkout.sessions.listLineItems = async (sessionId) => fakePage(lineItemsBySession[sessionId] || []);
  }
  return stripe;
}

test('runAudit returns a gap object when no Stripe credential is available', async () => {
  const report = await runAudit({ secretKey: '', ownerEmails: ['owner@x.com'] });
  assert.equal(report.configured, false);
  assert.match(report.gap, /Stripe credential/);
});

test('runAudit can initialize Stripe from a managed file without returning the secret', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-stripe-audit-run-'));
  const secretPath = path.join(tmpDir, 'stripe.txt');
  const secret = 'sk_live_managed_runtime_value';
  fs.writeFileSync(secretPath, `${secret}\n`, { mode: 0o600 });
  let receivedSecret = null;
  try {
    const report = await runAudit({
      env: {},
      secretPaths: [secretPath],
      stripeFactory: (value) => {
        receivedSecret = value;
        return fakeStripe();
      },
      ownerEmails: ['owner@x.com'],
    });
    assert.equal(receivedSecret, secret);
    assert.equal(report.configured, true);
    assert.equal(report.credentialSource, 'managed_file');
    assert.equal(JSON.stringify(report).includes(secret), false);
    assert.equal(JSON.stringify(report).includes(secretPath), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('runAudit separates owner vs external charges by email match', async () => {
  const stripeClient = fakeStripe({
    charges: [
      { id: 'ch_o1', status: 'succeeded', refunded: false, amount: 4900, amount_refunded: 0, customer: { email: 'OWNER@example.com' } },
      { id: 'ch_o2', status: 'succeeded', refunded: false, amount: 14900, amount_refunded: 0, customer: { email: 'owner@example.com' } },
      { id: 'ch_x1', status: 'succeeded', refunded: false, amount: 1900, amount_refunded: 0, customer: { email: 'real-customer@somewhere.com' } },
      { id: 'ch_x2', status: 'succeeded', refunded: false, amount: 1900, amount_refunded: 500, customer: { email: 'another@elsewhere.io' } },
    ],
    subscriptions: [],
    sessions: [],
  });
  const report = await runAudit({ stripeClient, ownerEmails: ['owner@example.com'] });
  assert.equal(report.configured, true);
  assert.equal(report.charges.all.chargeCount, 4);
  assert.equal(report.charges.owner.chargeCount, 2);
  assert.equal(report.charges.external.chargeCount, 2);
  assert.equal(report.charges.external.uniqueCustomerCount, 2);
  // External gross = 19 + 19 = 38, net = 38 - 5 = 33
  assert.equal(report.charges.external.gross, 38);
  assert.equal(report.charges.external.net, 33);
});

test('runAudit never counts missing charge identity as external proof', async () => {
  const stripeClient = fakeStripe({
    charges: [
      { id: 'ch_unknown', status: 'succeeded', refunded: false, amount: 9900, amount_refunded: 0, customer: null },
    ],
  });
  const report = await runAudit({ stripeClient, ownerEmails: ['owner@x.com'] });
  assert.equal(report.charges.external.chargeCount, 0);
  assert.equal(report.charges.unknown.chargeCount, 1);
  assert.equal(report.charges.unknown.net, 99);
});

test('runAudit excludes refunded charges from the paid-charges set', async () => {
  const stripeClient = fakeStripe({
    charges: [
      { id: 'ch_x', status: 'succeeded', refunded: true, amount: 1900, amount_refunded: 1900, customer: { email: 'r@x.com' } },
      { id: 'ch_y', status: 'failed', refunded: false, amount: 1900, amount_refunded: 0, customer: { email: 'r2@x.com' } },
      { id: 'ch_ok', status: 'succeeded', refunded: false, amount: 1900, amount_refunded: 0, customer: { email: 'r3@x.com' } },
    ],
  });
  const report = await runAudit({ stripeClient, ownerEmails: [] });
  // Successful refunded charges remain visible so net revenue is truthful,
  // while failed charges stay excluded and full refunds do not count as payers.
  assert.equal(report.charges.all.chargeCount, 2);
  assert.equal(report.charges.all.uniqueCustomerCount, 1);
  assert.equal(report.charges.all.gross, 38);
  assert.equal(report.charges.all.refundedCents, 1900);
  assert.equal(report.charges.all.net, 19);
});

test('runAudit falls back to billing_details.email when customer object has no email', async () => {
  const stripeClient = fakeStripe({
    charges: [
      { id: 'ch_b', status: 'succeeded', refunded: false, amount: 4900, amount_refunded: 0, customer: null, billing_details: { email: 'guest@example.com' } },
    ],
  });
  const report = await runAudit({ stripeClient, ownerEmails: ['owner@x.com'] });
  assert.equal(report.charges.external.chargeCount, 1);
  assert.equal(report.charges.external.uniqueCustomerCount, 1);
});

test('runAudit separates owner vs external active subscriptions and computes external MRR', async () => {
  const stripeClient = fakeStripe({
    subscriptions: [
      { id: 'sub_owner', status: 'active', plan: { amount: 14900 }, customer: { email: 'owner@x.com' } },
      { id: 'sub_real', status: 'active', plan: { amount: 1900 }, customer: { email: 'paying@somewhere.io' } },
      { id: 'sub_cancelled', status: 'canceled', plan: { amount: 4900 }, customer: { email: 'cancelled@somewhere.io' } },
    ],
  });
  const report = await runAudit({ stripeClient, ownerEmails: ['owner@x.com'] });
  assert.equal(report.subscriptions.activeOrTrialing, 2);
  assert.equal(report.subscriptions.activeOwner, 1);
  assert.equal(report.subscriptions.activeExternal, 1);
  assert.equal(report.subscriptions.mrrExternal, 19);
  assert.equal(report.subscriptions.mrrAll, 168);
});

test('runAudit normalizes annual subscription value to monthly recurring revenue', async () => {
  const stripeClient = fakeStripe({
    subscriptions: [
      { id: 'sub_annual', status: 'active', plan: { amount: 14900, interval: 'year' }, customer: { email: 'buyer@x.com' } },
    ],
  });
  const report = await runAudit({ stripeClient, ownerEmails: ['owner@x.com'] });
  assert.equal(report.subscriptions.activeExternal, 1);
  assert.equal(report.subscriptions.mrrExternalCents, 14900 / 12);
  assert.ok(Math.abs(report.subscriptions.mrrExternal - (149 / 12)) < Number.EPSILON * 10);
});

test('runAudit never counts missing subscription identity as external proof', async () => {
  const stripeClient = fakeStripe({
    subscriptions: [
      { id: 'sub_unknown', status: 'active', plan: { amount: 1900, interval: 'month' }, customer: null },
    ],
  });
  const report = await runAudit({ stripeClient, ownerEmails: ['owner@x.com'] });
  assert.equal(report.subscriptions.activeExternal, 0);
  assert.equal(report.subscriptions.activeUnknown, 1);
  assert.equal(report.subscriptions.mrrExternal, 0);
});

test('runAudit does not count a trialing subscription as active revenue or MRR', async () => {
  const stripeClient = fakeStripe({
    subscriptions: [
      { id: 'sub_trial', status: 'trialing', plan: { amount: 1900, interval: 'month' }, customer: { email: 'buyer@x.com' } },
    ],
  });
  const report = await runAudit({ stripeClient, ownerEmails: ['owner@x.com'] });
  assert.equal(report.subscriptions.activeOrTrialing, 1);
  assert.equal(report.subscriptions.activeExternal, 0);
  assert.equal(report.subscriptions.trialingExternal, 1);
  assert.equal(report.subscriptions.mrrExternal, 0);
  assert.equal(report.subscriptions.mrrAll, 0);
});

test('runAudit separates owner vs external checkout completions', async () => {
  const stripeClient = fakeStripe({
    sessions: [
      { id: 'cs_1', status: 'complete', customer_email: 'owner@x.com' },
      { id: 'cs_2', status: 'complete', customer_email: 'real@somewhere.io' },
      { id: 'cs_3', status: 'expired', customer_email: 'real2@somewhere.io' },
      { id: 'cs_4', status: 'open', customer_email: null },
    ],
  });
  const report = await runAudit({ stripeClient, ownerEmails: ['owner@x.com'] });
  assert.equal(report.checkout.totalSessions, 4);
  assert.equal(report.checkout.completedAll, 2);
  assert.equal(report.checkout.completedExternal, 1);
  assert.equal(report.checkout.unknownSessions, 1);
  assert.equal(report.checkout.paidExternal, 0);
});

test('runAudit separates status-complete checkout from provider-paid checkout', async () => {
  const stripeClient = fakeStripe({
    sessions: [
      { id: 'complete_unpaid', status: 'complete', payment_status: 'unpaid', customer_email: 'buyer@x.com' },
      { id: 'paid', status: 'complete', payment_status: 'paid', customer_email: 'buyer@x.com' },
      { id: 'owner_paid', status: 'complete', payment_status: 'paid', customer_email: 'owner@x.com' },
    ],
  });
  const report = await runAudit({ stripeClient, ownerEmails: ['owner@x.com'] });
  assert.equal(report.checkout.statusCompleteAll, 3);
  assert.equal(report.checkout.statusCompleteExternal, 2);
  assert.equal(report.checkout.paidAll, 2);
  assert.equal(report.checkout.paidExternal, 1);
  assert.equal(report.checkout.paidOwner, 1);
  assert.equal(report.checkout.monetaryPaidExternal, 0);
  assert.equal(report.checkout.zeroAmountPaidStatusAll, 2);
  assert.equal(report.checkout.paidRateExternal, 0.5);
});

test('runAudit attributes revenue only when ThumbGate product, payment intent, and external payer agree', async () => {
  const stripeClient = fakeStripe({
    charges: [
      {
        id: 'ch_thumbgate',
        status: 'succeeded',
        amount: 49900,
        amount_refunded: 0,
        payment_intent: 'pi_thumbgate',
        customer: { email: 'buyer@x.com' },
      },
    ],
    sessions: [
      {
        id: 'cs_thumbgate',
        status: 'complete',
        payment_status: 'paid',
        amount_total: 49900,
        payment_intent: 'pi_thumbgate',
        customer_email: 'buyer@x.com',
      },
    ],
    lineItemsBySession: {
      cs_thumbgate: [
        { price: { id: 'price_test_diagnostic', unit_amount: 49900, currency: 'usd', product: { id: 'prod_thumbgate', name: 'ThumbGate Workflow Diagnostic' } } },
      ],
    },
  });
  const report = await runAudit({ stripeClient, ownerEmails: ['owner@x.com'] });
  assert.equal(report.productAttribution.verified, true);
  assert.equal(report.productAttribution.thumbgate.uniquePayingCustomerCount, 1);
  assert.equal(report.productAttribution.thumbgate.netRevenueCents, 49900);
  assert.equal(report.productAttribution.identityConflictCount, 0);
  assert.equal(report.productAttribution.unmatchedExternalNetCents, 0);
});

test('runAudit deduplicates the same provider charge across duplicate checkout evidence', async () => {
  const created = Math.floor(new Date('2026-07-15T14:00:00.000Z').getTime() / 1000);
  const stripeClient = fakeStripe({
    charges: [
      {
        id: 'ch_once',
        status: 'succeeded',
        created,
        amount: 49900,
        amount_refunded: 0,
        payment_intent: 'pi_once',
        customer: { email: 'buyer@x.com' },
      },
    ],
    sessions: [
      {
        id: 'cs_duplicate_a',
        status: 'complete',
        payment_status: 'paid',
        amount_total: 49900,
        payment_intent: 'pi_once',
        customer_email: 'buyer@x.com',
      },
      {
        id: 'cs_duplicate_b',
        status: 'complete',
        payment_status: 'paid',
        amount_total: 49900,
        payment_intent: 'pi_once',
        customer_email: 'buyer@x.com',
      },
    ],
    lineItemsBySession: {
      cs_duplicate_a: [
        { price: { id: 'price_test_diagnostic', unit_amount: 49900, currency: 'usd', product: { id: 'prod_thumbgate', name: 'ThumbGate Workflow Diagnostic' } } },
      ],
      cs_duplicate_b: [
        { price: { id: 'price_test_diagnostic', unit_amount: 49900, currency: 'usd', product: { id: 'prod_thumbgate', name: 'ThumbGate Workflow Diagnostic' } } },
      ],
    },
  });
  const report = await runAudit({
    stripeClient,
    ownerEmails: ['owner@x.com'],
    now: '2026-07-15T16:00:00.000Z',
    timeZone: 'America/New_York',
  });
  assert.equal(report.productAttribution.verified, true);
  assert.equal(report.productAttribution.thumbgate.netRevenueCents, 49900);
  assert.equal(report.productAttribution.thumbgate.revenueWindows.verified, true);
  assert.equal(report.productAttribution.thumbgate.revenueWindows.todayGrossRevenueCents, 49900);
  assert.equal(report.productAttribution.thumbgate.revenueWindows.trailing30DayGrossRevenueCents, 49900);
  assert.equal(report.productAttribution.thumbgate.individualPaymentEvidenceVerified, true);
  assert.equal(report.productAttribution.thumbgate.individualPayments.length, 1);
  assert.equal(report.productAttribution.thumbgate.individualPayments[0].id, 'ch_once');
  assert.equal(report.productAttribution.thumbgate.individualPayments[0].provider, 'stripe');
  assert.equal(report.productAttribution.thumbgate.individualPayments[0].isToday, true);
  assert.equal(report.productAttribution.thumbgate.individualPayments[0].currency, 'usd');
  assert.match(report.productAttribution.thumbgate.individualPayments[0].customerId, /^sha256:[a-f0-9]{64}$/);
  assert.match(report.productAttribution.thumbgate.individualPayments[0].buyerEmailDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(report.productAttribution.thumbgate.individualPayments[0].evidenceDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(report.productAttribution.thumbgate.individualPayments).includes('buyer@x.com'), false);
});

test('Stripe individual-payment evidence preserves provider refunds and invoice IDs without payer PII', async () => {
  const created = Math.floor(new Date('2026-07-15T14:00:00.000Z').getTime() / 1000);
  const stripeClient = fakeStripe({
    charges: [{
      id: 'ch_partial',
      status: 'succeeded',
      created,
      amount: 300000,
      amount_refunded: 100000,
      currency: 'usd',
      payment_intent: 'pi_partial',
      invoice: 'in_thumbgate_2026_07',
      customer: { email: 'private-buyer@example.com' },
    }],
    sessions: [{
      id: 'cs_partial',
      status: 'complete',
      payment_status: 'paid',
      amount_total: 300000,
      payment_intent: 'pi_partial',
      customer_email: 'private-buyer@example.com',
    }],
    lineItemsBySession: {
      cs_partial: [
        { price: { id: 'price_test_operations', unit_amount: 300000, currency: 'usd', product: { id: 'prod_thumbgate_ops', name: 'ThumbGate Reliability Operations' } } },
      ],
    },
  });
  const report = await runAudit({
    stripeClient,
    ownerEmails: ['owner@x.com'],
    now: '2026-07-15T16:00:00.000Z',
    timeZone: 'America/New_York',
  });
  const payment = report.productAttribution.thumbgate.individualPaymentStates[0];

  assert.equal(payment.status, 'partially_refunded');
  assert.equal(payment.grossCents, 300000);
  assert.equal(payment.refundedCents, 100000);
  assert.equal(payment.netCents, 200000);
  assert.equal(payment.invoiceId, 'in_thumbgate_2026_07');
  assert.equal(JSON.stringify(payment).includes('private-buyer@example.com'), false);
});

test('runAudit refuses revenue attribution when session and charge identities conflict', async () => {
  const stripeClient = fakeStripe({
    charges: [
      {
        id: 'ch_owner',
        status: 'succeeded',
        amount: 49900,
        amount_refunded: 0,
        payment_intent: 'pi_conflict',
        customer: { email: 'owner@x.com' },
      },
    ],
    sessions: [
      {
        id: 'cs_conflict',
        status: 'complete',
        payment_status: 'paid',
        amount_total: 49900,
        payment_intent: 'pi_conflict',
        customer_email: 'buyer@x.com',
      },
    ],
    lineItemsBySession: {
      cs_conflict: [
        { price: { id: 'price_test_diagnostic', unit_amount: 49900, currency: 'usd', product: { id: 'prod_thumbgate', name: 'ThumbGate Workflow Diagnostic' } } },
      ],
    },
  });
  const report = await runAudit({ stripeClient, ownerEmails: ['owner@x.com'] });
  assert.equal(report.productAttribution.verified, false);
  assert.equal(report.productAttribution.identityConflictCount, 1);
  assert.equal(report.productAttribution.thumbgate.uniquePayingCustomerCount, 0);
  assert.equal(report.productAttribution.thumbgate.netRevenueCents, 0);
});

test('runAudit refuses to merge two different external payer identities', async () => {
  const stripeClient = fakeStripe({
    charges: [{
      id: 'ch_other_external',
      status: 'succeeded',
      amount: 49900,
      amount_refunded: 0,
      payment_intent: 'pi_external_conflict',
      customer: { email: 'other-buyer@x.com' },
    }],
    sessions: [{
      id: 'cs_external_conflict',
      status: 'complete',
      payment_status: 'paid',
      amount_total: 49900,
      payment_intent: 'pi_external_conflict',
      customer_email: 'buyer@x.com',
    }],
    lineItemsBySession: {
      cs_external_conflict: [
        { price: { id: 'price_test_diagnostic', unit_amount: 49900, currency: 'usd', product: { id: 'prod_thumbgate', name: 'ThumbGate Workflow Diagnostic' } } },
      ],
    },
  });
  const report = await runAudit({ stripeClient, ownerEmails: ['owner@x.com'] });

  assert.equal(report.productAttribution.verified, false);
  assert.equal(report.productAttribution.identityConflictCount, 1);
  assert.equal(report.productAttribution.thumbgate.individualPaymentStates.length, 0);
});

test('runAudit can verify a non-ThumbGate payment without counting it as ThumbGate revenue', async () => {
  const stripeClient = fakeStripe({
    charges: [
      {
        id: 'ch_other',
        status: 'succeeded',
        amount: 99900,
        amount_refunded: 0,
        payment_intent: 'pi_other',
        customer: { email: 'buyer@x.com' },
      },
    ],
    sessions: [
      {
        id: 'cs_other',
        status: 'complete',
        payment_status: 'paid',
        amount_total: 99900,
        payment_intent: 'pi_other',
        customer_email: 'buyer@x.com',
      },
    ],
    lineItemsBySession: {
      cs_other: [
        { price: { id: 'price_other', unit_amount: 99900, currency: 'usd', product: { id: 'prod_other', name: 'Resume AI Assessment' } } },
      ],
    },
  });
  const report = await runAudit({ stripeClient, ownerEmails: ['owner@x.com'] });
  assert.equal(report.productAttribution.verified, true);
  assert.equal(report.productAttribution.thumbgate.uniquePayingCustomerCount, 0);
  assert.equal(report.productAttribution.thumbgate.netRevenueCents, 0);
  assert.equal(report.charges.external.netCents, 99900);
});

test('runAudit leaves mixed ThumbGate and non-ThumbGate checkout revenue unresolved', async () => {
  const stripeClient = fakeStripe({
    charges: [
      {
        id: 'ch_mixed',
        status: 'succeeded',
        amount: 59900,
        amount_refunded: 0,
        payment_intent: 'pi_mixed',
        customer: { email: 'buyer@x.com' },
      },
    ],
    sessions: [
      {
        id: 'cs_mixed',
        status: 'complete',
        payment_status: 'paid',
        amount_total: 59900,
        payment_intent: 'pi_mixed',
        customer_email: 'buyer@x.com',
      },
    ],
    lineItemsBySession: {
      cs_mixed: [
        { price: { id: 'price_test_diagnostic', unit_amount: 49900, currency: 'usd', product: { id: 'prod_thumbgate', name: 'ThumbGate Diagnostic' } } },
        { price: { id: 'price_other', unit_amount: 10000, currency: 'usd', product: { id: 'prod_other', name: 'Resume Assessment' } } },
      ],
    },
  });
  const report = await runAudit({ stripeClient, ownerEmails: ['owner@x.com'] });
  assert.equal(report.productAttribution.verified, false);
  assert.equal(report.productAttribution.unresolvedReasons.mixedProductSession, 1);
  assert.equal(report.productAttribution.thumbgate.netRevenueCents, 0);
});

test('runAudit attributes active MRR only when the expanded subscription product is ThumbGate', async () => {
  const stripeClient = fakeStripe({
    subscriptions: [
      {
        id: 'sub_thumbgate',
        status: 'active',
        customer: { email: 'buyer@x.com' },
        items: {
          data: [
            {
              quantity: 1,
              price: {
                id: 'price_test_pro_annual',
                unit_amount: 14900,
                currency: 'usd',
                recurring: { interval: 'year' },
                product: { id: 'prod_thumbgate', name: 'ThumbGate Pro' },
              },
            },
          ],
        },
      },
    ],
  });
  const report = await runAudit({ stripeClient, ownerEmails: ['owner@x.com'] });
  assert.equal(report.productAttribution.verified, true);
  assert.equal(report.productAttribution.thumbgate.uniquePayingCustomerCount, 1);
  assert.equal(report.productAttribution.thumbgate.activeSubscriptionCount, 1);
  assert.equal(report.productAttribution.thumbgate.mrrCents, 14900 / 12);
});

test('runAudit retrieves a string subscription product reference before attributing ThumbGate MRR', async () => {
  const stripeClient = fakeStripe({
    subscriptions: [
      {
        id: 'sub_thumbgate_string_product',
        status: 'active',
        customer: { email: 'buyer@x.com' },
        items: {
          data: [
            {
              quantity: 1,
              price: {
                id: 'price_test_pro_monthly',
                unit_amount: 1900,
                currency: 'usd',
                recurring: { interval: 'month' },
                product: 'prod_thumbgate',
              },
            },
          ],
        },
      },
    ],
    productsById: {
      prod_thumbgate: { id: 'prod_thumbgate', name: 'ThumbGate Pro' },
    },
  });
  const report = await runAudit({ stripeClient, ownerEmails: ['owner@x.com'] });
  assert.equal(report.productAttribution.verified, true);
  assert.equal(report.productAttribution.thumbgate.activeSubscriptionCount, 1);
  assert.equal(report.productAttribution.thumbgate.mrrCents, 1900);
});

test('runAudit stays unverified when positive external checkout lacks line-item access', async () => {
  const stripeClient = fakeStripe({
    charges: [
      {
        id: 'ch_uninspectable',
        status: 'succeeded',
        amount: 49900,
        amount_refunded: 0,
        payment_intent: 'pi_uninspectable',
        customer: { email: 'buyer@x.com' },
      },
    ],
    sessions: [
      {
        id: 'cs_uninspectable',
        status: 'complete',
        payment_status: 'paid',
        amount_total: 49900,
        payment_intent: 'pi_uninspectable',
        customer_email: 'buyer@x.com',
      },
    ],
    supportsLineItems: false,
  });
  const report = await runAudit({ stripeClient, ownerEmails: ['owner@x.com'] });
  assert.equal(report.productAttribution.verified, false);
  assert.equal(report.productAttribution.unresolvedSessionCount, 1);
  assert.equal(report.productAttribution.thumbgate.netRevenueCents, 0);
});

test('runAudit rejects an invalid revenue catalog even when Stripe has no external activity', async () => {
  const report = await runAuditWithCatalog({
    stripeClient: fakeStripe(),
    ownerEmails: ['owner@x.com'],
    productCatalog: [],
  });

  assert.equal(report.productAttribution.verified, false);
  assert.equal(report.productAttribution.scope, 'stripe_revenue_catalog_invalid');
  assert.match(report.productAttribution.gap, /catalog must contain/i);
  assert.equal(report.productAttribution.thumbgate.individualPaymentEvidenceVerified, false);
});

test('runAudit fails closed when a known checkout price has drifted commercial terms', async () => {
  const stripeClient = fakeStripe({
    charges: [{
      id: 'ch_catalog_drift',
      status: 'succeeded',
      amount: 99900,
      amount_refunded: 0,
      payment_intent: 'pi_catalog_drift',
      customer: { email: 'buyer@x.com' },
    }],
    sessions: [{
      id: 'cs_catalog_drift',
      status: 'complete',
      payment_status: 'paid',
      amount_total: 99900,
      payment_intent: 'pi_catalog_drift',
      customer_email: 'buyer@x.com',
    }],
    lineItemsBySession: {
      cs_catalog_drift: [{
        price: {
          id: 'price_test_diagnostic',
          unit_amount: 99900,
          currency: 'usd',
          product: { id: 'prod_thumbgate', name: 'ThumbGate Workflow Diagnostic' },
        },
      }],
    },
  });

  const report = await runAudit({ stripeClient, ownerEmails: ['owner@x.com'] });

  assert.equal(report.productAttribution.verified, false);
  assert.equal(report.productAttribution.unresolvedReasons.catalogTermsMismatch, 1);
  assert.equal(report.productAttribution.catalogTermsMismatchCount, 1);
  assert.equal(report.productAttribution.thumbgate.netRevenueCents, 0);
});

test('runAudit fails closed when a known subscription price has drifted cadence', async () => {
  const stripeClient = fakeStripe({
    subscriptions: [{
      id: 'sub_catalog_drift',
      status: 'active',
      customer: { email: 'buyer@x.com' },
      items: {
        data: [{
          quantity: 1,
          price: {
            id: 'price_test_pro_monthly',
            unit_amount: 1900,
            currency: 'usd',
            recurring: { interval: 'year', interval_count: 1 },
            product: 'prod_thumbgate',
          },
        }],
      },
    }],
  });

  const report = await runAudit({ stripeClient, ownerEmails: ['owner@x.com'] });

  assert.equal(report.productAttribution.verified, false);
  assert.equal(report.productAttribution.unresolvedSubscriptionCount, 1);
  assert.equal(report.productAttribution.catalogTermsMismatchCount, 1);
  assert.equal(report.productAttribution.thumbgate.activeSubscriptionCount, 0);
});

test('runAudit classifies a zero-amount paid-status session as verified non-revenue', async () => {
  const stripeClient = fakeStripe({
    sessions: [
      {
        id: 'cs_zero',
        status: 'complete',
        payment_status: 'paid',
        amount_total: 0,
        customer_email: 'buyer@x.com',
      },
    ],
    lineItemsBySession: {
      cs_zero: [
        { price: { product: { id: 'prod_thumbgate', name: 'ThumbGate Trial' } } },
      ],
    },
  });
  const report = await runAudit({ stripeClient, ownerEmails: ['owner@x.com'] });
  assert.equal(report.productAttribution.verified, true);
  assert.equal(report.productAttribution.paidExternalSessionCount, 0);
  assert.equal(report.productAttribution.zeroAmountPaidStatusSessionCount, 1);
  assert.equal(report.productAttribution.unresolvedSessionCount, 0);
  assert.equal(report.productAttribution.thumbgate.netRevenueCents, 0);
});

test('runAudit completionRateExternal uses external sessions as denominator', async () => {
  // Codex P2 finding: dividing external completions by total sessions
  // (which includes owner sessions) systematically undercounts the real
  // customer conversion rate. Denominator must be external sessions only.
  const stripeClient = fakeStripe({
    sessions: [
      // 8 owner sessions, 1 completed → owner rate = 12.5%
      { id: 'o1', status: 'complete', customer_email: 'owner@x.com' },
      { id: 'o2', status: 'expired', customer_email: 'owner@x.com' },
      { id: 'o3', status: 'open', customer_email: 'owner@x.com' },
      { id: 'o4', status: 'expired', customer_email: 'owner@x.com' },
      { id: 'o5', status: 'expired', customer_email: 'owner@x.com' },
      { id: 'o6', status: 'expired', customer_email: 'owner@x.com' },
      { id: 'o7', status: 'expired', customer_email: 'owner@x.com' },
      { id: 'o8', status: 'expired', customer_email: 'owner@x.com' },
      // 2 external sessions, 1 completed → external rate = 50.0%
      { id: 'e1', status: 'complete', customer_email: 'real@somewhere.io' },
      { id: 'e2', status: 'expired', customer_email: 'real2@somewhere.io' },
    ],
  });
  const report = await runAudit({ stripeClient, ownerEmails: ['owner@x.com'] });
  assert.equal(report.checkout.totalSessions, 10);
  assert.equal(report.checkout.externalSessions, 2);
  assert.equal(report.checkout.completedAll, 2);
  assert.equal(report.checkout.completedExternal, 1);
  // Old (buggy) calc would give 1/10 = 10%. Correct gives 1/2 = 50%.
  assert.equal(report.checkout.completionRateExternal, 0.5);
  assert.equal(report.checkout.completionRateAll, 0.2);
});

test('runAudit completionRateExternal returns 0 when no external sessions exist (no divide-by-zero)', async () => {
  const stripeClient = fakeStripe({
    sessions: [
      { id: 'o1', status: 'complete', customer_email: 'owner@x.com' },
    ],
  });
  const report = await runAudit({ stripeClient, ownerEmails: ['owner@x.com'] });
  assert.equal(report.checkout.externalSessions, 0);
  assert.equal(report.checkout.completionRateExternal, 0);
});

test('renderMarkdown highlights known non-owner evidence and its identity caveat', async () => {
  const stripeClient = fakeStripe({
    charges: [
      { id: 'ch_o', status: 'succeeded', refunded: false, amount: 14900, amount_refunded: 0, customer: { email: 'owner@x.com' } },
    ],
    subscriptions: [
      { id: 'sub_o', status: 'active', plan: { amount: 14900 }, customer: { email: 'owner@x.com' } },
    ],
    sessions: [
      { id: 'cs_o', status: 'complete', customer_email: 'owner@x.com' },
    ],
  });
  const report = await runAudit({ stripeClient, ownerEmails: ['owner@x.com'] });
  const md = renderMarkdown(report);
  assert.match(md, /Known non-owner paying identities lifetime: 0/);
  assert.match(md, /Known non-owner net revenue lifetime: \$0\.00/);
  assert.match(md, /Known non-owner active subscriptions: 0/);
  assert.match(md, /Missing email stays unknown/);
  assert.match(md, /Positive-amount paid-status sessions \(known non-owner\)/);
  assert.match(md, /Product attribution verified: true/);
});

test('renderMarkdown describes the unconfigured Stripe path without crashing', () => {
  const md = renderMarkdown({ configured: false, gap: 'No Stripe credential found', ownerEmails: [] });
  assert.match(md, /NOT CONFIGURED.*Stripe credential/);
});
