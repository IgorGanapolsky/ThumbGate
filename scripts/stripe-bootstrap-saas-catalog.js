#!/usr/bin/env node
'use strict';

/**
 * stripe-bootstrap-saas-catalog.js — Idempotently create the persistent
 * ThumbGate Pro / Team / Free catalog products + prices in Stripe Live.
 *
 * Why this exists:
 * - Today ThumbGate Checkout Sessions are created with inline `product_data`
 *   in `scripts/billing.js`. That works (and embeds per-tier thumbnails) but
 *   means the Stripe **dashboard** Product Catalog has zero ThumbGate-branded
 *   SaaS products — only legacy consulting SKUs are visible.
 * - Persistent products are required to (a) wire the Stripe Customer Portal
 *   plan-switcher, (b) attach Payment Links to a stable price, and (c) give
 *   the CEO a sane dashboard view of "what we sell."
 *
 * What it does (idempotent):
 *   1. Looks up products by `metadata.thumbgate_tier`. If found, updates name,
 *      description, images, marketing_features in-place.
 *   2. If not found, creates the product.
 *   3. Looks up the active price for each (product, currency, interval, amount).
 *      If a matching price exists, leaves it. Otherwise creates a new price
 *      and marks any previously-bootstrapped price as inactive.
 *
 * Tiers it creates:
 *   - ThumbGate Pro  — $19/mo recurring + $149/yr recurring
 *   - ThumbGate Team — $49/seat/mo recurring (min 3 seats, enforced at checkout)
 *   - ThumbGate Free — $0 one-time placeholder so the catalog reads complete
 *
 * Preconditions:
 *   - STRIPE_SECRET_KEY env var must be set (live key).
 *   - Tier icon PNGs must already return 200 at
 *     https://thumbgate-production.up.railway.app/assets/brand/thumbgate-icon-{pro,team}-512.png
 *     (verified live as of 2026-05-12).
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-bootstrap-saas-catalog.js
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-bootstrap-saas-catalog.js --dry-run
 */

const path = require('node:path');

const PUBLIC_ORIGIN = process.env.THUMBGATE_PUBLIC_APP_ORIGIN
  || 'https://thumbgate-production.up.railway.app';

const DRY_RUN = process.argv.includes('--dry-run');

const TIERS = [
  {
    tier: 'pro',
    name: 'ThumbGate Pro',
    description: 'Local dashboard, DPO export, and Pre-Action Checks that block repeated AI-agent mistakes across Claude Code, Cursor, Codex, Gemini, Amp, Cline, and OpenCode.',
    imageUrl: `${PUBLIC_ORIGIN}/assets/brand/thumbgate-icon-pro-512.png`,
    marketingFeatures: [
      { name: 'Pre-Action Checks block repeated mistakes before tools run' },
      { name: 'Local SQLite + LanceDB lesson DB, no data leaves your machine' },
      { name: 'Adapter for Claude Code, Cursor, Codex, Gemini, Amp, Cline, OpenCode' },
      { name: 'DPO export for offline preference fine-tuning' },
      { name: 'Cancel anytime, 7-day refund window' },
    ],
    prices: [
      { lookupKey: 'thumbgate_pro_monthly', unitAmount: 1900, interval: 'month', nickname: 'Pro — Monthly' },
      { lookupKey: 'thumbgate_pro_annual', unitAmount: 14900, interval: 'year', nickname: 'Pro — Annual (save ~35%)' },
    ],
  },
  {
    tier: 'team',
    name: 'ThumbGate Team',
    description: 'Shared Pre-Action Checks, team governance, and workflow hardening for AI coding agents. $49/seat/month with a 3-seat minimum.',
    imageUrl: `${PUBLIC_ORIGIN}/assets/brand/thumbgate-icon-team-512.png`,
    marketingFeatures: [
      { name: 'Everything in Pro, multiplied across the team' },
      { name: 'Shared lesson DB so one engineer\'s save protects the whole team' },
      { name: 'Org-level policy synthesis and rule rollouts' },
      { name: 'Per-seat billing, $49/seat/month, 3-seat minimum' },
      { name: 'Self-serve Stripe checkout, no sales call needed' },
    ],
    prices: [
      { lookupKey: 'thumbgate_team_per_seat_monthly', unitAmount: 4900, interval: 'month', nickname: 'Team — $49/seat/mo' },
    ],
  },
  {
    tier: 'free',
    name: 'ThumbGate Free',
    description: 'Open-source CLI + local Pre-Action Checks. MIT-licensed. Free forever.',
    imageUrl: `${PUBLIC_ORIGIN}/assets/brand/thumbgate-icon-512.png`,
    marketingFeatures: [
      { name: 'MIT-licensed open-source CLI' },
      { name: 'Local Pre-Action Checks via PreToolUse hook' },
      { name: 'Works with Claude Code out of the box' },
      { name: 'No account required — installs via `npx thumbgate`' },
    ],
    prices: [],
  },
];

const STRIPE_API = 'https://api.stripe.com/v1';

async function stripeRequest(method, route, body, secretKey) {
  const url = `${STRIPE_API}${route}`;
  const headers = {
    Authorization: `Bearer ${secretKey}`,
    'Stripe-Version': '2025-09-30.acacia',
  };
  let payload;
  if (body) {
    payload = encodeForStripe(body);
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const res = await fetch(url, { method, headers, body: payload });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`Stripe ${method} ${route} ${res.status}: ${json && json.error && json.error.message ? json.error.message : text}`);
    err.status = res.status;
    err.detail = json;
    throw err;
  }
  return json;
}

function encodeForStripe(obj, prefix) {
  const pairs = [];
  for (const [key, value] of Object.entries(obj)) {
    const enc = prefix ? `${prefix}[${key}]` : key;
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      value.forEach((item, idx) => {
        if (item !== null && typeof item === 'object') {
          pairs.push(encodeForStripe(item, `${enc}[${idx}]`));
        } else {
          pairs.push(`${encodeURIComponent(`${enc}[${idx}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof value === 'object') {
      pairs.push(encodeForStripe(value, enc));
    } else {
      pairs.push(`${encodeURIComponent(enc)}=${encodeURIComponent(String(value))}`);
    }
  }
  return pairs.join('&');
}

async function findProductByTier(tier, secretKey) {
  let starting_after = null;
  while (true) {
    const qs = starting_after ? `?limit=100&starting_after=${starting_after}` : '?limit=100';
    const page = await stripeRequest('GET', `/products${qs}`, null, secretKey);
    for (const p of page.data || []) {
      if (p.metadata && p.metadata.thumbgate_tier === tier) return p;
    }
    if (!page.has_more) return null;
    starting_after = page.data[page.data.length - 1].id;
  }
}

async function findPriceByLookupKey(lookupKey, secretKey) {
  const res = await stripeRequest('GET', `/prices?lookup_keys[0]=${encodeURIComponent(lookupKey)}&limit=1&active=true`, null, secretKey);
  return (res.data && res.data[0]) || null;
}

async function upsertTier(tierSpec, secretKey) {
  console.log(`\n=== ${tierSpec.name} (tier=${tierSpec.tier}) ===`);

  let product = await findProductByTier(tierSpec.tier, secretKey);

  const productPayload = {
    name: tierSpec.name,
    description: tierSpec.description,
    images: [tierSpec.imageUrl],
    metadata: { thumbgate_tier: tierSpec.tier, managed_by: 'stripe-bootstrap-saas-catalog' },
    marketing_features: tierSpec.marketingFeatures,
    statement_descriptor: tierSpec.tier === 'free' ? undefined : 'THUMBGATE',
    tax_code: 'txcd_10000000', // SaaS — software as a service
  };

  if (product) {
    console.log(`  found existing product ${product.id}, updating…`);
    if (DRY_RUN) {
      console.log('  [dry-run] would PATCH /products/' + product.id);
    } else {
      product = await stripeRequest('POST', `/products/${product.id}`, productPayload, secretKey);
    }
  } else {
    console.log('  creating new product…');
    if (DRY_RUN) {
      console.log('  [dry-run] would POST /products with payload:', JSON.stringify(productPayload, null, 2));
      product = { id: `prod_DRYRUN_${tierSpec.tier}`, metadata: productPayload.metadata };
    } else {
      product = await stripeRequest('POST', '/products', productPayload, secretKey);
    }
  }
  console.log(`  product: ${product.id}`);

  for (const priceSpec of tierSpec.prices) {
    const existing = await findPriceByLookupKey(priceSpec.lookupKey, secretKey);
    if (existing
      && existing.product === product.id
      && existing.unit_amount === priceSpec.unitAmount
      && existing.recurring
      && existing.recurring.interval === priceSpec.interval) {
      console.log(`  price ${priceSpec.lookupKey} already matches (${existing.id}), skipping`);
      continue;
    }
    if (existing) {
      console.log(`  price ${priceSpec.lookupKey} drifted (existing=${existing.id}), deactivating + recreating`);
      if (!DRY_RUN) {
        await stripeRequest('POST', `/prices/${existing.id}`, { active: false, lookup_key: `${priceSpec.lookupKey}_archived_${Date.now()}` }, secretKey);
      }
    }
    const pricePayload = {
      product: product.id,
      currency: 'usd',
      unit_amount: priceSpec.unitAmount,
      recurring: { interval: priceSpec.interval },
      lookup_key: priceSpec.lookupKey,
      nickname: priceSpec.nickname,
      transfer_lookup_key: true,
      metadata: { thumbgate_tier: tierSpec.tier, managed_by: 'stripe-bootstrap-saas-catalog' },
    };
    if (DRY_RUN) {
      console.log(`  [dry-run] would POST /prices for ${priceSpec.lookupKey}:`, JSON.stringify(pricePayload, null, 2));
    } else {
      const created = await stripeRequest('POST', '/prices', pricePayload, secretKey);
      console.log(`  created price ${created.id} for ${priceSpec.lookupKey} (${created.unit_amount}c/${created.recurring && created.recurring.interval})`);
    }
  }
  return product;
}

async function main() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    console.error('STRIPE_SECRET_KEY env var is required.');
    process.exitCode = 1;
    return;
  }
  if (!secretKey.startsWith('sk_live_') && !secretKey.startsWith('sk_test_')) {
    console.error('STRIPE_SECRET_KEY does not look like a Stripe secret key.');
    process.exitCode = 1;
    return;
  }
  console.log(`stripe-bootstrap-saas-catalog: mode=${DRY_RUN ? 'DRY RUN' : 'WRITE'} key=${secretKey.slice(0, 8)}…`);
  for (const tier of TIERS) {
    try {
      await upsertTier(tier, secretKey);
    } catch (err) {
      console.error(`  FAILED ${tier.tier}: ${err.message}`);
      if (err.detail) console.error('  detail:', JSON.stringify(err.detail, null, 2));
      process.exitCode = 1;
    }
  }
  console.log('\nBootstrap complete.');
}

const isMain = path.resolve(process.argv[1] || '') === path.resolve(__filename);
if (isMain) {
  main().catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
  });
}

module.exports = { TIERS, encodeForStripe, upsertTier };
