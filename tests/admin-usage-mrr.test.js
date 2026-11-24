'use strict';

// Owner console: CLI product usage, week-over-week changes and list-price MRR.
// The CLI already pings installs, captures and recalls; the console used to drop every non-web ping, so none of it showed.

process.env.NODE_ENV = 'test';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readTrafficWindow } = require('../scripts/owner-telemetry');
const { monthlyRecurring } = require('../scripts/owner-admin');
const { sanitizeTelemetryPayload } = require('../scripts/telemetry-analytics');

const NOW = Date.UTC(2026, 10, 24, 12);
const at = (daysAgo) => new Date(NOW - daysAgo * 86400000).toISOString();
const cli = (daysAgo, eventType, installId, extra = {}) => JSON.stringify({ receivedAt: at(daysAgo), clientType: 'cli', eventType, installId, version: '1.40.10', platform: 'darwin', ...extra });
const web = (daysAgo, eventType, visitorId, extra = {}) => JSON.stringify({ receivedAt: at(daysAgo), clientType: 'web', eventType, visitorId, ...extra });

async function read(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-usage-'));
  fs.writeFileSync(path.join(dir, 'telemetry-pings.jsonl'), lines.join('\n') + '\n');
  try { return await readTrafficWindow({ feedbackDir: dir, days: 30, now: NOW }); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('CLI installs are counted, owner and CI installs are left out, and activation means a captured piece of feedback', async () => {
  const { usage, traffic, daily } = await read([
    cli(20, 'cli_init', 'a'),
    cli(19, 'cli_capture', 'a'),
    cli(2, 'cli_stats', 'a'),
    cli(3, 'cli_init', 'b'),
    cli(1, 'cli_init', 'mine', { visitorType: 'owner' }),
    cli(1, 'cli_init', 'build', { visitorType: 'ci' }),
    cli(1, 'cli_init', 'flagged', { isInternal: true }),
    web(1, 'landing_page_view', 'v1'),
  ]);
  assert.equal(usage.activeInstalls30d, 2);
  assert.equal(usage.activeInstalls7d, 2, 'a was last seen 2 days ago, b 3 days ago');
  assert.equal(usage.initsInWindow, 2);
  assert.equal(usage.activatedInstalls, 1);
  assert.equal(usage.returningInstalls, 1, 'only a was seen on more than one day');
  assert.equal(usage.excludedInstalls, 3);
  assert.deepEqual(usage.byVersion, { '1.40.10': 2 });
  assert.equal(usage.eventsByType.cli_init, 2);
  assert.equal(traffic.visitors, 1, 'CLI installs never count as site visitors');
  assert.equal(daily.reduce((sum, day) => sum + day.activeInstalls, 0), 4, 'a on three days, b on one');
});

test('the newest 7 days are set against the 7 days before them', async () => {
  const { weeks } = await read([
    web(10, 'landing_page_view', 'old1'),
    web(9, 'checkout_start', 'old1'),
    web(3, 'landing_page_view', 'new1'),
    web(2, 'landing_page_view', 'new2'),
    web(2, 'landing_page_view', 'bot', { isBotTraffic: true }),
    cli(8, 'cli_init', 'i1'),
    cli(1, 'cli_capture', 'i1'),
    cli(1, 'cli_init', 'i2'),
  ]);
  assert.deepEqual(weeks.last7, { realVisitors: 2, pageViews: 3, checkoutStarts: 0, activeInstalls: 2 });
  assert.deepEqual(weeks.prior7, { realVisitors: 1, pageViews: 1, checkoutStarts: 1, activeInstalls: 1 });
});

test('MRR is each active item at list price scaled to one month, and pending cancels are counted', () => {
  const item = (unit_amount, interval, extra = {}) => ({ quantity: 1, price: { unit_amount, currency: 'usd', recurring: { interval, interval_count: 1 } }, ...extra });
  const result = monthlyRecurring([
    { items: { data: [item(1900, 'month')] } },
    { cancel_at_period_end: true, items: { data: [item(19000, 'year')] } },
    { items: { data: [item(1900, 'month', { quantity: 3 })] } },
    { items: { data: [{ price: { unit_amount: 500, currency: 'usd', recurring: null } }] } },
  ]);
  assert.deepEqual(result.mrr, { USD: 1900 + Math.round(19000 / 12) + 5700 });
  assert.equal(result.cancelling, 1);
  assert.equal(result.unpriced, 1, 'a one-time price is not recurring revenue');
});

test('stored CLI pings keep their package version and mark owner and CI runs as internal', () => {
  const owner = sanitizeTelemetryPayload({ clientType: 'cli', eventType: 'cli_init', installId: 'x', pkgVersion: '1.40.10', visitorType: 'owner' });
  assert.equal(owner.version, '1.40.10');
  assert.equal(owner.isInternal, true);
  const ci = sanitizeTelemetryPayload({ clientType: 'cli', eventType: 'cli_init', installId: 'y', visitorType: 'ci' });
  assert.equal(ci.isInternal, true);
  const user = sanitizeTelemetryPayload({ clientType: 'cli', eventType: 'cli_init', installId: 'z', visitorType: 'real_user' });
  assert.equal(user.isInternal, false);
});

// Render the page script against plain objects, like tests/admin-truth-ui.test.js does.
function renderTexts(section, data) {
  const vm = require('node:vm');
  const fake = (tag) => ({ tag, children: [], className: '', textContent: '', style: {}, append(...n) { this.children.push(...n); }, replaceChildren(...n) { this.children = n; }, remove() {}, setAttribute() {}, addEventListener() {} });
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  const script = html.match(/<script nonce="__ADMIN_NONCE__">([\s\S]*?)<\/script>/)[1];
  const context = { document: { getElementById: () => fake('div'), createElement: fake, createTextNode: (t) => ({ textContent: t, children: [] }), createElementNS: (ns, tag) => fake(tag), body: fake('body') }, fetch: () => new Promise(() => {}), location: {}, Node: function Node() {}, Intl, URLSearchParams, console };
  vm.createContext(context);
  vm.runInContext(script + '\n;globalThis.__render = render;', context);
  const parent = fake('section');
  context.__render(parent, section, data);
  const out = [];
  const walk = (node) => { if (node?.textContent) out.push(String(node.textContent)); for (const c of node?.children || []) walk(c); };
  walk(parent);
  return out;
}

const usage = { activeInstalls30d: 10, activeInstalls7d: 4, initsInWindow: 6, activatedInstalls: 3, returningInstalls: 5, excludedInstalls: 2, eventsByType: { cli_init: 6 }, byVersion: { '1.40.10': 10 }, byPlatform: { darwin: 10 } };
const weekOverWeek = { last7: { realVisitors: 15, pageViews: 20, checkoutStarts: 2, activeInstalls: 4 }, prior7: { realVisitors: 12, pageViews: 18, checkoutStarts: 2, activeInstalls: 0 } };

test('Money opens with this week against last week, MRR and product usage', () => {
  const page = renderTexts('money', { mrr: { USD: 5700 }, cancellingAtPeriodEnd: 1, usage30d: usage, weekOverWeek, reasons: {}, notes: [] });
  for (const wanted of ['This week at a glance', '$57.00', 'Product usage · CLI installs, past 30 days', '3 (30%)', '+3 (+25%) vs the 7 days before (12)', 'Same as the 7 days before', '+4 vs the 7 days before (0)']) assert.ok(page.includes(wanted), 'missing: ' + wanted + ' in ' + page.join(' | '));
});

test('a missing usage source says so instead of showing zero', () => {
  const page = renderTexts('money', { mrr: null, cancellingAtPeriodEnd: null, usage30d: null, weekOverWeek: null, reasons: { mrr: 'Stripe did not answer in time' }, notes: [] });
  assert.ok(page.includes('CLI usage is unavailable right now. No zero is inferred.'));
  assert.ok(page.includes('Stripe did not answer in time'));
});

test('Analytics shows the weekly comparison, usage and installs per day', () => {
  const page = renderTexts('analytics', { usage, weekOverWeek, daily: [{ date: '2026-11-23', visitors: 3, activeInstalls: 2, pageViews: 4, ctaClicks: 0, checkoutStarts: 0, checkoutPaidConfirmations: 0 }], reconciliation: { status: 'ok', complete: true } });
  for (const wanted of ['Past 7 days against the 7 days before', 'Active installs, past 7 days', 'Active CLI installs']) assert.ok(page.includes(wanted), 'missing: ' + wanted);
});

const { evaluateAlerts, createAlertTracker, formatAlertMessage } = require('../scripts/owner-alerts');

test('alert rules fire on real trouble, worst first, each with an action', () => {
  const alerts = evaluateAlerts({
    report: { errors: { lastHour: 7 }, uptime: { percent: 99.9 }, webhooks: { failures24h: 2 }, disk: { percent: 90 }, signIn: { failed24h: 1 } },
    money: {
      reasons: {},
      weekOverWeek: { last7: { realVisitors: 8, checkoutStarts: 1, activeInstalls: 5 }, prior7: { realVisitors: 40, checkoutStarts: 6, activeInstalls: 6 } },
      usage30d: { activeInstalls30d: 20, activatedInstalls: 2 },
      cancellingAtPeriodEnd: 1,
      recurring30d: { churnedSubscriptions: 0 },
    },
  });
  const ids = alerts.map((a) => a.id);
  assert.deepEqual(ids.slice(0, 2).sort(), ['server_errors', 'stripe_webhooks']);
  for (const id of ['disk', 'visitors_drop', 'checkout_drop', 'activation_low', 'cancelling']) assert.ok(ids.includes(id), id);
  for (const id of ['uptime', 'sign_in', 'installs_drop', 'churned']) assert.ok(!ids.includes(id), id + ' should stay quiet');
  for (const alert of alerts) assert.ok(alert.text && alert.action, alert.id);
});

test('small numbers never raise a drop alert, and a healthy console raises nothing', () => {
  const quiet = evaluateAlerts({
    report: { errors: { lastHour: 0 }, uptime: { percent: 100 }, webhooks: { failures24h: 0 }, disk: { percent: 20 }, signIn: { failed24h: 0 } },
    money: { reasons: {}, weekOverWeek: { last7: { realVisitors: 1, checkoutStarts: 0, activeInstalls: 0 }, prior7: { realVisitors: 3, checkoutStarts: 2, activeInstalls: 3 } }, usage30d: { activeInstalls30d: 3, activatedInstalls: 0 }, cancellingAtPeriodEnd: 0 },
  });
  assert.deepEqual(quiet, []);
});

test('an unreadable source is its own alert instead of a quiet zero', () => {
  const alerts = evaluateAlerts({ money: { reasons: { payingCustomers: 'Stripe did not answer in time', visitors: 'telemetry read failed' } } });
  assert.deepEqual(alerts.map((a) => a.id), ['stripe_unreadable', 'telemetry_unreadable']);
});

test('delivery sends an alert once, when it first appears', () => {
  const tracker = createAlertTracker();
  const a = { id: 'disk', text: 'x', action: 'y', level: 'amber' };
  const b = { id: 'server_errors', text: 'z', action: 'w', level: 'red' };
  assert.deepEqual(tracker.fresh([a]), [a]);
  assert.deepEqual(tracker.fresh([a]), []);
  assert.deepEqual(tracker.fresh([a, b]), [b]);
  assert.deepEqual(tracker.fresh([]), []);
  assert.deepEqual(tracker.fresh([a]), [a], 'an alert that cleared and came back is new again');
  assert.match(formatAlertMessage([b]).message, /^\[urgent\] z w/);
});

test('Today opens with alerts, then this week, renewals and churn, with the detail folded away', () => {
  const page = renderTexts('money', { mrr: { USD: 1900 }, cancellingAtPeriodEnd: 0, recurring30d: { renewalRevenue: { USD: 3800 }, renewalInvoices: 2, churnedSubscriptions: 1, churnRate: 0.25, complete: true }, usage30d: usage, weekOverWeek, payingCustomers: 0, reasons: {}, notes: [] });
  const order = ['Needs you', 'This week at a glance', 'Product usage · CLI installs, past 30 days', 'Biggest evidenced obstacle', 'Money detail: customers, checkouts, revenue, traffic and leads'].map((t) => page.indexOf(t));
  assert.ok(order.every((i) => i >= 0), order.join(','));
  assert.deepEqual([...order].sort((x, y) => x - y), order, 'in that order');
  assert.ok(page.includes('$38.00 · 2 renewals'));
  assert.ok(page.includes('25% · 1 cancelled'));
});
