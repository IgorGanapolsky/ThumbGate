'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseOwnerEmails,
  isOwnerEmail,
  runAudit,
  renderMarkdown,
} = require('../scripts/external-customer-audit');

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

// runAudit with an injected fake Stripe client ----------------------------

function fakePage(rows) {
  return { data: rows, has_more: false };
}

function fakeStripe({ charges = [], subscriptions = [], sessions = [] } = {}) {
  return {
    charges: { list: async () => fakePage(charges) },
    subscriptions: { list: async () => fakePage(subscriptions) },
    checkout: { sessions: { list: async () => fakePage(sessions) } },
  };
}

test('runAudit returns a gap object when STRIPE_SECRET_KEY is missing', async () => {
  const report = await runAudit({ secretKey: '', ownerEmails: ['owner@x.com'] });
  assert.equal(report.configured, false);
  assert.match(report.gap, /STRIPE_SECRET_KEY/);
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

test('runAudit excludes refunded charges from the paid-charges set', async () => {
  const stripeClient = fakeStripe({
    charges: [
      { id: 'ch_x', status: 'succeeded', refunded: true, amount: 1900, amount_refunded: 1900, customer: { email: 'r@x.com' } },
      { id: 'ch_y', status: 'failed', refunded: false, amount: 1900, amount_refunded: 0, customer: { email: 'r2@x.com' } },
      { id: 'ch_ok', status: 'succeeded', refunded: false, amount: 1900, amount_refunded: 0, customer: { email: 'r3@x.com' } },
    ],
  });
  const report = await runAudit({ stripeClient, ownerEmails: [] });
  // Only ch_ok survives the status=succeeded && !refunded filter
  assert.equal(report.charges.all.chargeCount, 1);
  assert.equal(report.charges.all.uniqueCustomerCount, 1);
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
});

test('renderMarkdown highlights the headline "real customers" line', async () => {
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
  assert.match(md, /Real, non-owner paying customers lifetime: 0/);
  assert.match(md, /Real, non-owner net revenue lifetime: \$0\.00/);
  assert.match(md, /Real, non-owner active subscriptions: 0/);
});

test('renderMarkdown describes the unconfigured Stripe path without crashing', () => {
  const md = renderMarkdown({ configured: false, gap: 'STRIPE_SECRET_KEY is not set', ownerEmails: [] });
  assert.match(md, /NOT CONFIGURED.*STRIPE_SECRET_KEY/);
});
