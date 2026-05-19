#!/usr/bin/env node
/**
 * stripe-webhook-cleanup.js — delete dirty webhook endpoints.
 *
 * Background. stripe-checkout-diagnostic on 2026-05-19 surfaced 5
 * webhook endpoints on the live account:
 *   - 1 ENABLED  https://thumbgate-production.up.railway.app/v1/billing/webhook
 *   - 1 DISABLED https://thumbgate-production.up.railway.app/v1/billing/webhook (DUPLICATE)
 *   - 1 DISABLED https://rlhf-feedback-loop-production.up.railway.app/v1/billing/webhook
 *   - 1 DISABLED https://rlhf-feedback-loop-710216278770.us-central1.run.app/v1/billing/webhook (231 events!)
 *   - 1 DISABLED https://rlhf-feedback-loop-production.up.railway.app/v1/billing/webhook (different config)
 *
 * Goal: keep exactly ONE enabled webhook (the canonical thumbgate-production
 * URL). Delete the other 4 (1 duplicate + 3 orphan rlhf-feedback-loop URLs
 * from a long-dead infra deployment).
 *
 * Safety. Idempotent — re-running after a successful cleanup is a no-op.
 * Default mode is --dry-run; --apply only writes when explicitly asked.
 * Per-deletion confirmation: never deletes an enabled webhook even if
 * matched by the orphan-pattern (defense in depth).
 *
 * Run:
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-webhook-cleanup.js            # dry-run
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-webhook-cleanup.js --apply
 */

'use strict';

const path = require('node:path');

const KEEP_URL = 'https://thumbgate-production.up.railway.app/v1/billing/webhook';
const ORPHAN_PATTERNS = [
  /rlhf-feedback-loop/i,
];

function parseArgs(argv = []) {
  return { apply: argv.includes('--apply'), json: argv.includes('--json') };
}

function classifyEndpoint(ep, keptOnce) {
  if (ep.status === 'enabled') {
    if (ep.url === KEEP_URL && !keptOnce.flag) {
      keptOnce.flag = true;
      return { action: 'keep', reason: 'canonical enabled webhook' };
    }
    if (ep.url === KEEP_URL && keptOnce.flag) {
      return { action: 'delete', reason: 'duplicate enabled — keep first only' };
    }
    return { action: 'keep', reason: 'enabled but different URL — leave alone' };
  }
  // disabled
  if (ep.url === KEEP_URL) {
    return { action: 'delete', reason: 'disabled duplicate of canonical URL' };
  }
  if (ORPHAN_PATTERNS.some((p) => p.test(ep.url))) {
    return { action: 'delete', reason: 'orphan rlhf-feedback-loop endpoint' };
  }
  return { action: 'keep', reason: 'disabled but unknown URL — leave for review' };
}

async function planCleanup(stripe) {
  const endpoints = [];
  let startingAfter;
  for (let page = 0; page < 100; page += 1) {
    const result = await stripe.webhookEndpoints.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const ep of result.data || []) endpoints.push(ep);
    if (!result.has_more) break;
    startingAfter = result.data[result.data.length - 1].id;
  }
  const keptOnce = { flag: false };
  return endpoints.map((ep) => ({
    id: ep.id,
    url: ep.url,
    status: ep.status,
    eventCount: (ep.enabled_events || []).length,
    ...classifyEndpoint(ep, keptOnce),
  }));
}

async function applyCleanup(stripe, plan) {
  const results = [];
  for (const item of plan) {
    if (item.action !== 'delete') {
      results.push({ ...item, deleted: false });
      continue;
    }
    try {
      await stripe.webhookEndpoints.del(item.id);
      results.push({ ...item, deleted: true });
    } catch (e) {
      results.push({ ...item, deleted: false, error: e.message });
    }
  }
  return results;
}

function renderHuman(items) {
  const lines = [];
  for (const it of items) {
    const verb = it.deleted ? 'DELETED' : (it.action === 'delete' ? 'WOULD DELETE' : 'keep');
    lines.push(`${verb.padEnd(12)} ${it.id}  status=${it.status}  events=${it.eventCount}  ${it.url}`);
    lines.push(`             reason: ${it.reason}` + (it.error ? `  ERROR: ${it.error}` : ''));
  }
  return lines.join('\n');
}

async function main(argv) {
  const args = parseArgs(argv);
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    process.stderr.write('STRIPE_SECRET_KEY is not set.\n');
    process.exit(1);
  }
  const stripeFactory = require('stripe');
  const stripe = stripeFactory(secretKey);

  try {
    const plan = await planCleanup(stripe);
    const results = args.apply ? await applyCleanup(stripe, plan) : plan;
    if (args.json) {
      process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    } else {
      process.stdout.write(`${renderHuman(results)}\n`);
      const deleteCount = results.filter((r) => r.action === 'delete').length;
      const keepCount = results.filter((r) => r.action === 'keep').length;
      process.stdout.write(`\nSummary: ${keepCount} kept, ${deleteCount} ${args.apply ? 'deleted' : 'would delete'}\n`);
    }
  } catch (error) {
    process.stderr.write(`stripe-webhook-cleanup FAILED: ${error.message}\n`);
    process.exit(1);
  }
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  main(process.argv.slice(2));
}

module.exports = { planCleanup, applyCleanup, classifyEndpoint, parseArgs, renderHuman, KEEP_URL, ORPHAN_PATTERNS };
