'use strict';
// Admin board: signed-out redirect, non-owner 403, owner money board. See docs/designs/2026-11-19-admin-board-gate-and-money-board.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-admin-board-'));
process.env.THUMBGATE_FEEDBACK_DIR = root;
process.env._TEST_API_KEYS_PATH = path.join(root, 'api-keys.json');
process.env._TEST_FUNNEL_LEDGER_PATH = path.join(root, 'funnel-events.jsonl');
process.env._TEST_REVENUE_LEDGER_PATH = path.join(root, 'revenue-events.jsonl');
process.env.THUMBGATE_API_KEY = crypto.randomBytes(8).toString('hex');
process.env.THUMBGATE_OPERATOR_KEY = crypto.randomBytes(8).toString('hex');
const OWNER = ['owner', 'example.invalid'].join('@');
const MEMBER = ['member', 'example.invalid'].join('@');
process.env.THUMBGATE_OWNER_EMAILS = OWNER;
process.env.STRIPE_SECRET_KEY = '';
process.env.STRIPE_PRICE_ID = '';
process.env.THUMBGATE_BILLING_SUMMARY_SOURCE = 'local';
for (const key of ['THUMBGATE_PROJECT_DIR', 'CLAUDE_PROJECT_DIR', 'INIT_CWD', 'RESEND_API_KEY', 'THUMBGATE_RESEND_API_KEY']) delete process.env[key];
fs.writeFileSync(path.join(root, 'api-keys.json'), JSON.stringify({ keys: {} }));

const { createApiServer } = require('../src/api/server');
const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('hex');
const ownerToken = newToken();
const memberToken = newToken();
const keyToken = newToken();
const staleToken = newToken();
const future = Date.now() + 600000;
const sessionPath = path.join(root, 'auth-sessions.json');
fs.writeFileSync(sessionPath, JSON.stringify({
  [hash(ownerToken)]: { subjectType: 'sso_free', ssoProvider: 'google', ssoEmail: OWNER, createdAt: Date.now(), expiresAt: future },
  [hash(memberToken)]: { subjectType: 'sso_free', ssoProvider: 'apple', ssoEmail: MEMBER, createdAt: Date.now(), expiresAt: future },
  [hash(keyToken)]: { subjectType: 'customer', createdAt: Date.now(), expiresAt: future },
  [hash(staleToken)]: { subjectType: 'sso_free', ssoProvider: 'google', ssoEmail: OWNER, createdAt: 1, expiresAt: 2 },
}));

// Site telemetry: three visitors (one is a bot), a click, a checkout start and a paid confirmation in the last
// 30 days, plus one visitor 40 days ago who must not count.
const telemetryPath = path.join(root, 'telemetry-pings.jsonl');
const stamp = (hoursAgo) => new Date(Date.now() - hoursAgo * 3600000).toISOString();
const ping = (hoursAgo, visitorId, eventType, extra = {}) => JSON.stringify({ receivedAt: stamp(hoursAgo), clientType: 'web', eventType, visitorId, sessionId: 's_' + visitorId, source: 'reddit', page: '/', audience: 'external', ...extra });
const telemetryLines = [
  ping(40 * 24, 'v_old', 'landing_page_view'),
  ping(30, 'v1', 'landing_page_view'),
  ping(29, 'v1', 'cta_click'),
  ping(28, 'v1', 'checkout_paid_confirmed'),
  ping(20, 'v2', 'landing_page_view'),
  ping(19, 'v2', 'checkout_start'),
  ping(10, 'v3', 'landing_page_view', { isBotTraffic: true, audience: 'bot' }),
  JSON.stringify({ receivedAt: stamp(5), clientType: 'cli', eventType: 'cli_session', installId: 'i1' }),
];
fs.writeFileSync(telemetryPath, telemetryLines.join('\n') + '\n');

let stripeCalls = 0;
let summaryCalls = 0;
let failProviders = false;
let summaryFails = false;
let stripeKeyMissing = false;
const listCalls = [];
const session = (id, metadata, extra = {}) => ({ id, success_url: 'https://thumbgate.ai/success', metadata, status: 'open', payment_status: 'unpaid', ...extra });
const nowSec = Math.floor(Date.now() / 1000);
const sessions = [
  session('cs_1', { uaClass: 'browser', utmSource: 'reddit' }, { status: 'complete', payment_status: 'paid', customer: 'cus_a', amount_total: 9900, currency: 'usd', created: nowSec - 3600 }),
  session('cs_2', { uaClass: 'browser', utmSource: 'reddit' }),
  session('cs_3', { uaClass: 'bot' }),
  session('cs_4', {}),
  session('cs_5', { uaClass: 'browser' }, { customer_email: OWNER }),
  // Older than 7 and 30 days: counted as a paying customer (same person as cs_1, so once), not in revenue.
  session('cs_7', { uaClass: 'browser' }, { status: 'complete', payment_status: 'paid', customer: 'cus_a', amount_total: 4900, currency: 'usd', created: nowSec - 40 * 86400 }),
  // A different person who paid 40 days ago.
  session('cs_8', { uaClass: 'browser' }, { status: 'complete', payment_status: 'paid', customer: 'cus_b', amount_total: 4900, currency: 'usd', created: nowSec - 40 * 86400 }),
  // Paid and then refunded in full: not a paying customer.
  session('cs_9', { uaClass: 'browser' }, { status: 'complete', payment_status: 'paid', customer: 'cus_refunded', amount_total: 4900, currency: 'usd', created: nowSec - 40 * 86400, payment_intent: { latest_charge: { refunded: true, amount_refunded: 4900 } } }),
  // The owner's own old purchase never counts.
  session('cs_6', { uaClass: 'browser' }, { status: 'complete', payment_status: 'paid', customer: 'cus_owner', customer_email: OWNER, amount_total: 100, currency: 'usd', created: nowSec - 40 * 86400 }),
];
const stripe = {
  // Like Stripe's list: newest first, `limit` rows a page, the next page starts after `starting_after`.
  checkout: { sessions: { list: async (params = {}) => {
    stripeCalls += 1; listCalls.push(params);
    if (failProviders) throw new Error('provider failure');
    const rows = sessions.filter((row) => !(params.status && row.status !== params.status) && !(params.created?.gte && row.created && row.created < params.created.gte));
    const start = params.starting_after ? rows.findIndex((row) => row.id === params.starting_after) + 1 : 0;
    const limit = params.limit || 10;
    return { data: rows.slice(start, start + limit), has_more: start + limit < rows.length };
  } } },
  // One paid renewal from a customer and one from the owner, which never counts.
  invoices: { list: async () => { stripeCalls += 1; if (failProviders) throw new Error('provider failure'); return { has_more: false, data: [
    { id: 'in_1', billing_reason: 'subscription_cycle', customer_email: MEMBER, amount_paid: 1900, currency: 'usd' },
    { id: 'in_2', billing_reason: 'subscription_cycle', customer_email: OWNER, amount_paid: 1900, currency: 'usd' },
    { id: 'in_3', billing_reason: 'subscription_create', customer_email: MEMBER, amount_paid: 1900, currency: 'usd' },
  ] }; } },
  subscriptions: { list: async () => { stripeCalls += 1; if (failProviders) throw new Error('provider failure'); return { has_more: false, data: [{ id: 'sub_1', customer: { email: MEMBER } }, { id: 'sub_2', customer: { email: OWNER } }] }; } },
};
const summary = {
  revenue: { external: { paidOrders: 2, bookedRevenueByCurrency: { USD: 9900 } } },
  reconciliation: { status: 'ok', complete: true },
  trafficMetrics: { visitors: 1, sessions: 1, pageViews: 1, ctaClicks: 1, checkoutStarts: 1, checkoutPaidConfirmations: 1 },
  signups: { bySource: { reddit: 3, github: 2 }, emailSignups: 4 },
  pipeline: { workflowSprintLeads: { total: 1, bySource: { founders: 1 } } },
  newsletter: { total: 0, bySource: {} },
};
let server;
let origin;
const request = (url, { token, ...options } = {}) => fetch(origin + url, { redirect: 'manual', ...options, headers: { ...(token ? { cookie: 'thumbgate_auth_session=' + token } : {}), ...(options.headers || {}) } });
const ownerJson = async (url) => (await request(url, { token: ownerToken })).json();

test.before(async () => {
  server = createApiServer({ ownerAdminDependencies: {
    getStripeClient: () => {
      if (stripeKeyMissing) throw new Error('STRIPE_SECRET_KEY is missing. Stripe client cannot be initialized.');
      return stripe;
    },
    getOwnerEmails: () => [OWNER],
    moneyCacheMs: 0,
    lastGoodMs: 0,
    telemetryCacheMs: 0,
    getBillingSummaryLive: async () => { summaryCalls += 1; if (failProviders || summaryFails) return { error: 'unavailable' }; return summary; },
  } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
});
test.after(async () => { await new Promise((resolve) => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });

test('signed out: /admin redirects to the sign-in page and returns no data', async () => {
  for (const token of [null, staleToken, newToken()]) {
    for (const url of ['/admin', '/admin/', '/admin.html', '/%61dmin']) {
      const res = await request(url, { token });
      assert.equal(res.status, 302, url);
      assert.equal(res.headers.get('location'), '/signin?next=%2Fadmin');
      assert.equal(res.headers.get('cache-control'), 'private, no-store');
      assert.equal(res.headers.get('set-cookie'), null);
      assert.equal(await res.text(), '');
    }
  }
  assert.equal((await request('/v1/admin/money')).status, 404, 'signed-out API stays a private 404');
  assert.equal(stripeCalls + summaryCalls, 0);
});

test('signed in but not on the allowlist: 403 and no data on page and API, including key-only sessions', async () => {
  for (const token of [memberToken, keyToken]) {
    for (const url of ['/admin', '/v1/admin/money', '/v1/admin/stripe/customers', '/v1/admin/analytics']) {
      const res = await request(url, { token });
      assert.equal(res.status, 403, url);
      assert.equal(await res.text(), '{"error":"Forbidden"}');
    }
  }
  assert.equal(stripeCalls + summaryCalls, 0, 'no provider was called for a non-owner');
});

test('owner: the page loads and the money board returns the numbers', async () => {
  const page = await request('/admin', { token: ownerToken });
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes('Money'));
  const res = await request('/v1/admin/money', { token: ownerToken });
  assert.equal(res.status, 200);
  const text = await res.text();
  const body = JSON.parse(text);
  assert.equal(body.status, 'ok');
  const d = body.data;
  assert.equal(d.payingCustomers, 3, 'cus_a (once), cus_b and the one outside subscriber; the owner purchase and the fully refunded one are excluded');
  assert.equal(d.payingCustomersSource, 'stripe');
  assert.equal(d.payingCustomersBasis, 'stripe_paid_and_active');
  assert.equal(d.activePro, 1, 'the owner subscription is excluded');
  assert.deepEqual(d.revenueLast30Days, { USD: 9900 });
  assert.equal(d.checkouts7d.started, 5);
  assert.equal(d.checkouts7d.human, 2);
  assert.equal(d.checkouts7d.completedHuman, 1);
  assert.equal(d.checkouts7d.paidHuman, 1);
  assert.equal(d.checkouts7d.bot, 1);
  assert.equal(d.checkouts7d.notClassified, 1);
  assert.equal(d.checkouts7d.internal, 1);
  const buckets = d.checkouts7d;
  assert.equal(buckets.human + buckets.bot + buckets.notClassified + buckets.internal, buckets.started, 'every started checkout lands in exactly one bucket');
  assert.equal(d.traffic30d.visitors, 3, 'from site telemetry; the 40-day-old visitor and the CLI event are outside');
  assert.equal(d.traffic30d.realVisitors, 2);
  assert.equal(d.traffic30d.pageViews, 3);
  assert.equal(d.traffic30d.checkoutStarts, 1);
  assert.equal(d.traffic30d.checkoutPaidConfirmations, 1);
  assert.deepEqual(d.leadsBySource.signups, { reddit: 3, github: 2 });
  assert.equal(d.leadsBySource.workflowSprint.total, 1);
  assert.ok(!/sk_(live|test)|card|cus_/.test(text), 'no secret, card or customer id in the response');
  assert.deepEqual(Object.values(d.reasons).filter(Boolean), [], 'no reason is needed when every source answers');
});

test('?product= (and any other query) never changes the page: the ThumbGate board, never an "Invalid query" error', async () => {
  const plain = await (await request('/admin', { token: ownerToken })).text();
  for (const query of ['?product=dayglass', '?product=macyolo', '?product=thumbgate', '?product=evil', '?product=%00', '?product=a&product=b', '?x=1']) {
    const res = await request('/admin' + query, { token: ownerToken });
    assert.equal(res.status, 200, query);
    assert.match(res.headers.get('content-type'), /text\/html/, query);
    const html = await res.text();
    assert.ok(!html.includes('Invalid query'), query);
    assert.match(html, /<title>[^<]*ThumbGate[^<]*<\/title>/, query);
    assert.equal(html.replace(/nonce-[A-Za-z0-9+/=]+|nonce="[^"]*"/g, ''), plain.replace(/nonce-[A-Za-z0-9+/=]+|nonce="[^"]*"/g, ''), query + ' serves the same page');
    for (const name of ['Dayglass', 'Mac YOLO']) assert.ok(!html.includes(name), query + ' mentions ' + name);
  }
  const signedOut = await request('/admin?product=dayglass');
  assert.equal(signedOut.status, 302);
  assert.equal(signedOut.headers.get('location'), '/signin?next=%2Fadmin');
  assert.equal((await request('/admin?product=dayglass', { token: memberToken })).status, 403);
});

test('owner: paying customers come from Stripe and visitors from telemetry even when the billing summary fails', async () => {
  summaryFails = true;
  try {
    const body = await ownerJson('/v1/admin/money');
    assert.equal(body.status, 'partial');
    assert.equal(body.data.payingCustomers, 3);
    assert.deepEqual(body.data.revenueLast30Days, { USD: 9900 });
    assert.equal(body.data.checkouts7d.started, 5);
    assert.equal(body.data.traffic30d.visitors, 3, 'visitors never wait for the billing summary');
    assert.equal(body.data.leadsBySource, null);
    assert.match(body.data.reasons.leads, /lead ledgers/);
    assert.ok(body.warnings.includes('leads_unavailable'));
  } finally { summaryFails = false; }
});

test('owner: with the Stripe key missing every Stripe card says so and telemetry cards still answer', async () => {
  stripeKeyMissing = true;
  try {
    const body = await ownerJson('/v1/admin/money');
    assert.equal(body.data.payingCustomers, null);
    assert.equal(body.data.reasons.payingCustomers, 'Stripe key missing');
    assert.equal(body.data.reasons.checkouts, 'Stripe key missing');
    assert.equal(body.data.reasons.revenue, 'Stripe key missing');
    assert.equal(body.data.traffic30d.visitors, 3);
    assert.equal(body.data.reasons.visitors, null);
  } finally { stripeKeyMissing = false; }
});

test('owner: an unavailable provider reports null with a reason, never an invented zero', async () => {
  failProviders = true;
  try {
    const res = await request('/v1/admin/money', { token: ownerToken });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'partial');
    assert.equal(body.data.payingCustomers, null);
    assert.equal(body.data.activePro, null);
    assert.equal(body.data.revenueLast30Days, null);
    assert.equal(body.data.checkouts7d, null);
    assert.equal(body.data.reasons.payingCustomers, 'Stripe unavailable');
    assert.equal(body.data.traffic30d.visitors, 3);
  } finally { failProviders = false; }
});

test('owner: an empty telemetry store says so instead of reporting zero visitors', async () => {
  const saved = fs.readFileSync(telemetryPath);
  fs.writeFileSync(telemetryPath, '');
  try {
    const body = await ownerJson('/v1/admin/money');
    assert.equal(body.data.traffic30d, null);
    assert.equal(body.data.reasons.visitors, 'telemetry store empty');
    assert.equal(body.data.payingCustomers, 3, 'Stripe cards are unaffected');
  } finally { fs.writeFileSync(telemetryPath, saved); }
});

test('owner: analytics returns the 30-day traffic and a daily series from the telemetry tail', async () => {
  const body = await ownerJson('/v1/admin/analytics');
  assert.equal(body.status, 'ok');
  assert.equal(body.data.trafficMetrics.visitors, 3);
  assert.equal(body.data.trafficMetrics.pageViews, 3);
  assert.equal(body.data.trafficMetrics.ctaClicks, 2, 'a CTA click and a checkout start are both clicks');
  assert.equal(body.data.trafficMetrics.checkoutStarts, 1);
  assert.equal(body.data.trafficMetrics.checkoutPaidConfirmations, 1);
  assert.ok(body.data.daily.length >= 1 && body.data.daily.every((day) => typeof day.date === 'string' && Number.isInteger(day.visitors)));
  assert.equal(body.data.dataQuality.telemetryWindowComplete, true);
});

test('summary: same auth as the console (signed out is the private 404, non-owner 403), read-only, and no provider is called without the owner', async () => {
  const before = stripeCalls + summaryCalls;
  assert.equal((await request('/v1/admin/summary')).status, 404);
  assert.equal((await request('/v1/admin/summary', { token: staleToken })).status, 404);
  for (const token of [memberToken, keyToken]) assert.equal((await request('/v1/admin/summary', { token })).status, 403);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal((await request('/v1/admin/summary', { token: ownerToken, method })).status, 405, method);
  assert.equal((await request('/v1/admin/summary?x=1', { token: ownerToken })).status, 400, 'no query options exist');
  assert.equal(stripeCalls + summaryCalls, before);
});

test('summary: the owner gets every number the Money and Analytics tabs show, each with source, collected time and a state', async () => {
  const res = await request('/v1/admin/summary', { token: ownerToken });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.data.readOnly, true);
  const fields = body.data.fields;
  const states = new Set(['ok', 'verified_zero', 'partial', 'stale', 'unavailable', 'unresolved']);
  for (const [key, field] of Object.entries(fields)) {
    assert.ok(states.has(field.status), key + ' has a known state, got ' + field.status);
    assert.equal(typeof field.source, 'string', key);
    assert.equal(typeof field.label, 'string', key);
    assert.ok(Object.hasOwn(field, 'collectedAt'), key);
  }
  // Every value the Money tab shows.
  const money = await ownerJson('/v1/admin/money');
  assert.equal(fields['money.paying_customers'].value, money.data.payingCustomers);
  assert.equal(fields['money.active_pro'].value, money.data.activePro);
  assert.deepEqual(fields['money.revenue_30d'].value, money.data.revenueLast30Days);
  assert.match(fields['money.revenue_30d'].label, /One-time checkout revenue/);
  // Renewal invoices are read now: only the customer's subscription_cycle invoice counts.
  assert.deepEqual(fields['money.subscription_invoices_30d'].value, { USD: 1900 });
  assert.deepEqual(fields['money.subscription_invoices_30d'].value, money.data.recurring30d.renewalRevenue);
  assert.equal(fields['money.churned_subscriptions_30d'].value, money.data.recurring30d.churnedSubscriptions);
  assert.deepEqual(body.data.knownGaps, []);
  for (const [window, block] of [['7d', money.data.checkouts7d], ['30d', money.data.checkouts30d]]) {
    for (const name of ['started', 'human', 'bot', 'notClassified', 'internal']) assert.equal(fields[`money.checkouts_${window}.${name}`].value, block[name], window + ' ' + name);
  }
  assert.deepEqual(fields['money.checkout_bot_check'].value.sinceBotCheck, money.data.checkoutBotCheck.sinceBotCheck);
  assert.deepEqual(fields['money.signups_by_source'].value, money.data.leadsBySource.signups);
  assert.equal(fields['traffic.visitor_identifiers_all_30d'].value, money.data.traffic30d.visitors);
  assert.equal(fields['traffic.visitor_identifiers_excluding_flagged_30d'].value, money.data.traffic30d.realVisitors);
  assert.equal(fields['traffic.landing_page_views_30d'].value, money.data.traffic30d.pageViews);
  // Every value the Analytics tab shows.
  const analytics = await ownerJson('/v1/admin/analytics');
  assert.equal(fields['traffic.cta_clicks_30d'].value, analytics.data.trafficMetrics.ctaClicks);
  assert.equal(fields['traffic.checkout_starts_30d'].value, analytics.data.trafficMetrics.checkoutStarts);
  assert.equal(fields['traffic.paid_confirmations_30d'].value, analytics.data.trafficMetrics.checkoutPaidConfirmations);
  assert.equal(fields['traffic.daily_30d'].value.length, analytics.data.daily.length);
  assert.equal(fields['analytics.external_paid_orders'].value, analytics.data.revenue.external.paidOrders);
  assert.equal(fields['analytics.email_signups'].value, analytics.data.signups.emailSignups);
  assert.equal(fields['money.paying_customers'].source, 'stripe');
  assert.equal(fields['money.paying_customers'].status, 'ok');
  assert.equal(typeof fields['money.paying_customers'].collectedAt, 'string');
  assert.equal(body.data.freshness.billingSummaryCacheSeconds, 600);
  assert.ok(!/sk_(live|test)|cus_/.test(JSON.stringify(body)), 'no secret or customer id in the summary');
});

test('summary: a failed source shows as unavailable with its reason, never as a zero', async () => {
  failProviders = true;
  try {
    const body = await ownerJson('/v1/admin/summary');
    assert.equal(body.status, 'partial');
    const fields = body.data.fields;
    assert.equal(fields['money.paying_customers'].value, null);
    assert.equal(fields['money.paying_customers'].status, 'unavailable');
    assert.equal(fields['money.paying_customers'].reason, 'Stripe unavailable');
    assert.equal(fields['traffic.landing_page_views_30d'].status, 'ok', 'telemetry is unaffected');
  } finally { failProviders = false; }
});

test('sign-in page: Google and Apple links, no typed email', async () => {
  const res = await request('/signin');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('/v1/cloud/sso/authorize?provider=google'));
  assert.ok(html.includes('/v1/cloud/sso/authorize?provider=apple'));
  assert.ok(!/type=["']email["']/i.test(html));
});

test('alerts: owner only, a list with an action on each, and delivery off without a webhook', async () => {
  assert.equal((await request('/v1/admin/alerts')).status, 404);
  assert.equal((await request('/v1/admin/alerts', { token: memberToken })).status, 403);
  const body = await ownerJson('/v1/admin/alerts');
  assert.equal(body.source, 'owner_alerts');
  assert.ok(Array.isArray(body.data.alerts));
  for (const alert of body.data.alerts) assert.ok(alert.text && alert.action && ['red', 'amber', 'info'].includes(alert.level), JSON.stringify(alert));
  assert.equal(body.data.delivery, 'off');
  assert.equal(body.data.checked.money, true);
});

test('channels: starts, paying customers and revenue per utm source, bots and owner left out', async () => {
  const money = await ownerJson('/v1/admin/money');
  const byName = Object.fromEntries(money.data.channels.map((row) => [row.channel, row]));
  // cus_a first paid 40 days ago with no utm (direct), so the customer is credited to direct, not to reddit.
  assert.equal(byName.direct.paidCustomers, 2, 'cus_a and cus_b');
  assert.equal(byName.reddit.paidCustomers, 0);
  assert.deepEqual(byName.reddit.revenue30d, { USD: 9900 }, 'the recent reddit checkout is reddit revenue');
  assert.equal(byName.reddit.checkoutStarts30d, 2);
  const summary = await ownerJson('/v1/admin/summary');
  assert.deepEqual(summary.data.fields['money.channels'].value, money.data.channels);
});
