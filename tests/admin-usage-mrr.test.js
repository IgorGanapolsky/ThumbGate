'use strict';

// Owner console: CLI product usage, week-over-week changes and list-price MRR.
// The CLI already pings installs, captures and recalls; the console used to drop every non-web ping, so none of it showed.

process.env.NODE_ENV = 'test';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readTrafficWindow, readInstallCohorts } = require('../scripts/owner-telemetry');
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
  assert.deepEqual(weeks.last7, { realVisitors: 2, engagedVisitors: 0, browserConfirmedVisitors: 0, pageViews: 3, checkoutStarts: 0, activeInstalls: 2 });
  assert.deepEqual(weeks.prior7, { realVisitors: 1, engagedVisitors: 1, browserConfirmedVisitors: 0, pageViews: 1, checkoutStarts: 1, activeInstalls: 1 });
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
  for (const wanted of ['$38.00', 'Renewal revenue, past 30 days (2 renewals)', '25%', 'Churn, past 30 days (1 cancelled)']) assert.ok(page.includes(wanted), 'missing: ' + wanted);
});

test('install cohorts: each install joins the week it was first seen, and later weeks count who came back', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-cohort-'));
  fs.writeFileSync(path.join(dir, 'telemetry-pings.jsonl'), [
    cli(20, 'cli_init', 'a'), cli(13, 'cli_capture', 'a'), cli(1, 'cli_stats', 'a'),
    cli(19, 'cli_init', 'b'),
    cli(2, 'cli_init', 'c'),
    cli(2, 'cli_init', 'mine', { visitorType: 'owner' }),
    cli(70, 'cli_init', 'too_old'),
  ].join('\n') + '\n');
  try {
    const { cohorts } = await readInstallCohorts({ feedbackDir: dir, weeks: 8, now: NOW });
    const week2 = cohorts.find((c) => c.weeksAgo === 2);
    assert.equal(week2.size, 2, 'a and b were first seen 2 weeks ago');
    assert.deepEqual(week2.retained, [2, 1, 1], 'a came back in each later week, b never did');
    assert.deepEqual(cohorts.find((c) => c.weeksAgo === 0).retained, [1], 'c is new this week; owner left out');
    assert.equal(cohorts.reduce((n, c) => n + c.size, 0), 3, 'the 70-day-old install is outside the 8-week read');
    assert.equal(cohorts[0].includesOlder, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Growth shows the cohort table and Today shows where buyers come from', () => {
  const growth = renderTexts('analytics', { cohorts: { cohorts: [{ weekStart: '2026-11-03', weeksAgo: 2, size: 4, retained: [4, 2, 1], includesOlder: false }, { weekStart: '2026-11-17', weeksAgo: 0, size: 3, retained: [3], includesOlder: false }] }, reconciliation: { status: 'ok', complete: true } });
  for (const wanted of ['Install retention by week first seen', '50% (2)', '25% (1)']) assert.ok(growth.includes(wanted), 'missing: ' + wanted);
  const today = renderTexts('money', { channels: [{ channel: 'reddit', checkoutStarts30d: 5, paidCustomers: 1, revenue30d: { USD: 1900 } }], reasons: {}, notes: [] });
  for (const wanted of ['Where buyers come from', 'reddit', '$19.00']) assert.ok(today.includes(wanted), 'missing: ' + wanted);
});

test('unfiltered count-drop alerts are never delivered, real faults still are', () => {
  const { evaluateAlerts, isDeliverable } = require('../scripts/owner-alerts');
  const week = { prior7: { realVisitors: 200, checkoutStarts: 90, activeInstalls: 214 }, last7: { realVisitors: 10, checkoutStarts: 2, activeInstalls: 30 } };
  const alerts = evaluateAlerts({ money: { weekOverWeek: week, reasons: {}, usage30d: { activeInstalls30d: 30, activatedInstalls: 1 } }, report: { errors: { lastHour: 9 } } });
  const ids = alerts.map((alert) => alert.id);
  for (const id of ['visitors_drop', 'checkout_drop', 'installs_drop', 'activation_low']) assert.ok(ids.includes(id), 'still shown on the admin page: ' + id);
  assert.deepEqual(alerts.filter(isDeliverable).map((alert) => alert.id), ['server_errors']);
});

test('alert delivery sends a one-time confirmation, then each new alert once', async () => {
  const { startAlertDelivery, createRuntimeObservations } = require('../scripts/owner-admin');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-deliver-'));
  const sent = [];
  const makeDeps = () => ({ feedbackDir: dir, runtime: createRuntimeObservations(), health: () => ({ version: 'x', buildSha: null, uptime: 1 }), getStripeClient: () => { throw new Error('STRIPE_SECRET_KEY is missing.'); }, getOwnerEmails: () => [], moneyCacheMs: 0, lastGoodMs: 0, telemetryCacheMs: 0, stripeDeadlineMs: 200, getBillingSummaryLive: async () => ({ error: 'off' }) });
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    const timer = startAlertDelivery(makeDeps, { intervalMs: 150, firstCheckMs: 10, send: async (m) => { sent.push(m); } });
    for (let i = 0; i < 100 && sent.length < 1; i += 1) await wait(20);
    assert.equal(sent[0].title, 'ThumbGate: alert delivery is on');
    assert.equal(sent.length, 1, 'an unreadable source seen once (a cold start after a deploy) is not sent yet');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'owner-alert-delivery.json'), 'utf8')).pending, ['stripe_unreadable']);
    for (let i = 0; i < 150 && sent.length < 2; i += 1) await wait(50);
    clearInterval(timer);
    assert.match(sent[1].message, /Stripe could not be read: Stripe key missing\. It has been failing for \d+ minutes?\./, 'still unreadable on the third check in a row, so it is sent');
    assert.ok(fs.existsSync(path.join(dir, 'owner-alert-delivery.json')));
    sent.length = 0;
    // A restart (every deploy) reads the saved state: no second confirmation, and a still-firing alert is not re-sent.
    const again = startAlertDelivery(makeDeps, { intervalMs: 60000, firstCheckMs: 10, send: async (m) => { sent.push(m); } });
    const statePath = path.join(dir, 'owner-alert-delivery.json');
    const firstCheck = JSON.parse(fs.readFileSync(statePath, 'utf8')).checkedAt;
    for (let i = 0; i < 100 && JSON.parse(fs.readFileSync(statePath, 'utf8')).checkedAt === firstCheck; i += 1) await wait(50);
    clearInterval(again);
    assert.deepEqual(sent, [], 'nothing is sent again after a restart');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('engaged visitors: one id with a single page view is not counted as a person; two events or any click is', async () => {
  const { traffic, weeks } = await read([
    web(2, 'landing_page_view', 'crawler-1'),
    web(2, 'landing_page_view', 'crawler-2'),
    web(2, 'landing_page_view', 'reader'), web(2, 'landing_page_view', 'reader'),
    web(3, 'cta_click', 'clicker'),
    web(3, 'landing_page_view', 'bot', { isBotTraffic: true }), web(3, 'cta_click', 'bot', { isBotTraffic: true }),
    web(10, 'landing_page_view', 'old-reader'), web(10, 'pricing_view', 'old-reader'),
  ]);
  assert.equal(traffic.realVisitors, 5, 'the existing count keeps every unflagged id');
  assert.equal(traffic.engagedVisitors, 3, 'reader, clicker and old-reader; the single-view ids and the flagged bot are out');
  assert.equal(weeks.last7.engagedVisitors, 2);
  assert.equal(weeks.prior7.engagedVisitors, 1);
});

test('browser-confirmed visitors: only ids that sent an event through the browser beacon, bots left out', async () => {
  const { traffic, weeks } = await read([
    web(2, 'landing_page_view', 'crawler'), web(2, 'pro_checkout_direct_stripe', 'crawler'),
    web(2, 'landing_page_view', 'person'), web(2, 'section_view', 'person', { ingest: 'beacon' }),
    web(3, 'section_view', 'headless', { ingest: 'beacon', isBotTraffic: true }),
    web(10, 'page_exit', 'old-person', { ingest: 'beacon' }),
  ]);
  assert.equal(traffic.engagedVisitors, 3, 'two server-side events make the crawler look engaged');
  assert.equal(traffic.browserConfirmedVisitors, 2, 'person and old-person ran the page script; the crawler never did');
  assert.equal(weeks.last7.browserConfirmedVisitors, 1);
  assert.equal(weeks.prior7.browserConfirmedVisitors, 1);
});

test('the beacon mark comes from the server, never from the payload', () => {
  assert.equal(sanitizeTelemetryPayload({ eventType: 'section_view', ingest: 'beacon' }, {}).ingest, undefined);
  assert.equal(sanitizeTelemetryPayload({ eventType: 'section_view' }, {}, { ingest: 'beacon' }).ingest, 'beacon');
});

test('the visitors-drop alert follows engaged visitors when they are reported', () => {
  const { evaluateAlerts } = require('../scripts/owner-alerts');
  const money = (week) => ({ weekOverWeek: week, reasons: {}, usage30d: {} });
  const crawlerSpike = { prior7: { realVisitors: 9000, engagedVisitors: 30 }, last7: { realVisitors: 100, engagedVisitors: 28 } };
  assert.ok(!evaluateAlerts({ money: money(crawlerSpike), report: {} }).some((a) => a.id === 'visitors_drop'), 'a crawler swing alone is not a drop in people');
  const realDrop = { prior7: { realVisitors: 100, engagedVisitors: 40 }, last7: { realVisitors: 100, engagedVisitors: 10 } };
  assert.ok(evaluateAlerts({ money: money(realDrop), report: {} }).some((a) => a.id === 'visitors_drop'));
});

test('owner alerts (a): one failed Stripe read sends nothing, and a good check clears the count', () => {
  const { nextAlertDeliveryState } = require('../scripts/owner-admin');
  const stripe = { id: 'stripe_unreadable', level: 'amber', text: 'Stripe could not be read: Stripe did not answer in time.', action: 'Refresh in a minute.', tab: 'money' };
  const T0 = Date.parse('2026-11-25T10:00:00Z');
  const min = (n) => T0 + n * 60000;
  const first = nextAlertDeliveryState([stripe], null, min(0));
  assert.deepEqual(first.added, [], 'one failed read: no delivery');
  assert.equal(first.streaks.stripe_unreadable.count, 1);
  const good = nextAlertDeliveryState([], { firing: first.firing, pending: first.pending, streaks: first.streaks, checkedAt: new Date(min(0)).toISOString() }, min(15));
  assert.deepEqual(good.streaks, {}, 'a successful read clears the count');
  const again = nextAlertDeliveryState([stripe], { firing: good.firing, pending: good.pending, streaks: good.streaks }, min(30));
  assert.deepEqual(again.added, [], 'a failure after a success starts from one again');
  assert.equal(again.streaks.stripe_unreadable.count, 1);
  const second = nextAlertDeliveryState([stripe], { firing: first.firing, pending: first.pending, streaks: first.streaks }, min(15));
  assert.deepEqual(second.added, [], 'two in a row is still not sent');
});

test('owner alerts (b): three failed Stripe reads in a row send exactly one email, with how long it has been failing, and it does not repeat', () => {
  const { nextAlertDeliveryState } = require('../scripts/owner-admin');
  const { formatAlertMessage } = require('../scripts/owner-alerts');
  const stripe = { id: 'stripe_unreadable', level: 'amber', text: 'Stripe could not be read: Stripe did not answer in time.', action: 'Refresh in a minute. If it stays, check the Stripe key on Railway.', tab: 'money' };
  const T0 = Date.parse('2026-11-25T10:00:00Z');
  let state = null;
  const sentMessages = [];
  for (const offset of [0, 15, 30, 45, 60]) {
    const step = nextAlertDeliveryState([stripe], state, T0 + offset * 60000);
    if (step.added.length) sentMessages.push(formatAlertMessage(step.added));
    state = { firing: step.firing, pending: step.pending, streaks: step.streaks, checkedAt: new Date(T0 + offset * 60000).toISOString() };
  }
  assert.equal(sentMessages.length, 1, 'exactly one delivery over five failing checks');
  assert.match(sentMessages[0].message, /Stripe could not be read: Stripe did not answer in time\. It has been failing for 30 minutes\. Refresh in a minute\. If it stays, check the Stripe key on Railway\./);
  assert.equal(sentMessages[0].title, 'ThumbGate: 1 thing need you');
});

test('owner alerts (c): a red alert (failed Stripe notifications) is sent on the first check', () => {
  const { nextAlertDeliveryState } = require('../scripts/owner-admin');
  const { evaluateAlerts, isDeliverable } = require('../scripts/owner-alerts');
  const alerts = evaluateAlerts({ report: { webhooks: { failures24h: 3 } } }).filter(isDeliverable);
  assert.deepEqual(alerts.map((a) => [a.id, a.level]), [['stripe_webhooks', 'red']]);
  const step = nextAlertDeliveryState(alerts, null, Date.parse('2026-11-25T10:00:00Z'));
  assert.deepEqual(step.added.map((a) => a.id), ['stripe_webhooks']);
  assert.doesNotMatch(step.added[0].text, /failing for/, 'red alert wording is unchanged');
  const repeat = nextAlertDeliveryState(alerts, { firing: step.firing, pending: step.pending, streaks: step.streaks }, Date.parse('2026-11-25T10:15:00Z'));
  assert.deepEqual(repeat.added, [], 'does not repeat while it keeps firing');
});
