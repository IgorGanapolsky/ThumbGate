#!/usr/bin/env node
/**
 * unified-revenue-rollup.js — fuse Stripe + Plausible into one source of truth.
 *
 * The audit on 2026-05-15 flagged that telemetry was captured across three
 * independent stacks (Stripe, Plausible, first-party JSONL) but nothing
 * joined them into one current view. `revenue-status.js` only did a binary
 * "is the Plausible script on the page" check. `analytics-latest.md` had
 * gone two days stale because no scheduler refreshed it.
 *
 * This script:
 *   1. Pulls live cash + checkout completion from Stripe (via
 *      stripe-live-status.js — same client that the existing daily loop uses).
 *   2. Pulls 24h pageviews + traffic-source breakdown from Plausible.
 *   3. Specifically measures pageviews on the seven public revenue surfaces
 *      we ship today (/, /pricing, /case-studies, /compare/heidi,
 *      /learn/spec-driven-development, /pro, /go/teams).
 *   4. Joins them so we can answer "are the new surfaces converting" without
 *      asking a human.
 *   5. Writes both a human-readable markdown rollup and a machine-readable
 *      JSON snapshot.
 *
 * Run modes:
 *   node scripts/unified-revenue-rollup.js                # write both files
 *   node scripts/unified-revenue-rollup.js --json         # JSON to stdout
 *   node scripts/unified-revenue-rollup.js --dry-run      # no writes
 *
 * Required env (graceful degradation if missing — every absence becomes a gap
 * line in the report, never a crash):
 *   STRIPE_SECRET_KEY    — live Stripe key, for cash + checkout completion
 *   PLAUSIBLE_API_KEY    — Plausible analytics token
 *   PLAUSIBLE_SITE_ID    — Plausible site id (defaults to thumbgate.ai)
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REVENUE_SURFACES = [
  '/',
  '/pricing',
  '/case-studies',
  '/compare/heidi',
  '/learn/spec-driven-development',
  '/pro',
  '/go/teams',
];

const PLAUSIBLE_BASE = 'https://plausible.io/api/v1';

function parseArgs(argv = []) {
  return {
    json: argv.includes('--json'),
    dryRun: argv.includes('--dry-run'),
    period: extractFlag(argv, '--period=') || '1d',
    outputDir: extractFlag(argv, '--output-dir=') || 'reports/revenue',
  };
}

function extractFlag(argv, prefix) {
  const match = argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function dollars(cents) {
  return Number(cents || 0) / 100;
}

function formatUsd(value) {
  const num = Number(value || 0);
  return `$${num.toFixed(2)}`;
}

async function plausibleQuery(endpoint, params, { apiKey, siteId, fetchImpl = fetch } = {}) {
  const qs = new URLSearchParams({ site_id: siteId, ...params });
  const url = `${PLAUSIBLE_BASE}${endpoint}?${qs.toString()}`;
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Plausible ${res.status} for ${endpoint}: ${body}`);
  }
  const json = await res.json();
  if (json.error) {
    throw new Error(`Plausible error for ${endpoint}: ${json.error}`);
  }
  return json;
}

async function gatherPlausible({ period = '1d', fetchImpl = fetch, env = process.env } = {}) {
  const apiKey = env.PLAUSIBLE_API_KEY;
  const siteId = env.PLAUSIBLE_SITE_ID || 'thumbgate.ai';
  if (!apiKey) {
    return { configured: false, gap: 'PLAUSIBLE_API_KEY is not set', siteId };
  }
  const ctx = { apiKey, siteId, fetchImpl };
  try {
    const [aggregate, byPage, bySource] = await Promise.all([
      plausibleQuery('/stats/aggregate', { metrics: 'visitors,pageviews,bounce_rate,visit_duration', period }, ctx),
      plausibleQuery('/stats/breakdown', { property: 'event:page', metrics: 'visitors,pageviews', period, limit: 50 }, ctx),
      plausibleQuery('/stats/breakdown', { property: 'visit:source', metrics: 'visitors', period, limit: 20 }, ctx),
    ]);
    return {
      configured: true,
      siteId,
      period,
      aggregate: aggregate.results || {},
      pages: (byPage.results || []).map((row) => ({
        page: row.page,
        visitors: Number(row.visitors || 0),
        pageviews: Number(row.pageviews || 0),
      })),
      sources: (bySource.results || []).map((row) => ({
        source: row.source,
        visitors: Number(row.visitors || 0),
      })),
    };
  } catch (error) {
    return { configured: true, siteId, error: error.message };
  }
}

async function gatherStripe({ liveStatusModule = null } = {}) {
  let stripeLiveStatus = liveStatusModule;
  if (!stripeLiveStatus) {
    try {
      stripeLiveStatus = require('./stripe-live-status');
    } catch (error) {
      return { configured: false, gap: `stripe-live-status module unavailable: ${error.message}` };
    }
  }
  try {
    const status = await stripeLiveStatus.getLiveStatus();
    const configured = status.configured !== false;
    return {
      configured,
      status: status.status || 'ok',
      gap: configured ? null : (status.gaps && status.gaps[0]) || 'Stripe is not configured',
      balance: status.balance || { available: 0, pending: 0, currency: 'USD' },
      revenue: status.revenue || { grossLifetime: 0, netLifetime: 0, today: 0, todayChargeCount: 0 },
      checkout: status.checkout || { completed: 0, expired: 0, total: 0, conversionRate: '0%' },
      subscriptions: status.subscriptions || { active: 0, cancelled: 0, total: 0, mrr: 0 },
      products: status.products || [],
    };
  } catch (error) {
    return { configured: false, gap: `Stripe call failed: ${error.message}` };
  }
}

function joinSurfaceTraffic(plausible) {
  if (!plausible || !plausible.configured || plausible.error) return [];
  const byPath = new Map(plausible.pages.map((row) => [row.page, row]));
  return REVENUE_SURFACES.map((surface) => {
    const hit = byPath.get(surface);
    return {
      surface,
      visitors: hit ? hit.visitors : 0,
      pageviews: hit ? hit.pageviews : 0,
      live: Boolean(hit),
    };
  });
}

function diagnoseFunnel(stripe, surfaces) {
  const diagnostics = [];
  const pricingHits = surfaces.find((s) => s.surface === '/pricing')?.visitors || 0;
  const caseStudyHits = surfaces.find((s) => s.surface === '/case-studies')?.visitors || 0;
  const checkoutsCompleted = stripe?.checkout?.completed || 0;
  const cashAvailable = dollars(stripe?.balance?.available || 0);

  if (cashAvailable === 0 && pricingHits > 0) {
    diagnostics.push({
      severity: 'info',
      signal: 'pricing_traffic_no_cash',
      message: `${pricingHits} unique visitors on /pricing but $0 Stripe balance — funnel inbound but no buyer conversion yet.`,
    });
  }
  if (caseStudyHits > 0 && checkoutsCompleted === 0) {
    diagnostics.push({
      severity: 'info',
      signal: 'case_study_traffic_no_checkout',
      message: `${caseStudyHits} unique visitors on /case-studies but 0 completed checkouts — proof page reading, not yet buying.`,
    });
  }
  if (cashAvailable > 0) {
    diagnostics.push({
      severity: 'win',
      signal: 'cash_available',
      message: `Stripe shows ${formatUsd(cashAvailable)} available — this is real cash, not aspirational.`,
    });
  }
  if (!stripe?.configured) {
    diagnostics.push({
      severity: 'warning',
      signal: 'stripe_unconfigured',
      message: stripe?.gap || 'Stripe API unavailable — cash truth unknown.',
    });
  }
  return diagnostics;
}

function renderMarkdown(snapshot) {
  const lines = [];
  lines.push('# Unified Revenue Rollup');
  lines.push('');
  lines.push(`Generated: ${snapshot.generatedAt}`);
  lines.push(`Period: ${snapshot.period}`);
  lines.push('');
  lines.push('## Cash Truth (Stripe Live API)');
  lines.push('');
  if (snapshot.stripe.configured) {
    lines.push(`- Available: ${formatUsd(dollars(snapshot.stripe.balance.available))}`);
    lines.push(`- Pending: ${formatUsd(dollars(snapshot.stripe.balance.pending))}`);
    lines.push(`- Today gross: ${formatUsd(dollars(snapshot.stripe.revenue.today))} (${snapshot.stripe.revenue.todayChargeCount} charge${snapshot.stripe.revenue.todayChargeCount === 1 ? '' : 's'})`);
    lines.push(`- Lifetime net: ${formatUsd(dollars(snapshot.stripe.revenue.netLifetime))}`);
    lines.push(`- Active subs: ${snapshot.stripe.subscriptions.active} (MRR ${formatUsd(dollars(snapshot.stripe.subscriptions.mrr))})`);
    lines.push(`- Checkouts completed lifetime: ${snapshot.stripe.checkout.completed} of ${snapshot.stripe.checkout.total} (${snapshot.stripe.checkout.conversionRate})`);
  } else {
    lines.push(`- Stripe: NOT CONFIGURED — ${snapshot.stripe.gap}`);
  }
  lines.push('');
  lines.push('## Web Traffic (Plausible)');
  lines.push('');
  if (snapshot.plausible.configured && !snapshot.plausible.error) {
    const agg = snapshot.plausible.aggregate;
    lines.push(`- Visitors: ${agg.visitors?.value ?? 0}`);
    lines.push(`- Pageviews: ${agg.pageviews?.value ?? 0}`);
    lines.push(`- Bounce rate: ${agg.bounce_rate?.value ?? 0}%`);
    lines.push(`- Avg visit duration: ${agg.visit_duration?.value ?? 0}s`);
  } else if (snapshot.plausible.error) {
    lines.push(`- Plausible: ERROR — ${snapshot.plausible.error}`);
  } else {
    lines.push(`- Plausible: NOT CONFIGURED — ${snapshot.plausible.gap}`);
  }
  lines.push('');
  lines.push('## Revenue Surface Traffic (last ' + snapshot.period + ')');
  lines.push('');
  if (snapshot.surfaces.length > 0) {
    lines.push('| Surface | Visitors | Pageviews |');
    lines.push('| --- | ---: | ---: |');
    for (const row of snapshot.surfaces) {
      lines.push(`| \`${row.surface}\` | ${row.visitors} | ${row.pageviews} |`);
    }
  } else {
    lines.push('_No Plausible data available._');
  }
  lines.push('');
  if (snapshot.plausible.sources && snapshot.plausible.sources.length > 0) {
    lines.push('## Top Sources (' + snapshot.period + ')');
    lines.push('');
    lines.push('| Source | Visitors |');
    lines.push('| --- | ---: |');
    for (const row of snapshot.plausible.sources.slice(0, 10)) {
      lines.push(`| ${row.source || 'Direct/None'} | ${row.visitors} |`);
    }
    lines.push('');
  }
  lines.push('## Diagnostics');
  lines.push('');
  if (snapshot.diagnostics.length > 0) {
    for (const d of snapshot.diagnostics) {
      lines.push(`- **[${d.severity}] ${d.signal}** — ${d.message}`);
    }
  } else {
    lines.push('_No signals to surface — nothing yet to interpret._');
  }
  lines.push('');
  lines.push('## Honest Limits');
  lines.push('');
  lines.push('- This rollup never claims revenue without a Stripe-API balance check.');
  lines.push('- Plausible counts unique visitors / pageviews — not buyers. Conversion is inferred only when Stripe charges arrive.');
  lines.push('- First-party telemetry-pings.jsonl + funnel-events.jsonl live on the Railway container and are not joined here.');
  lines.push('  Hooking them in requires a persistent-volume export step.');
  return lines.join('\n') + '\n';
}

async function buildSnapshot({ argv = [], env = process.env, fetchImpl = fetch, liveStatusModule = null, now = new Date() } = {}) {
  const args = parseArgs(argv);
  const [plausible, stripe] = await Promise.all([
    gatherPlausible({ period: args.period, fetchImpl, env }),
    gatherStripe({ liveStatusModule }),
  ]);
  const surfaces = joinSurfaceTraffic(plausible);
  const diagnostics = diagnoseFunnel(stripe, surfaces);
  return {
    generatedAt: now.toISOString(),
    period: args.period,
    stripe,
    plausible,
    surfaces,
    diagnostics,
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const snapshot = await buildSnapshot({ argv });
  const markdown = renderMarkdown(snapshot);

  if (args.json) {
    process.stdout.write(JSON.stringify(snapshot, null, 2) + '\n');
    return;
  }

  if (args.dryRun) {
    process.stdout.write(markdown);
    return;
  }

  fs.mkdirSync(args.outputDir, { recursive: true });
  const mdPath = path.join(args.outputDir, 'unified-rollup-latest.md');
  const jsonPath = path.join(args.outputDir, 'unified-rollup-latest.json');
  fs.writeFileSync(mdPath, markdown);
  fs.writeFileSync(jsonPath, JSON.stringify(snapshot, null, 2) + '\n');
  process.stdout.write(`Wrote ${mdPath} and ${jsonPath}\n`);
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  main().catch((error) => {
    process.stderr.write(`unified-revenue-rollup FAILED: ${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  REVENUE_SURFACES,
  parseArgs,
  gatherPlausible,
  gatherStripe,
  joinSurfaceTraffic,
  diagnoseFunnel,
  renderMarkdown,
  buildSnapshot,
};
