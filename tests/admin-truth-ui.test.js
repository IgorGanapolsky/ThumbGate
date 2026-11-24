'use strict';

// Owner console truthfulness, read from what public/admin.html renders:
//  - the Observability caption names the period actually measured, not "30 days";
//  - a conversion rate with no denominator reads "N/A", never 0;
//  - Money labels its revenue as one-time checkout revenue and says renewal invoices are not included;
//  - sources show when they were observed and when the display refreshed;
//  - the Overview's first screen is verified money, measured activation and the biggest evidenced obstacle.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const report = require('../scripts/ops-report');

function fakeElement(tag) {
  return {
    tag, children: [], className: '', textContent: '', style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    remove() {}, setAttribute() {}, addEventListener() {},
  };
}

function load(fetchImpl = () => new Promise(() => {})) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  const script = html.match(/<script nonce="__ADMIN_NONCE__">([\s\S]*?)<\/script>/)[1];
  const context = {
    document: { getElementById: () => fakeElement('div'), createElement: fakeElement, createTextNode: (text) => ({ tag: '#text', textContent: text, children: [] }), createElementNS: (ns, tag) => fakeElement(tag), body: fakeElement('body') },
    fetch: fetchImpl, location: { assign() {} }, Node: function Node() {}, Intl, URLSearchParams, console,
  };
  vm.createContext(context);
  vm.runInContext(script + '\n;globalThis.__render = render;', context);
  return context;
}

const texts = (node, found = []) => {
  if (!node || typeof node !== 'object') return found;
  if (node.textContent) found.push(String(node.textContent));
  for (const child of node.children || []) texts(child, found);
  return found;
};
const renderTexts = (section, data, fetchImpl) => {
  const context = load(fetchImpl);
  const parent = fakeElement('section');
  context.__render(parent, section, data);
  return { parent, context, all: () => texts(parent) };
};

const MIN = 60000;
const NOW = Date.parse('2026-11-19T21:00:00Z');
const beats = (minutes) => { const out = []; for (let i = minutes; i >= 0; i -= 1) out.push(NOW - i * MIN); return out; };
const observability = (minutes) => ({ report: report.buildReport({ now: NOW, beats: beats(minutes), events: [], speed: {}, startedAt: new Date(NOW - 10 * MIN).toISOString(), uptimeSeconds: 600, sha: '1ba5043d2ade4dcef85bd114a8fc3e4b6f40062f', commitTitle: 'x', repo: 'IgorGanapolsky/ThumbGate', disk: { capacityBytes: 10 * 1024 ** 3, usedBytes: 1024 ** 3 } }) });

test('uptime caption names the real measured period, never a fixed 30 days', () => {
  const oneDay = renderTexts('observability', observability(1440)).all();
  assert.ok(oneDay.includes('Up during the observed period, about 1 day'), oneDay.join(' | '));
  assert.equal(oneDay.some((text) => /last 30 days/i.test(text)), false);
  const hours = renderTexts('observability', observability(600)).all();
  assert.ok(hours.includes('Up during the observed period, less than 1 day'));
});

test('periodWords reads in plain days', () => {
  const { context } = renderTexts('observability', observability(1440));
  assert.equal(context.periodWords(1), 'about 1 day');
  assert.equal(context.periodWords(2.4), 'about 2.4 days');
  assert.equal(context.periodWords(0.4), 'less than 1 day');
  assert.equal(context.periodWords(null), 'length not measured');
});

const funnel = (stageCounts, rates = {}) => ({ stageCounts, conversionRates: { acquisitionToActivation: 0, activationToPaid: 0, acquisitionToPaid: 0, ...rates }, uniqueAcquisitionLeads: 207, uniquePaidCustomers: 0, excludedSyntheticCheckoutSessions: 105 });

test('conversion rates with no denominator are N/A, not zero', () => {
  const { context } = renderTexts('observability', observability(600));
  const rows = context.conversionRows(funnel({ acquisition: 209, activation: 0, paid: 0 }));
  const byName = Object.fromEntries(rows.map((r) => [r.name, r.value]));
  assert.equal(byName['First API-key use to paid'], 'N/A, no recorded first API-key uses');
  assert.equal(byName['Acquisition event to first API-key use'], '0%', 'a real zero over a real denominator stays 0%');
  const none = context.conversionRows(funnel({ acquisition: 0, activation: 0, paid: 0 }));
  assert.ok(none.every((r) => /^N\/A, no (measured|recorded)/.test(r.value)));
  const some = context.conversionRows(funnel({ acquisition: 200, activation: 20, paid: 2 }, { acquisitionToActivation: 0.1, activationToPaid: 0.1, acquisitionToPaid: 0.01 }));
  assert.deepEqual([...some.map((r) => r.value)], ['10%', '10%', '1%']);
});

test('the Analytics tab shows the conversion table and what qualifies an acquisition identity', () => {
  const page = renderTexts('analytics', { trafficMetrics: null, signups: {}, revenue: { external: {} }, funnel: funnel({ acquisition: 209, activation: 0, paid: 0 }) }).all();
  assert.ok(page.includes('Funnel conversion'));
  assert.ok(page.includes('N/A, no recorded first API-key uses'));
  assert.ok(page.some((text) => /An acquisition identity is one distinct event identity/.test(text)));
  assert.ok(page.some((text) => /first call made with an API key/.test(text)));
});

const moneyBase = { payingCustomers: 0, activePro: 0, payingCustomersBasis: 'stripe_paid_and_active', activeProBasis: 'stripe_active_subscriptions_excluding_owner', revenueLast30Days: {}, checkouts7d: null, checkouts30d: null, checkoutBotCheck: null, traffic30d: null, leadsBySource: null, reasons: {}, notes: [] };

test('Money labels checkout revenue as one-time and says renewal invoices are not included', () => {
  const page = renderTexts('money', { ...moneyBase, revenueLast30Days: { USD: 4900 } }).all();
  assert.ok(page.includes('One-time checkout revenue · past 30 days'));
  assert.equal(page.some((text) => /^Revenue · past 30 days$/.test(text)), false);
  assert.ok(page.some((text) => /Subscription renewal invoices are not read/.test(text) && /not collected yet/.test(text)));
});

test('Money shows source observed time, state and refresh time per source', () => {
  const fresh = { paid: { collectedAt: '2026-11-20T18:00:00.000Z', stale: true }, subscriptions: { collectedAt: '2026-11-20T19:00:00.000Z', stale: false }, checkouts: { collectedAt: '2026-11-20T19:00:00.000Z', stale: false }, traffic: { collectedAt: null, stale: false }, leads: { collectedAt: '2026-11-20T18:50:00.000Z', stale: false }, displayRefreshedAt: '2026-11-20T19:05:00.000Z', telemetryCacheSeconds: 60, billingSummaryCacheSeconds: 600 };
  const page = renderTexts('money', { ...moneyBase, freshness: fresh }).all();
  assert.ok(page.includes('Source freshness'));
  assert.ok(page.includes('Last verified value, the source did not answer'));
  assert.ok(page.includes('Current'));
  assert.ok(page.includes('not collected'), 'a source with no read time says so');
  assert.ok(page.some((text) => /Site visits are cached for 60 seconds and the billing summary for 10 minutes/.test(text)));
});

const metric = (label, value, status, extra = {}) => ({ label, value, status, source: 'stripe', collectedAt: '2026-11-20T19:00:00.000Z', ...extra });
const summaryBody = (since = { started: 3, human: 0, bot: 3, notClassified: 0, internal: 0 }) => ({ data: { freshness: { displayRefreshedAt: '2026-11-20T19:05:00.000Z' }, fields: {
  'money.paying_customers': metric('Paying customers', 0, 'verified_zero'),
  'money.active_pro': metric('Active Pro subscriptions', 0, 'verified_zero'),
  'money.revenue_30d': metric('One-time checkout revenue, past 30 days, by currency', {}, 'ok'),
  'money.subscription_invoices_30d': metric('Subscription invoices, past 30 days', null, 'unresolved', { collectedAt: null, reason: 'Not collected yet' }),
  'money.checkout_bot_check': metric('Checkout sessions split at the bot check (30 days)', { botCheckBeganLabel: '18 Nov 2026, 7:04 PM ET', sinceBotCheck: since }, 'ok'),
} } });
const analyticsBody = { data: { funnel: funnel({ acquisition: 209, activation: 0, paid: 0 }) } };

test('Overview first screen: verified money, measured activation and the biggest evidenced obstacle', async () => {
  const fetchImpl = (url) => Promise.resolve({ ok: true, json: async () => (url.endsWith('/summary') ? summaryBody() : analyticsBody) });
  const view = renderTexts('overview', { health: { version: 'x', buildSha: 'abc', uptime: 120 } }, fetchImpl);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const page = view.all();
  for (const wanted of ['External money and verification state', 'Recorded first API-key use', 'Biggest evidenced obstacle', 'Verified zero', 'Unresolved, not collected yet', 'Funnel conversion', 'Build and runtime']) assert.ok(page.includes(wanted), 'missing: ' + wanted);
  assert.ok(page.some((text) => /207 distinct acquisition-event identities and 0 recorded first API-key uses/.test(text)));
  assert.ok(page.some((text) => /Since the bot check on 18 Nov 2026, 7:04 PM ET, 3 checkout sessions started and 0 are classified as a browser/.test(text)));
  assert.ok(page.some((text) => /read-only/.test(text) && /\/v1\/admin\/summary/.test(text)));
  assert.equal(page.some((text) => /uptimeSeconds/.test(text)), false);
});

test('Overview never infers a zero when the sources fail', async () => {
  const view = renderTexts('overview', { health: {} }, () => Promise.resolve({ ok: false, json: async () => null }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const page = view.all();
  assert.ok(page.some((text) => /money summary is unavailable/.test(text)));
  assert.ok(page.some((text) => /funnel is unavailable/.test(text)));
  assert.ok(page.some((text) => /could not be read right now/.test(text)));
});

test('describeObstacle names evidence and its limits, and does not invent one', () => {
  const { context } = renderTexts('observability', observability(600));
  const fields = summaryBody().data.fields;
  assert.match(context.describeObstacle(fields, funnel({ acquisition: 209, activation: 0, paid: 0 })), /does not establish unique people, installations or successful local use/);
  assert.match(context.describeObstacle(null, null), /could not be read right now/);
  assert.match(context.describeObstacle({ 'money.paying_customers': metric('p', 2, 'ok') }, null), /2 paying customers/);
  assert.match(context.describeObstacle({ 'money.paying_customers': metric('p', 0, 'verified_zero') }, null), /not enough classified evidence/);
});
