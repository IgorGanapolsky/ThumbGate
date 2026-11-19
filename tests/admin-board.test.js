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

let stripeCalls = 0;
let summaryCalls = 0;
let failProviders = false;
const session = (id, metadata, extra = {}) => ({ id, success_url: 'https://thumbgate.ai/success', metadata, status: 'open', payment_status: 'unpaid', ...extra });
const sessions = [
  session('cs_1', { uaClass: 'browser' }, { status: 'complete', payment_status: 'paid' }),
  session('cs_2', { uaClass: 'browser' }),
  session('cs_3', { uaClass: 'bot' }),
  session('cs_4', {}),
  session('cs_5', { uaClass: 'browser' }, { customer_email: OWNER }),
];
const stripe = {
  checkout: { sessions: { list: () => { stripeCalls += 1; if (failProviders) throw new Error('provider failure'); return (async function* () { for (const row of sessions) yield row; })(); } } },
  subscriptions: { list: async () => { stripeCalls += 1; if (failProviders) throw new Error('provider failure'); return { has_more: false, data: [{ id: 'sub_1', customer: { email: MEMBER } }, { id: 'sub_2', customer: { email: OWNER } }] }; } },
};
const summary = {
  revenue: { external: { paidOrders: 2, bookedRevenueByCurrency: { USD: 9900 } } },
  reconciliation: { status: 'ok', complete: true },
  trafficMetrics: { visitors: 100, sessions: 90, pageViews: 200, ctaClicks: 10, checkoutStarts: 5, checkoutPaidConfirmations: 1 },
  signups: { bySource: { reddit: 3, github: 2 }, emailSignups: 4 },
  pipeline: { workflowSprintLeads: { total: 1, bySource: { founders: 1 } } },
  newsletter: { total: 0, bySource: {} },
};
let server;
let origin;
const request = (url, { token, ...options } = {}) => fetch(origin + url, { redirect: 'manual', ...options, headers: { ...(token ? { cookie: 'thumbgate_auth_session=' + token } : {}), ...(options.headers || {}) } });

test.before(async () => {
  server = createApiServer({ ownerAdminDependencies: {
    getStripeClient: () => stripe,
    getOwnerEmails: () => [OWNER],
    moneyCacheMs: 0,
    getBillingSummaryLive: async () => { summaryCalls += 1; if (failProviders) return { error: 'unavailable' }; return summary; },
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
  assert.equal(d.payingCustomers, 2);
  assert.equal(d.activePro, 1, 'the owner subscription is excluded');
  assert.deepEqual(d.revenueLast30Days, { USD: 9900 });
  assert.equal(d.checkouts7d.started, 5);
  assert.equal(d.checkouts7d.human, 2);
  assert.equal(d.checkouts7d.completedHuman, 1);
  assert.equal(d.checkouts7d.paidHuman, 1);
  assert.equal(d.checkouts7d.bot, 1);
  assert.equal(d.checkouts7d.unclassified, 1);
  assert.equal(d.checkouts7d.internal, 1);
  assert.equal(d.traffic30d.visitors, 100);
  assert.deepEqual(d.leadsBySource.signups, { reddit: 3, github: 2 });
  assert.equal(d.leadsBySource.workflowSprint.total, 1);
  assert.ok(!/sk_(live|test)|card|cus_/.test(text), 'no secret, card or customer id in the response');
});

test('owner: an unavailable provider reports null, never an invented zero', async () => {
  failProviders = true;
  try {
    const res = await request('/v1/admin/money', { token: ownerToken });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'unavailable');
    assert.equal(body.data.payingCustomers, null);
    assert.equal(body.data.activePro, null);
    assert.equal(body.data.revenueLast30Days, null);
    assert.equal(body.data.checkouts7d, null);
    assert.equal(body.data.leadsBySource, null);
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
