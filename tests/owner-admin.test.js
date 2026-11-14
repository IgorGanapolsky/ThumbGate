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
const admin = require('../scripts/owner-admin');
const billing = require('../scripts/billing');
const { createApiServer } = require('../src/api/server');
const ownerToken = crypto.randomBytes(32).toString('hex');
const otherToken = crypto.randomBytes(32).toString('hex');
const expiredToken = crypto.randomBytes(32).toString('hex');
const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const baseSession = { subjectType: 'sso_free', ssoProvider: 'apple', createdAt: Date.now(), expiresAt: Date.now() + 600000 };
const sessionRows = { [hash(ownerToken)]: { ...baseSession, ssoEmail: 'owner@example.invalid' }, [hash(otherToken)]: { ...baseSession, ssoEmail: 'member@example.invalid' }, [hash(expiredToken)]: { ...baseSession, ssoEmail: 'owner@example.invalid', expiresAt: 1 } };
const sessionPath = path.join(root, 'auth-sessions.json');
const writeSessions = () => fs.writeFileSync(sessionPath, JSON.stringify(sessionRows));
writeSessions();
fs.writeFileSync(path.join(root, 'api-keys.json'), JSON.stringify({ keys: {} }));
let providerCalls = 0;
let providerFailure = false;
let lastProviderParams;
const stripe = Object.fromEntries(['customers', 'subscriptions', 'charges', 'refunds', 'products', 'prices'].map((kind) => [kind, { list: async (params, options) => {
  providerCalls += 1; lastProviderParams = { kind, params, options };
  if (providerFailure) throw new Error('Private provider failure must not reach the response');
  return { data: kind === 'customers' ? [{ id: 'cus_synthetic1', name: '<img src=x onerror=alert(1)>', email: 'member@example.invalid', livemode: true, metadata: { secret: 'must-not-leak' }, apiKey: 'must-not-leak' }] : [], has_more: kind === 'customers' && !params.starting_after };
} }]));
let server;
let origin;
const request = (url, { token = ownerToken, ...options } = {}) => fetch(origin + url, { ...options, headers: { ...(token ? { cookie: 'thumbgate_auth_session=' + token } : {}), ...options.headers } });
const deps = (extra = {}) => ({ feedbackDir: root, health: () => ({ version: 'fixture', buildSha: 'fixture', uptime: 10 }), runtime: admin.createRuntimeObservations(), hashDataIdentity: (prefix, seed) => prefix + '_' + crypto.createHash('sha256').update(seed).digest('hex').slice(0, 24), buildHostedTenantIdentity: ({ customerId }) => ({ partition: 'tenant_' + crypto.createHash('sha256').update(customerId).digest('hex').slice(0, 24) }), ...extra });

test.before(async () => { server = createApiServer({ ownerAdminDependencies: { getStripeClient: () => stripe } }); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); origin = 'http://127.0.0.1:' + server.address().port; });
test.after(async () => { await new Promise((resolve) => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });

test('anonymous, non-owner and expired sessions receive identical private 404 without collection or writes', async () => {
  const before = fs.readFileSync(sessionPath, 'utf8');
  const count = providerCalls;
  for (const token of [null, otherToken, expiredToken]) {
    for (const url of ['/admin', '/admin/', '/admin.html', '/admin/customers', '/%61dmin', '/v1/admin', '/v1/admin/stripe/customers', '/v1/%61dmin/stripe/customers']) {
      for (const method of ['GET', 'HEAD', 'OPTIONS', 'POST']) {
        const response = await request(url, { token, method });
        assert.equal(response.status, 404);
        assert.equal(response.headers.get('cache-control'), 'private, no-store');
        assert.equal(response.headers.get('access-control-allow-origin'), null);
        assert.equal(response.headers.get('www-authenticate'), null);
        assert.equal(await response.text(), method === 'HEAD' ? '' : '{"error":"Not found"}');
      }
    }
  }
  assert.equal(providerCalls, count);
  assert.equal(fs.readFileSync(sessionPath, 'utf8'), before);
});

test('credentials, forged identity and request-selected paths cannot replace owner session', async () => {
  const before = providerCalls;
  for (const headers of [{ authorization: 'Bearer synthetic-admin-credential' }, { 'x-api-key': 'synthetic-operator-credential' }, { 'x-owner-email': 'owner@example.invalid' }]) {
    assert.equal((await request('/v1/admin/stripe/customers?project=/tmp', { token: null, headers })).status, 404);
  }
  assert.equal(providerCalls, before);
});

test('Stripe lists paginate and project fields without leaking provider secrets', async () => {
  const response = await request('/v1/admin/stripe/customers?limit=1');
  const first = await response.json();
  assert.equal(first.status, 'ok'); assert.equal(first.data.nextCursor, 'cus_synthetic1');
  assert.equal(first.data.records[0].classification, 'external');
  assert.ok(!JSON.stringify(first).includes('must-not-leak'));
  const second = await (await request('/v1/admin/stripe/customers?starting_after=cus_synthetic1')).json();
  assert.equal(second.data.hasMore, false);
  await request('/v1/admin/stripe/subscriptions');
  assert.equal(lastProviderParams.params.status, 'all');
  assert.deepEqual(lastProviderParams.options, { timeout: 8000, maxNetworkRetries: 0 });
  for (const query of ['limit=0', 'limit=101', 'limit=2&limit=3', 'starting_after=sub_wrong', 'unexpected=1', 'starting_after=../x']) assert.equal((await request('/v1/admin/stripe/customers?' + query)).status, 400);
});

test('Stripe failure is unavailable without fabricated zero or upstream text', async () => {
  providerFailure = true;
  const body = await (await request('/v1/admin/stripe/payments')).json();
  providerFailure = false;
  assert.equal(body.status, 'unavailable'); assert.equal(body.data, null);
  assert.deepEqual(body.warnings, ['source_unavailable']);
});

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

test('analytics finite projection excludes record identity and dynamic arbitrary keys', () => {
  const value = admin.projectAnalytics({ revenue: { external: { bookedRevenueByCurrency: { USD: 20, 'private@example.invalid': 40 } }, latestPaidOrder: { customerId: 'private' } }, funnel: { lastPaidEvent: { secret: 'private' } }, attribution: { 'private@example.invalid': 12 } });
  assert.ok(!JSON.stringify(value).includes('private'));
  assert.deepEqual(value.revenue.external.bookedRevenueByCurrency, { USD: 20 });
});

test('runtime ring bounds errors and telemetry uses sixty second buckets with boundary expiry', () => {
  const runtime = admin.createRuntimeObservations(0);
  for (let i = 0; i < 105; i++) runtime.recordResponse(500, '/private?secret', i);
  runtime.recordTelemetry(false, 1000);
  runtime.recordTelemetry(true, 1000);
  runtime.recordTelemetry(true, 60999);
  const first = runtime.snapshot(60999);
  assert.equal(first.recentErrors.length, 100); assert.equal(first.recentErrors[0].route, 'other');
  assert.equal(first.telemetry.events, 2);
  assert.equal(runtime.snapshot(61000).telemetry.events, 1);
  for (let i = 1; i < 90; i++) runtime.recordTelemetry(true, i * 1000);
  assert.ok(runtime.snapshot(90000).telemetry.retainedSeconds <= 60);
});

test('nonwriting data inventory maps joined accounts, counts scoped files, paginates beyond five hundred', async () => {
  const fixture = fs.mkdtempSync(path.join(root, 'data-'));
  const d = deps({ feedbackDir: fixture });
  const keys = Object.fromEntries(Array.from({ length: 502 }, (_, i) => ['synthetic-' + i, { customerId: 'customer_' + String(i).padStart(3, '0'), customerEmail: 'member' + i + '@example.invalid', active: true }]));
  fs.writeFileSync(path.join(fixture, 'api-keys.json'), JSON.stringify({ keys }));
  fs.writeFileSync(path.join(fixture, 'auth-sessions.json'), JSON.stringify({ synthetic: { ...baseSession, ssoEmail: 'member0@example.invalid', subjectType: 'sso_free' } }));
  const partition = d.buildHostedTenantIdentity({ customerId: 'customer_000' }).partition;
  const tenant = path.join(fixture, 'tenants', partition); fs.mkdirSync(tenant, { recursive: true });
  fs.writeFileSync(path.join(tenant, 'feedback-log.jsonl'), '{"signal":"up"}\n{"signal":"down"}\n');
  fs.writeFileSync(path.join(tenant, 'memory-log.jsonl'), '{"id":"lesson"}\n');
  const before = fs.readFileSync(path.join(fixture, 'api-keys.json'), 'utf8');
  const first = await admin.collectAdminSection({ section: 'data', limit: 1, offset: 0 }, d);
  assert.equal(first.data.totalKnown, 502); assert.equal(first.data.records[0].partitions.length, 2);
  assert.equal(first.data.records[0].partitions[0].feedback.total, 2);
  assert.equal(first.data.records[0].partitions[0].lessons.total, 1);
  assert.ok(!JSON.stringify(first).includes('synthetic-'));
  const last = await admin.collectAdminSection({ section: 'data', limit: 50, offset: 500 }, d);
  assert.equal(last.data.records.length, 2); assert.equal(last.data.hasMore, false);
  assert.equal(fs.readFileSync(path.join(fixture, 'api-keys.json'), 'utf8'), before);
});

test('data readers reject symlinks, corrupt stores and missing files without claiming zero', async () => {
  const fixture = fs.mkdtempSync(path.join(root, 'unsafe-'));
  fs.symlinkSync(sessionPath, path.join(fixture, 'auth-sessions.json'));
  assert.equal(admin.readObject(fixture, 'auth-sessions.json').state, 'corrupt');
  fs.writeFileSync(path.join(fixture, 'api-keys.json'), '[');
  assert.equal(admin.readObject(fixture, 'api-keys.json').state, 'corrupt');
  const count = await admin.countRecords(fixture, path.join(fixture, 'missing.jsonl'));
  assert.equal(count.total, null); assert.equal(count.complete, false);
  fs.writeFileSync(path.join(fixture, 'oversized.json'), ' '.repeat(8 * 1024 * 1024 + 1));
  assert.equal(admin.readObject(fixture, 'oversized.json').state, 'oversized');
});

test('provider slots survive response timeout and block repeated refresh and shared analytics until transport settles', async () => {
  const releases = [];
  let outstanding = 0;
  let maximum = 0;
  const pending = () => new Promise((resolve) => {
    outstanding++; maximum = Math.max(maximum, outstanding);
    releases.push(() => { outstanding--; resolve({ data: [] }); });
  });
  const slow = deps({ sectionTimeoutMs: 10, getStripeClient: () => ({ customers: { list: pending } }) });
  const route = { section: 'stripe', resource: 'customers', limit: 1 };
  const first = admin.collectAdminSection(route, slow);
  const second = admin.collectAdminSection(route, slow);
  await assert.rejects(admin.collectAdminSection(route, slow), { code: 'collection_busy' });
  const results = await Promise.all([first, second]);
  assert.ok(results.every((r) => r.status === 'unavailable' && r.warnings[0] === 'collection_timeout'));
  await Promise.all([admin.collectAdminSection(route, slow), admin.collectAdminSection(route, slow)]);
  const analytics = await billing.getBillingSummariesLive({ month: { window: '30d' } }, { listStripeReconciledRevenueEventsFn: () => billing.withStripeReadSlot(pending) });
  assert.equal(analytics.month.reconciliation.status, 'unavailable');
  assert.equal(outstanding, 2); assert.equal(maximum, 2);
  releases.forEach((release) => release());
  await new Promise((resolve) => setImmediate(resolve));
  const available = await billing.withStripeReadSlot(async () => 'settled');
  assert.equal(available, 'settled');
});

test('oversized analytics source does not invoke shared synchronous collector', async () => {
  const target = path.join(root, 'telemetry-pings.jsonl');
  const prior = fs.existsSync(target) ? fs.readFileSync(target) : null;
  fs.writeFileSync(target, ' '.repeat(8 * 1024 * 1024 + 1));
  let calls = 0;
  try {
    const result = await admin.collectAdminSection({ section: 'analytics' }, deps({ getBillingSummaryLive: async () => { calls++; return {}; } }));
    assert.equal(result.status, 'unavailable'); assert.equal(calls, 0); assert.deepEqual(result.warnings, ['analytics_source_budget']);
  } finally { if (prior) fs.writeFileSync(target, prior); else fs.rmSync(target); }
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

test('successful telemetry persistence counts but privacy opt-out and failed persistence do not', async () => {
  const before = (await (await request('/v1/admin/observability')).json()).data.telemetry.events;
  await request('/v1/telemetry/ping', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventType: 'page_view' }) });
  await request('/v1/telemetry/ping', { method: 'POST', headers: { 'content-type': 'application/json', dnt: '1' }, body: '{}' });
  const telemetryPath = path.join(root, 'telemetry-pings.jsonl');
  fs.renameSync(telemetryPath, telemetryPath + '.saved'); fs.mkdirSync(telemetryPath);
  try { await request('/v1/telemetry/ping', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); }
  finally { fs.rmdirSync(telemetryPath); fs.renameSync(telemetryPath + '.saved', telemetryPath); }
  const after = (await (await request('/v1/admin/observability')).json()).data.telemetry.events;
  assert.equal(after, before + 1);
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

test('inventory unavailable and partial states never invent a complete zero; session activity is not an active key', async () => {
  const fixture = fs.mkdtempSync(path.join(root, 'inventory-'));
  let result = await admin.collectAdminSection({ section: 'data', offset: 0, limit: 25 }, deps({ feedbackDir: fixture }));
  assert.equal(result.status, 'unavailable'); assert.equal(result.data, null);
  fs.writeFileSync(path.join(fixture, 'api-keys.json'), '{broken');
  fs.writeFileSync(path.join(fixture, 'auth-sessions.json'), '{broken');
  result = await admin.collectAdminSection({ section: 'data', offset: 0, limit: 25 }, deps({ feedbackDir: fixture }));
  assert.equal(result.status, 'unavailable'); assert.equal(result.data, null);
  fs.writeFileSync(path.join(fixture, 'auth-sessions.json'), JSON.stringify({ synthetic: { ...baseSession, ssoEmail: 'free@example.invalid' } }));
  result = await admin.collectAdminSection({ section: 'data', offset: 0, limit: 25 }, deps({ feedbackDir: fixture }));
  assert.equal(result.status, 'partial'); assert.equal(result.data.total, null); assert.equal(result.data.totalKnown, 1);
  assert.equal(result.data.records[0].hasCurrentSession, true); assert.equal(result.data.records[0].hasActiveKey, false);
});

test('shared read-path inventory includes enabled legacy merging and trial fallback before collection', async () => {
  const legacy = fs.mkdtempSync(path.join(root, 'legacy-'));
  const saved = { merge: process.env._TEST_INCLUDE_LEGACY_BILLING_DATA, fallback: process.env._TEST_THUMBGATE_FALLBACK_FEEDBACK_DIR };
  const primary = path.join(root, 'revenue-events.jsonl');
  const prior = fs.existsSync(primary) ? fs.readFileSync(primary) : null;
  fs.writeFileSync(primary, '');
  process.env._TEST_INCLUDE_LEGACY_BILLING_DATA = '1';
  process.env._TEST_THUMBGATE_FALLBACK_FEEDBACK_DIR = legacy;
  fs.writeFileSync(path.join(legacy, 'revenue-events.jsonl'), ' '.repeat(8 * 1024 * 1024 + 1));
  fs.writeFileSync(path.join(legacy, 'trial-emails.jsonl'), '{}\n');
  try {
    const paths = billing.getBillingAnalyticsReadPaths();
    assert.ok(paths.includes(path.join(legacy, 'revenue-events.jsonl')));
    assert.ok(paths.includes(path.join(legacy, 'trial-emails.jsonl')));
    let calls = 0;
    const result = await admin.collectAdminSection({ section: 'analytics' }, deps({ getBillingSummaryLive: async () => { calls++; return {}; } }));
    assert.equal(calls, 0); assert.equal(result.status, 'unavailable');
    assert.deepEqual(result.warnings, ['analytics_source_budget']);
    fs.rmSync(path.join(legacy, 'revenue-events.jsonl'));
    fs.writeFileSync(path.join(legacy, 'trial-emails.jsonl'), ' '.repeat(8 * 1024 * 1024 + 1));
    const trial = await admin.collectAdminSection({ section: 'analytics' }, deps({ getBillingSummaryLive: async () => { calls++; return {}; } }));
    assert.equal(calls, 0); assert.deepEqual(trial.warnings, ['analytics_source_budget']);
  } finally {
    if (saved.merge === undefined) delete process.env._TEST_INCLUDE_LEGACY_BILLING_DATA; else process.env._TEST_INCLUDE_LEGACY_BILLING_DATA = saved.merge;
    if (saved.fallback === undefined) delete process.env._TEST_THUMBGATE_FALLBACK_FEEDBACK_DIR; else process.env._TEST_THUMBGATE_FALLBACK_FEEDBACK_DIR = saved.fallback;
    if (prior) fs.writeFileSync(primary, prior); else fs.rmSync(primary);
  }
});

test('subscription-item endpoint reaches every price page with strict resource and subscription cursors', async () => {
  const calls = [];
  const d = deps({ getStripeClient: () => ({ subscriptionItems: { list: async (params) => {
    calls.push(params);
    return { data: [{ id: params.starting_after ? 'si_second' : 'si_first', quantity: 1, price: { id: params.starting_after ? 'price_second' : 'price_first', unit_amount: 8000, currency: 'usd', recurring: { interval: 'month', interval_count: 3 } } }], has_more: !params.starting_after };
  } } }) });
  const url = '/v1/admin/stripe/subscription-items';
  const firstRoute = admin.parseAdminRoute(url, new URLSearchParams('subscription=sub_fixture&limit=1'));
  const first = await admin.collectAdminSection(firstRoute, d);
  assert.equal(first.data.nextCursor, 'si_first');
  assert.equal(first.data.records[0].price.recurring.interval_count, 3);
  const secondRoute = admin.parseAdminRoute(url, new URLSearchParams('subscription=sub_fixture&starting_after=si_first'));
  const second = await admin.collectAdminSection(secondRoute, d);
  assert.equal(second.data.records[0].price.id, 'price_second'); assert.equal(second.data.hasMore, false);
  assert.equal(calls[0].subscription, 'sub_fixture');
  assert.throws(() => admin.parseAdminRoute(url, new URLSearchParams()), { code: 'invalid_query' });
  assert.throws(() => admin.parseAdminRoute(url, new URLSearchParams('subscription=sub_fixture&starting_after=price_wrong')), { code: 'invalid_query' });
});

test('integrated owner reads both tenants while customer requests and inherited scope stay isolated', async () => {
  const { __test__ } = require('../src/api/server');
  const { withDataScope, currentDataScope } = require('../scripts/feedback-scope');
  const { getFeedbackPaths } = require('../scripts/feedback-paths');
  const { EventEmitter } = require('node:events');
  const keyPath = path.join(root, 'api-keys.json');
  const originalKeys = fs.readFileSync(keyPath);
  const globalFeedback = path.join(root, 'feedback-log.jsonl');
  const originalFeedback = fs.existsSync(globalFeedback) ? fs.readFileSync(globalFeedback) : null;
  const keys = ['synthetic-integrated-key-a', 'synthetic-integrated-key-b'];
  const customers = ['synthetic-integrated-a', 'synthetic-integrated-b'];
  const identities = customers.map((customerId) => __test__.buildHostedTenantIdentity({ valid: true, customerId }));
  const dirs = identities.map((identity) => path.join(root, 'tenants', identity.partition));
  const rows = (count, marker) => Array.from({ length: count }, (_, i) => ({ id: marker + i, signal: 'positive', reviewOrigin: 'human', context: marker, timestamp: new Date().toISOString() }));
  const put = (file, values) => fs.writeFileSync(file, values.map(JSON.stringify).join('\n') + '\n');
  fs.writeFileSync(keyPath, JSON.stringify({ keys: Object.fromEntries(keys.map((key, i) => [key, { customerId: customers[i], customerEmail: 'integrated' + i + '@example.invalid', active: true, tier: 'pro', plan: 'pro' }])) }));
  put(globalFeedback, rows(5, 'global-marker'));
  dirs.forEach((dir, i) => {
    fs.mkdirSync(dir, { recursive: true });
    put(path.join(dir, 'feedback-log.jsonl'), rows(i + 1, 'tenant-' + i));
    put(path.join(dir, 'memory-log.jsonl'), rows(i + 1, 'lesson-' + i));
  });
  try {
    const customerRead = async (i, query = '') => {
      const response = await request('/v1/feedback/stats' + query, { token: null, headers: { authorization: 'Bearer ' + keys[i], 'x-thumbgate-project-dir': root } });
      assert.equal(response.status, 200);
      return response.json();
    };
    const results = await Promise.all([customerRead(0), customerRead(1), request('/v1/admin/data').then((response) => response.json())]);
    assert.equal(results[0].total, 1); assert.equal(results[1].total, 2);
    const accounts = results[2].data.records.filter((row) => customers.includes(row.accountId));
    assert.deepEqual(accounts.map((row) => row.partitions[0].feedback.total), [1, 2]);
    assert.equal(results[2].data.unattributedLegacy.feedback.total, 5);
    assert.equal((await customerRead(0, '?project=' + encodeURIComponent(root))).total, 1);
    assert.equal((await request('/v1/admin/data?project=' + encodeURIComponent(root))).status, 400);
    assert.equal((await request('/v1/admin/data', { token: null, headers: { authorization: 'Bearer ' + keys[0] } })).status, 404);
    const handler = server.listeners('request')[0];
    const scope = { kind: 'tenant', tenantId: identities[0].partition, feedbackDir: dirs[0] };
    await withDataScope(scope, async () => {
      const req = new EventEmitter();
      Object.assign(req, { method: 'GET', url: '/v1/admin/data', headers: { cookie: 'thumbgate_auth_session=' + ownerToken, host: 'localhost', 'x-thumbgate-project-dir': dirs[1] } });
      const res = new EventEmitter();
      res.writeHead = (status) => { res.statusCode = status; };
      res.end = (body) => { res.body = body; res.writableEnded = true; res.emit('finish'); };
      await handler(req, res);
      assert.equal(res.statusCode, 200);
      const scopedOwner = JSON.parse(res.body).data.records.filter((row) => customers.includes(row.accountId));
      assert.deepEqual(scopedOwner.map((row) => row.partitions[0].feedback.total), [1, 2]);
      assert.equal(currentDataScope().tenantId, identities[0].partition);
      assert.equal(getFeedbackPaths().FEEDBACK_DIR, fs.realpathSync(dirs[0]));
    });
    assert.equal(currentDataScope(), null);
    const after = await Promise.all([customerRead(0), customerRead(1)]);
    assert.deepEqual(after.map((value) => value.total), [1, 2]);
  } finally {
    fs.writeFileSync(keyPath, originalKeys);
    if (originalFeedback) fs.writeFileSync(globalFeedback, originalFeedback); else fs.rmSync(globalFeedback);
    dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
  }
});

test('recursive private-route scope records one HTTP error observation per request', async () => {
  const keyPath = path.join(root, 'api-keys.json');
  const original = fs.readFileSync(keyPath);
  const key = 'synthetic-recursion-key';
  fs.writeFileSync(keyPath, JSON.stringify({ keys: { [key]: { customerId: 'synthetic-recursion-customer', active: true } } }));
  const route = '/lessons/synthetic-missing-for-error';
  const failInnerResponse = (req, res) => {
    if (req.url !== route) return;
    const writeHead = res.writeHead;
    let injected = false;
    res.writeHead = function writeWithFailure(status, ...args) {
      if (!injected && status === 404) { injected = true; throw new Error('Synthetic response failure'); }
      return writeHead.call(this, status, ...args);
    };
  };
  server.prependListener('request', failInnerResponse);
  try {
    const before = (await (await request('/v1/admin/observability')).json()).data.recentErrors.length;
    const response = await request(route, { token: null, headers: { authorization: 'Bearer ' + key } });
    assert.equal(response.status, 500);
    const after = (await (await request('/v1/admin/observability')).json()).data.recentErrors;
    assert.equal(after.length, before + 1);
    assert.equal(after.at(-1).route, 'page');
    assert.equal(after.at(-1).status, 500);
  } finally { server.removeListener('request', failInnerResponse); fs.writeFileSync(keyPath, original); }
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
