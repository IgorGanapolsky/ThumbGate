#!/usr/bin/env node
'use strict';

/**
 * stripe-revenue.js — Ground-truth live revenue query against Stripe API.
 *
 * Bypasses the hosted operational summary entirely. Reads from whichever of
 * these env vars is set, in priority order:
 *   STRIPE_READ_KEY       (preferred: restricted read-only key)
 *   STRIPE_SECRET_KEY     (full secret — works but overprivileged)
 *   STRIPE_API_KEY        (legacy name)
 *
 * The Stripe CLI's stored `rk_live_*` in ~/.config/stripe/config.toml is a
 * display placeholder only — the real key is in the macOS Keychain and
 * disappears when the CLI session expires. That's why `stripe charges list
 * --live` intermittently returns "not configured." Using an env-sourced
 * restricted key avoids that entire class of failure.
 *
 * To mint a read-only key:
 *   1. https://dashboard.stripe.com/apikeys/create
 *   2. Type: Restricted key.
 *   3. Permissions (read): Balance, Charges, Customers, Events, Subscriptions.
 *      Everything else: None.
 *   4. Name it "thumbgate-cfo-read". Save. Copy the rk_live_*.
 *   5. Export locally: export STRIPE_READ_KEY=rk_live_...
 *   6. Run: node scripts/stripe-revenue.js
 *
 * Usage:
 *   node scripts/stripe-revenue.js             # lifetime summary
 *   node scripts/stripe-revenue.js --days=30   # last 30 days
 *   node scripts/stripe-revenue.js --json      # machine-readable
 */

const STRIPE_API = 'https://api.stripe.com/v1';

function resolveKey() {
  return (
    process.env.STRIPE_READ_KEY
    || process.env.STRIPE_SECRET_KEY
    || process.env.STRIPE_API_KEY
    || ''
  ).trim();
}

function parseArgs(argv) {
  const out = { days: null, json: false };
  for (const raw of argv.slice(2)) {
    if (raw === '--json') out.json = true;
    else if (raw.startsWith('--days=')) out.days = Number(raw.slice(7));
  }
  return out;
}

async function stripeGet(path, params, key) {
  const url = new URL(`${STRIPE_API}${path}`);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${key}`,
      accept: 'application/json',
      'stripe-version': '2024-12-18.acacia',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Stripe ${path} ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function paginate(path, params, key, maxPages = 50) {
  const out = [];
  let starting_after;
  for (let i = 0; i < maxPages; i++) {
    const page = await stripeGet(path, { ...params, limit: 100, starting_after }, key);
    out.push(...(page.data || []));
    if (!page.has_more || page.data.length === 0) break;
    starting_after = page.data[page.data.length - 1].id;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const key = resolveKey();
  if (!key) {
    console.error('No Stripe key in env. Set STRIPE_READ_KEY or STRIPE_SECRET_KEY.');
    console.error('See header comment in this file for the minting steps.');
    process.exit(2);
  }
  if (!/^(sk|rk)_(live|test)_/.test(key)) {
    console.error('Stripe key format is invalid. Set STRIPE_READ_KEY or STRIPE_SECRET_KEY to a sk_*/rk_* key.');
    process.exit(2);
  }

  const sinceTs = args.days ? Math.floor((Date.now() - args.days * 86_400_000) / 1000) : null;

  const [balance, charges, subs] = await Promise.all([
    stripeGet('/balance', {}, key),
    paginate('/charges', sinceTs ? { 'created[gte]': sinceTs } : {}, key),
    paginate('/subscriptions', { status: 'all' }, key, 10),
  ]);

  const summary = summarizeRevenue({
    args,
    key,
    balance,
    charges,
    subs,
  });

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  printSummary(summary);
}

function summarizeRevenue({ args, key, balance, charges, subs }) {
  const mode = key.includes('_live_') ? 'live' : 'test';
  const succeeded = charges.filter((c) => c.status === 'succeeded');
  const refunded = charges.filter((c) => c.refunded);
  const totalCents = succeeded.reduce((a, c) => a + (c.amount || 0), 0);
  const refundedCents = refunded.reduce((a, c) => a + (c.amount_refunded || 0), 0);
  const netCents = totalCents - refundedCents;
  const currencies = new Set(succeeded.map((c) => c.currency));
  const activeSubs = subs.filter((s) => ['active', 'trialing'].includes(s.status));
  const mrrCents = activeSubs.reduce((a, s) => {
    const item = s.items?.data?.[0];
    if (!item?.price) return a;
    const interval = item.price.recurring?.interval;
    const amount = item.price.unit_amount || 0;
    if (interval === 'month') return a + amount;
    if (interval === 'year') return a + Math.round(amount / 12);
    return a;
  }, 0);

  return {
    mode,
    window: args.days ? `last ${args.days} days` : 'lifetime',
    charges: {
      total: charges.length,
      succeeded: succeeded.length,
      refunded: refunded.length,
      grossUsd: (totalCents / 100).toFixed(2),
      refundedUsd: (refundedCents / 100).toFixed(2),
      netUsd: (netCents / 100).toFixed(2),
      currencies: [...currencies],
    },
    subscriptions: {
      total: subs.length,
      active: activeSubs.length,
      mrrUsd: (mrrCents / 100).toFixed(2),
      arrUsd: ((mrrCents * 12) / 100).toFixed(2),
    },
    balance: {
      availableUsd: (
        (balance.available || []).find((b) => b.currency === 'usd')?.amount || 0
      ) / 100,
      pendingUsd: (
        (balance.pending || []).find((b) => b.currency === 'usd')?.amount || 0
      ) / 100,
    },
    firstChargeAt: succeeded.length
      ? new Date(Math.min(...succeeded.map((c) => c.created)) * 1000).toISOString()
      : null,
    lastChargeAt: succeeded.length
      ? new Date(Math.max(...succeeded.map((c) => c.created)) * 1000).toISOString()
      : null,
  };
}

function printSummary(summary) {
  const flag = summary.mode === 'live' ? '🔴 LIVE' : '🟡 TEST';
  console.log(`\n${flag}  Stripe revenue summary (${summary.window})`);
  console.log('─'.repeat(60));
  console.log(`  Charges        : ${summary.charges.succeeded} succeeded / ${summary.charges.total} total`);
  console.log(`  Gross          : $${summary.charges.grossUsd}`);
  console.log(`  Refunded       : $${summary.charges.refundedUsd}`);
  console.log(`  Net            : $${summary.charges.netUsd}`);
  console.log(`  Active subs    : ${summary.subscriptions.active} / ${summary.subscriptions.total}`);
  console.log(`  MRR            : $${summary.subscriptions.mrrUsd}`);
  console.log(`  ARR            : $${summary.subscriptions.arrUsd}`);
  console.log(`  Available      : $${summary.balance.availableUsd.toFixed(2)}`);
  console.log(`  Pending        : $${summary.balance.pendingUsd.toFixed(2)}`);
  console.log(`  First charge   : ${summary.firstChargeAt || '(none)'}`);
  console.log(`  Last charge    : ${summary.lastChargeAt || '(none)'}`);
  console.log('');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`stripe-revenue error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  STRIPE_API,
  resolveKey,
  parseArgs,
  stripeGet,
  paginate,
  summarizeRevenue,
  printSummary,
  main,
};
