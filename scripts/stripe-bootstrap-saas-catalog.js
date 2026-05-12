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
  // One-off SKUs currently sold via hardcoded buy.stripe.com Payment Links in
  // src/api/server.js. Recreating these as persistent products + one-time
  // prices lets thumbgate.ai swap to env-driven Payment Link URLs once the
  // workflow has captured the new URLs.
  {
    tier: 'first_failure_rule',
    name: 'ThumbGate — First Failure Rule',
    description: 'One prevention rule shipped to your repo within 24 hours. Buy the proof that a single rule blocks a class of repeated AI-agent mistakes.',
    imageUrl: `${PUBLIC_ORIGIN}/assets/brand/thumbgate-icon-512.png`,
    marketingFeatures: [
      { name: 'One prevention rule shipped within 24h' },
      { name: 'PR opened against your repo with the rule + test' },
      { name: 'Refund if we cannot extract a rule from your trace' },
    ],
    prices: [
      { lookupKey: 'thumbgate_first_failure_rule', unitAmount: 100, interval: null, nickname: 'First Failure Rule — $1 one-time' },
    ],
  },
  {
    tier: 'quick_read',
    name: 'ThumbGate — Quick Read',
    description: '20-minute written teardown of one repeated AI-agent failure pattern in your repo + a recommended Pre-Action Check.',
    imageUrl: `${PUBLIC_ORIGIN}/assets/brand/thumbgate-icon-512.png`,
    marketingFeatures: [
      { name: '20-minute written teardown of one failure pattern' },
      { name: 'Recommended Pre-Action Check + lesson DB entry' },
      { name: 'Delivered in 48 hours' },
    ],
    prices: [
      { lookupKey: 'thumbgate_quick_read', unitAmount: 1900, interval: null, nickname: 'Quick Read — $19 one-time' },
    ],
  },
  {
    tier: 'workflow_teardown',
    name: 'ThumbGate — Workflow Teardown',
    description: 'Deep teardown of one AI-agent workflow: root-cause analysis, prevention rules, and an installable Pre-Action Check pack.',
    imageUrl: `${PUBLIC_ORIGIN}/assets/brand/thumbgate-icon-512.png`,
    marketingFeatures: [
      { name: 'Full workflow teardown with root-cause analysis' },
      { name: 'Pre-Action Check pack delivered as a PR' },
      { name: 'One async follow-up call to walk through findings' },
    ],
    prices: [
      { lookupKey: 'thumbgate_workflow_teardown', unitAmount: 9900, interval: null, nickname: 'Workflow Teardown — $99 one-time' },
    ],
  },
  {
    tier: 'sprint_diagnostic',
    name: 'ThumbGate — Sprint Diagnostic',
    description: 'Two-day diagnostic on your AI-agent workflow: failure-trace analysis, top-5 prevention rules, and a Pre-Action Check pack scoped to your stack.',
    imageUrl: `${PUBLIC_ORIGIN}/assets/brand/thumbgate-icon-pro-512.png`,
    marketingFeatures: [
      { name: 'Two-day diagnostic on your AI-agent workflow' },
      { name: 'Top-5 prevention rules ranked by impact' },
      { name: 'Scoped Pre-Action Check pack delivered as a PR' },
      { name: '60-minute findings review call' },
    ],
    prices: [
      { lookupKey: 'thumbgate_sprint_diagnostic', unitAmount: 49900, interval: null, nickname: 'Sprint Diagnostic — $499 one-time' },
    ],
  },
  {
    tier: 'workflow_sprint',
    name: 'ThumbGate — Workflow Sprint',
    description: 'Full-week workflow hardening sprint: end-to-end teardown, prevention-rule synthesis, Pre-Action Check rollout, and a paired engineering session.',
    imageUrl: `${PUBLIC_ORIGIN}/assets/brand/thumbgate-icon-team-512.png`,
    marketingFeatures: [
      { name: 'Full-week workflow hardening sprint' },
      { name: 'End-to-end teardown + prevention-rule synthesis' },
      { name: 'Pre-Action Check rollout against your repo' },
      { name: 'Paired engineering session with the founder' },
      { name: '30-day async follow-up window' },
    ],
    prices: [
      { lookupKey: 'thumbgate_workflow_sprint', unitAmount: 150000, interval: null, nickname: 'Workflow Sprint — $1,500 one-time' },
    ],
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

// Walks Payment Links to find one whose metadata tags it as managed by this
// bootstrap for a given lookup_key. Required because Stripe doesn't index
// Payment Links by an arbitrary key.
async function findPaymentLinkByLookupKey(lookupKey, secretKey) {
  let starting_after = null;
  while (true) {
    const qs = starting_after ? `?limit=100&starting_after=${starting_after}&active=true` : '?limit=100&active=true';
    const page = await stripeRequest('GET', `/payment_links${qs}`, null, secretKey);
    for (const link of page.data || []) {
      if (link.metadata && link.metadata.thumbgate_lookup_key === lookupKey) return link;
    }
    if (!page.has_more) return null;
    starting_after = page.data[page.data.length - 1].id;
  }
}

async function ensurePaymentLinkForPrice({ lookupKey, priceId, tier, secretKey }) {
  if (!priceId) return null;
  const existing = await findPaymentLinkByLookupKey(lookupKey, secretKey);
  if (existing && existing.active) {
    console.log(`  payment link for ${lookupKey} already exists: ${existing.url}`);
    return existing;
  }
  const payload = {
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
    metadata: {
      thumbgate_tier: tier,
      thumbgate_lookup_key: lookupKey,
      managed_by: 'stripe-bootstrap-saas-catalog',
    },
    after_completion: { type: 'redirect', redirect: { url: `${PUBLIC_ORIGIN}/thanks?lk=${encodeURIComponent(lookupKey)}` } },
  };
  if (DRY_RUN) {
    console.log(`  [dry-run] would POST /payment_links for ${lookupKey}:`, JSON.stringify(payload, null, 2));
    return { url: `https://buy.stripe.com/DRYRUN_${lookupKey}`, id: `plink_dryrun_${lookupKey}` };
  }
  const created = await stripeRequest('POST', '/payment_links', payload, secretKey);
  console.log(`  created payment link ${created.id} for ${lookupKey}: ${created.url}`);
  return created;
}

// Only one-off SKUs get Payment Links auto-generated. SaaS subscriptions are
// driven by inline Checkout Sessions in src/api/server.js, so a stable
// Payment Link for them would never be referenced.
const PAYMENT_LINK_TIERS = new Set([
  'first_failure_rule', 'quick_read', 'workflow_teardown',
  'sprint_diagnostic', 'workflow_sprint',
]);

async function upsertTier(tierSpec, secretKey, summary) {
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
    const isRecurring = Boolean(priceSpec.interval);
    const existingInterval = (existing && existing.recurring && existing.recurring.interval) || null;
    const matches = existing
      && existing.product === product.id
      && existing.unit_amount === priceSpec.unitAmount
      && existingInterval === priceSpec.interval;
    if (matches) {
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
      lookup_key: priceSpec.lookupKey,
      nickname: priceSpec.nickname,
      transfer_lookup_key: true,
      metadata: { thumbgate_tier: tierSpec.tier, managed_by: 'stripe-bootstrap-saas-catalog' },
    };
    if (isRecurring) {
      pricePayload.recurring = { interval: priceSpec.interval };
    }
    let createdPriceId = null;
    if (DRY_RUN) {
      console.log(`  [dry-run] would POST /prices for ${priceSpec.lookupKey}:`, JSON.stringify(pricePayload, null, 2));
      createdPriceId = `price_dryrun_${priceSpec.lookupKey}`;
    } else {
      const created = await stripeRequest('POST', '/prices', pricePayload, secretKey);
      const intervalLabel = created.recurring && created.recurring.interval ? created.recurring.interval : 'one_time';
      console.log(`  created price ${created.id} for ${priceSpec.lookupKey} (${created.unit_amount}c/${intervalLabel})`);
      createdPriceId = created.id;
    }
    if (PAYMENT_LINK_TIERS.has(tierSpec.tier)) {
      const priceIdForLink = createdPriceId || (existing && existing.id);
      const link = await ensurePaymentLinkForPrice({
        lookupKey: priceSpec.lookupKey,
        priceId: priceIdForLink,
        tier: tierSpec.tier,
        secretKey,
      });
      if (summary && link && link.url) {
        summary.paymentLinks[priceSpec.lookupKey] = link.url;
      }
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
  // Keep the no-prefix log line — the self-heal auto-fix on this branch
  // (commit 3b2b47ad) flagged slicing 8 chars of an sk_live_* as a partial
  // secret leak in logs.
  console.log(`stripe-bootstrap-saas-catalog: mode=${DRY_RUN ? 'DRY RUN' : 'WRITE'} key=configured`);
  const summary = { paymentLinks: {} };
  for (const tier of TIERS) {
    try {
      await upsertTier(tier, secretKey, summary);
    } catch (err) {
      console.error(`  FAILED ${tier.tier}: ${err.message}`);
      if (err.detail) console.error('  detail:', JSON.stringify(err.detail, null, 2));
      process.exitCode = 1;
    }
  }
  console.log('\n=== Payment Link summary (use these to update src/api/server.js constants) ===');
  for (const [key, url] of Object.entries(summary.paymentLinks)) {
    console.log(`  ${key}: ${url}`);
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
