'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'stripe-revenue.js');
const {
  parseArgs,
  paginate,
  summarizeRevenue,
  isDirectRun,
} = require('../scripts/stripe-revenue');

test('stripe revenue key validation never logs provided key material', () => {
  const invalidKey = 'invalid_secret_key_prefix_1234567890';
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    env: {
      ...process.env,
      STRIPE_READ_KEY: invalidKey,
      STRIPE_SECRET_KEY: '',
      STRIPE_API_KEY: '',
    },
    encoding: 'utf8',
  });

  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 2);
  assert.match(output, /Stripe key format is invalid/);
  assert.doesNotMatch(output, /invalid_secret_key_prefix/);
  assert.doesNotMatch(output, /1234567890/);
});

test('parseArgs reads JSON mode and day windows', () => {
  assert.deepEqual(parseArgs(['node', SCRIPT, '--json', '--days=30']), {
    days: 30,
    json: true,
  });
});

test('isDirectRun only accepts the Stripe revenue CLI path', () => {
  assert.equal(isDirectRun(SCRIPT), true);
  assert.equal(isDirectRun(__filename), false);
});

test('paginate follows Stripe cursors without leaking auth details', async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options) => {
    calls.push({ url: String(url), authorization: options.headers.authorization });
    const parsed = new URL(url);
    const startingAfter = parsed.searchParams.get('starting_after');
    const id = startingAfter ? 'ch_second' : 'ch_first';
    return {
      ok: true,
      json: async () => ({
        data: [{ id }],
        has_more: !startingAfter,
      }),
    };
  };

  try {
    const charges = await paginate('/charges', { status: 'succeeded' }, 'rk_test_123');
    assert.deepEqual(charges.map((charge) => charge.id), ['ch_first', 'ch_second']);
    assert.equal(calls[0].authorization, 'Bearer rk_test_123');
    assert.match(calls[0].url, /status=succeeded/);
    assert.match(calls[1].url, /starting_after=ch_first/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('summarizeRevenue reports gross, net, balances, and subscription MRR', () => {
  const summary = summarizeRevenue({
    args: { days: 30, json: true },
    key: 'rk_live_123',
    balance: {
      available: [{ currency: 'usd', amount: 12345 }],
      pending: [{ currency: 'usd', amount: 678 }],
    },
    charges: [
      { id: 'ch_1', status: 'succeeded', amount: 5000, amount_refunded: 0, refunded: false, currency: 'usd', created: 1_700_000_000 },
      { id: 'ch_2', status: 'succeeded', amount: 2500, amount_refunded: 500, refunded: true, currency: 'usd', created: 1_700_100_000 },
      { id: 'ch_3', status: 'failed', amount: 9900, amount_refunded: 0, refunded: false, currency: 'usd', created: 1_700_200_000 },
    ],
    subs: [
      { status: 'active', items: { data: [{ price: { unit_amount: 2900, recurring: { interval: 'month' } } }] } },
      { status: 'trialing', items: { data: [{ price: { unit_amount: 12000, recurring: { interval: 'year' } } }] } },
      { status: 'canceled', items: { data: [{ price: { unit_amount: 9999, recurring: { interval: 'month' } } }] } },
    ],
  });

  assert.equal(summary.mode, 'live');
  assert.equal(summary.window, 'last 30 days');
  assert.equal(summary.charges.total, 3);
  assert.equal(summary.charges.succeeded, 2);
  assert.equal(summary.charges.refunded, 1);
  assert.equal(summary.charges.grossUsd, '75.00');
  assert.equal(summary.charges.refundedUsd, '5.00');
  assert.equal(summary.charges.netUsd, '70.00');
  assert.deepEqual(summary.charges.currencies, ['usd']);
  assert.equal(summary.subscriptions.total, 3);
  assert.equal(summary.subscriptions.active, 2);
  assert.equal(summary.subscriptions.mrrUsd, '39.00');
  assert.equal(summary.subscriptions.arrUsd, '468.00');
  assert.equal(summary.balance.availableUsd, 123.45);
  assert.equal(summary.balance.pendingUsd, 6.78);
  assert.equal(summary.firstChargeAt, '2023-11-14T22:13:20.000Z');
  assert.equal(summary.lastChargeAt, '2023-11-16T02:00:00.000Z');
});
