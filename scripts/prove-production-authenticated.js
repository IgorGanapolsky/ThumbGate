#!/usr/bin/env node
'use strict';

const path = require('node:path');

const DEFAULT_BASE_URL = 'https://thumbgate-production.up.railway.app';
// Public buyer origin plus Railway hostname. Deploy workflows may probe either
// (vars.THUMBGATE_PUBLIC_APP_ORIGIN defaults to thumbgate.ai in production CI).
const DEFAULT_PRODUCTION_PROOF_HOSTS = Object.freeze([
  'thumbgate-production.up.railway.app',
  'thumbgate.ai',
  'www.thumbgate.ai',
]);
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 2_000;

function normalizeBaseUrl(value) {
  const raw = String(value || DEFAULT_BASE_URL).trim();
  try {
    const parsed = new URL(raw);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.origin;
  } catch {
    return '';
  }
}

function buildProductionHostAllowlist(allowedHosts = [], env = process.env) {
  const configuredHosts = String(env.THUMBGATE_PROD_ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return new Set([
    ...DEFAULT_PRODUCTION_PROOF_HOSTS,
    ...configuredHosts,
    ...allowedHosts.map((host) => String(host || '').trim().toLowerCase()).filter(Boolean),
  ]);
}

function validateBaseUrl(value, allowedHosts = []) {
  const raw = String(value || DEFAULT_BASE_URL).trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { valid: false, baseUrl: '', reason: 'Production URL is invalid' };
  }

  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  const allowlist = buildProductionHostAllowlist(allowedHosts);
  const hostname = parsed.hostname.toLowerCase();
  const isLoopback = loopbackHosts.has(hostname);
  const safeBaseUrl = parsed.origin;
  const hasUnexpectedComponents = Boolean(
    parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || (parsed.pathname && parsed.pathname !== '/'),
  );
  const protocolAllowed = parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLoopback);
  const hostAllowed = isLoopback || allowlist.has(parsed.host.toLowerCase());

  if (hasUnexpectedComponents || !protocolAllowed || !hostAllowed) {
    return {
      valid: false,
      baseUrl: safeBaseUrl,
      reason: 'Production URL is outside the credential-safe allowlist',
    };
  }
  return { valid: true, baseUrl: safeBaseUrl, reason: null };
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseArgs(argv = []) {
  const options = {
    baseUrl: process.env.THUMBGATE_PROD_URL || DEFAULT_BASE_URL,
    expectedSha: process.env.GITHUB_SHA || '',
    expectedVersion: process.env.THUMBGATE_EXPECTED_VERSION || '',
    query: 'thumbgate',
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    retryDelayMs: DEFAULT_RETRY_DELAY_MS,
    json: false,
  };

  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    else if (arg.startsWith('--base-url=')) options.baseUrl = arg.slice('--base-url='.length);
    else if (arg.startsWith('--expected-sha=')) options.expectedSha = arg.slice('--expected-sha='.length);
    else if (arg.startsWith('--expected-version=')) options.expectedVersion = arg.slice('--expected-version='.length);
    else if (arg.startsWith('--query=')) options.query = arg.slice('--query='.length);
    else if (arg.startsWith('--timeout-ms=')) options.timeoutMs = parsePositiveInteger(arg.slice('--timeout-ms='.length), DEFAULT_TIMEOUT_MS);
    else if (arg.startsWith('--max-attempts=')) options.maxAttempts = parsePositiveInteger(arg.slice('--max-attempts='.length), DEFAULT_MAX_ATTEMPTS);
    else if (arg.startsWith('--retry-delay-ms=')) options.retryDelayMs = parsePositiveInteger(arg.slice('--retry-delay-ms='.length), DEFAULT_RETRY_DELAY_MS);
  }

  options.baseUrl = normalizeBaseUrl(options.baseUrl);
  options.expectedSha = String(options.expectedSha || '').trim();
  options.expectedVersion = String(options.expectedVersion || '').trim();
  options.query = String(options.query || 'thumbgate').trim() || 'thumbgate';
  return options;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeDiagnosticText(value, secrets = []) {
  let text = String(value || '').trim();
  for (const secret of secrets) {
    const normalized = String(secret || '').trim();
    if (normalized) text = text.split(normalized).join('[REDACTED]');
  }
  return text.slice(0, 500) || null;
}

function buildProblemDiagnostics(body, apiKey) {
  if (!isObject(body)) return {};
  return {
    problemType: sanitizeDiagnosticText(body.type || body.code, [apiKey]),
    problemTitle: sanitizeDiagnosticText(body.title || body.error, [apiKey]),
    problemDetail: sanitizeDiagnosticText(body.detail || body.message, [apiKey]),
  };
}

function buildChecks({
  expectedSha = '',
  expectedVersion = '',
  query = 'thumbgate',
  expectedDashboardSource = 'live',
} = {}) {
  const normalizedQuery = String(query || 'thumbgate').trim() || 'thumbgate';
  const encodedQuery = encodeURIComponent(normalizedQuery);
  return [
    {
      name: 'health_identity',
      method: 'GET',
      path: '/health',
      authenticated: false,
      validate(body) {
        const identityMatches = (!expectedSha || body.buildSha === expectedSha)
          && (!expectedVersion || body.version === expectedVersion);
        return {
          valid: body.status === 'ok' && body.degraded === false && identityMatches,
          metrics: {
            status: body.status || null,
            degraded: body.degraded,
            version: body.version || null,
            buildSha: body.buildSha || null,
          },
        };
      },
    },
    {
      name: 'auth_boundary',
      method: 'GET',
      path: `/v1/search?q=${encodedQuery}&limit=1`,
      authenticated: false,
      expectedStatuses: [401, 403],
      bodyOptional: true,
      validate(_body, status) {
        return {
          valid: status === 401 || status === 403,
          metrics: { rejectedStatus: status },
        };
      },
    },
    {
      name: 'search',
      method: 'GET',
      path: `/v1/search?q=${encodedQuery}&limit=3`,
      authenticated: true,
      validate(body) {
        const count = Array.isArray(body.results) ? body.results.length : -1;
        const validResults = Array.isArray(body.results)
          && body.results.every((result) => isObject(result)
            && ['feedback', 'contextfs', 'prevention_rule', 'document'].includes(result.source)
            && Number.isFinite(result.score)
            && (String(result.id || '').trim() || String(result.title || result.context || '').trim()));
        return {
          valid: body.query === normalizedQuery
            && body.source === 'all'
            && body.engine === 'hybrid-parent-child'
            && count > 0
            && body.returned === count
            && Number.isFinite(body.total)
            && body.total >= count
            && validResults,
          metrics: {
            results: Math.max(0, count),
            returned: Number.isFinite(body.returned) ? body.returned : null,
            engine: typeof body.engine === 'string' ? body.engine : null,
          },
        };
      },
    },
    {
      name: 'lesson_search',
      method: 'GET',
      path: `/v1/lessons/search?q=${encodedQuery}&limit=3`,
      authenticated: true,
      validate(body) {
        const count = Array.isArray(body.results) ? body.results.length : -1;
        const validResults = Array.isArray(body.results)
          && body.results.every((result) => isObject(result)
            && String(result.id || '').trim()
            && Number.isFinite(result.evidenceScore)
            && result.evidenceScore > 0);
        return {
          valid: body.query === normalizedQuery
            && typeof body.backend === 'string'
            && body.backend.length > 0
            && count > 0
            && body.returned === count
            && Number.isFinite(body.totalLessons)
            && body.totalLessons >= count
            && validResults,
          metrics: {
            results: Math.max(0, count),
            returned: Number.isFinite(body.returned) ? body.returned : null,
            totalLessons: Number.isFinite(body.totalLessons) ? body.totalLessons : null,
          },
        };
      },
    },
    {
      name: 'dashboard_data',
      method: 'GET',
      path: '/v1/dashboard',
      authenticated: true,
      validate(body) {
        const keyCount = isObject(body) ? Object.keys(body).length : 0;
        const source = isObject(body.operational) ? body.operational.source : null;
        const approvalTotal = isObject(body.approval) ? body.approval.total : null;
        const totalGates = isObject(body.gateStats) ? body.gateStats.totalGates : null;
        return {
          valid: source === expectedDashboardSource
            && Number.isFinite(approvalTotal)
            && Number.isFinite(totalGates)
            && isObject(body.health)
            && isObject(body.harness)
            && isObject(body.liveMetrics)
            && isObject(body.lessonPipeline),
          metrics: {
            topLevelKeys: keyCount,
            source,
            approvalTotal: Number.isFinite(approvalTotal) ? approvalTotal : null,
            totalGates: Number.isFinite(totalGates) ? totalGates : null,
          },
        };
      },
    },
    {
      name: 'dpo_export',
      method: 'POST',
      path: '/v1/dpo/export',
      authenticated: true,
      body: { includePairs: true },
      validate(body) {
        const pairs = Number.isFinite(body.pairCount) ? body.pairCount : body.pairs;
        const records = Array.isArray(body.records) ? body.records : [];
        const validRecords = records.every((record) => isObject(record)
          && String(record.prompt || '').trim()
          && String(record.chosen || '').trim()
          && String(record.rejected || '').trim());
        return {
          valid: Number.isFinite(pairs)
            && pairs > 0
            && records.length === pairs
            && validRecords
            && Number.isFinite(body.errors)
            && body.errors > 0
            && Number.isFinite(body.learnings)
            && body.learnings > 0
            && (body.outputPath === null || body.outputPath === undefined),
          metrics: {
            pairs: Number.isFinite(pairs) ? pairs : null,
            errors: Number.isFinite(body.errors) ? body.errors : null,
            learnings: Number.isFinite(body.learnings) ? body.learnings : null,
          },
        };
      },
    },
  ];
}

async function probeCheck(check, options) {
  const {
    apiKey,
    baseUrl,
    fetchImpl,
    timeoutMs,
    maxAttempts,
    retryDelayMs,
  } = options;

  let lastResult = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    try {
      const headers = buildRequestHeaders(check, apiKey);
      const response = await fetchImpl(`${baseUrl}${check.path}`, {
        method: check.method,
        headers,
        body: check.body ? JSON.stringify(check.body) : undefined,
        signal: controller.signal,
      });
      const body = await readJsonBody(response);
      const acceptedStatus = Array.isArray(check.expectedStatuses)
        ? check.expectedStatuses.includes(response.status)
        : response.ok;
      const validation = (isObject(body) || check.bodyOptional)
        ? check.validate(body, response.status)
        : { valid: false, metrics: {} };
      lastResult = {
        name: check.name,
        ok: acceptedStatus && validation.valid,
        status: response.status,
        attempts: attempt,
        durationMs: Date.now() - startedAt,
        schemaValid: Boolean(validation.valid),
        ...buildProblemDiagnostics(body, apiKey),
        ...validation.metrics,
      };
      const retryableStatus = response.status >= 500 || [408, 425, 429].includes(response.status);
      const retryableValidationLag = response.ok && !validation.valid;
      if (lastResult.ok || (!retryableStatus && !retryableValidationLag)) return lastResult;
    } catch (error) {
      lastResult = {
        name: check.name,
        ok: false,
        status: null,
        attempts: attempt,
        durationMs: Date.now() - startedAt,
        schemaValid: false,
        error: error?.name === 'AbortError' ? 'timeout' : 'request_failed',
      };
    } finally {
      clearTimeout(timer);
    }

    if (attempt < maxAttempts) await delay(retryDelayMs);
  }
  return lastResult;
}

function buildRequestHeaders(check, apiKey) {
  const headers = { accept: 'application/json' };
  if (check.authenticated) headers.authorization = `Bearer ${apiKey}`;
  if (check.body) headers['content-type'] = 'application/json';
  return headers;
}

async function readJsonBody(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function runAuthenticatedProductionProof(options = {}) {
  const expectedSha = String(options.expectedSha || '').trim();
  const expectedVersion = String(options.expectedVersion || '').trim();
  const validatedUrl = validateBaseUrl(options.baseUrl, options.allowedHosts || []);
  if (!validatedUrl.valid) {
    return {
      verdict: 'fail',
      reason: validatedUrl.reason,
      baseUrl: validatedUrl.baseUrl,
      checks: [],
    };
  }
  if (!expectedSha || !expectedVersion) {
    return {
      verdict: 'fail',
      reason: 'Exact expected SHA and version are required',
      baseUrl: validatedUrl.baseUrl,
      checks: [],
    };
  }
  const apiKeyInput = Object.hasOwn(options, 'apiKey')
    ? options.apiKey
    : process.env.THUMBGATE_API_KEY;
  const apiKey = String(apiKeyInput || '').trim();
  if (!apiKey) {
    return {
      verdict: 'fail',
      reason: 'THUMBGATE_API_KEY is unavailable',
      baseUrl: validatedUrl.baseUrl,
      checks: [],
    };
  }

  const normalized = {
    apiKey,
    baseUrl: validatedUrl.baseUrl,
    fetchImpl: options.fetchImpl || globalThis.fetch,
    timeoutMs: parsePositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS),
    maxAttempts: parsePositiveInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS),
    retryDelayMs: parsePositiveInteger(options.retryDelayMs, DEFAULT_RETRY_DELAY_MS),
  };
  if (typeof normalized.fetchImpl !== 'function') {
    return {
      verdict: 'fail',
      reason: 'fetch is unavailable',
      baseUrl: normalized.baseUrl,
      checks: [],
    };
  }

  const checks = [];
  for (const check of buildChecks(options)) {
    checks.push(await probeCheck(check, normalized));
  }

  return {
    verdict: checks.every((check) => check.ok) ? 'pass' : 'fail',
    baseUrl: normalized.baseUrl,
    expectedSha,
    expectedVersion,
    checks,
  };
}

function renderHuman(report) {
  const lines = [`Authenticated production proof: ${report.verdict.toUpperCase()}`];
  for (const check of report.checks || []) {
    lines.push(`${check.ok ? 'PASS' : 'FAIL'} ${check.name} status=${check.status ?? 'none'} attempts=${check.attempts}`);
  }
  if (report.reason) lines.push(`Reason: ${report.reason}`);
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await runAuthenticatedProductionProof({
    ...args,
    apiKey: process.env.THUMBGATE_API_KEY,
  });
  process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : renderHuman(report));
  if (report.verdict !== 'pass') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().catch(() => {
    process.stderr.write('Authenticated production proof failed unexpectedly.\n');
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_PRODUCTION_PROOF_HOSTS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_RETRY_DELAY_MS,
  normalizeBaseUrl,
  buildProductionHostAllowlist,
  validateBaseUrl,
  parseArgs,
  buildChecks,
  probeCheck,
  runAuthenticatedProductionProof,
  renderHuman,
};
