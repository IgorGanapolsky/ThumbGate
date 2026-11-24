'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-funnel-bot-filter-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmp;
process.env._TEST_API_KEYS_PATH = path.join(tmp, 'api-keys.json');
process.env._TEST_FUNNEL_LEDGER_PATH = path.join(tmp, 'funnel-ledger.jsonl');
process.env._TEST_REVENUE_LEDGER_PATH = path.join(tmp, 'revenue-ledger.jsonl');

const {
  classifyCheckoutSessionDepth,
  summarizeCheckoutSessionDepth,
  listStripeCheckoutSessionDepth,
  verifyPaidCheckoutSession,
  getBillingSummariesLive,
} = require('../scripts/billing');

const stripeWith = (session, error) => ({
  checkout: {
    sessions: {
      retrieve: async () => {
        if (error) throw error;
        return session;
      },
    },
  },
});

test('success visit counts only when Stripe reports the session_id paid', async () => {
  const ok = await verifyPaidCheckoutSession('cs_live_abcdefgh12345678', {
    stripeClient: stripeWith({ payment_status: 'paid', mode: 'payment' }),
  });
  assert.deepEqual(ok, { verified: true, reason: 'paid' });

  const unpaid = await verifyPaidCheckoutSession('cs_live_abcdefgh12345678', {
    stripeClient: stripeWith({ payment_status: 'unpaid', mode: 'subscription' }),
  });
  assert.deepEqual(unpaid, { verified: false, reason: 'not_paid' });

  assert.deepEqual(await verifyPaidCheckoutSession('', { stripeClient: stripeWith({}) }), { verified: false, reason: 'missing_session_id' });
  assert.deepEqual(await verifyPaidCheckoutSession('anything', { stripeClient: stripeWith({}) }), { verified: false, reason: 'malformed_session_id' });
  assert.deepEqual(
    await verifyPaidCheckoutSession('cs_live_abcdefgh12345678', { stripeClient: stripeWith(null, new Error('No such checkout.session')) }),
    { verified: false, reason: 'unknown_session' },
  );
  assert.deepEqual(
    await verifyPaidCheckoutSession('cs_live_abcdefgh12345678', { stripeClient: stripeWith(null, new Error('socket hang up')) }),
    { verified: false, reason: 'lookup_failed' },
  );
});

test('checkout depth: raw sessions are not qualified, email or payment attempt is', () => {
  assert.equal(classifyCheckoutSessionDepth({ status: 'expired', payment_status: 'unpaid' }), 'raw');
  assert.equal(classifyCheckoutSessionDepth({ status: 'open', customer_details: { email: 'real.buyer@acme-widgets.dev' } }), 'identified');
  assert.equal(classifyCheckoutSessionDepth({ status: 'expired', customer_details: { email: 'probe@example.com' } }), 'raw');
  assert.equal(classifyCheckoutSessionDepth({ status: 'expired', payment_intent: 'pi_123' }), 'payment_attempt');
  assert.equal(classifyCheckoutSessionDepth({ status: 'complete', payment_status: 'paid' }), 'paid');

  const rows = [
    { event: 'checkout_session_created', evidence: 'cs_a' },
    { event: 'checkout_session_created', evidence: 'cs_b' },
    { event: 'checkout_session_created', evidence: 'cs_c' },
    { event: 'checkout_session_created', evidence: 'cs_d' },
    { event: 'something_else', evidence: 'cs_z' },
  ];
  const summary = summarizeCheckoutSessionDepth(rows, {
    status: 'ok',
    byId: { cs_a: 'raw', cs_b: 'identified', cs_c: 'payment_attempt', cs_d: 'raw' },
  });
  assert.equal(summary.basis, 'stripe_session_lookup');
  assert.equal(summary.sessionsCreated, 4);
  assert.equal(summary.raw, 2);
  assert.equal(summary.qualifiedCheckoutStarts, 2);

  const partial = summarizeCheckoutSessionDepth(rows, { status: 'partial', byId: { cs_a: 'raw' } });
  assert.equal(partial.basis, 'telemetry_heuristic');
  assert.equal(partial.unresolved, 3);
  assert.equal(summarizeCheckoutSessionDepth(rows, null).lookupStatus, 'not_requested');
});

test('listStripeCheckoutSessionDepth pages through sessions and classifies each', async () => {
  const pages = [
    { has_more: true, data: [{ id: 'cs_1', status: 'expired' }, { id: 'cs_2', status: 'expired', payment_intent: 'pi_1' }] },
    { has_more: false, data: [{ id: 'cs_3', status: 'complete', payment_status: 'paid' }] },
  ];
  const seen = [];
  const stripeClient = {
    checkout: { sessions: { list: async (params) => { seen.push(params); return pages[seen.length - 1]; } } },
  };
  const out = await listStripeCheckoutSessionDepth({ stripeClient, deadline: Date.now() + 5000 });
  assert.equal(out.status, 'ok');
  assert.equal(out.complete, true);
  assert.deepEqual(out.byId, { cs_1: 'raw', cs_2: 'payment_attempt', cs_3: 'paid' });
  assert.equal(seen[1].starting_after, 'cs_2');
});

test('billing summary counts a checkout start only after the session got past raw', async () => {
  const day = new Date().toISOString().slice(0, 10);
  const rows = ['cs_live_rawone', 'cs_live_rawtwo', 'cs_live_withemail'].map((id, i) => ({
    timestamp: `${day}T0${i + 1}:00:00.000Z`,
    stage: 'acquisition',
    event: 'checkout_session_created',
    evidence: id,
    visitorId: `visitor_${i}`,
    metadata: { visitorId: `visitor_${i}`, planId: 'pro' },
  }));
  fs.writeFileSync(process.env._TEST_FUNNEL_LEDGER_PATH, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);

  const summaries = await getBillingSummariesLive({ summary: {} }, {
    listStripeReconciledRevenueEventsFn: async () => Object.defineProperty([], 'reconciliation', { value: { status: 'ok', complete: true } }),
    listStripeCheckoutSessionDepthFn: async () => ({
      status: 'ok',
      complete: true,
      byId: { cs_live_rawone: 'raw', cs_live_rawtwo: 'raw', cs_live_withemail: 'identified' },
    }),
  });
  const { summary } = summaries;
  assert.equal(summary.checkoutSessionDepth.sessionsCreated, 3);
  assert.equal(summary.checkoutSessionDepth.raw, 2);
  assert.equal(summary.trafficMetrics.checkoutStarts, 1);
  assert.equal(summary.trafficMetrics.checkoutStartsBasis, 'stripe_session_lookup');

  const unreachable = await getBillingSummariesLive({ summary: {} }, {
    listStripeReconciledRevenueEventsFn: async () => Object.defineProperty([], 'reconciliation', { value: { status: 'ok', complete: true } }),
    listStripeCheckoutSessionDepthFn: async () => { throw new Error('stripe down'); },
  });
  assert.equal(unreachable.summary.trafficMetrics.checkoutStartsBasis, 'telemetry_heuristic');
});
