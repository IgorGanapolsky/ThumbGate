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

// Build the update plan from a `products.list` async iterator. Pure async
// function so tests can inject a fake iterator without mocking the full
// Stripe SDK.
async function buildUpdatePlan(productsIterator) {
  const plan = [];
  for await (const product of productsIterator) {
    const match = classifyProduct(product);
    if (!match) continue;
    const current = Array.isArray(product.images) ? product.images : [];
    const target = [match.imageUrl];
    const needsUpdate = current.length !== 1 || current[0] !== match.imageUrl;
    plan.push({ productId: product.id, name: product.name, tier: match.tier, current, target, needsUpdate });
  }
  return plan;
}

function loadStripeModule(loader = require) {
  try {
    // eslint-disable-next-line global-require
    return loader('stripe');
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND') return null;
    throw err;
  }
}

async function run({ dryRun, stripeFactory, logger = console } = {}) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    logger.error('STRIPE_SECRET_KEY is not set. Aborting.');
    process.exitCode = 2;
    return;
  }

  // Lazy-load so `node --check` and linters don't require stripe to be installed
  // just to parse this file. Tests can inject `stripeFactory` to mock it;
  // passing `null` explicitly disables the loader to exercise the missing-SDK branch.
  const factory = stripeFactory !== undefined ? stripeFactory : loadStripeModule();
  if (!factory) {
    logger.error('stripe package not installed. Run `npm install stripe` first.');
    process.exitCode = 2;
    return;
  }

  const stripe = factory(secret, { apiVersion: '2024-06-20' });

  const plan = await buildUpdatePlan(stripe.products.list({ active: true, limit: 100 }));
  const updates = plan.filter((entry) => entry.needsUpdate);
  const skipped = plan.filter((entry) => !entry.needsUpdate);

  logger.log(`Found ${plan.length} matching products (${updates.length} need update, ${skipped.length} already correct).`);
  for (const entry of plan) {
    const verb = entry.needsUpdate ? 'UPDATE' : 'SKIP  ';
    logger.log(`  ${verb} ${entry.productId}  ${entry.name}  →  ${entry.tier}`);
  }

  if (dryRun) {
    logger.log('\nDry run — no Stripe writes issued.');
    return { plan, updatedIds: [] };
  }

  const updatedIds = [];
  for (const entry of updates) {
    await stripe.products.update(entry.productId, { images: entry.target });
    logger.log(`  ✓ patched ${entry.productId}`);
    updatedIds.push(entry.productId);
  }

  logger.log(`\nDone. ${updates.length} product(s) updated.`);
  return { plan, updatedIds };
}

function main({ argv = process.argv, logger = console, runner = run } = {}) {
  const dryRun = argv.includes('--dry-run');
  return runner({ dryRun, logger }).catch((err) => {
    logger.error('Failed:', err.message || err);
    process.exitCode = 1;
  });
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  main();
}

module.exports = { run, classifyProduct, TIER_IMAGE_MAP, buildUpdatePlan, loadStripeModule, main };
