#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveHostedBillingConfig } = require('./hosted-config');

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const OPERATOR_CONFIG_PATH = path.join(os.homedir(), '.config', 'thumbgate', 'operator.json');
const ALLOWED_STATUSES = new Set([
  'all',
  'new',
  'qualified',
  'named_pilot',
  'proof_backed_run',
  'paid_team',
]);
const ALLOWED_PRIORITY_BANDS = new Set(['review_now', 'review_next', 'hold_or_nurture']);
const ALLOWED_FIT_BANDS = new Set(['strong_evidence_for_review', 'partial_evidence', 'incomplete_evidence']);
const ALLOWED_ROUTES = new Set(['diagnostic', 'close', 'nurture', 'disqualify']);
const ALLOWED_OPERATOR_STEPS = new Set([
  'request_action_time_approval',
  'request_action_time_approval_for_discovery',
  'review_and_qualify',
  'prepare_scope_or_hold',
]);
const ALLOWED_CLOSE_STATUSES = new Set(['approval_ready_not_authorized', 'hold_not_approval_ready']);
const ALLOWED_DISCOVERY_STATUSES = new Set(['approval_ready_not_authorized', 'hold_not_approval_ready']);
const ALLOWED_UNKNOWNS = new Set([
  'contactEmail',
  'workflow',
  'owner',
  'repeatedFailure',
  'runtime',
  'urgencyAndTrigger',
  'measurableCurrentImpact',
  'decisionAuthority',
  'budgetMechanism',
  'priceUnderstanding',
  'proofRequiredToDecide',
]);
const ALLOWED_CLOSE_BLOCKERS = new Set([
  'qualification_review_unverified',
  'lifecycle_not_evidence_qualified',
  'intake_not_current',
  'contact_path_missing',
  'contact_path_invalid',
  'material_unknowns_remaining',
  'price_understanding_unconfirmed',
  'offer_unavailable',
  'route_not_closeable',
  'checkout_url_unavailable',
]);
const ALLOWED_DISCOVERY_BLOCKERS = new Set([
  'lifecycle_not_new',
  'intake_not_current',
  'contact_path_missing',
  'contact_path_invalid',
  'no_material_questions',
  'disqualified',
  'zero_spend_unverified',
]);
const ALLOWED_OFFER_IDS = new Set([
  'workflow_hardening_diagnostic',
  'workflow_hardening_sprint',
  'workflow_reliability_operations',
  'enterprise_governance_pilot',
  'enterprise_reliability_operations',
]);

function queueError(code, message, status = null) {
  const error = new Error(message);
  error.code = code;
  if (status !== null) error.status = status;
  return error;
}

function parsePositiveInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw queueError('invalid_argument', `${label} must be an integer from 1 to ${maximum}.`);
  }
  return parsed;
}

function parseArgs(argv = []) {
  const options = {
    json: false,
    statuses: ['new', 'qualified'],
    limit: DEFAULT_LIMIT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    exportPrivatePath: null,
  };

  for (const arg of argv) {
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg.startsWith('--status=')) {
      const statuses = [...new Set(arg.slice('--status='.length)
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean))];
      if (statuses.length === 0 || statuses.some((status) => !ALLOWED_STATUSES.has(status)) ||
          (statuses.includes('all') && statuses.length !== 1)) {
        throw queueError(
          'invalid_argument',
          `status must be all or a comma-separated subset of ${[...ALLOWED_STATUSES].filter((value) => value !== 'all').join(', ')}.`
        );
      }
      options.statuses = statuses;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger(arg.slice('--limit='.length), 'limit', MAX_LIMIT);
      continue;
    }
    if (arg.startsWith('--timeout-ms=')) {
      options.timeoutMs = parsePositiveInteger(arg.slice('--timeout-ms='.length), 'timeout-ms', 120000);
      continue;
    }
    if (arg.startsWith('--export-private=')) {
      const outputPath = arg.slice('--export-private='.length).trim();
      if (!outputPath || !path.isAbsolute(outputPath)) {
        throw queueError('invalid_argument', 'export-private must be an absolute local file path.');
      }
      options.exportPrivatePath = path.resolve(outputPath);
      continue;
    }
    throw queueError('invalid_argument', `Unknown argument: ${arg}`);
  }

  return options;
}

function normalizeText(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function loadOperatorConfig(configPath = OPERATOR_CONFIG_PATH) {
  try {
    const stat = fs.lstatSync(configPath);
    if (!stat.isFile() || stat.isSymbolicLink()) return { operatorKey: null, baseUrl: null };
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
      return { operatorKey: null, baseUrl: null };
    }
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return {
      operatorKey: normalizeText(parsed.operatorKey),
      baseUrl: normalizeText(parsed.baseUrl),
    };
  } catch {
    return { operatorKey: null, baseUrl: null };
  }
}

function resolveHostedQueueConfig(env = process.env, operatorConfig = loadOperatorConfig()) {
  const runtime = resolveHostedBillingConfig();
  return {
    apiBaseUrl: normalizeText(env.THUMBGATE_BILLING_API_BASE_URL)
      || normalizeText(operatorConfig.baseUrl)
      || runtime.billingApiBaseUrl,
    apiKey: normalizeText(env.THUMBGATE_OPERATOR_KEY)
      || normalizeText(operatorConfig.operatorKey)
      || normalizeText(env.THUMBGATE_API_KEY),
  };
}

function validateHostedConfig(config = {}) {
  const apiBaseUrl = String(config.apiBaseUrl || '').trim();
  const apiKey = String(config.apiKey || '').trim();
  if (!apiBaseUrl || !apiKey) {
    throw queueError(
      'operator_config_missing',
      'Hosted intake queue is not configured. Set THUMBGATE_OPERATOR_KEY or configure the local ThumbGate operator file.'
    );
  }
  let parsed;
  try {
    parsed = new URL(apiBaseUrl);
  } catch {
    throw queueError('operator_config_invalid', 'Hosted intake queue base URL is invalid.');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw queueError(
      'operator_config_invalid',
      'Hosted intake queue base URL must not contain credentials, query parameters, or fragments.'
    );
  }
  const localHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !localHttp) {
    throw queueError('operator_config_invalid', 'Hosted intake queue requires HTTPS outside localhost.');
  }
  return { apiBaseUrl: parsed.toString(), apiKey };
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw queueError('intake_queue_timeout', `Hosted intake queue timed out after ${timeoutMs}ms.`);
    }
    throw queueError('intake_queue_unreachable', 'Hosted intake queue could not be reached.');
  } finally {
    clearTimeout(timer);
  }
}

function assertPrivateResponse(response) {
  const cacheControl = String(response.headers?.get?.('cache-control') || '').toLowerCase();
  const vary = String(response.headers?.get?.('vary') || '').toLowerCase();
  if (!cacheControl.includes('private') || !cacheControl.includes('no-store') ||
      !vary.split(',').map((value) => value.trim()).includes('authorization')) {
    throw queueError(
      'unsafe_cache_policy',
      'Hosted intake queue response is missing the required private, no-store, Vary: Authorization cache policy.'
    );
  }
}

function validateQueuePayload(payload) {
  const counters = payload && typeof payload === 'object' ? [
    payload.total,
    payload.eligibleTotal,
    payload.returned,
    payload.approvalReadyTotal,
    payload.discoveryReadyTotal,
  ] : [];
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.leads) ||
      counters.some((value) => !Number.isSafeInteger(value) || value < 0) ||
      payload.eligibleTotal > payload.total || payload.returned !== payload.leads.length ||
      payload.returned > payload.eligibleTotal ||
      payload.approvalReadyTotal + payload.discoveryReadyTotal > payload.eligibleTotal) {
    throw queueError('invalid_queue_payload', 'Hosted intake queue returned an invalid payload.');
  }
  return payload;
}

function leadRef(leadId) {
  return crypto.createHash('sha256').update(String(leadId || '')).digest('hex').slice(0, 12);
}

function allowlistedText(value, allowed) {
  const normalized = String(value || '').trim();
  return allowed.has(normalized) ? normalized : null;
}

function allowlistedList(values, allowed) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => allowlistedText(value, allowed)).filter(Boolean))];
}

function safeTimestamp(value) {
  const parsed = new Date(String(value || ''));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function summarizeLead(lead = {}) {
  const card = lead.qualificationCard || {};
  const discoveryPacket = lead.discoveryPacket || {};
  const closePacket = lead.closePacket || {};
  const closeOfferId = allowlistedText(closePacket.offer?.offerId, ALLOWED_OFFER_IDS);
  const recommendedOfferId = allowlistedText(card.recommendedOffer?.offerId, ALLOWED_OFFER_IDS);
  const closePriceCents = Number.isSafeInteger(closePacket.offer?.priceCents) && closePacket.offer.priceCents >= 0
    ? closePacket.offer.priceCents
    : null;
  const recommendedPriceCents = Number.isSafeInteger(card.recommendedOffer?.priceCents) && card.recommendedOffer.priceCents >= 0
    ? card.recommendedOffer.priceCents
    : null;
  return {
    ref: leadRef(lead.leadId),
    submittedAt: safeTimestamp(lead.submittedAt),
    updatedAt: safeTimestamp(lead.updatedAt),
    lifecycleStatus: allowlistedText(lead.status, ALLOWED_STATUSES),
    priorityRank: Number.isInteger(lead.priorityRank) ? lead.priorityRank : null,
    priorityScore: Number.isFinite(card.priorityScore) ? card.priorityScore : null,
    priorityBand: allowlistedText(card.priorityBand, ALLOWED_PRIORITY_BANDS),
    fitBand: allowlistedText(card.fitBand, ALLOWED_FIT_BANDS),
    route: allowlistedText(card.route, ALLOWED_ROUTES),
    unknowns: allowlistedList(card.unknowns, ALLOWED_UNKNOWNS),
    nextOperatorStep: allowlistedText(lead.nextOperatorStep, ALLOWED_OPERATOR_STEPS),
    discoveryStatus: allowlistedText(discoveryPacket.status, ALLOWED_DISCOVERY_STATUSES),
    discoveryBlockers: allowlistedList(discoveryPacket.blockers, ALLOWED_DISCOVERY_BLOCKERS),
    closeStatus: allowlistedText(closePacket.status, ALLOWED_CLOSE_STATUSES),
    closeBlockers: allowlistedList(closePacket.blockers, ALLOWED_CLOSE_BLOCKERS),
    offerId: closeOfferId || recommendedOfferId,
    priceCents: closePriceCents ?? recommendedPriceCents,
  };
}

function summarizeQueue(payload, apiBaseUrl) {
  const byStatus = {};
  for (const status of ALLOWED_STATUSES) {
    if (status === 'all') continue;
    const count = payload.byStatus?.[status];
    if (Number.isSafeInteger(count) && count >= 0) byStatus[status] = count;
  }
  return {
    generatedAt: safeTimestamp(payload.generatedAt),
    source: 'hosted_operator_intake_queue',
    apiOrigin: new URL(apiBaseUrl).origin,
    queueAvailable: true,
    total: payload.total,
    eligibleTotal: payload.eligibleTotal,
    returned: Number.isInteger(payload.returned) ? payload.returned : payload.leads.length,
    approvalReadyTotal: payload.approvalReadyTotal,
    discoveryReadyTotal: payload.discoveryReadyTotal,
    primaryApprovalActionAvailable: Boolean(payload.primaryApprovalAction),
    primaryDiscoveryActionAvailable: Boolean(payload.primaryDiscoveryAction),
    byStatus,
    filters: {
      statuses: allowlistedList(payload.filters?.statuses, ALLOWED_STATUSES),
      limit: Number.isInteger(payload.filters?.limit) ? payload.filters.limit : null,
    },
    latestSubmittedAt: safeTimestamp(payload.latestSubmittedAt),
    oldestSubmittedAt: safeTimestamp(payload.oldestSubmittedAt),
    leads: payload.leads.map(summarizeLead),
    privacy: {
      contactDetailsIncluded: false,
      draftsIncluded: false,
      approvalTokensIncluded: false,
      rawLeadIdsIncluded: false,
    },
    externalActionAuthorized: false,
    revenueRecognized: false,
  };
}

function exportPrivateQueue(payload, outputPath) {
  const parent = path.dirname(outputPath);
  const realParent = fs.realpathSync(parent);
  const safePath = path.join(realParent, path.basename(outputPath));
  const serialized = `${JSON.stringify({
    exportedAt: new Date().toISOString(),
    sensitivity: 'private_buyer_intake_do_not_commit_or_share',
    externalActionAuthorized: false,
    revenueRecognized: false,
    queue: payload,
  }, null, 2)}\n`;
  fs.writeFileSync(safePath, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  fs.chmodSync(safePath, 0o600);
  const stat = fs.statSync(safePath);
  return {
    path: safePath,
    bytes: stat.size,
    mode: (stat.mode & 0o777).toString(8).padStart(3, '0'),
    sha256: crypto.createHash('sha256').update(serialized).digest('hex'),
  };
}

async function fetchWorkflowIntakeQueue(options = {}, config = resolveHostedQueueConfig(), fetchImpl = fetch) {
  const effectiveOptions = {
    statuses: Array.isArray(options.statuses) ? options.statuses : ['new', 'qualified'],
    limit: Number.isInteger(options.limit) ? options.limit : DEFAULT_LIMIT,
    timeoutMs: Number.isInteger(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS,
  };
  const hosted = validateHostedConfig(config);
  const url = new URL('/v1/intake/workflow-sprint/queue', hosted.apiBaseUrl);
  url.searchParams.set('status', effectiveOptions.statuses.join(','));
  url.searchParams.set('limit', String(effectiveOptions.limit));
  const response = await fetchWithTimeout(fetchImpl, url, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${hosted.apiKey}`,
      accept: 'application/json',
    },
  }, effectiveOptions.timeoutMs);

  if (response.status === 404) {
    throw queueError(
      'release_required',
      'Production does not expose the authenticated intake queue yet; deploy the reviewed revenue-evidence candidate first.',
      404
    );
  }
  if (response.status === 401 || response.status === 403) {
    const authProbeUrl = new URL('/v1/billing/summary?window=today', hosted.apiBaseUrl);
    let authProbe = null;
    try {
      authProbe = await fetchWithTimeout(fetchImpl, authProbeUrl, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${hosted.apiKey}`,
          accept: 'application/json',
        },
      }, effectiveOptions.timeoutMs);
    } catch {
      // Keep the original queue authorization result authoritative when the
      // compatibility probe is unavailable.
    }
    if (authProbe?.ok) {
      throw queueError(
        'release_required',
        'Production accepts the operator key but does not enable the authenticated intake queue yet; deploy the reviewed revenue-evidence candidate first.',
        response.status
      );
    }
    throw queueError('operator_credentials_rejected', 'Hosted intake queue rejected operator credentials.', response.status);
  }
  if (!response.ok) {
    throw queueError('intake_queue_http_error', `Hosted intake queue returned HTTP ${response.status}.`, response.status);
  }
  assertPrivateResponse(response);
  const payload = validateQueuePayload(await response.json());
  return { payload, summary: summarizeQueue(payload, hosted.apiBaseUrl) };
}

function formatSummary(summary, privateExport = null) {
  const lines = [
    'ThumbGate hosted intake close queue',
    `Source: ${summary.source}`,
    `Total: ${summary.total} | eligible: ${summary.eligibleTotal} | returned: ${summary.returned}`,
    `Approval-ready: ${summary.approvalReadyTotal} (not authorized to send)`,
    `Discovery-ready: ${summary.discoveryReadyTotal} (not authorized to send)`,
    `Status: ${Object.entries(summary.byStatus).map(([key, value]) => `${key}=${value}`).join(', ') || 'none'}`,
    `Latest: ${summary.latestSubmittedAt || 'none'}`,
    'Privacy: buyer details, drafts, approval tokens, and raw lead IDs are withheld from terminal output.',
    'Revenue recognized: no',
  ];
  if (privateExport) {
    lines.push(`Private export: ${privateExport.path}`);
    lines.push(`Private export proof: bytes=${privateExport.bytes} mode=${privateExport.mode} sha256=${privateExport.sha256}`);
  }
  return `${lines.join('\n')}\n`;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const { payload, summary } = await fetchWorkflowIntakeQueue(options);
  const privateExport = options.exportPrivatePath
    ? exportPrivateQueue(payload, options.exportPrivatePath)
    : null;
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ...summary, privateExport }, null, 2)}\n`);
    return;
  }
  process.stdout.write(formatSummary(summary, privateExport));
}

module.exports = {
  ALLOWED_STATUSES,
  ALLOWED_CLOSE_BLOCKERS,
  ALLOWED_DISCOVERY_BLOCKERS,
  ALLOWED_OFFER_IDS,
  ALLOWED_UNKNOWNS,
  DEFAULT_LIMIT,
  DEFAULT_TIMEOUT_MS,
  MAX_LIMIT,
  OPERATOR_CONFIG_PATH,
  parseArgs,
  loadOperatorConfig,
  resolveHostedQueueConfig,
  validateHostedConfig,
  assertPrivateResponse,
  validateQueuePayload,
  leadRef,
  allowlistedText,
  allowlistedList,
  safeTimestamp,
  summarizeLead,
  summarizeQueue,
  exportPrivateQueue,
  fetchWorkflowIntakeQueue,
  formatSummary,
  main,
};

if (require.main === module) { // NOSONAR
  main().catch((error) => {
    process.stderr.write(`${error.code || 'intake_queue_error'}: ${error.message}\n`);
    process.exit(1);
  });
}
