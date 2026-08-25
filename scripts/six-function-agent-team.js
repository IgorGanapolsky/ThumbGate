#!/usr/bin/env node
'use strict';

/**
 * Six-function agent team — FORMAT map, not a new SKU.
 *
 * Process steal from the Industry Rockstar / Kane & Alessia Minkus
 * AI Unleashed Global Summit YouTube registration landing
 * (events.aiunleashedglobalsummit.com/aias-registration-yt):
 *   - dedicated ad destination path
 *   - for-you / not-for-you qualification
 *   - six named business-function agents
 *   - repeated single CTA
 *   - FAQ "how is this different from other AI events"
 *   - two-paths close
 *
 * Not stolen: celebrity quotes, 3M+ trained, 2,000-seat scarcity,
 * fake countdown, Katalyst CRM, a 6-agent OS, $499 hero.
 *
 * Each function maps onto an EXISTING ThumbGate surface.
 * isNewSku=false. livePromotionAllowed=false. affiliation=none.
 *
 * Usage:
 *   node scripts/six-function-agent-team.js
 *   node scripts/six-function-agent-team.js --json
 */

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = 'thumbgate.six_function_agent_team.v1';
const REPO_ROOT = path.resolve(__dirname, '..');

const UTM = {
  utm_source: 'youtube',
  utm_medium: 'cpc',
  utm_campaign: 'six-function-agent-gates',
};

const CTAS = Object.freeze({
  github: `https://github.com/IgorGanapolsky/ThumbGate?utm_source=${UTM.utm_source}&utm_medium=${UTM.utm_medium}&utm_campaign=${UTM.utm_campaign}`,
  npm: `https://www.npmjs.com/package/thumbgate?utm_source=${UTM.utm_source}&utm_medium=${UTM.utm_medium}&utm_campaign=${UTM.utm_campaign}`,
  marketplace: `https://github.com/marketplace/actions/thumbgate-agent-governance?utm_source=${UTM.utm_source}&utm_medium=${UTM.utm_medium}&utm_campaign=${UTM.utm_campaign}`,
  install: 'npx thumbgate init',
});

const FUNCTIONS = Object.freeze([
  {
    id: 'lead_gen',
    label: 'Lead generation',
    existingSurface: 'config/gates/default.json',
    gateId: 'outbound-email-send',
    whatItDoes: 'Drafts allowed. Send, send_draft, and Gmail MCP send_message stay blocked until a human delivers.',
  },
  {
    id: 'content',
    label: 'Content',
    existingSurface: 'scripts/post-everywhere.js',
    gateId: 'social-publish',
    whatItDoes: 'Social fan-out stays on existing publish gates: no Hashnode, no double-post, first-party UTMs.',
  },
  {
    id: 'product',
    label: 'Product',
    existingSurface: 'scripts/eval-baseline.js',
    gateId: 'eval-ablation',
    whatItDoes: 'Eval and ablation stay on the existing baseline CLI. Receipts beat summit promises.',
  },
  {
    id: 'marketing',
    label: 'Marketing',
    existingSurface: 'public/yt.html',
    gateId: 'dedicated-ad-landing',
    whatItDoes: 'YouTube/CPC traffic lands on /yt (alias /aias-registration-yt), not the homepage.',
  },
  {
    id: 'sales',
    label: 'Sales',
    existingSurface: 'public/yt.html',
    gateId: 'free-cta-only',
    whatItDoes: 'Hero CTAs are GitHub, npm, and the free GitHub Marketplace Action. No paid-pilot hero.',
  },
  {
    id: 'ops',
    label: 'Ops',
    existingSurface: 'scripts/session-lease.js',
    gateId: 'session-lease-pretooluse',
    whatItDoes: 'Single-writer checkout lease plus PreToolUse receipts. One live session owns a checkout.',
  },
]);

function resolveSurface(relativePath) {
  return path.join(REPO_ROOT, relativePath);
}

function runSixFunctionMap(options = {}) {
  const functions = options.functions || FUNCTIONS;
  const missing = [];
  for (const fn of functions) {
    const abs = resolveSurface(fn.existingSurface);
    if (!fs.existsSync(abs)) {
      missing.push(`${fn.id}:${fn.existingSurface}`);
    }
  }
  return {
    schema: SCHEMA,
    isNewSku: false,
    livePromotionAllowed: false,
    affiliation: 'none',
    capturedRevenueUsd: 0,
    sourceEvent: 'AI Unleashed Global Summit YouTube registration FORMAT (Industry Rockstar / Kane & Alessia Minkus) — not affiliated',
    utm: { ...UTM },
    ctas: { ...CTAS },
    functions: functions.map((fn) => ({ ...fn })),
    missingSurfaces: missing,
    ok: missing.length === 0,
    disclaimers: [
      'FORMAT steal only. Not the summit, not a 6-agent OS, not affiliated.',
      'livePromotionAllowed is false: no $499 hero, no paid-pilot outreach from this page.',
      'Each function maps onto an existing ThumbGate surface. isNewSku is false.',
    ],
  };
}

function formatReport(report) {
  const rows = report.functions.map((fn) => `| ${fn.label} | \`${fn.existingSurface}\` | ${fn.gateId} |`);
  return [
    '# Six-function agent team (existing gates)',
    '',
    `ok=${report.ok}  isNewSku=${report.isNewSku}  livePromotionAllowed=${report.livePromotionAllowed}  affiliation=${report.affiliation}`,
    '',
    '| Function | Existing surface | Gate |',
    '|----------|------------------|------|',
    ...rows,
    '',
    ...report.disclaimers.map((d) => `- ${d}`),
    '',
  ].join('\n');
}

function mainCli(argv = process.argv.slice(2)) {
  const report = runSixFunctionMap();
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatReport(report));
  }
  return report.ok ? 0 : 1;
}

module.exports = {
  SCHEMA,
  UTM,
  CTAS,
  FUNCTIONS,
  runSixFunctionMap,
  formatReport,
  mainCli,
};

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  process.exitCode = mainCli();
}
