#!/usr/bin/env node
'use strict';

/**
 * refresh-proof-pack.js — regenerate (or check) the public evaluation scorecard.
 *
 * Cadence (repo policy): GitHub Actions schedule is limited to CodeQL. Noncritical
 * loops run via workflow_dispatch or local LaunchAgent:
 *   npm run proof-pack:refresh          # write public/eval-scorecard.html
 *   npm run proof-pack:refresh:check    # CI gate: metrics must still match
 *   npm run proof-pack:schedule         # install daily local LaunchAgent
 *
 * Isolation: generation goes through generate-eval-scorecard → thumbgate-bench
 * isolated runtime (strict enforcement pinned).
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SCORECARD_HTML = path.join(PROJECT_ROOT, 'public', 'eval-scorecard.html');
const SCORECARD_JSON = path.join(PROJECT_ROOT, 'public', 'eval-scorecard.json');

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    write: false,
    check: false,
    json: false,
    help: false,
    minScore: 90,
  };
  for (const arg of argv) {
    if (arg === '--write') args.write = true;
    else if (arg === '--check') args.check = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg.startsWith('--min-score=')) {
      args.minScore = Number(arg.slice('--min-score='.length));
    }
  }
  if (!args.write && !args.check) {
    // Default to write for operator cadence runs.
    args.write = true;
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/refresh-proof-pack.js [--write] [--check] [--json] [--min-score=90]

  --write   Regenerate public/eval-scorecard.html (+ .json sidecar)
  --check   Fail if committed scorecard metrics diverge from a fresh bench run
  --json    Print machine-readable summary to stdout
  --min-score=N  Minimum composite score (default 90)
`);
}

function extractMetricsFromHtml(html) {
  const metrics = {};
  // Prefer JSON-LD Dataset variableMeasured
  const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (ldMatch) {
    try {
      const ld = JSON.parse(ldMatch[1]);
      const vars = Array.isArray(ld.variableMeasured) ? ld.variableMeasured : [];
      for (const item of vars) {
        if (item && item.name != null) metrics[item.name] = item.value;
      }
    } catch {
      // fall through to regex
    }
  }
  const scoreMatch = html.match(/composite score <strong>([^<]+)<\/strong>/i)
    || html.match(/composite score[^0-9]*([0-9]+)/i);
  if (scoreMatch && metrics.score == null) {
    metrics.score = Number(scoreMatch[1]);
  }
  const passMatch = html.match(/Overall:\s*<span class="(good|bad)">(PASSED|FAILED)<\/span>/i);
  if (passMatch) {
    metrics.passedLabel = passMatch[2].toUpperCase();
  }
  return metrics;
}

function normalizeMetrics(metrics = {}) {
  const keys = [
    'score',
    'taskSuccessRate',
    'unsafeActionRate',
    'blockedUnsafeRate',
    'capabilityRate',
    'falseBlockRate',
    'replayStability',
  ];
  const out = {};
  for (const key of keys) {
    if (metrics[key] == null || metrics[key] === '') continue;
    const n = Number(metrics[key]);
    out[key] = Number.isFinite(n) ? Number(n.toFixed(4)) : metrics[key];
  }
  return out;
}

function metricsEqual(a, b, options = {}) {
  const left = normalizeMetrics(a);
  const right = normalizeMetrics(b);
  // When comparing a committed HTML extract to a fresh bench report, only
  // assert keys present on the committed side (JSON-LD may omit some rates).
  const keys = options.keys
    || (options.committedOnly
      ? Object.keys(left)
      : [...new Set([...Object.keys(left), ...Object.keys(right)])]);
  const diffs = [];
  for (const key of keys) {
    if (left[key] !== right[key]) {
      diffs.push({ key, committed: left[key], fresh: right[key] });
    }
  }
  return { equal: diffs.length === 0, diffs, left, right };
}

function runFreshBench() {
  const { generate, runBench } = require('./generate-eval-scorecard');
  // Prefer direct bench for metrics; generate for write path.
  let report;
  try {
    report = runBench();
  } catch {
    // generate also runs the bench
    report = null;
  }
  return { generate, report };
}

function buildSidecar(report, version, nowIso) {
  const metrics = report.metrics || report;
  return {
    generatedAt: nowIso,
    version,
    sourcePath: report.sourcePath || 'bench/thumbgate-bench.json',
    passed: report.passed !== false,
    isolatedRuntime: report.isolatedRuntime !== false,
    metrics: normalizeMetrics(metrics),
    scenarioCount: Array.isArray(report.scenarios) ? report.scenarios.length : null,
    proofUrl: 'https://thumbgate.ai/eval-scorecard',
  };
}

function refreshWrite(options = {}) {
  const { generate } = require('./generate-eval-scorecard');
  const now = options.now instanceof Date ? options.now : new Date();
  const result = generate({
    now,
    outputPath: options.outputPath || SCORECARD_HTML,
  });
  const version = options.version || require(path.join(PROJECT_ROOT, 'package.json')).version;
  const sidecar = buildSidecar(result.report, version, now.toISOString());
  const sidecarPath = options.sidecarPath || SCORECARD_JSON;
  fs.writeFileSync(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`, 'utf8');
  return {
    mode: 'write',
    htmlPath: result.outPath,
    sidecarPath,
    passed: result.report.passed !== false,
    metrics: sidecar.metrics,
    score: sidecar.metrics.score,
  };
}

function refreshCheck(options = {}) {
  const htmlPath = options.htmlPath || SCORECARD_HTML;
  if (!fs.existsSync(htmlPath)) {
    throw new Error(`Missing committed scorecard: ${htmlPath}`);
  }
  const committedHtml = fs.readFileSync(htmlPath, 'utf8');
  const committed = normalizeMetrics(extractMetricsFromHtml(committedHtml));

  const { runBench } = require('./generate-eval-scorecard');
  const report = options.report || runBench();
  const fresh = normalizeMetrics(report.metrics || report);
  const comparison = metricsEqual(committed, fresh, { committedOnly: true });
  const score = Number(fresh.score ?? committed.score);
  const minScore = options.minScore ?? 90;
  const scoreOk = Number.isFinite(score) && score >= minScore;
  const passed = report.passed !== false && scoreOk && comparison.equal;

  return {
    mode: 'check',
    passed,
    scoreOk,
    metricsMatch: comparison.equal,
    diffs: comparison.diffs,
    committed,
    fresh,
    minScore,
    reportPassed: report.passed !== false,
  };
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }

  let summary;
  if (args.check) {
    summary = refreshCheck({ minScore: args.minScore });
  } else {
    summary = refreshWrite();
    if (Number(summary.score) < args.minScore || summary.passed === false) {
      summary.checkFailed = true;
    }
  }

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else if (summary.mode === 'write') {
    console.log(
      `Proof pack scorecard written: ${summary.htmlPath} (score=${summary.score}, passed=${summary.passed})`,
    );
    console.log(`Sidecar: ${summary.sidecarPath}`);
  } else {
    console.log(
      `Proof pack check: metricsMatch=${summary.metricsMatch} scoreOk=${summary.scoreOk} reportPassed=${summary.reportPassed}`,
    );
    if (summary.diffs.length) {
      for (const diff of summary.diffs) {
        console.log(`  drift ${diff.key}: committed=${diff.committed} fresh=${diff.fresh}`);
      }
    }
  }

  if (summary.mode === 'check' && !summary.passed) return 1;
  if (summary.mode === 'write' && summary.checkFailed) return 1;
  return 0;
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.error(err.message || err);
    process.exitCode = 1;
  }
}

module.exports = {
  parseArgs,
  extractMetricsFromHtml,
  normalizeMetrics,
  metricsEqual,
  refreshWrite,
  refreshCheck,
  buildSidecar,
  main,
  SCORECARD_HTML,
  SCORECARD_JSON,
};
