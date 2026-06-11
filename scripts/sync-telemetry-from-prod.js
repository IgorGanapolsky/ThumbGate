#!/usr/bin/env node
'use strict';

/**
 * sync-telemetry-from-prod.js
 *
 * The agentic data pipeline (scripts/agentic-data-pipeline.js →
 * scripts/telemetry-analytics.js) computes `get_business_metrics` from the LOCAL
 * telemetry store at `<feedbackDir>/telemetry-pings.jsonl`. On a developer
 * machine that store is near-empty, so metrics read uniqueVisitors:0 /
 * checkoutStarts:0 even though real web traffic is flowing.
 *
 * The real web funnel lives on the PROD Railway volume and is exposed only via
 * the operator-key-gated endpoint `GET /v1/telemetry/export`. Both stores use the
 * SAME jsonl format/filename and matching fields (receivedAt/event/eventType/
 * installId/visitorId/sessionId/traceId), so a sync is a clean append + dedupe.
 *
 * This script:
 *   1. Resolves the operator (or admin) key from env or ~/.config/thumbgate/operator.json.
 *   2. GETs /v1/telemetry/export?source=both with `Authorization: Bearer <key>`.
 *   3. Merges/dedupes the returned `telemetry` rows into
 *      `<feedbackDir>/telemetry-pings.jsonl` (dedupe by a stable sha256 of the
 *      canonical row, so repeat runs never double-count).
 *   4. Optionally (`--funnel`) persists the returned `funnel` rows into
 *      `<feedbackDir>/funnel-events.jsonl` the same way.
 *
 * After a run, `get_business_metrics` reflects the real funnel because the
 * pipeline reads the same feedback dir on each call.
 *
 * SECURITY: the operator key is never printed. Only its source is reported.
 *
 * Usage:
 *   node scripts/sync-telemetry-from-prod.js [--since-days=30] [--since=<iso>]
 *        [--limit=10000] [--source=both|telemetry|funnel] [--funnel]
 *        [--base-url=<url>] [--feedback-dir=<dir>] [--json] [--dry-run]
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { getFeedbackPaths } = require('./feedback-loop');

const DEFAULT_BASE_URL = 'https://thumbgate-production.up.railway.app';
const OPERATOR_CONFIG_PATH = path.join(os.homedir(), '.config', 'thumbgate', 'operator.json');
const TELEMETRY_FILE_NAME = 'telemetry-pings.jsonl';
const FUNNEL_FILE_NAME = 'funnel-events.jsonl';
const EXPORT_PATH = '/v1/telemetry/export';
const HARD_LIMIT = 10000; // server clamps each stream to this
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Configure fetch proxy when running behind a corporate/sandbox proxy. Mirrors
// scripts/operational-summary.js so hosted reads behave the same everywhere.
(function configureProxy() {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy
    || process.env.HTTP_PROXY || process.env.http_proxy;
  if (!proxyUrl) return;
  try {
    const { ProxyAgent, setGlobalDispatcher } = require('undici');
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
  } catch {
    // undici not available — fetch will use the default dispatcher.
  }
}());

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function loadOperatorConfig(configPath = OPERATOR_CONFIG_PATH) {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return {
      operatorKey: normalizeText(parsed.operatorKey),
      baseUrl: normalizeText(parsed.baseUrl),
    };
  } catch {
    return { operatorKey: null, baseUrl: null };
  }
}

/**
 * Resolve the credential + base URL the same way scripts/operational-summary.js
 * does: env THUMBGATE_OPERATOR_KEY > operator.json operatorKey > env
 * THUMBGATE_API_KEY (admin keys are an accepted alternate auth path on the
 * export endpoint). `source` records WHERE the key came from for diagnostics —
 * the key value itself is never returned to callers that print it.
 */
function resolveOperatorConfig(options = {}) {
  const operatorConfig = loadOperatorConfig(options.configPath);
  let apiKey = normalizeText(process.env.THUMBGATE_OPERATOR_KEY);
  let keySource = apiKey ? 'env:THUMBGATE_OPERATOR_KEY' : null;
  if (!apiKey && operatorConfig.operatorKey) {
    apiKey = operatorConfig.operatorKey;
    keySource = 'operator.json';
  }
  if (!apiKey) {
    apiKey = normalizeText(process.env.THUMBGATE_API_KEY);
    keySource = apiKey ? 'env:THUMBGATE_API_KEY' : null;
  }
  const baseUrl = normalizeText(options.baseUrl)
    || normalizeText(process.env.THUMBGATE_SYNC_BASE_URL)
    || normalizeText(process.env.THUMBGATE_BILLING_API_BASE_URL)
    || operatorConfig.baseUrl
    || DEFAULT_BASE_URL;
  return { apiKey, keySource, baseUrl };
}

// Recursively sort object keys so structurally-identical rows serialize
// identically regardless of original key order.
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

// Stable dedupe id. sha256 (not sha1/md5 — SonarCloud S4790) over the canonical
// JSON of the whole row: identical rows → identical id across runs.
function stableRowId(row) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(row))).digest('hex');
}

// The export endpoint returns each stream as { rows: [...] }; older/simplified
// shapes may return a bare array. Accept both.
function extractRows(streamValue) {
  if (Array.isArray(streamValue)) return streamValue;
  if (streamValue && Array.isArray(streamValue.rows)) return streamValue.rows;
  return [];
}

/**
 * Fetch the telemetry export. `fetchImpl` is injectable so tests run without
 * network or secrets. Auth is `Authorization: Bearer <key>` — the server's
 * extractApiKey reads Bearer / x-api-key, NOT x-operator-key.
 */
async function fetchTelemetryExport(params = {}) {
  const {
    baseUrl,
    operatorKey,
    since,
    limit = HARD_LIMIT,
    source = 'both',
    fetchImpl = globalThis.fetch,
  } = params;
  if (!operatorKey) {
    const err = new Error('No operator/admin key available for telemetry export.');
    err.code = 'no_key';
    throw err;
  }
  if (typeof fetchImpl !== 'function') {
    const err = new Error('No fetch implementation available (Node >=18 or inject fetchImpl).');
    err.code = 'no_fetch';
    throw err;
  }
  const url = new URL(EXPORT_PATH, baseUrl || DEFAULT_BASE_URL);
  url.searchParams.set('source', source);
  url.searchParams.set('limit', String(Math.min(Math.max(1, Number(limit) || HARD_LIMIT), HARD_LIMIT)));
  if (since) url.searchParams.set('since', since);

  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${operatorKey}`,
      accept: 'application/json',
    },
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    const err = new Error(`Telemetry export failed: HTTP ${response.status} ${bodyText.slice(0, 200)}`);
    err.code = 'http_error';
    err.status = response.status;
    throw err;
  }
  return response.json();
}

// Read every stable id already present in a jsonl ledger (skips unparseable lines).
function readExistingIds(filePath) {
  const ids = new Set();
  if (!fs.existsSync(filePath)) return ids;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      ids.add(stableRowId(JSON.parse(line)));
    } catch {
      // Tolerate malformed historical lines.
    }
  }
  return ids;
}

/**
 * Append only rows whose stable id isn't already present. Pure aside from the
 * single append; safe to re-run. Returns { added, skipped }.
 */
function mergeRowsIntoLedger(filePath, rows, options = {}) {
  const existing = options.existingIds || readExistingIds(filePath);
  const toAppend = [];
  let skipped = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') { skipped += 1; continue; }
    const id = stableRowId(row);
    if (existing.has(id)) { skipped += 1; continue; }
    existing.add(id);
    toAppend.push(JSON.stringify(row));
  }
  if (toAppend.length && !options.dryRun) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, toAppend.map((l) => `${l}\n`).join(''), 'utf8');
  }
  return { added: toAppend.length, skipped };
}

function resolveFeedbackDir(options = {}) {
  if (options.feedbackDir) return path.resolve(options.feedbackDir);
  return getFeedbackPaths().FEEDBACK_DIR;
}

// Resolve the `since` ISO timestamp: an explicit --since wins; otherwise derive
// it from --since-days relative to nowMs (test-injectable) or the current time.
function computeSinceIso(options = {}) {
  if (options.since) return options.since;
  if (!Number.isFinite(options.sinceDays)) return undefined;
  const baseMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  return new Date(baseMs - options.sinceDays * MS_PER_DAY).toISOString();
}

/**
 * End-to-end sync: fetch export → merge telemetry (always) and funnel (opt-in).
 * Returns a summary object with counts and resolved paths (no secrets).
 */
async function syncTelemetryFromProd(options = {}) {
  const config = resolveOperatorConfig(options);
  const feedbackDir = resolveFeedbackDir(options);
  const source = options.source || (options.funnel ? 'both' : 'telemetry');
  const sinceIso = computeSinceIso(options);

  const payload = await fetchTelemetryExport({
    baseUrl: config.baseUrl,
    operatorKey: config.apiKey,
    since: sinceIso,
    limit: options.limit || HARD_LIMIT,
    source,
    fetchImpl: options.fetchImpl,
  });

  const telemetryRows = extractRows(payload.telemetry);
  const telemetryPath = path.join(feedbackDir, TELEMETRY_FILE_NAME);
  const telemetryResult = mergeRowsIntoLedger(telemetryPath, telemetryRows, { dryRun: options.dryRun });

  const summary = {
    feedbackDir,
    baseUrl: config.baseUrl,
    keySource: config.keySource,
    source,
    since: payload.since || sinceIso || null,
    dryRun: !!options.dryRun,
    telemetry: {
      path: telemetryPath,
      fetched: telemetryRows.length,
      added: telemetryResult.added,
      skipped: telemetryResult.skipped,
    },
    funnel: null,
  };

  if (options.funnel) {
    const funnelRows = extractRows(payload.funnel);
    const funnelPath = path.join(feedbackDir, FUNNEL_FILE_NAME);
    const funnelResult = mergeRowsIntoLedger(funnelPath, funnelRows, { dryRun: options.dryRun });
    summary.funnel = {
      path: funnelPath,
      fetched: funnelRows.length,
      added: funnelResult.added,
      skipped: funnelResult.skipped,
    };
  }

  return summary;
}

function parseArgs(argv) {
  const opts = { sinceDays: 30, funnel: false, json: false, dryRun: false };
  for (const arg of argv) {
    if (arg === '--funnel') opts.funnel = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg.startsWith('--since-days=')) opts.sinceDays = Number(arg.split('=')[1]);
    else if (arg.startsWith('--since=')) opts.since = arg.split('=').slice(1).join('=');
    else if (arg.startsWith('--limit=')) opts.limit = Number(arg.split('=')[1]);
    else if (arg.startsWith('--source=')) opts.source = arg.split('=')[1];
    else if (arg.startsWith('--base-url=')) opts.baseUrl = arg.split('=').slice(1).join('=');
    else if (arg.startsWith('--feedback-dir=')) opts.feedbackDir = arg.split('=').slice(1).join('=');
  }
  if (!Number.isFinite(opts.sinceDays)) opts.sinceDays = 30;
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const preflight = resolveOperatorConfig(opts);
  if (!preflight.apiKey) {
    console.error(
      'No operator/admin key found. Set THUMBGATE_OPERATOR_KEY (or THUMBGATE_API_KEY), '
      + 'or add operatorKey to ~/.config/thumbgate/operator.json. '
      + 'The key lives in Railway prod env as THUMBGATE_OPERATOR_KEY.'
    );
    process.exitCode = 1;
    return;
  }
  try {
    const summary = await syncTelemetryFromProd(opts);
    if (opts.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      const t = summary.telemetry;
      console.log(`✅ Telemetry sync${summary.dryRun ? ' (dry-run)' : ''} complete`);
      console.log(`   source=${summary.source} since=${summary.since || 'server-default'} via ${summary.keySource}`);
      console.log(`   telemetry: ${t.fetched} fetched → ${t.added} added, ${t.skipped} already present`);
      console.log(`   → ${t.path}`);
      if (summary.funnel) {
        const f = summary.funnel;
        console.log(`   funnel: ${f.fetched} fetched → ${f.added} added, ${f.skipped} already present`);
        console.log(`   → ${f.path}`);
      }
    }
  } catch (err) {
    console.error(`❌ Telemetry sync failed: ${err.message}`);
    process.exitCode = 1;
  }
}

// Path-based entrypoint check (require.main === module is flagged by SonarCloud S3403).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}

module.exports = {
  DEFAULT_BASE_URL,
  TELEMETRY_FILE_NAME,
  FUNNEL_FILE_NAME,
  HARD_LIMIT,
  canonicalize,
  stableRowId,
  extractRows,
  loadOperatorConfig,
  resolveOperatorConfig,
  fetchTelemetryExport,
  readExistingIds,
  mergeRowsIntoLedger,
  resolveFeedbackDir,
  computeSinceIso,
  syncTelemetryFromProd,
  parseArgs,
};
