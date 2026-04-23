#!/usr/bin/env node
'use strict';

/**
 * stripe-sync-product-images.js — Push tier-specific product images to existing
 * Stripe products.
 *
 * Why this exists:
 * - New Checkout Sessions create inline `product_data` from scripts/billing.js,
 *   which already ships per-tier icons.
 * - But the Stripe *dashboard* Product catalog (and any hard-coded price_id
 *   products attached to recurring subscriptions) keeps whatever `images` were
 *   set at product creation time. Every tier currently renders the base
 *   thumbgate-icon-512.png there, which is why Team and Pro look identical in
 *   the dashboard.
 *
 * What it does:
 * - Lists active products, matches by `name` prefix (`ThumbGate Pro`,
 *   `ThumbGate Team`, `ThumbGate Free`, `ThumbGate Team — Org-wide AI agent
 *   immunity`, etc.).
 * - Patches each product's `images` array to point at the tier-appropriate
 *   URL on the production public shell.
 * - Idempotent: if the correct URL is already set, it skips the update.
 *
 * Preconditions:
 * - STRIPE_SECRET_KEY env var must be set.
 * - The tier icon PNGs must already be live at
 *   https://thumbgate-production.up.railway.app/assets/brand/thumbgate-icon-{pro,team}-512.png
 *   (run this AFTER the deploy-verification gate has confirmed they return 200).
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-sync-product-images.js
 *   # Dry run (no Stripe writes, just print the plan):
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-sync-product-images.js --dry-run
 */

const path = require('node:path');

const PUBLIC_ORIGIN = process.env.THUMBGATE_PUBLIC_APP_ORIGIN
  || 'https://thumbgate-production.up.railway.app';

const TIER_IMAGE_MAP = [
  { match: /^ThumbGate Team\b/i, imageUrl: `${PUBLIC_ORIGIN}/assets/brand/thumbgate-icon-team-512.png`, tier: 'team' },
  { match: /^ThumbGate Pro\b/i, imageUrl: `${PUBLIC_ORIGIN}/assets/brand/thumbgate-icon-pro-512.png`, tier: 'pro' },
  { match: /^ThumbGate Free\b/i, imageUrl: `${PUBLIC_ORIGIN}/assets/brand/thumbgate-icon-512.png`, tier: 'free' },
];

function classifyProduct(product) {
  for (const entry of TIER_IMAGE_MAP) {
    if (entry.match.test(product.name || '')) return entry;
  }
  return null;
}

async function run({ dryRun }) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    console.error('STRIPE_SECRET_KEY is not set. Aborting.');
    process.exitCode = 2;
    return;
  }

  // Lazy-load so `node --check` and linters don't require stripe to be installed
  // just to parse this file.
  let StripeCtor;
  try {
    // eslint-disable-next-line global-require
    StripeCtor = require('stripe');
  } catch (err) {
    console.error('stripe package not installed. Run `npm install stripe` first.');
    process.exitCode = 2;
    return;
  }

  const stripe = StripeCtor(secret, { apiVersion: '2024-06-20' });

  const plan = [];
  for await (const product of stripe.products.list({ active: true, limit: 100 })) {
    const match = classifyProduct(product);
    if (!match) continue;
    const current = Array.isArray(product.images) ? product.images : [];
    const target = [match.imageUrl];
    const needsUpdate = current.length !== 1 || current[0] !== match.imageUrl;
    plan.push({ productId: product.id, name: product.name, tier: match.tier, current, target, needsUpdate });
  }

  const updates = plan.filter((entry) => entry.needsUpdate);
  const skipped = plan.filter((entry) => !entry.needsUpdate);

  console.log(`Found ${plan.length} matching products (${updates.length} need update, ${skipped.length} already correct).`);
  for (const entry of plan) {
    const verb = entry.needsUpdate ? 'UPDATE' : 'SKIP  ';
    console.log(`  ${verb} ${entry.productId}  ${entry.name}  →  ${entry.tier}`);
  }

  if (dryRun) {
    console.log('\nDry run — no Stripe writes issued.');
    return;
  }

  for (const entry of updates) {
    await stripe.products.update(entry.productId, { images: entry.target });
    console.log(`  ✓ patched ${entry.productId}`);
  }

  console.log(`\nDone. ${updates.length} product(s) updated.`);
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  const dryRun = process.argv.includes('--dry-run');
  run({ dryRun }).catch((err) => {
    console.error('Failed:', err.message || err);
    process.exitCode = 1;
  });
}

module.exports = { run, classifyProduct, TIER_IMAGE_MAP };
