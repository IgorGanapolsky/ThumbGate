#!/usr/bin/env node
'use strict';

/**
 * verify-marketing-pages-deployed.js — post-deploy probe for top-level
 * marketing pages.
 *
 * Reads `config/post-deploy-marketing-pages.json` and curls every entry
 * against the live production URL (default
 * https://thumbgate-production.up.railway.app, overridable via
 * THUMBGATE_PROD_URL env or --prod-url=…). Each response body must
 * contain the configured sentinel string and must not contain any configured
 * `mustNotContain` strings. Any mismatch fails the run and the route is
 * included in the failure summary.
 *
 * Intended to run as a workflow step in .github/workflows/deploy-verify.yml
 * after the version sentinel check, so the marketing surface is verified
 * in the same gate as /health and /dashboard. Adding a new marketing
 * page? Add it to the JSON manifest — no workflow edit required.
 *
 * Modes:
 *   --json    machine-readable report on stdout, suitable for piping
 *             into the GitHub Actions PR comment step.
 *   --quiet   suppress per-route lines; only print the final summary.
 *
 * Exit code is 0 when every page passes, 1 if any sentinel is missing
 * or any route returns non-200.
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PROD_URL = 'https://thumbgate-production.up.railway.app';
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_MANIFEST_PATH = path.resolve(__dirname, '..', 'config', 'post-deploy-marketing-pages.json');

function parseArgs(argv = []) {
  const out = {
    prodUrl: process.env.THUMBGATE_PROD_URL || DEFAULT_PROD_URL,
    manifestPath: DEFAULT_MANIFEST_PATH,
    json: false,
    quiet: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  for (const arg of argv) {
    if (arg === '--json') out.json = true;
    else if (arg === '--quiet') out.quiet = true;
    else if (arg.startsWith('--prod-url=')) out.prodUrl = arg.slice('--prod-url='.length);
    else if (arg.startsWith('--manifest=')) out.manifestPath = arg.slice('--manifest='.length);
    else if (arg.startsWith('--timeout-ms=')) {
      const n = Number(arg.slice('--timeout-ms='.length));
      if (Number.isFinite(n) && n > 0) out.timeoutMs = n;
    }
  }
  return out;
}

function loadManifest(manifestPath) {
  const raw = fs.readFileSync(manifestPath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.pages) || parsed.pages.length === 0) {
    throw new Error(`Manifest has no pages: ${manifestPath}`);
  }
  for (const entry of parsed.pages) {
    if (typeof entry.route !== 'string' || !entry.route.startsWith('/')) {
      throw new Error(`Invalid route in manifest: ${JSON.stringify(entry)}`);
    }
    if (typeof entry.sentinel !== 'string' || entry.sentinel.length === 0) {
      throw new Error(`Invalid sentinel for route ${entry.route}`);
    }
    if (entry.mustNotContain != null) {
      if (!Array.isArray(entry.mustNotContain) || entry.mustNotContain.some((value) => typeof value !== 'string' || value.length === 0)) {
        throw new Error(`Invalid mustNotContain for route ${entry.route}`);
      }
    }
    if (entry.userAgent != null && (typeof entry.userAgent !== 'string' || entry.userAgent.length === 0)) {
      throw new Error(`Invalid userAgent for route ${entry.route}`);
    }
  }
  return parsed;
}

async function probePage({ prodUrl, route, sentinel, mustNotContain = [], userAgent, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (typeof fetchImpl !== 'function') {
    return { route, ok: false, error: 'fetch_unavailable' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${prodUrl.replace(/\/$/, '')}${route}`;
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        // A real browser-shaped UA so bot-deflection interstitials do not
        // trigger; this probe is meant to verify the buyer-facing surface.
        'User-Agent': userAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    const body = await res.text().catch(() => '');
    const sentinelPresent = body.includes(sentinel);
    const forbiddenPresent = Array.isArray(mustNotContain)
      ? mustNotContain.filter((value) => body.includes(value))
      : [];
    return {
      route,
      url,
      status: res.status,
      ok: res.ok && sentinelPresent && forbiddenPresent.length === 0,
      sentinelPresent,
      forbiddenPresent,
      bytes: body.length,
    };
  } catch (error) {
    return {
      route,
      ok: false,
      error: error?.name === 'AbortError' ? `timeout_after_${timeoutMs}ms` : (error?.message || String(error)),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runVerification({ prodUrl, manifestPath, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const manifest = loadManifest(manifestPath);
  const results = [];
  // Sequential is fine — manifest has <20 entries; parallelism would
  // be over-engineered and would risk masking a per-route rate-limit signal.
  for (const entry of manifest.pages) {
    // eslint-disable-next-line no-await-in-loop
    const result = await probePage({
      prodUrl,
      route: entry.route,
      sentinel: entry.sentinel,
      mustNotContain: entry.mustNotContain,
      userAgent: entry.userAgent,
      fetchImpl,
      timeoutMs,
    });
    results.push({ ...result, sentinel: entry.sentinel, description: entry.description });
  }
  const passed = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  return {
    generatedAt: new Date().toISOString(),
    prodUrl,
    manifestVersion: manifest.version,
    totalRoutes: results.length,
    passedCount: passed.length,
    failedCount: failed.length,
    verdict: failed.length === 0 ? 'pass' : 'fail',
    results,
  };
}

function renderHuman(report, { quiet = false } = {}) {
  const lines = [];
  if (!quiet) {
    for (const r of report.results) {
      if (r.ok) {
        lines.push(`✅ ${r.route.padEnd(20)}  HTTP ${r.status}  bytes=${r.bytes}  sentinel-OK`);
      } else if (r.error) {
        lines.push(`❌ ${r.route.padEnd(20)}  ERROR ${r.error}`);
      } else if (!r.sentinelPresent) {
        lines.push(`❌ ${r.route.padEnd(20)}  HTTP ${r.status}  sentinel MISSING (expected: ${JSON.stringify(r.sentinel)})`);
      } else if (Array.isArray(r.forbiddenPresent) && r.forbiddenPresent.length > 0) {
        lines.push(`❌ ${r.route.padEnd(20)}  HTTP ${r.status}  forbidden content PRESENT (${r.forbiddenPresent.map((value) => JSON.stringify(value)).join(', ')})`);
      } else {
        lines.push(`❌ ${r.route.padEnd(20)}  HTTP ${r.status}`);
      }
    }
  }
  lines.push(`\nSummary: ${report.passedCount}/${report.totalRoutes} pages passed against ${report.prodUrl} (verdict: ${report.verdict.toUpperCase()})`);
  return lines.join('\n');
}

async function main(argv) {
  const args = parseArgs(argv);
  let report;
  try {
    report = await runVerification({
      prodUrl: args.prodUrl,
      manifestPath: args.manifestPath,
      timeoutMs: args.timeoutMs,
    });
  } catch (error) {
    process.stderr.write(`verify-marketing-pages-deployed FAILED: ${error.message}\n`);
    process.exit(2);
  }
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderHuman(report, { quiet: args.quiet })}\n`);
  }
  process.exitCode = report.verdict === 'pass' ? 0 : 1;
}

module.exports = {
  DEFAULT_PROD_URL,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MANIFEST_PATH,
  parseArgs,
  loadManifest,
  probePage,
  runVerification,
  renderHuman,
};

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  main(process.argv.slice(2));
}
