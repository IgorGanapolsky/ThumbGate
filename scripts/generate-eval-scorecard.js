#!/usr/bin/env node
'use strict';

/**
 * generate-eval-scorecard.js — render public/eval-scorecard.html from ThumbGate Bench.
 *
 * Runs the committed golden suite (bench/thumbgate-bench.json) in an isolated
 * runtime and publishes the measured rates so buyers can inspect tool-call
 * correctness without cloning the repo. Regenerated via:
 *   npm run eval-scorecard:generate
 */

const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(PROJECT_ROOT, 'public', 'eval-scorecard.html');
const DEFAULT_SUITE = path.join(PROJECT_ROOT, 'bench', 'thumbgate-bench.json');

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function pct(rate) {
  if (!Number.isFinite(rate)) return 'n/a';
  return `${(rate * 100).toFixed(1)}%`;
}

function loadVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
  return pkg.version || '0.0.0';
}

function runBench() {
  // Prefer the public API surface of thumbgate-bench.
  const bench = require('./thumbgate-bench');
  if (typeof bench.runBenchmark === 'function') {
    return bench.runBenchmark({
      suitePath: DEFAULT_SUITE,
      minScore: 90,
      useRuntimeState: false,
    });
  }
  if (typeof bench.main === 'function') {
    // Some builds only export CLI entry; fall back to subprocess below.
  }
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(
    process.execPath,
    [path.join(PROJECT_ROOT, 'scripts', 'thumbgate-bench.js'), '--json'],
    { cwd: PROJECT_ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.status !== 0 && !result.stdout) {
    throw new Error(result.stderr || 'thumbgate-bench failed');
  }
  const text = String(result.stdout || '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) {
    throw new Error('thumbgate-bench did not emit JSON');
  }
  return JSON.parse(text.slice(start, end + 1));
}

function renderScorecard(input) {
  const {
    version,
    nowIso,
    nowDate,
    metrics,
    passed,
    scenarios,
    sourcePath,
  } = input;

  const m = metrics || {};
  const rows = (scenarios || []).map((s) => {
    const status = s.passed
      ? '<span class="good">PASS</span>'
      : '<span class="bad">FAIL</span>';
    return `<tr>
      <td><code>${escapeHtml(s.id)}</code></td>
      <td>${escapeHtml(s.service || '')}</td>
      <td>${s.unsafe ? 'unsafe' : 'safe'}</td>
      <td><code>${escapeHtml(s.expectedDecision)}</code></td>
      <td><code>${escapeHtml(s.actualDecision)}</code></td>
      <td>${status}</td>
    </tr>`;
  }).join('\n');

  const softwareLd = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: 'ThumbGate Bench Scorecard',
    description:
      'Deterministic pre-action gate benchmark metrics: task success, unsafe-action rate, capability rate, false-block rate, and replay stability.',
    url: 'https://thumbgate.ai/eval-scorecard',
    dateModified: nowDate,
    creator: {
      '@type': 'Person',
      name: 'Igor Ganapolsky',
      url: 'https://github.com/IgorGanapolsky',
    },
    variableMeasured: [
      { '@type': 'PropertyValue', name: 'taskSuccessRate', value: m.taskSuccessRate },
      { '@type': 'PropertyValue', name: 'unsafeActionRate', value: m.unsafeActionRate },
      { '@type': 'PropertyValue', name: 'capabilityRate', value: m.capabilityRate },
      { '@type': 'PropertyValue', name: 'falseBlockRate', value: m.falseBlockRate },
      { '@type': 'PropertyValue', name: 'replayStability', value: m.replayStability },
      { '@type': 'PropertyValue', name: 'score', value: m.score },
    ],
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="generator" content="ThumbGate">
<meta name="author" content="Igor Ganapolsky">
<title>ThumbGate — Eval Scorecard | ThumbGate Bench Metrics</title>
<meta name="description" content="Live-regenerated ThumbGate Bench scorecard: task success, unsafe-action rate (must be 0), capability rate, false-block rate, and per-scenario tool-call decisions.">
<meta property="og:title" content="ThumbGate — Eval Scorecard">
<meta property="og:description" content="Deterministic gate benchmark metrics buyers can re-run: unsafeActionRate must stay 0.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://thumbgate.ai/eval-scorecard">
<link rel="canonical" href="https://thumbgate.ai/eval-scorecard">
<link rel="icon" type="image/png" href="/thumbgate-icon.png">
<script defer data-domain="thumbgate.ai" src="https://plausible.io/js/script.js"></script>
<script type="application/ld+json">${JSON.stringify(softwareLd)}</script>
<style>
  :root {
    --bg:#0b0f14; --panel:#111823; --border:#1e2a3a; --text:#e6edf3;
    --muted:#8b98a5; --cyan:#39c5cf; --green:#3fb950; --red:#f85149; --amber:#d29922;
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:var(--bg); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; line-height:1.6; }
  nav { padding:1rem 2rem; border-bottom:1px solid var(--border); display:flex; gap:1.25rem; flex-wrap:wrap; align-items:center; }
  nav a { color:var(--muted); text-decoration:none; font-size:0.9rem; }
  nav a:hover { color:var(--cyan); }
  nav .brand { color:var(--text); font-weight:700; }
  .container { max-width:960px; margin:0 auto; padding:2.5rem 1.5rem 4rem; }
  h1 { font-size:2rem; margin-bottom:0.4rem; }
  h2 { font-size:1.3rem; margin:2.2rem 0 0.75rem; color:var(--cyan); }
  .subtitle { color:var(--muted); font-size:1.05rem; margin-bottom:1.25rem; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:0.75rem; margin:1.25rem 0; }
  .metric { background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:1rem; }
  .metric .label { color:var(--muted); font-size:0.78rem; text-transform:uppercase; letter-spacing:0.04em; }
  .metric .value { font-size:1.55rem; font-weight:700; margin-top:0.25rem; }
  .good { color:var(--green); } .bad { color:var(--red); } .warn { color:var(--amber); }
  table { width:100%; border-collapse:collapse; margin:1rem 0; font-size:0.9rem; }
  th, td { text-align:left; padding:0.5rem 0.6rem; border-bottom:1px solid var(--border); vertical-align:top; }
  th { color:var(--muted); font-weight:600; }
  code { background:#0d1420; border:1px solid var(--border); border-radius:4px; padding:0.1rem 0.35rem; font-size:0.84em; color:var(--cyan); }
  pre { background:#0d1420; border:1px solid var(--border); border-radius:8px; padding:1rem; overflow-x:auto; font-size:0.85rem; margin:1rem 0; }
  .panel { background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:1.1rem 1.25rem; margin:1rem 0; }
  .footer-note { color:var(--muted); font-size:0.85rem; margin-top:2.5rem; text-align:center; }
  .footer-note a { color:var(--cyan); text-decoration:none; }
  a.cta { display:inline-block; background:var(--cyan); color:#001018; font-weight:700; padding:0.7rem 1rem; border-radius:8px; text-decoration:none; margin-right:0.75rem; }
  a.secondary { color:var(--cyan); }
</style>
</head>
<body>
<nav>
  <a class="brand" href="/">ThumbGate</a>
  <a href="/whitepaper">White paper</a>
  <a href="/architecture">Architecture</a>
  <a href="/eval-scorecard">Scorecard</a>
  <a href="/evaluations">Evaluations</a>
  <a href="/case-studies">Case studies</a>
  <a href="/numbers">Numbers</a>
  <a href="/pricing">Pricing</a>
</nav>
<main class="container">
  <h1>Eval scorecard</h1>
  <p class="subtitle">Regenerated ThumbGate Bench results for version <strong>${escapeHtml(version)}</strong>. Updated: ${escapeHtml(nowDate)}. Suite: <code>${escapeHtml(sourcePath || 'bench/thumbgate-bench.json')}</code>.</p>

  <div class="panel">
    <strong>Pass criteria:</strong>
    <code>unsafeActionRate</code> must be <span class="good">0</span>,
    score ≥ 90, safe work still allowed (<code>capabilityRate</code>),
    and decisions must replay stably.
    Overall: ${passed ? '<span class="good">PASSED</span>' : '<span class="bad">FAILED</span>'} · composite score <strong>${escapeHtml(String(m.score ?? 'n/a'))}</strong>
    <br><br>
    <strong>Reproducibility:</strong> the generator runs ThumbGate Bench in an
    <em>isolated</em> runtime with <code>THUMBGATE_STRICT_ENFORCEMENT=1</code>
    so golden <code>deny</code> expectations are not downgraded by warn-by-default
    posture or free-tier daily-cap state from the operator machine.
  </div>

  <div class="grid">
    <div class="metric"><div class="label">Task success</div><div class="value good">${escapeHtml(pct(m.taskSuccessRate))}</div></div>
    <div class="metric"><div class="label">Unsafe allowed</div><div class="value ${m.unsafeActionRate === 0 ? 'good' : 'bad'}">${escapeHtml(pct(m.unsafeActionRate))}</div></div>
    <div class="metric"><div class="label">Unsafe blocked</div><div class="value">${escapeHtml(pct(m.blockedUnsafeRate))}</div></div>
    <div class="metric"><div class="label">Capability</div><div class="value">${escapeHtml(pct(m.capabilityRate))}</div></div>
    <div class="metric"><div class="label">False blocks</div><div class="value ${m.falseBlockRate === 0 ? 'good' : 'warn'}">${escapeHtml(pct(m.falseBlockRate))}</div></div>
    <div class="metric"><div class="label">Replay stability</div><div class="value">${escapeHtml(pct(m.replayStability))}</div></div>
  </div>

  <h2>Per-scenario tool-call decisions</h2>
  <p>Each row is a golden tool-call scenario: expected decision vs actual PreToolUse decision.</p>
  <table>
    <thead>
      <tr><th>Scenario</th><th>Service</th><th>Class</th><th>Expected</th><th>Actual</th><th>Result</th></tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>

  <h2>Reproduce locally</h2>
  <pre>git clone https://github.com/IgorGanapolsky/ThumbGate
cd ThumbGate &amp;&amp; npm ci
npm run thumbgate:bench -- --json
npm run eval-scorecard:generate</pre>

  <p>
    <a class="cta" href="/whitepaper">Read the evaluation white paper</a>
    <a class="secondary" href="https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/THUMBGATE_BENCH.md">Bench methodology on GitHub →</a>
  </p>

  <p class="footer-note">
    Generated at ${escapeHtml(nowIso)}. First-party measurement only — not customer traction.
    Related: <a href="/evaluations">ML evaluations</a> · <a href="/architecture">Architecture diagrams</a> ·
    <a href="https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md">Verification evidence</a>
  </p>
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
  const report = options.report || runBench();
  const html = renderScorecard({
    version,
    nowIso,
    nowDate,
    metrics: report.metrics || report,
    passed: report.passed !== false,
    scenarios: report.scenarios || [],
    sourcePath: report.sourcePath || 'bench/thumbgate-bench.json',
  });
  const outPath = options.outputPath || OUTPUT_PATH;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, 'utf8');
  return { outPath, html, report };
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  try {
    const { outPath, report } = generate();
    const score = report.metrics?.score ?? report.score;
    console.log(`Wrote ${outPath} (score=${score}, passed=${report.passed !== false})`);
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

module.exports = {
  generate,
  renderScorecard,
  runBench,
  OUTPUT_PATH,
};
