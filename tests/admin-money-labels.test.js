'use strict';

// Every label the Money tab shows must be plain words: no camelCase field names and no digit glued to a word
// ("checkoutsStarted7d", "visitors30d"). No card may show a bare "Unknown": a missing number shows its reason.
// Both are read from what public/admin.html actually renders.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fakeElement(tag) {
  return {
    tag,
    children: [],
    className: '',
    textContent: '',
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    remove() {},
    setAttribute() {},
    addEventListener() {},
  };
}

function renderSection(section, data) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  const script = html.match(/<script nonce="__ADMIN_NONCE__">([\s\S]*?)<\/script>/)[1];
  const context = {
    document: { getElementById: () => fakeElement('div'), createElement: fakeElement, createElementNS: (ns, tag) => fakeElement(tag), body: fakeElement('body') },
    fetch: () => new Promise(() => {}),
    location: { assign() {} },
    Node: function Node() {},
    Intl,
    URLSearchParams,
    console,
  };
  vm.createContext(context);
  vm.runInContext(script + '\n;globalThis.__render = render;', context);
  const parent = fakeElement('section');
  context.__render(parent, section, data);
  return parent;
}
const renderMoney = (data) => renderSection('money', data);

function textsOf(node, found = []) {
  if (!node || typeof node !== 'object') return found;
  if (node.textContent) found.push({ text: String(node.textContent), className: node.className, tag: node.tag });
  for (const child of node.children || []) textsOf(child, found);
  return found;
}

const bucket = { started: 5, human: 2, completedHuman: 1, paidHuman: 1, bot: 1, notClassified: 1, internal: 1 };
const reasonsNone = { payingCustomers: null, activePro: null, revenue: null, checkouts: null, visitors: null, leads: null };
const sample = {
  payingCustomers: 3,
  activePro: 1,
  payingCustomersBasis: 'stripe_paid_and_active',
  activeProBasis: 'stripe_active_subscriptions_excluding_owner',
  revenueLast30Days: { USD: 9900 },
  checkouts7d: bucket,
  checkouts30d: bucket,
  traffic30d: { visitors: 100, realVisitors: 90, botOrInternalVisitors: 10, sessions: 90, pageViews: 200, ctaClicks: 10, checkoutStarts: 5, checkoutPaidConfirmations: 1 },
  leadsBySource: { signups: { reddit: 3 }, workflowSprint: { total: 1, bySource: { founders: 1 } }, newsletter: { total: 0, bySource: {} }, emailSignups: 4 },
  reasons: reasonsNone,
  notes: [],
};

// Each source failing in turn: its fields are null and the reason says why.
const stripeDown = { ...sample, payingCustomers: null, activePro: null, revenueLast30Days: null, checkouts7d: null, checkouts30d: null, payingCustomersBasis: 'unavailable', activeProBasis: 'unavailable', reasons: { ...reasonsNone, payingCustomers: 'Stripe key missing', activePro: 'Stripe key missing', revenue: 'Stripe key missing', checkouts: 'Stripe key missing' } };
const telemetryDown = { ...sample, traffic30d: null, reasons: { ...reasonsNone, visitors: 'telemetry store empty' } };
const leadsDown = { ...sample, leadsBySource: null, reasons: { ...reasonsNone, leads: 'lead ledgers still calculating, refresh in a minute' } };
const everythingDown = { ...stripeDown, traffic30d: null, leadsBySource: null, reasons: { payingCustomers: 'Stripe unavailable', activePro: 'Stripe unavailable', revenue: 'Stripe unavailable', checkouts: 'Stripe unavailable', visitors: 'telemetry read failed', leads: 'lead ledgers failed' } };
// A source that failed without saying why still never renders a bare Unknown.
const noReasonGiven = { ...everythingDown, reasons: {} };

const camelCase = /[a-z][A-Z]/;
const digitGlued = /[A-Za-z]\d|\d[A-Za-z]/;

function offenders(list) {
  // The product name ThumbGate is a brand, not a field name.
  return list.filter(({ text }) => { const plain = text.replaceAll('ThumbGate', 'Brand'); return camelCase.test(plain) || digitGlued.test(plain); }).map(({ text }) => text);
}

test('Money tab card labels are plain words, with and without data', () => {
  for (const data of [sample, stripeDown, telemetryDown, leadsDown, everythingDown]) {
    const labels = textsOf(renderMoney(data)).filter((item) => item.className === 'label');
    assert.ok(labels.length >= 8, 'the card labels were found');
    assert.deepEqual(offenders(labels), []);
  }
});

test('Money tab detail rows and notes are plain words too', () => {
  const all = textsOf(renderMoney(sample)).filter((item) => item.className !== 'value');
  const bad = offenders(all.filter((item) => !/^\$|^\d/.test(item.text)));
  assert.deepEqual(bad, []);
});

test('Money tab cards use the agreed wording', () => {
  const labels = textsOf(renderMoney(sample)).filter((item) => item.className === 'label').map((item) => item.text);
  for (const wanted of ['Paying customers', 'Checkouts started (7 days)', 'Real people (7 days)', 'Bots (7 days)', 'Not classified (7 days)', 'Visitors who viewed a page (30 days)']) {
    assert.ok(labels.includes(wanted), 'missing label: ' + wanted);
  }
});

test('no Money card shows a bare Unknown when any one source, or all of them, fail', () => {
  for (const [name, data] of Object.entries({ sample, stripeDown, telemetryDown, leadsDown, everythingDown, noReasonGiven })) {
    const unknown = textsOf(renderMoney(data)).filter((item) => /\bunknown\b/i.test(item.text));
    assert.deepEqual(unknown.map((item) => item.text), [], name + ' renders Unknown');
  }
});

test('a failed source shows its own reason on the card', () => {
  const values = (data) => textsOf(renderMoney(data)).filter((item) => item.className === 'value').map((item) => item.text);
  assert.ok(values(stripeDown).includes('Stripe key missing'));
  assert.ok(values(telemetryDown).includes('telemetry store empty'));
  assert.ok(values(everythingDown).includes('telemetry read failed'));
  assert.ok(values(noReasonGiven).includes('Source not available right now'));
});

test('with the billing source failing and Stripe returning zero, the paying customers card reads "0 · from Stripe"', () => {
  const zero = { ...leadsDown, payingCustomers: 0, activePro: 0, revenueLast30Days: {}, checkouts7d: { started: 0, human: 0, completedHuman: 0, paidHuman: 0, bot: 0, notClassified: 0, internal: 0 }, reasons: { ...reasonsNone, leads: 'lead ledgers failed' } };
  const items = textsOf(renderMoney(zero));
  const card = items.findIndex((item) => item.className === 'label' && item.text === 'Paying customers');
  assert.ok(card >= 0, 'the Paying customers card is there');
  assert.equal(items[card - 1].text, '0 · from Stripe', 'the value sits directly before its label');
});

test('Analytics tab renders numbers and the daily chart, and never a bare Unknown', () => {
  const analytics = { trafficMetrics: { visitors: 3, pageViews: 3, ctaClicks: 2, checkoutStarts: 1, checkoutPaidConfirmations: 1 }, daily: [{ date: '2026-11-18', visitors: 2, sessions: 2, pageViews: 2, ctaClicks: 1, checkoutStarts: 0, checkoutPaidConfirmations: 0 }, { date: '2026-11-19', visitors: 1, sessions: 1, pageViews: 1, ctaClicks: 1, checkoutStarts: 1, checkoutPaidConfirmations: 1 }] };
  for (const data of [analytics, { daily: [] }]) {
    const items = textsOf(renderSection('analytics', data));
    assert.deepEqual(items.filter((item) => /\bunknown\b/i.test(item.text)).map((item) => item.text), []);
  }
  const labels = textsOf(renderSection('analytics', analytics)).filter((item) => item.className === 'label').map((item) => item.text);
  assert.ok(labels.includes('Visitors who viewed a page (30 days)') && labels.includes('Paid confirmations (30 days)'));
});

test('the label checker itself rejects the old code names', () => {
  const bad = ['checkoutsStarted7d', 'humanCheckoutStarts7d', 'visitors 30d', 'Visitors30d'];
  assert.deepEqual(offenders(bad.map((text) => ({ text }))), bad);
  assert.deepEqual(offenders([{ text: 'Checkouts started (7 days)' }, { text: 'Checkout starts seen on the site (30 days)' }]), []);
});
