#!/usr/bin/env node
/**
 * stripe-payment-link-update.js — fix attribution + urgency on the 3
 * customer-facing Payment Links.
 *
 * Background. docs/audits/payment-links-2026-05-18.md verified that 100
 * active Stripe Payment Links exist on the account and most are missing
 * three high-leverage fields:
 *
 *   - no `custom_text` — no urgency, social proof, or refund-window copy
 *     on the buyer's Stripe checkout page
 *   - no `metadata` — paid conversions cannot be attributed back to UTM
 *     source, CTA placement, or campaign
 *   - no `automatic_tax` — international buyers see no VAT/GST and may
 *     bail at the price-with-tax mismatch on completion
 *
 * Unlike business_profile + branding (Stripe blocks own-account writes
 * for those — verified HTTP 403 on 2026-05-18), the Payment Links
 * endpoint `stripe.paymentLinks.update(id, params)` DOES work for
 * own-account links. This is the API-reachable lever.
 *
 * Scope. Targets ONLY the 3 customer-facing links documented in the
 * audit. The other 97 are left alone — they're noise from past
 * iterations and changing them risks breaking embeds we don't know about.
 *
 * Idempotency. Re-running after a successful run is a no-op because
 * every field is read before write. `--dry-run` plans without writing.
 *
 * Run:
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-payment-link-update.js
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-payment-link-update.js --dry-run
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-payment-link-update.js --json
 */

'use strict';

const path = require('node:path');

// Customer-facing Payment Link URL slugs (from public/index.html grep, 2026-05-18).
// Slugs map to plink_* IDs via the Stripe API. The script resolves IDs from URLs.
const TARGETS = [
  {
    urlSlug: '3cI7sLgH25v8dWh5e33sI0o',
    label: 'Sprint Diagnostic',
    expectedPriceUsd: 499,
    customText: 'Two-day diagnostic on one AI-agent workflow. Refund within 7 days if we cannot extract a prevention rule from your failure trace. Sent within 48 hours of payment.',
    metadata: {
      utm_source: 'thumbgate.ai',
      cta_id: 'sprint_diagnostic_499',
      attribution_version: '2026-05-18',
      offer_kind: 'one_time_consulting',
    },
  },
  {
    urlSlug: '8x25kDcqMaPs9G15e33sI0p',
    label: 'Workflow Hardening Sprint',
    expectedPriceUsd: 1500,
    customText: 'Full Workflow Hardening Sprint — diagnostic + applied prevention rules + deployed PreToolUse hooks + rollout review. Two weeks calendar time. Refund within 7 days.',
    metadata: {
      utm_source: 'thumbgate.ai',
      cta_id: 'workflow_sprint_1500',
      attribution_version: '2026-05-18',
      offer_kind: 'one_time_consulting',
    },
  },
  {
    urlSlug: 'bJe14naiE9Lo7xT49Z3sI12',
    label: 'OpenClaw Agent Governance Kit',
    expectedPriceUsd: 97,
    customText: 'Self-serve digital kit — ThumbGate prevention-rule starters, OpenClaw workflow prompts, agent registry checklist, proof report template. Instant download.',
    metadata: {
      utm_source: 'thumbgate.ai',
      cta_id: 'openclaw_governance_kit_97',
      attribution_version: '2026-05-18',
      offer_kind: 'digital_kit',
    },
  },
];

function parseArgs(argv = []) {
  return { dryRun: argv.includes('--dry-run'), json: argv.includes('--json') };
}

function readEnv(name, fallback = '') {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

/**
 * Resolve plink_* ID from a buy.stripe.com slug. Lists active Payment Links
 * and finds the one whose `url` ends with the slug.
 */
async function resolvePlinkId(stripe, urlSlug) {
  let startingAfter;
  for (let page = 0; page < 100; page += 1) {
    const result = await stripe.paymentLinks.list({
      limit: 100,
      active: true,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const link of result.data || []) {
      if (link.url && link.url.endsWith(urlSlug)) return link.id;
    }
    if (!result.has_more || !result.data || result.data.length === 0) break;
    startingAfter = result.data[result.data.length - 1].id;
  }
  return null;
}

function metadataMatches(currentMetadata, desiredMetadata) {
  const current = currentMetadata || {};
  for (const [key, value] of Object.entries(desiredMetadata)) {
    if (String(current[key] || '') !== String(value)) return false;
  }
  return true;
}

function customTextMatches(currentSubmit, desiredText) {
  if (!currentSubmit || !currentSubmit.message) return false;
  return currentSubmit.message === desiredText;
}

async function updateLink({ stripe, target, options }) {
  const plinkId = await resolvePlinkId(stripe, target.urlSlug);
  if (!plinkId) {
    return { target: target.label, error: `could not resolve plink ID for slug ${target.urlSlug}` };
  }

  const link = await stripe.paymentLinks.retrieve(plinkId);
  const actions = [];
  const patch = {};

  if (!customTextMatches(link.custom_text?.submit, target.customText)) {
    patch.custom_text = {
      submit: { message: target.customText },
      ...(link.custom_text || {}),
    };
    patch.custom_text.submit = { message: target.customText };
    actions.push({ field: 'custom_text.submit.message', to: `${target.customText.slice(0, 60)}…` });
  }

  if (!metadataMatches(link.metadata, target.metadata)) {
    patch.metadata = { ...(link.metadata || {}), ...target.metadata };
    actions.push({ field: 'metadata', to: JSON.stringify(target.metadata) });
  }

  if (!(link.automatic_tax && link.automatic_tax.enabled)) {
    patch.automatic_tax = { enabled: true };
    actions.push({ field: 'automatic_tax.enabled', to: 'true' });
  }

  if (actions.length === 0) {
    return { target: target.label, plinkId, changed: false, actions: [] };
  }

  if (options.dryRun) {
    return { target: target.label, plinkId, changed: false, actions, dryRun: true };
  }

  const updated = await stripe.paymentLinks.update(plinkId, patch);
  return { target: target.label, plinkId, changed: true, actions, updatedUrl: updated.url };
}

function renderHuman(results) {
  const lines = [];
  for (const r of results) {
    if (r.error) {
      lines.push(`✗ ${r.target}: ${r.error}`);
      continue;
    }
    if (r.changed === false && (!r.actions || r.actions.length === 0)) {
      lines.push(`✓ ${r.target} (${r.plinkId}): no-op (already matches)`);
      continue;
    }
    const verb = r.dryRun ? 'WOULD update' : 'Updated';
    lines.push(`${verb} ${r.target} (${r.plinkId}):`);
    for (const a of r.actions) lines.push(`  - ${a.field}: ${a.to}`);
  }
  return lines.join('\n');
}

async function applyAll({ stripe, options }) {
  const results = [];
  for (const target of TARGETS) {
    try {
      results.push(await updateLink({ stripe, target, options }));
    } catch (error) {
      results.push({ target: target.label, error: error.message || String(error) });
    }
  }
  return results;
}

async function main(argv) {
  const args = parseArgs(argv);
  const secretKey = readEnv('STRIPE_SECRET_KEY');
  if (!secretKey) {
    process.stderr.write('STRIPE_SECRET_KEY is not set.\n');
    process.exit(1);
  }
  const stripeFactory = require('stripe');
  const stripe = stripeFactory(secretKey);
  try {
    const results = await applyAll({ stripe, options: { dryRun: args.dryRun } });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    } else {
      process.stdout.write(`${renderHuman(results)}\n`);
    }
    if (results.some((r) => r.error)) process.exit(1);
  } catch (error) {
    process.stderr.write(`stripe-payment-link-update FAILED: ${error.message}\n`);
    process.exit(1);
  }
}

if (path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main(process.argv.slice(2));
}

module.exports = { TARGETS, applyAll, resolvePlinkId, updateLink, parseArgs, renderHuman };
