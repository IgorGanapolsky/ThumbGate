#!/usr/bin/env node
'use strict';

/**
 * generate-numbers-page.js — render public/numbers.html from first-party data.
 *
 * Why this exists (SEO 2026 rationale):
 *   Search engines — and the AI retrievers that sit on top of them — rank
 *   first-party, freshly-dated, extractable content higher than synthesized
 *   summaries. ThumbGate has operational data (configured gate counts,
 *   recorded block/warn events, token savings estimates, Bayes error rate)
 *   that should be published only with explicit caveats about what was
 *   observed versus what was merely configured.
 *   Publishing those numbers as a structured, machine-liftable page with a
 *   visible "Updated:" stamp hits three ranking signals at once:
 *     1. First-party data (proprietary, not synthesized)
 *     2. Freshness (dateModified reflects actual regeneration)
 *     3. Extractability (JSON-LD Dataset + SoftwareApplication + Person)
 *
 * Data sources (all local, no network calls):
 *   - scripts/gate-stats.js       → configured gate inventory, recorded block/warn counts, Bayes error
 *   - scripts/token-savings.js    → blended $/token savings estimate from recorded block counts
 *   - package.json                → current version
 *
 * Output:
 *   public/numbers.html (static; regenerate via `npm run numbers:generate`)
 *
 * Determinism:
 *   Output is deterministic for a given (stats, version, date) tuple. The
 *   "Updated:" line uses the provided `now` date so tests can pin it.
 */

const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(PROJECT_ROOT, 'public', 'numbers.html');

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-US');
}

function loadVersion() {
  const pkgPath = path.join(PROJECT_ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  return pkg.version || '0.0.0';
}

function collectStats() {
  // Lazy-require so tests that stub the data can inject their own values.
  const { calculateStats } = require('./gate-stats');
  const { computeTokenSavings } = require('./token-savings');

  const gate = calculateStats();
  const savings = computeTokenSavings({
    blockedCalls: gate.totalBlocked,
    deflectedBots: 0,
  });

  return { gate, savings };
}

/**
 * Render the numbers.html body from injected data. Exposed for tests so
 * we don't have to read the filesystem to verify the template.
 *
 * @param {{
 *   version: string,
 *   nowIso: string,
 *   nowDate: string,
 *   gate: ReturnType<typeof import('./gate-stats').calculateStats>,
 *   savings: ReturnType<typeof import('./token-savings').computeTokenSavings>,
 * }} input
 * @returns {string} HTML document
 */
function renderNumbersPage(input) {
  const { version, nowIso, nowDate, gate, savings } = input;

  const softwareLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'ThumbGate',
    alternateName: 'thumbgate',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Cross-platform, Node.js >=20.10.0',
    softwareVersion: version,
    url: 'https://thumbgate-production.up.railway.app/numbers',
    dateModified: nowDate,
    creator: {
      '@type': 'Person',
      name: 'Igor Ganapolsky',
      url: 'https://github.com/IgorGanapolsky',
      sameAs: [
        'https://github.com/IgorGanapolsky',
        'https://www.linkedin.com/in/igorganapolsky',
      ],
    },
  };

  const datasetLd = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: 'ThumbGate Operational Snapshot',
    description:
      'First-party operational snapshot from the ThumbGate pre-action check runtime: configured checks, recorded block/warn events, estimated token savings from recorded blocks, and Bayes error rate when the sample supports it.',
    url: 'https://thumbgate-production.up.railway.app/numbers',
    license: 'https://opensource.org/licenses/MIT',
    creator: softwareLd.creator,
    dateModified: nowDate,
    datePublished: nowDate,
    keywords: [
      'AI agent gates',
      'LLM token savings',
      'prevention rules',
      'Bayes error rate',
      'self-improving agents',
    ],
    variableMeasured: [
      { '@type': 'PropertyValue', name: 'configured_gates', value: gate.totalGates },
      { '@type': 'PropertyValue', name: 'actions_blocked', value: gate.totalBlocked },
      { '@type': 'PropertyValue', name: 'actions_warned', value: gate.totalWarned },
      {
        '@type': 'PropertyValue',
        name: 'estimated_hours_saved',
        value: gate.estimatedHoursSaved,
      },
      {
        '@type': 'PropertyValue',
        name: 'estimated_dollars_saved',
        value: Number(savings.dollarsSaved.toFixed(4)),
        unitText: 'USD',
      },
      {
        '@type': 'PropertyValue',
        name: 'tokens_saved_total',
        value: savings.tokensSavedTotal,
      },
      {
        '@type': 'PropertyValue',
        name: 'bayes_error_rate',
        value: gate.bayesErrorRate,
      },
    ],
  };

  const hasRecordedBlocks = Number(gate.totalBlocked || 0) > 0;
  const hasRecordedWarnings = Number(gate.totalWarned || 0) > 0;
  const topBlockedLine = hasRecordedBlocks && gate.topBlocked
    ? `${escapeHtml(gate.topBlocked.id)} (${formatNumber(gate.topBlocked.occurrences || 0)} blocks)`
    : 'No recorded blocker yet';
  const topBlockedSub = hasRecordedBlocks
    ? 'highest recorded block count'
    : 'top blocker appears only after at least one recorded block';
  const blockedSub = hasRecordedBlocks
    ? 'recorded hard blocks in the local gate ledger'
    : 'no recorded hard-block events in this snapshot';
  const warnedSub = hasRecordedWarnings
    ? 'recorded soft interventions; not hard blocks'
    : 'no recorded soft-warning events in this snapshot';
  const hoursSub = hasRecordedBlocks || hasRecordedWarnings
    ? '~15 min per recorded block/warn event'
    : '0 because no block/warn events are recorded';
  const dollarsSub = hasRecordedBlocks
    ? 'blended Sonnet/Opus/Haiku 80/15/5 mix from recorded blocks'
    : '0 because no recorded block events feed this estimate';
  const tokensSub = hasRecordedBlocks
    ? '2,000 input + 600 output per recorded block, conservative'
    : '0 because no recorded block events feed this estimate';

  const bayesLine = gate.bayesErrorRate === null || gate.bayesErrorRate === undefined
    ? 'n/a'
    : `${(gate.bayesErrorRate * 100).toFixed(1)}%`;
  const bayesSub = gate.bayesErrorRate === null || gate.bayesErrorRate === undefined
    ? 'needs both safe and harmful feedback sequences'
    : 'irreducible error given current feature set';

  const lastPromotionLine = (() => {
    if (!gate.lastPromotion) return 'none';
    const id = gate.lastPromotion.gateId || 'unknown';
    const ts = gate.lastPromotion.timestamp
      ? new Date(gate.lastPromotion.timestamp).toISOString().slice(0, 10)
      : null;
    return ts ? `${escapeHtml(id)} on ${ts}` : escapeHtml(id);
  })();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="generator" content="ThumbGate">
<meta name="author" content="Igor Ganapolsky">
<title>ThumbGate — The Numbers | First-Party Data Snapshot</title>
<meta name="description" content="ThumbGate's generated first-party operational snapshot: configured pre-action checks, recorded block/warn events, estimated LLM token savings when events exist, and scorer calibration when the sample supports it.">
<meta property="og:title" content="ThumbGate — The Numbers">
<meta property="og:description" content="Generated first-party operational snapshot: configured gates, recorded interventions, and explicit zero-evidence caveats.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://thumbgate-production.up.railway.app/numbers">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="https://thumbgate-production.up.railway.app/numbers">
<link rel="icon" type="image/png" href="/thumbgate-icon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<script defer data-domain="thumbgate-production.up.railway.app" src="https://plausible.io/js/script.js"></script>

<script type="application/ld+json">
${JSON.stringify(softwareLd, null, 2)}
</script>

<script type="application/ld+json">
${JSON.stringify(datasetLd, null, 2)}
</script>

<style>
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: #0a0a0b;
    --bg-card: #161618;
    --bg-raised: #111113;
    --border: #222225;
    --text: #e8e8ec;
    --muted: #8b8b94;
    --cyan: #22d3ee;
    --green: #34d399;
    --amber: #fbbf24;
    --amber-soft: rgba(251, 191, 36, 0.1);
    --amber-line: rgba(251, 191, 36, 0.34);
  }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }
  nav { padding: 1rem 2rem; border-bottom: 1px solid var(--border); display: flex; gap: 1.5rem; align-items: center; }
  nav a { color: var(--muted); text-decoration: none; font-size: 0.9rem; }
  nav a:hover { color: var(--cyan); }
  nav .brand { color: var(--text); font-weight: 700; font-size: 1.05rem; text-decoration: none; }
  .container { max-width: 900px; margin: 0 auto; padding: 3rem 1.5rem 5rem; }
  h1 { font-size: 2.4rem; line-height: 1.15; margin-bottom: 0.75rem; }
  h2 { font-size: 1.35rem; color: var(--cyan); margin: 3rem 0 1rem; }
  .subtitle { color: var(--muted); font-size: 1.05rem; max-width: 640px; margin-bottom: 1.25rem; }
  .freshness {
    display: inline-block;
    padding: 6px 14px;
    background: rgba(52, 211, 153, 0.08);
    border: 1px solid rgba(52, 211, 153, 0.35);
    border-radius: 999px;
    color: var(--green);
    font-size: 0.82rem;
    font-weight: 600;
    margin-bottom: 2.5rem;
  }
  .truth-note {
    background: var(--amber-soft);
    border: 1px solid var(--amber-line);
    border-radius: 12px;
    color: #fde68a;
    padding: 16px 18px;
    margin: 0 0 2.5rem;
    font-size: 0.95rem;
  }
  .truth-note strong { color: #fff3bd; }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px; margin: 1.5rem 0; }
  .stat-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 22px 20px;
  }
  .stat-label { color: var(--muted); font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 10px; }
  .stat-value { font-size: 2.1rem; font-weight: 700; color: var(--text); line-height: 1.1; }
  .stat-sub { color: var(--muted); font-size: 0.85rem; margin-top: 8px; }
  .stat-source { display: block; color: var(--cyan); font-size: 0.75rem; text-decoration: none; margin-top: 10px; }
  .stat-source:hover { text-decoration: underline; }
  .method {
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 22px 24px;
    color: var(--muted);
    font-size: 0.95rem;
  }
  .method strong { color: var(--text); }
  .method ul { margin: 10px 0 0 18px; }
  .method li { margin-bottom: 6px; }
  .cta { text-align: center; margin-top: 3rem; }
  .cta a {
    display: inline-block;
    padding: 14px 28px;
    background: var(--cyan);
    color: #0a0a0b;
    border-radius: 10px;
    font-weight: 700;
    text-decoration: none;
  }
  .footer-note { color: var(--muted); font-size: 0.85rem; margin-top: 1.5rem; text-align: center; }
  .footer-note a { color: var(--cyan); text-decoration: none; }
</style>
</head>
<body>
<nav>
  <a class="brand" href="/">ThumbGate</a>
  <a href="/learn">Learn</a>
  <a href="/compare">Compare</a>
  <a href="/numbers">Numbers</a>
  <a href="/dashboard">Dashboard</a>
  <a href="/pro">Pro</a>
</nav>

<main class="container">
  <h1>The Numbers</h1>
  <p class="subtitle">Generated first-party operational snapshot from the ThumbGate runtime. This is not customer traction, install volume, revenue, or proof that a configured gate has fired.</p>
  <div class="freshness">Updated: ${escapeHtml(nowDate)} · Version ${escapeHtml(version)}</div>
  <div class="truth-note"><strong>Read this first:</strong> configured checks are inventory. Recorded blocks and warnings are usage evidence. This snapshot currently reports ${formatNumber(gate.totalBlocked)} recorded hard-block event(s) and ${formatNumber(gate.totalWarned)} recorded warning event(s).</div>

  <h2>Gate enforcement</h2>
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-label">Configured checks</div>
      <div class="stat-value">${formatNumber(gate.totalGates)}</div>
      <div class="stat-sub">${formatNumber(gate.manualGates)} shipped defaults · ${formatNumber(gate.autoPromotedGates)} auto-promoted; inventory, not usage</div>
      <a class="stat-source" href="https://github.com/IgorGanapolsky/ThumbGate/blob/main/scripts/gate-stats.js">source: gate-stats.js</a>
    </div>
    <div class="stat-card">
      <div class="stat-label">Actions blocked</div>
      <div class="stat-value">${formatNumber(gate.totalBlocked)}</div>
      <div class="stat-sub">${blockedSub}</div>
      <a class="stat-source" href="https://github.com/IgorGanapolsky/ThumbGate/blob/main/scripts/gate-stats.js">source: gate-stats.js</a>
    </div>
    <div class="stat-card">
      <div class="stat-label">Actions warned</div>
      <div class="stat-value">${formatNumber(gate.totalWarned)}</div>
      <div class="stat-sub">${warnedSub}</div>
      <a class="stat-source" href="https://github.com/IgorGanapolsky/ThumbGate/blob/main/scripts/gate-stats.js">source: gate-stats.js</a>
    </div>
    <div class="stat-card">
      <div class="stat-label">Top recorded blocker</div>
      <div class="stat-value" style="font-size:1.1rem;">${topBlockedLine}</div>
      <div class="stat-sub">${topBlockedSub}</div>
      <a class="stat-source" href="https://github.com/IgorGanapolsky/ThumbGate/blob/main/scripts/gate-stats.js">source: gate-stats.js</a>
    </div>
  </div>

  <h2>Token &amp; time savings</h2>
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-label">Estimated hours saved</div>
      <div class="stat-value">${escapeHtml(String(gate.estimatedHoursSaved))}</div>
      <div class="stat-sub">${hoursSub}</div>
      <a class="stat-source" href="https://github.com/IgorGanapolsky/ThumbGate/blob/main/scripts/gate-stats.js">source: gate-stats.js</a>
    </div>
    <div class="stat-card">
      <div class="stat-label">Estimated LLM dollars saved</div>
      <div class="stat-value">${escapeHtml(savings.dollarsSavedDisplay)}</div>
      <div class="stat-sub">${dollarsSub}</div>
      <a class="stat-source" href="https://github.com/IgorGanapolsky/ThumbGate/blob/main/scripts/token-savings.js">source: token-savings.js</a>
    </div>
    <div class="stat-card">
      <div class="stat-label">Tokens not spent</div>
      <div class="stat-value">${escapeHtml(savings.tokensSavedDisplay)}</div>
      <div class="stat-sub">${tokensSub}</div>
      <a class="stat-source" href="https://github.com/IgorGanapolsky/ThumbGate/blob/main/scripts/token-savings.js">source: token-savings.js</a>
    </div>
    <div class="stat-card">
      <div class="stat-label">Scorer Bayes error</div>
      <div class="stat-value">${escapeHtml(bayesLine)}</div>
      <div class="stat-sub">${bayesSub}</div>
      <a class="stat-source" href="https://github.com/IgorGanapolsky/ThumbGate/blob/main/scripts/bayes-optimal-gate.js">source: bayes-optimal-gate.js</a>
    </div>
  </div>

  <h2>Methodology</h2>
  <div class="method">
    <p><strong>Where the numbers come from.</strong> This page is regenerated from local scripts — no survey data, no hand-edited figures, no third-party attribution. Every number on this page is produced by code in the public <a href="https://github.com/IgorGanapolsky/ThumbGate">ThumbGate repo</a>.</p>
    <ul>
      <li><strong>Configured checks</strong> — union of shipped default rules and the auto-promotion ledger. This is inventory, not proof that the check fired.</li>
      <li><strong>Actions blocked/warned</strong> — recorded intervention counts from gate occurrence data. These are the evidence counters.</li>
      <li><strong>Hours saved</strong> — conservative 15-minute/incident estimate, shown only as a function of recorded block/warn counts.</li>
      <li><strong>Dollars saved</strong> — blended per-call token estimate (2k input + 600 output) × recorded blocks × 2026-04-15 Anthropic + OpenAI list prices. See <code>scripts/token-savings.js</code> for the full price snapshot.</li>
      <li><strong>Bayes error rate</strong> — shown only when the feedback sample contains both safe and harmful outcomes. One-class samples are reported as n/a.</li>
    </ul>
    <p style="margin-top:12px;">Last auto-promotion: ${lastPromotionLine}. Regenerated on every release via <code>npm run numbers:generate</code> and on a weekly cadence.</p>
  </div>

  <div class="cta">
    <a href="https://www.npmjs.com/package/thumbgate">Install ThumbGate — npx thumbgate init</a>
    <div class="footer-note">Prefer the raw feed? See <a href="https://github.com/IgorGanapolsky/ThumbGate">GitHub</a> or run <code>npm run gate:stats</code> locally.</div>
    <div class="footer-note">Generated at ${escapeHtml(nowIso)} UTC.</div>
  </div>
</main>
</body>
</html>
`;
}

function generate(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const nowIso = now.toISOString();
  const nowDate = nowIso.slice(0, 10);
  const version = options.version || loadVersion();
  const { gate, savings } = options.data || collectStats();

  const html = renderNumbersPage({ version, nowIso, nowDate, gate, savings });
  const outPath = options.outPath || OUTPUT_PATH;
  fs.writeFileSync(outPath, html);
  return { outPath, bytes: Buffer.byteLength(html), version, nowDate };
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  try {
    const result = generate();
    console.log(`wrote ${result.outPath} (${result.bytes} bytes) · version ${result.version} · dated ${result.nowDate}`);
  } catch (err) {
    console.error('generate-numbers-page failed:', err.message);
    process.exit(1);
  }
}

module.exports = {
  generate,
  renderNumbersPage,
  OUTPUT_PATH,
};
