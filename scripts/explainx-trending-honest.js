#!/usr/bin/env node
'use strict';

/**
 * explainx-trending-honest.js — Parse live ExplainX /trending rankings.
 *
 * Source: https://explainx.ai/trending (their page-view scores, refreshed ~30m).
 * Rank by parsed `score` only. Map onto existing ThumbGate/fleet rails.
 * Zero items → UNAVAILABLE (fail closed). Never invent ROI or TF-IDF theater.
 *
 * Do NOT dual-edit mac-yolo tools/explainx-trending-rag-engine.js (hardcoded theater).
 *
 * Usage:
 *   node scripts/explainx-trending-honest.js --fixture tests/fixtures/explainx-trending-rsc-snippet.html --json
 *   node scripts/explainx-trending-honest.js --fetch --json
 *   node scripts/explainx-trending-honest.js --fixture ... --top 5
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const DEFAULT_URL = 'https://explainx.ai/trending';
const REPO = path.resolve(__dirname, '..');

/** Map ExplainX item → existing ThumbGate/fleet rails (never auto-install). */
const RAIL_MAP = Object.freeze([
  {
    id: 'show-me-visual',
    match: (item) => /show-me|visual output|draw instead of ramble|mermaid|ascii tree/i.test(
      `${item.name} ${item.description} ${item.href}`
    ),
    rails: ['.agents/skills/show-me/SKILL.md', 'graphify query/path', 'docs/agents/code-search.md'],
    steal: 'Format menu (tree/mermaid/annotated diff) as a skill, not a prompt',
  },
  {
    id: 'session-budget',
    match: (item) => /limit-reset|usage limit|session limit|weekly cap|token budget/i.test(
      `${item.name} ${item.description} ${item.href}`
    ),
    rails: ['manage-agent-context-budget', 'openai-ultrafast $10/mo cap', 'scripts/budget*.js'],
    steal: 'Name which budget resets (session vs weekly); never claim a weekly wipe exists',
  },
  {
    id: 'skills-mcp-loops',
    match: (item) => /skills.*mcp|mcp.*loops|agent skills|skill\.md|loop engineering/i.test(
      `${item.name} ${item.description} ${item.href}`
    ),
    rails: ['context-engineering-checklist', 'gsd-ralph-context-loop', 'adapters/mcp/'],
    steal: 'Skills + MCP + loops as three layers; irreversible policy stays in hooks',
  },
  {
    id: 'grill-me-spec',
    match: (item) => /grill-me/i.test(`${item.name} ${item.href}`),
    rails: ['intent-contract', 'spec-driven-feature', 'coding-context-pack'],
    steal: 'Force clarifying questions before coding (spec-first)',
  },
  {
    id: 'harness-compare',
    match: (item) => /agent harness/i.test(`${item.name} ${item.description}`),
    rails: ['AGENTS.md', 'adapters/', 'prove:adapters'],
    steal: 'Compare harnesses by proof surfaces, not brand',
  },
]);

const SKIP_REASONS = Object.freeze({
  news_noise: /gpt-6|astra|rsa-|spy-satellite|god'?s eye|outage|muse spark|openai announced/i,
  product_clone: /explainx mcp|skillmeet|bootcamp|course|workshop|pricing|pathway/i,
  ui_design_sku: /mobile-app-ui|apple-ui|game-ui|interior-design|visual-design|flutter-ui|lottie/i,
  eci_pause: /commerce agent|shopping agent/i,
});

function parseArgs(argv) {
  const out = {
    fixture: null,
    fetch: false,
    url: DEFAULT_URL,
    json: false,
    top: 15,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--json') out.json = true;
    else if (arg === '--fetch') out.fetch = true;
    else if (arg === '--fixture' && next) { out.fixture = next; i += 1; }
    else if (arg === '--url' && next) { out.url = next; i += 1; }
    else if (arg === '--top' && next) { out.top = Number.parseInt(next, 10) || 15; i += 1; }
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  return out;
}

function unescapeRsc(text) {
  return String(text || '')
    .replace(/\\u0026/g, '&')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

/**
 * Parse scored items from ExplainX RSC / HTML payloads.
 */
function parseTrendingHtml(html) {
  const raw = String(html || '');
  const items = [];
  const patterns = [
    /\{\\"type\\":\\"([^\\"]+)\\",\\"typeLabel\\":\\"([^\\"]+)\\",\\"name\\":\\"([^\\"]+)\\",\\"description\\":\\"([^\\"]*)\\",\\"href\\":\\"([^\\"]+)\\",\\"score\\":(\d+)\}/g,
    /\{"type":"([^"]+)","typeLabel":"([^"]+)","name":"([^"]+)","description":"([^"]*)","href":"([^"]+)","score":(\d+)\}/g,
  ];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match = pattern.exec(raw);
    while (match) {
      items.push({
        type: match[1],
        typeLabel: match[2],
        name: unescapeRsc(match[3]),
        description: unescapeRsc(match[4]).slice(0, 280),
        href: match[5],
        score: Number.parseInt(match[6], 10) || 0,
        url: match[5].startsWith('http') ? match[5] : `https://explainx.ai${match[5]}`,
      });
      match = pattern.exec(raw);
    }
  }

  const byHref = new Map();
  for (const item of items) {
    const prev = byHref.get(item.href);
    if (!prev || item.score > prev.score) byHref.set(item.href, item);
  }
  return [...byHref.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function skipReason(item) {
  const hay = `${item.name} ${item.description} ${item.href} ${item.type}`;
  for (const [reason, re] of Object.entries(SKIP_REASONS)) {
    if (re.test(hay)) return reason;
  }
  return null;
}

function mapItem(item) {
  const skip = skipReason(item);
  if (skip) {
    return {
      ...item,
      disposition: 'skip',
      skipReason: skip,
      rails: [],
      steal: null,
    };
  }
  for (const rule of RAIL_MAP) {
    if (rule.match(item)) {
      return {
        ...item,
        disposition: 'map',
        skipReason: null,
        mapId: rule.id,
        rails: rule.rails,
        steal: rule.steal,
      };
    }
  }
  return {
    ...item,
    disposition: 'observe',
    skipReason: null,
    rails: [],
    steal: 'No ThumbGate rail match — observe only; do not auto-install',
  };
}

function fetchUrl(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'ThumbGate-explainx-trending-honest/1.0 (+https://github.com/IgorGanapolsky/ThumbGate)',
        Accept: 'text/html,application/xhtml+xml',
      },
      timeout: timeoutMs,
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        fetchUrl(res.headers.location, timeoutMs).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error(`timeout fetching ${url}`));
    });
  });
}

function buildReport({ html, source, top }) {
  const parsed = parseTrendingHtml(html);
  if (parsed.length === 0) {
    return {
      ok: false,
      status: 'UNAVAILABLE',
      source,
      reason: 'zero scored items parsed from HTML — refuse invented catalog',
      items: [],
      actionable: [],
      counts: { parsed: 0, map: 0, skip: 0, observe: 0 },
    };
  }

  const mapped = parsed.slice(0, Math.max(1, top)).map(mapItem);
  const actionable = mapped.filter((item) => item.disposition === 'map');
  const counts = {
    parsed: parsed.length,
    shown: mapped.length,
    map: mapped.filter((i) => i.disposition === 'map').length,
    skip: mapped.filter((i) => i.disposition === 'skip').length,
    observe: mapped.filter((i) => i.disposition === 'observe').length,
  };

  return {
    ok: true,
    status: 'OK',
    source,
    reason: `ranked by ExplainX page-view score (${counts.parsed} unique items parsed)`,
    disclaimer: 'Scores are explainx.ai traffic, not ThumbGate ROI. Never auto-install third-party skills.',
    items: mapped,
    actionable,
    counts,
  };
}

async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(`Usage: node scripts/explainx-trending-honest.js [--fixture PATH | --fetch] [--json] [--top N]`);
    return { ok: true, status: 'HELP' };
  }

  let html = '';
  let source = '';
  if (args.fixture) {
    const fixturePath = path.isAbsolute(args.fixture)
      ? args.fixture
      : path.join(REPO, args.fixture);
    html = fs.readFileSync(fixturePath, 'utf8');
    source = `fixture:${path.relative(REPO, fixturePath)}`;
  } else if (args.fetch) {
    html = await fetchUrl(args.url);
    source = `fetch:${args.url}`;
  } else {
    throw new Error('Provide --fixture PATH or --fetch');
  }

  const report = buildReport({ html, source, top: args.top });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    console.log(`status=${report.status} ok=${report.ok} source=${report.source}`);
    console.log(`reason=${report.reason}`);
    if (report.ok) {
      for (const item of report.items.slice(0, args.top)) {
        const tag = item.disposition === 'map' ? 'MAP' : item.disposition === 'skip' ? 'SKIP' : 'OBS';
        console.log(
          `${String(item.score).padStart(4)} [${tag}] ${item.type} ${item.name}`
          + (item.mapId ? ` → ${item.mapId}` : '')
          + (item.skipReason ? ` (${item.skipReason})` : ''),
        );
      }
      console.log(`actionable=${report.actionable.length} map=${report.counts.map} skip=${report.counts.skip}`);
    }
  }
  process.exitCode = report.ok ? 0 : 2;
  return report;
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  run().catch((err) => {
    console.error(String(err && err.message ? err.message : err));
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_URL,
  RAIL_MAP,
  SKIP_REASONS,
  buildReport,
  fetchUrl,
  mapItem,
  parseArgs,
  parseTrendingHtml,
  run,
  skipReason,
};
