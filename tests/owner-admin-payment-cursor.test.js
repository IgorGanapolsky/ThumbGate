'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const admin = require('../scripts/owner-admin');

test('payments accept both provider charge cursor prefixes and preserve resource isolation', () => {
  for (const cursor of ['ch_fixture123', 'py_fixture123']) {
    const route = admin.parseAdminRoute('/v1/admin/stripe/payments', new URLSearchParams({ starting_after: cursor }));
    assert.equal(route.cursor, cursor);
  }
  for (const cursor of ['pi_wrong123', 'cus_wrong123', 'py_', 'py_abc/def', 'py_abc.def', 'py_' + 'a'.repeat(121)]) {
    assert.throws(() => admin.parseAdminRoute('/v1/admin/stripe/payments', new URLSearchParams({ starting_after: cursor })), { code: 'invalid_query' });
  }
  for (const resource of ['customers', 'subscriptions', 'refunds', 'products', 'prices']) {
    assert.throws(() => admin.parseAdminRoute('/v1/admin/stripe/' + resource, new URLSearchParams({ starting_after: 'py_fixture123' })), { code: 'invalid_query' });
  }
});

test('a returned py payment cursor can be parsed and forwarded unchanged to the second provider page', async () => {
  const calls = [];
  const stripe = { charges: { list: async (params) => {
    calls.push(params);
    return params.starting_after
      ? { data: [{ id: 'py_second', status: 'succeeded', paid: true, amount: 100, currency: 'usd' }], has_more: false }
      : { data: [{ id: 'py_first', status: 'succeeded', paid: true, amount: 200, currency: 'usd' }], has_more: true };
  } } };
  const deps = { getStripeClient: () => stripe };
  const firstRoute = admin.parseAdminRoute('/v1/admin/stripe/payments', new URLSearchParams('limit=1'));
  const first = await admin.collectAdminSection(firstRoute, deps);
  assert.equal(first.data.nextCursor, 'py_first');
  const nextRoute = admin.parseAdminRoute('/v1/admin/stripe/payments', new URLSearchParams({ limit: '1', starting_after: first.data.nextCursor }));
  const second = await admin.collectAdminSection(nextRoute, deps);
  assert.equal(calls[1].starting_after, 'py_first');
  assert.equal(second.data.records[0].id, 'py_second');
  assert.equal(second.data.nextCursor, null);
  assert.equal(second.data.hasMore, false);
});
