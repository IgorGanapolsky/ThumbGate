#!/usr/bin/env node
/**
 * telemetry-readback.js — pull our own /v1/telemetry/export and produce
 * a funnel-stage summary, since Plausible is paywalled (verified
 * 2026-05-18 — HTTP 402 across all 3 endpoints).
 *
 * What we read. The prod endpoint /v1/telemetry/export returns two
 * streams since a configurable window:
 *
 *   - telemetry.rows: the first-party `sendFirstPartyTelemetry` pings
 *     (one per CTA click / page view / form submit, with eventType
 *     + ctaId + ctaPlacement + utm_*)
 *   - funnel.rows: the canonical funnel-events ledger (one row per
 *     promotion across funnel stages, written by scripts/billing.js)
 *
 * What we produce. A markdown table of event counts grouped by
 * eventType, plus a per-CTA breakdown for the top 10 CTAs, plus the
 * top 5 utm_source values. This is the smallest read that gives us
 * "what are buyers actually doing?" without renewing Plausible.
 *
 * Run:
 *   THUMBGATE_API_KEY=... THUMBGATE_APP_ORIGIN=https://thumbgate-production.up.railway.app \
 *     node scripts/telemetry-readback.js
 *   ... --since 7d           — wider window
 *   ... --json                — JSON instead of markdown
 *   ... --output reports/funnel-snapshot.md
 *
 * Auth: passes Authorization: Bearer $THUMBGATE_API_KEY (or operator
 * key — server accepts either). Without a key, fails closed.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_APP_ORIGIN = 'https://thumbgate-production.up.railway.app';
const DEFAULT_LIMIT = 10000;
const DEFAULT_SINCE_HOURS = 24;

function parseArgs(argv = []) {
  const args = { json: false, output: null, since: null, limit: null, appOrigin: null };
  for (let i = 0; i < argv.length; i += 1) {
    const v = argv[i];
    if (v === '--json') args.json = true;
    else if (v === '--output') args.output = argv[++i];
    else if (v === '--since') args.since = argv[++i];
    else if (v === '--limit') args.limit = Number(argv[++i]);
    else if (v === '--app-origin') args.appOrigin = argv[++i];
  }
  return args;
}

function parseSince(sinceArg, nowMs = Date.now()) {
  if (!sinceArg) return new Date(nowMs - DEFAULT_SINCE_HOURS * 3600 * 1000).toISOString();
  const m = /^(\d+)([hd])$/.exec(String(sinceArg).trim());
  if (m) {
    const n = Number(m[1]);
    const mult = m[2] === 'd' ? 86400 : 3600;
    return new Date(nowMs - n * mult * 1000).toISOString();
  }
  const explicit = Date.parse(sinceArg);
  if (Number.isFinite(explicit)) return new Date(explicit).toISOString();
  return new Date(nowMs - DEFAULT_SINCE_HOURS * 3600 * 1000).toISOString();
}

async function fetchTelemetry({ appOrigin, apiKey, since, limit, fetchImpl = globalThis.fetch }) {
  const url = new URL('/v1/telemetry/export', appOrigin);
  url.searchParams.set('since', since);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('source', 'both');
  const res = await fetchImpl(url, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`telemetry export HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function topNByKey(rows, keyFn, n = 10) {
  const counts = new Map();
  for (const row of rows) {
    const k = keyFn(row);
    if (!k) continue;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function aggregateTelemetry(payload) {
  const telemetryRows = payload?.telemetry?.rows || [];
  const funnelRows = payload?.funnel?.rows || [];

  const byEventType = topNByKey(telemetryRows, (r) => r.eventType, 25);
  const byCtaId = topNByKey(
    telemetryRows.filter((r) => r.ctaId),
    (r) => `${r.ctaId} @ ${r.ctaPlacement || 'unknown'}`,
    15
  );
  const byUtmSource = topNByKey(
    telemetryRows.filter((r) => r.utm_source || r.utmSource),
    (r) => r.utm_source || r.utmSource,
    10
  );
  const byFunnelStage = topNByKey(funnelRows, (r) => r.stage || r.event || r.type, 15);

  return {
    generatedAt: new Date().toISOString(),
    sinceISO: payload?.since,
    telemetryRowCount: telemetryRows.length,
    telemetryTotalAfterSince: payload?.telemetry?.totalAfterSince ?? null,
    funnelRowCount: funnelRows.length,
    funnelTotalAfterSince: payload?.funnel?.totalAfterSince ?? null,
    byEventType,
    byCtaId,
    byUtmSource,
    byFunnelStage,
  };
}

function renderMarkdown(agg) {
  const lines = [];
  lines.push('# ThumbGate Funnel Snapshot');
  lines.push('');
  lines.push(`Generated: ${agg.generatedAt}`);
  lines.push(`Window since: ${agg.sinceISO}`);
  lines.push(`Telemetry rows in window: ${agg.telemetryRowCount}` + (agg.telemetryTotalAfterSince != null && agg.telemetryTotalAfterSince !== agg.telemetryRowCount ? ` (truncated from ${agg.telemetryTotalAfterSince})` : ''));
  lines.push(`Funnel rows in window: ${agg.funnelRowCount}` + (agg.funnelTotalAfterSince != null && agg.funnelTotalAfterSince !== agg.funnelRowCount ? ` (truncated from ${agg.funnelTotalAfterSince})` : ''));
  lines.push('');

  const renderPairs = (title, pairs) => {
    lines.push(`## ${title}`);
    lines.push('');
    if (pairs.length === 0) {
      lines.push('_no data in window_');
      lines.push('');
      return;
    }
    lines.push('| Key | Count |');
    lines.push('|---|---|');
    for (const [k, n] of pairs) lines.push(`| ${k} | ${n} |`);
    lines.push('');
  };

  renderPairs('Top eventTypes', agg.byEventType);
  renderPairs('Top CTAs (id @ placement)', agg.byCtaId);
  renderPairs('Top utm_source', agg.byUtmSource);
  renderPairs('Top funnel stages', agg.byFunnelStage);
  return lines.join('\n');
}

async function main(argv) {
  const args = parseArgs(argv);
  const apiKey = process.env.THUMBGATE_API_KEY || process.env.THUMBGATE_OPERATOR_KEY;
  if (!apiKey) {
    process.stderr.write('THUMBGATE_API_KEY (or THUMBGATE_OPERATOR_KEY) is required.\n');
    process.exit(1);
  }
  const appOrigin = args.appOrigin || process.env.THUMBGATE_APP_ORIGIN || DEFAULT_APP_ORIGIN;
  const since = parseSince(args.since);
  const limit = Number.isFinite(args.limit) && args.limit > 0 ? args.limit : DEFAULT_LIMIT;

  try {
    const payload = await fetchTelemetry({ appOrigin, apiKey, since, limit });
    const agg = aggregateTelemetry(payload);
    const body = args.json ? JSON.stringify(agg, null, 2) : renderMarkdown(agg);
    if (args.output) {
      const out = path.resolve(args.output);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, body + '\n');
      process.stdout.write(`wrote ${out}\n`);
    } else {
      process.stdout.write(`${body}\n`);
    }
  } catch (err) {
    process.stderr.write(`telemetry-readback FAILED: ${err.message}\n`);
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
  aggregateTelemetry,
  renderMarkdown,
  topNByKey,
};
