#!/usr/bin/env node
/**
 * ml-revenue-report.js — point our existing Bayesian conversion-rate stats
 * at the revenue question.
 *
 * Background. ThumbGate ships ~3,000 lines of ML/stats code (Thompson Sampling,
 * Beta-binomial conversion estimation, RLAIF reward, judge-reward-function,
 * semantic dedup). Almost all of it is pointed at the AGENT-PRODUCT internals
 * ("which mistake to gate, how to rank lessons"). Only three modules touch
 * the revenue/customer question (`conversion-rate-stats.js`,
 * `unified-revenue-rollup.js`, `external-customer-audit.js`) and they have
 * been data-starved because Plausible is paywalled (HTTP 402) and we hadn't
 * wired the operator-key read against our own `/v1/telemetry/export`.
 *
 * This script connects:
 *   - Telemetry source: `/v1/telemetry/export` (gated by `THUMBGATE_API_KEY`)
 *   - Conversion source: Stripe API (gated by `STRIPE_SECRET_KEY`)
 *   - Stats: `conversion-rate-stats.js` Bayesian Beta-binomial posteriors
 *
 * Output: per-UTM-source and per-CTA-placement conversion rates with
 * credible intervals, ranked. Verdicts are honest about low-N regimes
 * (the existing `classifyVerdict()` returns "uninformative" when N=0 or
 * when the credible interval spans more than a couple orders of magnitude).
 *
 * Usage:
 *   THUMBGATE_API_KEY=... STRIPE_SECRET_KEY=... \
 *     node scripts/ml-revenue-report.js
 *   ... --since 30d
 *   ... --output reports/ml-revenue-report.md
 *   ... --json
 *
 * The script is wired into `.github/workflows/ml-revenue-report.yml` for
 * daily execution; the markdown report lands in `reports/ml-revenue/`.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { rankSurfaces, renderConversionMarkdown } = require('./conversion-rate-stats');

const DEFAULT_APP_ORIGIN = 'https://thumbgate-production.up.railway.app';
const DEFAULT_LIMIT = 10000;
const OWNER_EMAILS = new Set(['iganapolsky@gmail.com']);

function parseArgs(argv = []) {
  const args = { json: false, output: null, since: null, appOrigin: null };
  for (let i = 0; i < argv.length; i += 1) {
    const v = argv[i];
    if (v === '--json') args.json = true;
    else if (v === '--output') args.output = argv[++i];
    else if (v === '--since') args.since = argv[++i];
    else if (v === '--app-origin') args.appOrigin = argv[++i];
  }
  return args;
}

function parseSince(sinceArg, nowMs = Date.now()) {
  if (!sinceArg) return new Date(nowMs - 7 * 86400 * 1000).toISOString();
  const m = /^(\d+)([hd])$/.exec(String(sinceArg).trim());
  if (m) {
    const n = Number(m[1]);
    const mult = m[2] === 'd' ? 86400 : 3600;
    return new Date(nowMs - n * mult * 1000).toISOString();
  }
  const explicit = Date.parse(sinceArg);
  if (Number.isFinite(explicit)) return new Date(explicit).toISOString();
  return new Date(nowMs - 7 * 86400 * 1000).toISOString();
}

async function fetchTelemetry({ appOrigin, apiKey, since, fetchImpl = globalThis.fetch }) {
  const url = new URL('/v1/telemetry/export', appOrigin);
  url.searchParams.set('since', since);
  url.searchParams.set('limit', String(DEFAULT_LIMIT));
  url.searchParams.set('source', 'both');
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${apiKey}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`telemetry export HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function listStripeCharges({ stripe, sinceMs, max = 1000 }) {
  const out = [];
  let startingAfter;
  while (out.length < max) {
    const page = await stripe.charges.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const c of page.data || []) {
      if (c.created * 1000 < sinceMs) return out;
      if (!c.paid) continue;
      const email = (c.billing_details?.email || '').toLowerCase();
      if (OWNER_EMAILS.has(email)) continue; // exclude owner self-purchases
      out.push(c);
    }
    if (!page.has_more || !page.data || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return out;
}

/**
 * Build the per-UTM-source surface table for the Bayesian estimator.
 *
 * Each "surface" is the unit we want a posterior over. We use UTM source as
 * the primary grouping (the natural channel-level question: "is reddit
 * converting better than threads?"). Visitors = page-view events;
 * charges = external Stripe paid charges attributed to that source via
 * Payment Link / Checkout Session metadata when available, falling back to
 * "(unattributed)" when the buyer didn't carry a UTM cookie.
 */
function buildUtmSurfaces(telemetryRows, chargeRows) {
  const visitorsByUtm = new Map();
  for (const row of telemetryRows) {
    if (row.eventType !== 'page_view' && row.eventType !== 'checkout_interstitial_view') continue;
    const utm = row.utm_source || row.utmSource || '(direct)';
    visitorsByUtm.set(utm, (visitorsByUtm.get(utm) || 0) + 1);
  }

  const chargesByUtm = new Map();
  for (const c of chargeRows) {
    const utm = (c.metadata && (c.metadata.utm_source || c.metadata.utmSource)) || '(unattributed)';
    chargesByUtm.set(utm, (chargesByUtm.get(utm) || 0) + 1);
  }

  const allKeys = new Set([...visitorsByUtm.keys(), ...chargesByUtm.keys()]);
  const surfaces = [];
  for (const key of allKeys) {
    const visitors = visitorsByUtm.get(key) || 0;
    const charges = chargesByUtm.get(key) || 0;
    surfaces.push({
      surface: `utm_source=${key}`,
      // Bayesian Beta-binomial expects {trials, successes}. We carry the
      // human-readable {visitors, charges} alongside for the renderer.
      // Floor trials at the charge count: an attributed buyer clearly
      // visited at least once even when we missed their page_view event
      // (cookie not set, direct land on /checkout/pro, etc.).
      visitors,
      charges,
      trials: Math.max(visitors, charges),
      successes: charges,
    });
  }
  return surfaces;
}

/**
 * Per-CTA-placement breakdown. Different question: "of buyers who clicked
 * the Pro card vs the Team card vs the consulting link, which converts?"
 * Visitors = checkout_interstitial_cta_clicked events; charges = same
 * Stripe charges, attributed by cta_id metadata when present.
 */
function buildCtaSurfaces(telemetryRows, chargeRows) {
  const clicksByCta = new Map();
  for (const row of telemetryRows) {
    if (row.eventType !== 'checkout_interstitial_cta_clicked' && row.eventType !== 'cta_click') continue;
    const cta = row.ctaId || '(unknown)';
    clicksByCta.set(cta, (clicksByCta.get(cta) || 0) + 1);
  }

  const chargesByCta = new Map();
  for (const c of chargeRows) {
    const cta = (c.metadata && c.metadata.cta_id) || '(unattributed)';
    chargesByCta.set(cta, (chargesByCta.get(cta) || 0) + 1);
  }

  const allKeys = new Set([...clicksByCta.keys(), ...chargesByCta.keys()]);
  const surfaces = [];
  for (const key of allKeys) {
    const visitors = clicksByCta.get(key) || 0;
    const charges = chargesByCta.get(key) || 0;
    surfaces.push({
      surface: `cta_id=${key}`,
      visitors,
      charges,
      trials: Math.max(visitors, charges),
      successes: charges,
    });
  }
  return surfaces;
}

function renderReport({ generatedAt, since, telemetryCount, chargeCount, utmRanked, ctaRanked }) {
  const lines = [];
  lines.push('# ML Revenue Report');
  lines.push('');
  lines.push(`Generated: ${generatedAt}`);
  lines.push(`Window since: ${since}`);
  lines.push('');
  lines.push(`Telemetry events read: ${telemetryCount}`);
  lines.push(`External (non-owner) paid charges in window: ${chargeCount}`);
  lines.push('');
  lines.push('## How to read this');
  lines.push('');
  lines.push('Beta-binomial Bayesian posterior on conversion rate per surface. Credible-interval bounds widen at low N (honest); narrow as data accumulates. A "verdict" of "uninformative" means we genuinely do not know yet — not "the rate is zero."');
  lines.push('');
  lines.push('## Per UTM source');
  lines.push('');
  lines.push(renderConversionMarkdown(utmRanked));
  lines.push('');
  lines.push('## Per CTA placement');
  lines.push('');
  lines.push(renderConversionMarkdown(ctaRanked));
  lines.push('');
  return lines.join('\n');
}

async function buildReport({
  appOrigin,
  apiKey,
  stripeSecret,
  since,
  fetchImpl = globalThis.fetch,
  stripeFactory = require('stripe'),
} = {}) {
  if (!apiKey) throw new Error('THUMBGATE_API_KEY (or THUMBGATE_OPERATOR_KEY) required');
  if (!stripeSecret) throw new Error('STRIPE_SECRET_KEY required');

  const telemetry = await fetchTelemetry({ appOrigin, apiKey, since, fetchImpl });
  const telemetryRows = telemetry.telemetry?.rows || [];

  const stripe = stripeFactory(stripeSecret);
  const sinceMs = Date.parse(since);
  const chargeRows = await listStripeCharges({ stripe, sinceMs });

  const utmSurfaces = buildUtmSurfaces(telemetryRows, chargeRows);
  const ctaSurfaces = buildCtaSurfaces(telemetryRows, chargeRows);

  const utmRanked = rankSurfaces(utmSurfaces);
  const ctaRanked = rankSurfaces(ctaSurfaces);

  return {
    generatedAt: new Date().toISOString(),
    since,
    telemetryCount: telemetryRows.length,
    chargeCount: chargeRows.length,
    utmRanked,
    ctaRanked,
  };
}

async function main(argv) {
  const args = parseArgs(argv);
  const apiKey = process.env.THUMBGATE_API_KEY || process.env.THUMBGATE_OPERATOR_KEY;
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  const appOrigin = args.appOrigin || process.env.THUMBGATE_APP_ORIGIN || DEFAULT_APP_ORIGIN;
  const since = parseSince(args.since);

  try {
    const report = await buildReport({ appOrigin, apiKey, stripeSecret, since });
    const body = args.json ? JSON.stringify(report, null, 2) : renderReport(report);
    if (args.output) {
      const out = path.resolve(args.output);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, body + '\n');
      process.stdout.write(`wrote ${out}\n`);
    } else {
      process.stdout.write(`${body}\n`);
    }
  } catch (err) {
    process.stderr.write(`ml-revenue-report FAILED: ${err.message}\n`);
    process.exit(1);
  }
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  main(process.argv.slice(2));
}

module.exports = {
  parseArgs,
  parseSince,
  fetchTelemetry,
  listStripeCharges,
  buildUtmSurfaces,
  buildCtaSurfaces,
  buildReport,
  renderReport,
  OWNER_EMAILS,
};
