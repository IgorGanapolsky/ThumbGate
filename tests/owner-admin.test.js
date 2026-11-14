'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-owner-admin-'));
process.env.THUMBGATE_FEEDBACK_DIR = root;
process.env._TEST_API_KEYS_PATH = path.join(root, 'api-keys.json');
process.env._TEST_FUNNEL_LEDGER_PATH = path.join(root, 'funnel-events.jsonl');
process.env._TEST_REVENUE_LEDGER_PATH = path.join(root, 'revenue-events.jsonl');
process.env.THUMBGATE_API_KEY = 'synthetic-admin-credential';
process.env.THUMBGATE_OPERATOR_KEY = 'synthetic-operator-credential';
process.env.THUMBGATE_OWNER_EMAILS = 'owner@example.invalid';
process.env.STRIPE_SECRET_KEY = '';
process.env.STRIPE_PRICE_ID = '';
process.env.THUMBGATE_BILLING_SUMMARY_SOURCE = 'local';
for (const key of ['THUMBGATE_PROJECT_DIR', 'CLAUDE_PROJECT_DIR', 'INIT_CWD', 'RESEND_API_KEY', 'THUMBGATE_RESEND_API_KEY']) delete process.env[key];
const billing = require('../scripts/billing');
test.after(() => { fs.rmSync(root, { recursive: true, force: true }); });

test('classification and shared external totals exclude historical internal/test/unknown, deduplicate and separate currencies', () => {
  const paid = (orderId, fields) => ({ status: 'paid', orderId, amountKnown: true, amountCents: 123, currency: 'usd', ...fields });
  const report = billing.summarizeExternalRevenue([
    paid('owner', { customerEmail: 'owner@example.invalid' }),
    paid('test', { customerEmail: 'buyer@example.invalid', livemode: false }),
    paid('probe', { customerEmail: 'buyer@example.invalid', metadata: { probe: true } }),
    paid('unknown', {}),
    paid('charge', { customerEmail: 'buyer@example.invalid', metadata: { paymentIntentId: 'pi_shared' } }),
    paid('checkout', { provider: 'stripe', customerEmail: 'buyer@example.invalid', metadata: { paymentIntentId: 'pi_shared' } }),
    paid('eur', { customerEmail: 'buyer@example.invalid', currency: 'eur', amountCents: 456 }),
  ]);
  assert.deepEqual(report.bookedRevenueByCurrency, { USD: 123, EUR: 456 });
  assert.deepEqual(report.excluded, { internal: 1, test: 2, unknown: 1 });
  assert.equal(report.duplicates, 1);
  assert.equal(report.paidOrders, 2);
});

test('shared batch distinguishes successful empty, unconfigured, rejection, timeout and incomplete source', async () => {
  for (const status of ['ok', 'unconfigured', 'partial']) {
    const result = await billing.getBillingSummariesLive({ month: { window: '30d' } }, { listStripeReconciledRevenueEventsFn: async () => Object.assign([], { reconciliation: { status, complete: status === 'ok' } }) });
    assert.equal(result.month.reconciliation.status, status);
    assert.ok(result.month.revenue.external);
  }
  const rejected = await billing.getBillingSummariesLive({ month: { window: '30d' } }, { listStripeReconciledRevenueEventsFn: async () => { throw new Error('private'); } });
  assert.equal(rejected.month.reconciliation.status, 'unavailable');
  let futureCalls = 0;
  const timeout = await billing.getBillingSummariesLive({ month: { window: '30d', stripeReconciliationTimeoutMs: 5 } }, { listStripeReconciledRevenueEventsFn: async ({ signal }) => { await new Promise((r) => setTimeout(r, 30)); if (!signal.aborted) futureCalls++; return []; } });
  assert.equal(timeout.month.reconciliation.status, 'timeout');
  await new Promise((r) => setTimeout(r, 40)); assert.equal(futureCalls, 0);
});

function paymentFixture(orderId, fields = {}) {
  return { timestamp: new Date().toISOString(), provider: 'stripe', status: 'paid', orderId,
    customerEmail: 'buyer@example.invalid', customerId: 'cus_groupfixture', amountKnown: true,
    amountCents: 10000, currency: 'USD', ...fields };
}

for (const classification of ['internal', 'test']) {
  for (const restrictedFirst of [false, true]) {
    test(`payment alias groups exclude ${classification} evidence in ${restrictedFirst ? 'restricted' : 'buyer'}-first order`, () => {
      const buyer = paymentFixture('cs_groupfixture', { metadata: { paymentIntentId: 'pi_groupfixture' } });
      const restricted = paymentFixture('ch_groupfixture', {
        ...(classification === 'internal' ? { customerEmail: 'owner@example.invalid' } : { livemode: false }),
        metadata: { paymentIntentId: 'pi_groupfixture' },
      });
      const entries = restrictedFirst ? [restricted, buyer] : [buyer, restricted];
      for (const report of [billing.summarizeExternalRevenue(entries),
        billing.getBillingSummary({ window: 'lifetime', extraRevenueEvents: entries }).revenue.external]) {
        assert.deepEqual(report.bookedRevenueByCurrency, {});
        assert.equal(report.paidOrders, 0);
        assert.equal(report.excluded[classification], 1);
      }
    });
  }
}

test('payment alias groups connect bridge records transitively with internal then test precedence', () => {
  const entries = [paymentFixture('cs_bridge', { metadata: { paymentIntentId: 'pi_bridge' } }),
    paymentFixture('ch_bridge', { customerEmail: 'owner@example.invalid' }),
    paymentFixture('cs_link', { livemode: false, metadata: { paymentIntentId: 'pi_bridge', chargeId: 'ch_bridge' } })];
  for (const order of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
    const report = billing.summarizeExternalRevenue(order.map((i) => entries[i]));
    assert.deepEqual(report.bookedRevenueByCurrency, {});
    assert.deepEqual(report.excluded, { internal: 1, test: 0, unknown: 0 });
    assert.equal(report.duplicates, 2);
  }
});

test('payment alias groups count an external payment once and preserve authoritative partial and full refunds in either order', () => {
  for (const refund of [2500, 10000]) {
    const buyer = paymentFixture('cs_refundgroup', { metadata: { paymentIntentId: 'pi_refundgroup' } });
    const charge = paymentFixture('ch_refundgroup', { amountRefundedCents: refund,
      metadata: { paymentIntentId: 'pi_refundgroup', stripeReconciled: true } });
    for (const entries of [[buyer, charge], [charge, buyer]]) {
      const report = billing.summarizeExternalRevenue(entries);
      assert.equal(report.duplicates, 1);
      assert.deepEqual(report.bookedRevenueByCurrency, refund === 10000 ? {} : { USD: 10000 - refund });
      assert.equal(report.paidOrders, refund === 10000 ? 0 : 1);
      assert.deepEqual(report.refundedByCurrency, { USD: refund });
    }
  }
});

test('payment alias groups preserve evidence discarded by duplicate extras, reconciliation and paid funnel loading', () => {
  const revenuePath = billing.CONFIG.REVENUE_LEDGER_PATH;
  const funnelPath = billing.CONFIG.FUNNEL_LEDGER_PATH;
  const saved = [revenuePath, funnelPath].map((file) => fs.existsSync(file) ? fs.readFileSync(file) : null);
  const buyer = paymentFixture('cs_persisted', { metadata: { paymentIntentId: 'pi_persisted' } });
  try {
    fs.writeFileSync(revenuePath, JSON.stringify(buyer) + '\n');
    fs.writeFileSync(funnelPath, '');
    for (const evidence of [{ customerEmail: 'owner@example.invalid' }, { livemode: false }]) {
      const restricted = paymentFixture('cs_persisted', evidence);
      const report = billing.getBillingSummary({ window: 'lifetime', extraRevenueEvents: [restricted] });
      assert.deepEqual(report.revenue.external.bookedRevenueByCurrency, {});
      assert.equal(report.revenue.external.paidOrders, 0);
      // The existing broad ledger view still retains its single booked payment.
      assert.equal(report.revenue.paidOrders, 1);
    }
    // Reconciliation changes the visible order ID; its original checkout alias must survive.
    const reconciled = paymentFixture('ch_persisted', { metadata: { paymentIntentId: 'pi_persisted', stripeReconciled: true } });
    const owner = paymentFixture('cs_persisted', { customerEmail: 'owner@example.invalid' });
    assert.equal(billing.getBillingSummary({ window: 'lifetime', extraRevenueEvents: [reconciled, owner] }).revenue.external.paidOrders, 0);
    fs.writeFileSync(funnelPath, JSON.stringify({ timestamp: buyer.timestamp, stage: 'paid', event: 'checkout_completed',
      metadata: { provider: 'stripe', customerId: buyer.customerId, sessionId: buyer.orderId, email: 'owner@example.invalid' } }) + '\n');
    assert.equal(billing.getBillingSummary({ window: 'lifetime' }).revenue.external.paidOrders, 0);
  } finally {
    [revenuePath, funnelPath].forEach((file, i) => saved[i] === null ? fs.rmSync(file, { force: true }) : fs.writeFileSync(file, saved[i]));
  }
});

test('reconciliation overlays authoritative partial and full refunds on existing ledger identity', () => {
  for (const refunded of [25, 100]) {
    const ledger = { orderId: 'ch_refundfixture', status: 'paid', amountCents: 100, amountKnown: true, currency: 'USD', customerEmail: 'buyer@example.invalid' };
    const live = billing._buildStripeReconciledRevenueEvent({ id: 'ch_refundfixture', amount: 100, amount_refunded: refunded, refunded: refunded === 100, customer: { id: 'cus_fixture', email: 'buyer@example.invalid' }, currency: 'usd', livemode: true, created: 100 });
    const merged = billing._mergeRevenueEvents([ledger], [live]);
    assert.equal(merged.length, 1);
    const external = billing.summarizeExternalRevenue(merged);
    assert.equal(external.bookedRevenueByCurrency.USD, refunded === 100 ? undefined : 75);
    assert.equal(external.refundedByCurrency.USD, refunded);
  }
});

test('live reconciliation retains fully refunded charges and reports capped provider lists', async () => {
  const stripePath = require.resolve('stripe');
  const original = require.cache[stripePath];
  const saved = { secret: billing.CONFIG.STRIPE_SECRET_KEY, price: billing.CONFIG.STRIPE_PRICE_ID, product: billing.CONFIG.STRIPE_PRODUCT_ID };
  const price = { id: 'price_refundfixture', product: 'prod_refundfixture', unit_amount: 100, recurring: { interval: 'month' } };
  const calls = [];
  const client = {
    prices: { retrieve: async () => price, list: async () => ({ data: [price], has_more: true }) },
    charges: { list: async (params, options) => { calls.push(options); return { data: [{ id: 'ch_fullfixture', invoice: 'in_fixture', customer: { id: 'cus_fixture', email: 'member@example.invalid' }, amount: 100, amount_refunded: 100, refunded: true, paid: true, status: 'succeeded', livemode: true, created: 100, currency: 'usd' }], has_more: false }; } },
    invoices: { retrieve: async () => ({ lines: { data: [{ price }], has_more: false } }) },
  };
  require.cache[stripePath] = { id: stripePath, filename: stripePath, loaded: true, exports: function StripeFixture() { return client; } };
  billing.CONFIG.STRIPE_SECRET_KEY = 'synthetic-stripe-fixture';
  billing.CONFIG.STRIPE_PRICE_ID = price.id;
  billing.CONFIG.STRIPE_PRODUCT_ID = price.product;
  try {
    const rows = await billing.listStripeReconciledRevenueEvents();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].amountRefundedCents, 100);
    assert.equal(rows.reconciliation.status, 'partial');
    assert.equal(rows.reconciliation.complete, false);
    assert.equal(calls[0].maxNetworkRetries, 0);
  } finally {
    if (original) require.cache[stripePath] = original; else delete require.cache[stripePath];
    billing.CONFIG.STRIPE_SECRET_KEY = saved.secret; billing.CONFIG.STRIPE_PRICE_ID = saved.price; billing.CONFIG.STRIPE_PRODUCT_ID = saved.product;
  }
});


test('conflicting receipt identity cannot mask internal expanded customer or nested refund evidence', () => {
  const charge = { id: 'ch_conflict', created: 1, amount: 100, currency: 'usd', livemode: true,
    receipt_email: 'buyer@example.invalid', billing_details: { email: 'other@example.invalid' },
    customer: { id: 'cus_internal', email: 'owner@example.invalid' } };
  assert.equal(billing.classifyRevenueRecord(charge), 'internal');
  assert.equal(billing.classifyRevenueRecord({ receipt_email: 'buyer@example.invalid', charge }), 'internal');
  const reconciled = billing._buildStripeReconciledRevenueEvent(charge);
  assert.equal(billing.classifyRevenueRecord(reconciled), 'internal');
  assert.equal(reconciled.identityEmails.length, 3);
  const flagged = billing._buildStripeReconciledRevenueEvent({ ...charge, customer: { metadata: { internal: true } } });
  assert.equal(billing.classifyRevenueRecord(flagged), 'internal');
});

test('reconciled missing identity preserves ledger identity and never promotes conflicting internal evidence', () => {
  const ledger = { orderId: 'ch_missingidentity', status: 'paid', amountKnown: true, amountCents: 100, currency: 'USD', customerEmail: 'buyer@example.invalid' };
  const live = billing._buildStripeReconciledRevenueEvent({ id: ledger.orderId, created: 1, amount: 100, amount_refunded: 20, currency: 'usd', livemode: true });
  const merged = billing._mergeRevenueEvents([ledger], [live]);
  assert.equal(billing.summarizeExternalRevenue(merged).paidOrders, 1);
  assert.equal(merged[0].customerEmail, ledger.customerEmail);
  const internal = { ...ledger, customerEmail: 'owner@example.invalid' };
  const externalLive = { ...live, customerEmail: 'buyer@example.invalid' };
  assert.equal(billing.classifyRevenueRecord(billing._mergeRevenueEvents([internal], [externalLive])[0]), 'internal');
});

test('refunds reduce every summary path: full refund adds nothing, partial books net, owner/test refunds stay excluded', () => {
  const revenuePath = billing.CONFIG.REVENUE_LEDGER_PATH;
  const funnelPath = billing.CONFIG.FUNNEL_LEDGER_PATH;
  const saved = [revenuePath, funnelPath].map((file) => fs.existsSync(file) ? fs.readFileSync(file) : null);
  const charge = (id, fields) => paymentFixture(id, { metadata: { stripeReconciled: true, paymentIntentId: `pi_${id}` }, ...fields });
  try {
    fs.writeFileSync(revenuePath, '');
    fs.writeFileSync(funnelPath, '');
    const summary = (events) => billing.getBillingSummary({ window: 'lifetime', extraRevenueEvents: events }).revenue;
    const full = summary([charge('ch_full', { amountRefundedCents: 10000 })]);
    assert.equal(full.paidOrders, 0);
    assert.deepEqual(full.bookedRevenueByCurrency, {});
    assert.equal(full.external.paidOrders, 0);
    assert.deepEqual(full.external.bookedRevenueByCurrency, {});
    const partial = summary([charge('ch_part', { amountRefundedCents: 2500 })]);
    assert.equal(partial.paidOrders, 1);
    assert.deepEqual(partial.bookedRevenueByCurrency, { USD: 7500 });
    assert.deepEqual(partial.external.bookedRevenueByCurrency, { USD: 7500 });
    for (const evidence of [{ customerEmail: 'owner@example.invalid' }, { livemode: false }]) {
      const refunded = summary([charge('ch_int', { amountRefundedCents: 10000, ...evidence }), charge('ch_int2', { amountRefundedCents: 2500, ...evidence })]);
      assert.equal(refunded.external.paidOrders, 0);
      assert.deepEqual(refunded.external.bookedRevenueByCurrency, {});
      assert.equal(refunded.paidOrders, 1);
      assert.deepEqual(refunded.bookedRevenueByCurrency, { USD: 7500 });
    }
  } finally {
    [revenuePath, funnelPath].forEach((file, i) => saved[i] === null ? fs.rmSync(file, { force: true }) : fs.writeFileSync(file, saved[i]));
  }
});
