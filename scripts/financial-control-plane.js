#!/usr/bin/env node
'use strict';

/**
 * Fail-closed purchase control plane.
 *
 * Financial lifecycle calls derive their requester from an authenticated
 * runtime principal. Caller arguments cannot select an identity. A reservation
 * is consumed exactly once at the final pre-tool allow boundary, after every
 * other gate passes and before the economic action runs. Ledger events form a
 * global hash chain so deletion and reordering are detectable during
 * reconciliation and before any new authorization.
 */

const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { getFeedbackPaths, getRuntimeDir } = require('./feedback-paths');
const { withFileLedgerLock } = require('./file-ledger-lock');
const {
  consumeVerifiedApproval,
  getEscalation,
  getVerifiedApproval,
  requestEscalation,
} = require('./human-escalation');

const LEDGER_FILE = 'financial-control-ledger.jsonl';
const LEDGER_HEAD_FILE = 'financial-control-ledger.head.json';
const LEDGER_JOURNAL_FILE = 'financial-control-ledger.journal.json';
const LEDGER_HEAD_SCHEMA = 'financial-ledger-head-v2';
const LEDGER_JOURNAL_SCHEMA = 'financial-ledger-journal-v2';
const LEDGER_ANCHOR_SCHEMA = 'financial-ledger-anchor-v1';
const DEFAULT_TTL_MS = 60 * 60 * 1000;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RESERVATION_TTL_MS = 15 * 60 * 1000;
const SETTLEMENT_STATUSES = new Set(['committed', 'released']);
const CONTROL_PLANE_TOOLS = new Set([
  'create_purchase_requisition',
  'list_purchase_requisitions',
  'reserve_purchase_requisition',
  'settle_purchase_requisition',
  'reconcile_purchase_ledger',
  'satisfy_gate',
  'capture_feedback',
  'capture_memory_feedback',
  'record_task_outcome',
  'record_action_receipt',
  'get_scope_state',
  'set_task_scope',
  'report_product_issue',
  'open_feedback_session',
  'append_feedback_context',
  'finalize_feedback_session',
  'search_lessons',
  'retrieve_lessons',
  'verify_claim',
  'track_action',
]);
const REMEDY_TOOLS = new Set([
  'satisfy_gate',
  'capture_feedback',
  'capture_memory_feedback',
  'record_task_outcome',
  'diagnose_failure',
  'set_task_scope',
  'approve_protected_action',
  'track_action',
  'verify_claim',
  'break_glass_emergency',
]);

function isRemedyControlTool(toolName) {
  const normalized = String(toolName || '').trim();
  const bare = normalized.replace(/^mcp__.+?__/, '');
  return REMEDY_TOOLS.has(bare) || CONTROL_PLANE_TOOLS.has(bare);
}

// Keep these expressions deliberately small and auditable. The second group
// covers provider-native noun-first CLI forms such as `subscriptions create`.
const ECONOMIC_ACTION_PATTERNS = [
  /\badd\s+(?:a\s+)?(?:credit\s+)?card\b/i,
  /\badd\s+(?:a\s+)?payment\s+method\b/i,
  /\b(?:buy|purchase|subscribe|top-?up)\b/i,
  /\bcharge\s+(?:me\s+)?(?:\$|usd\s*)\d/i,
  /\bpay\s+now\b/i,
  /\bpay\s+(?:\$|usd\s*)\d/i,
  /\b(?:complete|confirm|place|submit|authorize)\s+(?:your\s+|the\s+|my\s+)?(?:purchase|order|payment|checkout|transaction)\b/i,
  /\b(?:proceed|continue)\s+to\s+checkout\b/i,
  /\bupgrade\b.{0,40}\b(?:pro|premium|business|enterprise)\b/i,
  /\b(?:activate|cancel|change|create|update|upgrade)\s+(?:a\s+)?(?:\w+\s+){0,3}(?:plan|subscription|tier|seat)\b/i,
  /\b(?:activate|cancel|change|create|update|upgrade)\s+(?:a\s+)?(?:\w+\s+){0,3}(?:checkout|payment\s+method)\b/i,
  /\b(?:confirm|complete|open|start)\s+(?:the\s+)?checkout\b/i,
  /\bcheckout\s+(?:flow|page|session)\b/i,
  /\b(?:issue|send)\s+(?:a\s+)?(?:invoice|payout|refund)\b/i,
  /\b(?:re)?send\s+(?:\w+\s+){0,3}invoice\b/i,
  /\b(?:make|send)\s+(?:a\s+)?(?:payment|transfer|wire)\b/i,
  /\bpay\s+(?:an?\s+)?invoice\b/i,
  /\bpaid\s+trial\b/i,
  /\brenew\s+(?:a\s+)?subscription\b/i,
  /\btransfer\s+(?:dollars?|funds|money|usd)\b/i,
  /\bupgrade\s+(?:a\s+)?plan\b/i,
  /\bcharges?\s+(?:attach|cancel|capture|confirm|create|detach|finalize|pay|refund|send|update)\b/i,
  /\bcheckout[\s_-]*sessions?\s+(?:attach|cancel|capture|confirm|create|detach|finalize|pay|refund|send|update)\b/i,
  /\binvoices?\s+(?:attach|cancel|capture|confirm|create|detach|finalize|pay|refund|send|update)\b/i,
  /\bpayment[\s_-]*intents?\s+(?:attach|cancel|capture|confirm|create|detach|finalize|pay|refund|send|update)\b/i,
  /\bpayment[\s_-]*methods?\s+(?:attach|cancel|capture|confirm|create|detach|finalize|pay|refund|send|update)\b/i,
  /\bpayouts?\s+(?:attach|cancel|capture|confirm|create|detach|finalize|pay|refund|send|update)\b/i,
  /\brefunds?\s+(?:attach|cancel|capture|confirm|create|detach|finalize|pay|refund|send|update)\b/i,
  /\bsubscriptions?\s+(?:attach|cancel|capture|confirm|create|detach|finalize|pay|refund|send|update)\b/i,
  /\btop[\s_-]*ups?\s+(?:attach|cancel|capture|confirm|create|detach|finalize|pay|refund|send|update)\b/i,
  /\btransfers?\s+(?:attach|cancel|capture|confirm|create|detach|finalize|pay|refund|send|update)\b/i,
  /\b(?:attach|cancel|capture|confirm|create|detach)\s+(?:a\s+)?(?:charge|invoice|payment|payment\s+method)\b/i,
  /\b(?:finalize|pay|refund|send|update)\s+(?:a\s+)?(?:charge|invoice|payment|payment\s+method)\b/i,
  /\b(?:attach|cancel|capture|confirm|create|detach)\s+(?:a\s+)?(?:payout|refund|subscription|top-?up|transfer)\b/i,
  /\b(?:finalize|pay|refund|send|update)\s+(?:a\s+)?(?:payout|refund|subscription|top-?up|transfer)\b/i,
];

// Exported linear URL patterns for external callers; runtime URL classification
// runs normalized URL parsing in containsEconomicUrl.
const ECONOMIC_URL_PATTERNS = [
  /\b(?:checkout|buy|billing)\.stripe\.com\b/i,
  /\bapi\.stripe\.com\/v\d+\/(?:charges|payment_intents|payment_methods|subscriptions|checkout\/sessions|invoices|refunds|payouts|transfers|topups|treasury)\b/i,
  /\bapi(?:-m)?\.(?:sandbox\.)?paypal\.com\/v\d+\/(?:checkout\/orders|payments|billing\/subscriptions|invoicing)\b/i,
  /\bconnect\.squareup(?:staging|sandbox)?\.com\/v\d+\/(?:payments|orders|subscriptions|invoices|refunds)\b/i,
  /\b(?:console\.cloud\.google\.com\/billing|console\.aws\.amazon\.com\/(?:billing|cost-management))\b/i,
  /\b(?:ads\.google\.com|adsmanager\.facebook\.com|business\.facebook\.com\/adsmanager|ads\.linkedin\.com|ads\.(?:x|twitter|reddit|tiktok)\.com)\b/i,
];

const NON_SPEND_HOST_PREFIXES = [
  'docs.', 'developer.', 'developers.', 'help.', 'support.', 'learn.', 'blog.', 'status.',
];
const STRIPE_CHECKOUT_HOSTS = new Set([
  'checkout.stripe.com', 'buy.stripe.com', 'billing.stripe.com',
]);
const STRIPE_API_SPEND_SEGMENTS = new Set([
  'charges', 'payment_intents', 'payment_methods', 'payment_links', 'subscriptions',
  'invoices', 'refunds', 'payouts', 'transfers', 'topups', 'treasury', 'billing', 'issuing',
]);
const PAYPAL_API_HOSTS = new Set([
  'api.paypal.com', 'api-m.paypal.com', 'api.sandbox.paypal.com', 'api-m.sandbox.paypal.com',
]);
const PAYPAL_API_SPEND_PREFIXES = [
  '/v1/payments', '/v2/payments', '/v2/checkout/orders', '/v1/billing/subscriptions', '/v1/invoicing', '/v2/invoicing',
];
const SQUARE_API_HOSTS = new Set([
  'connect.squareup.com', 'connect.squareupstaging.com', 'connect.squareupsandbox.com',
]);
const SQUARE_API_SPEND_SEGMENTS = new Set([
  'payments', 'orders', 'subscriptions', 'invoices', 'refunds',
]);
const AD_SPEND_HOSTS = new Set([
  'ads.google.com', 'adsmanager.facebook.com', 'ads.linkedin.com',
  'ads.x.com', 'ads.twitter.com', 'ads.reddit.com', 'ads.tiktok.com',
]);
const STRIPE_CLI_RESOURCES = new Set([
  'charges', 'charge', 'subscriptions', 'subscription', 'payment_intents', 'payment-intents',
  'payment_methods', 'payment-methods', 'payment_links', 'payment-links', 'checkout',
  'invoices', 'invoice', 'refunds', 'refund', 'payouts', 'payout', 'transfers', 'transfer',
  'topups', 'top-ups', 'top_ups', 'treasury', 'billing', 'billing_portal', 'billing-portal',
  'issuing', 'post', 'delete', 'trigger',
]);
const AWS_DOMAIN_SPEND_ACTIONS = new Set([
  'register-domain', 'renew-domain', 'transfer-domain',
]);
const GENERIC_SPEND_ROUTE_PATTERN = /(?:^|[\/#])(?:checkout|billing|subscriptions?|subscribe|upgrade|payments?|(?:settings|account)\/plans)(?:$|[\/#?])/i;
const GITHUB_SPEND_ROUTE_PATTERN = /^\/(?:settings\/(?:billing|plans)|organizations\/[^/]+\/settings\/(?:billing|plans)|sponsors\b|marketplace\/[^/]+\/order\b)/i;
const STRIPE_DASHBOARD_SPEND_PATTERN = /(?:^|\/)(?:payments|billing|subscriptions|invoices|payouts|topups|treasury|balances|checkout|settlement)(?:$|[\/?#])/i;
const APOLLO_SPEND_ROUTE_PATTERN = /(?:^|[\/#?&=_-])(?:plans|upgrade|billing|checkout|subscription)(?:$|[\/#?&=_-])/i;
const APP_STORE_BUY_PATTERN = /(?:^|[\/#?&=_-])(?:buy|purchase|checkout|subscribe)(?:$|[\/#?&=_-])/i;
const ASC_BILLING_PATTERN = /(?:^|[\/#?&=_-])(?:billing|agreements|tax-and-banking)(?:$|[\/#?&=_-])/i;

const SHELL_TOOL_PATTERN = /^(?:bash|shell|terminal|execute_command|exec_command)$/i;
const SCREEN_FORM_ACTION_PATTERN = /(?:fill|type|input|enter|submit|select|check)/i;
const SCREEN_TOOL_PATTERN = /(?:browser|chrome|computer|playwright|puppeteer|selenium|form[_-]?input|click|tap|press)/i;
const SCREEN_MUTATION_PATTERN = /(?:click|double[_ -]?click|tap|press|select|submit|confirm|activate)/i;
const SCREEN_OBSERVATION_PATTERN = /(?:screenshot|snapshot)/i;
const BROWSER_PAGE_STATE_FILE = 'browser-page-urls.json';
const MAX_TRACKED_BROWSER_PAGES = 256;
const DISALLOWED_PAGE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const BROWSER_ACT_TOOL_PATTERN = /(?:^|[_.:-])act$/i;
const BROWSER_NAVIGATE_TOOL_PATTERN = /(?:^|[_.:-])(?:navigate(?:[_-]page)?|goto|tabs?[_-](?:new|create)|new[_-](?:page|tab))(?:[_-]mcp)?$/i;
const BROWSER_TABS_TOOL_PATTERN = /(?:^|[_.:-])tabs$/i;
const BROWSER_NAVIGATE_ACTION_SET = new Set(['navigate', 'goto', 'new_tab', 'tabs-new']);
const BROWSER_TABS_NEW_ACTION_SET = new Set(['new', 'open', 'create', 'new_tab', 'tabs-new']);

// A process principal cannot be selected through a tool call. Operators that
// need an approved purchase to survive separate MCP/hook processes must set a
// unique THUMBGATE_RUNTIME_PRINCIPAL_ID in the trusted host configuration.
const RUNTIME_PRINCIPAL = Object.freeze({
  id: String(process.env.THUMBGATE_RUNTIME_PRINCIPAL_ID || '').trim()
    || `runtime_${crypto.randomUUID()}`,
  kind: 'agent',
});

function getRuntimePrincipal() {
  return { ...RUNTIME_PRINCIPAL };
}

function getLedgerPath(options = {}) {
  return path.join(getFeedbackPaths(options).FEEDBACK_DIR, LEDGER_FILE);
}

function getLedgerHeadPath(options = {}) {
  if (options.inputPath) return `${path.resolve(options.inputPath)}.head.json`;
  return path.join(getFeedbackPaths(options).FEEDBACK_DIR, LEDGER_HEAD_FILE);
}

function getLedgerJournalPath(options = {}) {
  if (options.inputPath) return `${path.resolve(options.inputPath)}.journal.json`;
  return path.join(getFeedbackPaths(options).FEEDBACK_DIR, LEDGER_JOURNAL_FILE);
}

function financialLedgerId(options = {}) {
  const configured = optionalString(options.financialLedgerId);
  if (configured) return configured;
  return `ledger_${crypto.createHash('sha256').update(getLedgerPath(options)).digest('hex')}`;
}

/**
 * Return the operator-owned monotonic anchor store. The store is deliberately
 * injected by the trusted host instead of selected through tool input. Its
 * state must live outside the agent-writable device filesystem (for example a
 * remote compare-and-set service or a hardware-backed host daemon).
 *
 * A file-backed implementation is available only behind an explicit test-only
 * switch. It exercises crash recovery but is not rollback-resistant and must
 * never be treated as a production control.
 */
function financialLedgerAnchorStore(options = {}) {
  const store = options.financialLedgerAnchorStore;
  if (store && typeof store.read === 'function' && typeof store.compareAndSet === 'function') {
    return store;
  }
  const remoteStore = remoteFinancialLedgerAnchorStore(options);
  if (remoteStore) return remoteStore;
  const testPath = optionalString(process.env.THUMBGATE_TEST_ONLY_FINANCIAL_ANCHOR_FILE);
  if (testPath && process.env.THUMBGATE_ALLOW_UNTRUSTED_FILE_ANCHOR_FOR_TESTS === '1') {
    return testOnlyFileAnchorStore(path.resolve(testPath));
  }
  throw financialError('rollback-resistant financial ledger anchor is required');
}

/**
 * Resolve production financial-control configuration from the trusted host.
 * Tool input is deliberately ignored: an agent cannot select the endpoint,
 * bearer credential, or transport used to protect the monotonic checkpoint.
 *
 * The remote service contract is one authenticated POST endpoint accepting:
 *   { operation: "read", ledgerId }
 *   { operation: "compareAndSet", ledgerId, expected, next }
 * It must perform compare-and-set atomically and reject sequence rollback.
 */
function getFinancialControlRuntimeOptions(options = {}) {
  if (options.financialLedgerAnchorStore) return { ...options };
  const remoteStore = remoteFinancialLedgerAnchorStore(options);
  return remoteStore
    ? { ...options, financialLedgerAnchorStore: remoteStore }
    : { ...options };
}

function remoteFinancialLedgerAnchorStore(options = {}) {
  const url = optionalString(options.financialLedgerAnchorUrl)
    || optionalString(process.env.THUMBGATE_FINANCIAL_ANCHOR_URL);
  if (!url) return null;
  const token = optionalString(options.financialLedgerAnchorToken)
    || optionalString(process.env.THUMBGATE_FINANCIAL_ANCHOR_TOKEN);
  if (!token) throw financialError('THUMBGATE_FINANCIAL_ANCHOR_TOKEN is required for the remote financial anchor');
  assertTrustedAnchorUrl(url, options);
  const request = typeof options.financialLedgerAnchorRequest === 'function'
    ? options.financialLedgerAnchorRequest
    : requestRemoteFinancialAnchor;
  const invoke = (payload) => request({ url, token, payload, timeoutMs: options.financialLedgerAnchorTimeoutMs });
  return {
    read({ ledgerId }) {
      const response = invoke({ operation: 'read', ledgerId });
      if (response?.ok !== true || !Object.hasOwn(response, 'anchor')) {
        throw financialError('remote financial anchor returned an invalid read response');
      }
      return response.anchor;
    },
    compareAndSet({ ledgerId, expected, next }) {
      const response = invoke({ operation: 'compareAndSet', ledgerId, expected, next });
      if (response?.ok !== true || typeof response.applied !== 'boolean') {
        throw financialError('remote financial anchor returned an invalid compare-and-set response');
      }
      return response.applied;
    },
  };
}

function assertTrustedAnchorUrl(value, options = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw financialError('THUMBGATE_FINANCIAL_ANCHOR_URL must be an absolute URL');
  }
  const allowHttpForTests = options.allowHttpFinancialAnchorForTests === true
    || process.env.THUMBGATE_ALLOW_HTTP_FINANCIAL_ANCHOR_FOR_TESTS === '1';
  if (url.protocol !== 'https:' && !(allowHttpForTests && url.protocol === 'http:')) {
    throw financialError('remote financial anchor requires HTTPS');
  }
}

function requestRemoteFinancialAnchor({ url, token, payload, timeoutMs }) {
  const childSource = [
    "'use strict';",
    "const fs = require('node:fs');",
    "const payload = fs.readFileSync(0, 'utf8');",
    "const controller = new AbortController();",
    "const timer = setTimeout(() => controller.abort(), Number(process.env.THUMBGATE_ANCHOR_TIMEOUT_MS));",
    "fetch(process.env.THUMBGATE_ANCHOR_URL, {",
    "  method: 'POST',",
    "  headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.THUMBGATE_ANCHOR_TOKEN}` },",
    "  body: payload,",
    "  signal: controller.signal,",
    "}).then(async (response) => {",
    "  const body = await response.text();",
    "  process.stdout.write(JSON.stringify({ status: response.status, ok: response.ok, body }));",
    "}).catch((error) => {",
    "  process.stderr.write(error.message);",
    "  process.exitCode = 1;",
    "}).finally(() => clearTimeout(timer));",
  ].join('\n');
  const timeout = normalizeAnchorTimeout(timeoutMs);
  const result = spawnSync(process.execPath, ['-e', childSource], {
    input: `${JSON.stringify(payload)}\n`,
    encoding: 'utf8',
    timeout: timeout + 1_000,
    maxBuffer: 1024 * 1024,
    env: {
      ...process.env,
      THUMBGATE_ANCHOR_URL: url,
      THUMBGATE_ANCHOR_TOKEN: token,
      THUMBGATE_ANCHOR_TIMEOUT_MS: String(timeout),
    },
  });
  if (result.error || result.status !== 0) {
    const detail = optionalString(result.stderr) || result.error?.message || `exit ${result.status}`;
    throw financialError(`remote financial anchor request failed: ${detail}`);
  }
  let envelope;
  try {
    envelope = JSON.parse(result.stdout);
  } catch {
    throw financialError('remote financial anchor returned a malformed transport response');
  }
  if (!envelope.ok) {
    throw financialError(`remote financial anchor rejected the request with HTTP ${envelope.status}`);
  }
  try {
    return JSON.parse(envelope.body);
  } catch {
    throw financialError('remote financial anchor returned malformed JSON');
  }
}

function normalizeAnchorTimeout(value) {
  const configured = Number(value ?? process.env.THUMBGATE_FINANCIAL_ANCHOR_TIMEOUT_MS ?? 5_000);
  if (!Number.isFinite(configured) || configured < 250 || configured > 30_000) {
    throw financialError('financial anchor timeout must be between 250 and 30000 milliseconds');
  }
  return Math.floor(configured);
}

function testOnlyFileAnchorStore(anchorPath) {
  return {
    read() {
      try {
        return JSON.parse(fs.readFileSync(anchorPath, 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },
    compareAndSet({ expected, next }) {
      let current = null;
      try {
        current = JSON.parse(fs.readFileSync(anchorPath, 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (!sameHead(current, expected)) return false;
      writeAtomicJson(anchorPath, next);
      return true;
    },
  };
}

function readFinancialLedgerAnchor(options = {}) {
  const anchor = financialLedgerAnchorStore(options).read({
    ledgerId: financialLedgerId(options),
  });
  if (anchor === null || anchor === undefined) return null;
  if (anchor.schemaVersion !== LEDGER_ANCHOR_SCHEMA
    || !Number.isInteger(anchor.sequence)
    || anchor.sequence < 1
    || !/^[a-f0-9]{64}$/i.test(String(anchor.eventHash || ''))) {
    throw financialError('rollback-resistant financial ledger anchor is malformed');
  }
  return anchor;
}

function advanceFinancialLedgerAnchor(previousHead, event, options = {}) {
  const store = financialLedgerAnchorStore(options);
  const ledgerId = financialLedgerId(options);
  const next = {
    schemaVersion: LEDGER_ANCHOR_SCHEMA,
    sequence: event.sequence,
    eventHash: event.eventHash,
  };
  const current = readFinancialLedgerAnchor(options);
  if (sameHead(current, next)) return next;
  if (!sameHead(current, previousHead)) {
    throw financialError('rollback-resistant financial ledger anchor rejected a stale checkpoint');
  }
  const advanced = store.compareAndSet({
    ledgerId,
    expected: previousHead
      ? { schemaVersion: LEDGER_ANCHOR_SCHEMA, sequence: previousHead.sequence, eventHash: previousHead.eventHash }
      : null,
    next,
  });
  if (advanced !== true || !sameHead(readFinancialLedgerAnchor(options), next)) {
    throw financialError('rollback-resistant financial ledger anchor compare-and-set failed');
  }
  return next;
}

function safeDecodeUri(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function trimUrlDelimiters(rawToken) {
  const trimChars = '"\'`<>()[]{},;';
  let start = 0;
  let end = rawToken.length;
  while (start < end && trimChars.includes(rawToken[start])) start += 1;
  while (end > start && trimChars.includes(rawToken[end - 1])) end -= 1;
  const sliced = rawToken.slice(start, end);
  for (const scheme of ['https://', 'http://']) {
    const idx = sliced.toLowerCase().indexOf(scheme);
    if (idx > 0 && '=:"\'([<'.includes(sliced[idx - 1])) {
      return trimUrlDelimiters(sliced.slice(idx));
    }
  }
  return sliced;
}

function looksLikeBareHostUrl(token) {
  const slashIdx = token.indexOf('/');
  const hostPart = (slashIdx === -1 ? token : token.slice(0, slashIdx)).replace(/\.$/, '');
  if (!hostPart || !hostPart.includes('.')) return false;
  const firstCode = hostPart.charCodeAt(0);
  const isAlnum = (firstCode >= 48 && firstCode <= 57)
    || (firstCode >= 65 && firstCode <= 90)
    || (firstCode >= 97 && firstCode <= 122);
  return isAlnum && !hostPart.includes(':');
}

function parseEconomicCandidateUrl(rawToken) {
  const cleaned = trimUrlDelimiters(String(rawToken || ''));
  if (!cleaned) return null;
  const lower = cleaned.toLowerCase();
  const hasExplicitScheme = lower.startsWith('http://') || lower.startsWith('https://');
  if (!hasExplicitScheme && !looksLikeBareHostUrl(lower)) return null;
  try {
    const parsed = new URL(hasExplicitScheme ? cleaned : `https://${cleaned}`);
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
    const decodedPath = path.posix.normalize(safeDecodeUri(parsed.pathname).toLowerCase());
    const decodedSearch = safeDecodeUri(parsed.search).toLowerCase();
    const decodedHash = safeDecodeUri(parsed.hash).toLowerCase();
    return {
      host,
      pathname: decodedPath,
      route: `${decodedPath}${decodedSearch}${decodedHash}`,
      spaRoute: `${decodedPath}${decodedHash}`,
      hasExplicitScheme,
    };
  } catch {
    return null;
  }
}

function isPaymentGatewayApiUrl(host, pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (host === 'api.stripe.com' && /^v\d+$/.test(parts[0] || '')) {
    if (parts[1] === 'checkout' && parts[2] === 'sessions') return true;
    return STRIPE_API_SPEND_SEGMENTS.has(parts[1] || '');
  }
  if (PAYPAL_API_HOSTS.has(host)) {
    return PAYPAL_API_SPEND_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  }
  if (SQUARE_API_HOSTS.has(host) && /^v\d+$/.test(parts[0] || '')) {
    return SQUARE_API_SPEND_SEGMENTS.has(parts[1] || '');
  }
  return false;
}

function isStripeOrApolloSpendUrl(host, pathname, route) {
  if (STRIPE_CHECKOUT_HOSTS.has(host)) return true;
  if (host === 'dashboard.stripe.com' && STRIPE_DASHBOARD_SPEND_PATTERN.test(route)) return true;
  if (host === 'stripe.com' && !pathname.startsWith('/docs')
    && /^\/(?:checkout|billing|payments)(?:\/|$)/.test(pathname)) {
    return true;
  }
  return (host === 'apollo.io' || host === 'app.apollo.io') && APOLLO_SPEND_ROUTE_PATTERN.test(route);
}

function isAdsSpendUrl(host, route) {
  if (AD_SPEND_HOSTS.has(host)) return true;
  if (host === 'business.facebook.com' && route.startsWith('/adsmanager')) return true;
  return host === 'linkedin.com' && route.startsWith('/campaignmanager');
}

function isCloudConsoleSpendUrl(host, route) {
  if (host === 'console.cloud.google.com' && route.startsWith('/billing')) return true;
  if ((host === 'console.aws.amazon.com' || host.endsWith('.console.aws.amazon.com'))
    && (route.startsWith('/billing') || route.startsWith('/cost-management'))) {
    return true;
  }
  if (host === 'portal.azure.com' && route.includes('billing')) return true;
  return host === 'dash.cloudflare.com' && route.includes('/billing');
}

function isAppStoreSpendUrl(host, route) {
  if (host === 'apps.apple.com' && APP_STORE_BUY_PATTERN.test(route)) return true;
  if (host === 'play.google.com' && route.startsWith('/store') && APP_STORE_BUY_PATTERN.test(route)) return true;
  return host === 'appstoreconnect.apple.com' && ASC_BILLING_PATTERN.test(route);
}

function isProviderSpendUrl({ host, pathname, route }) {
  return isPaymentGatewayApiUrl(host, pathname)
    || isStripeOrApolloSpendUrl(host, pathname, route)
    || isAdsSpendUrl(host, route)
    || isCloudConsoleSpendUrl(host, route)
    || isAppStoreSpendUrl(host, route);
}

const THUMBGATE_LIVE_CHECKOUT_GO_PATTERN = /^\/go\/(?:pro-direct|pro-annual|founding-100|cloud-indie|cloud-startup|bundle-49|playbook-999|playbook-10|diagnostic-direct|diagnostic-499|diagnostic-pay|sprint|team-direct|lifetime-direct)(?:\/|$)/i;
const SYNTHETIC_PROBE_QUERY_PATTERN = /(?:^|[?&])probe=(?:1|true)(?:$|[&#])/i;

function isThumbGateLiveCheckoutRedirectUrl(candidate) {
  const host = candidate.host;
  const isHostedThumbGate = host === 'thumbgate.ai'
    || host.endsWith('.thumbgate.ai')
    || host.endsWith('.up.railway.app');
  if (!isHostedThumbGate) return false;
  if (!THUMBGATE_LIVE_CHECKOUT_GO_PATTERN.test(candidate.pathname)) return false;
  return !SYNTHETIC_PROBE_QUERY_PATTERN.test(candidate.route);
}

function isEconomicUrlCandidate(candidate) {
  if (!candidate) return false;
  if (NON_SPEND_HOST_PREFIXES.some((prefix) => candidate.host.startsWith(prefix))) return false;
  if (isProviderSpendUrl(candidate)) return true;
  if (isThumbGateLiveCheckoutRedirectUrl(candidate)) return true;
  if (!candidate.hasExplicitScheme) return false;
  if (candidate.host === 'github.com' || candidate.host === 'gitlab.com') {
    return GITHUB_SPEND_ROUTE_PATTERN.test(candidate.pathname);
  }
  return GENERIC_SPEND_ROUTE_PATTERN.test(candidate.spaRoute);
}

function containsEconomicUrl(text) {
  const input = String(text || '');
  if (!input) return false;
  for (const token of input.split(/\s+/)) {
    if (token && isEconomicUrlCandidate(parseEconomicCandidateUrl(token))) return true;
  }
  for (const match of input.matchAll(/https?:\/\/[^\s"'`<>()[\]{},;]+/gi)) {
    if (isEconomicUrlCandidate(parseEconomicCandidateUrl(match[0]))) return true;
  }
  return false;
}

function isAwsEconomicCli(positional) {
  const service = positional[0] || '';
  const action = positional[1] || '';
  if (service === 'billing' || service === 'billingconductor' || service === 'ce') return true;
  if (service === 'budgets') {
    return action.startsWith('create') || action.startsWith('update') || action.startsWith('delete');
  }
  if (service === 'ec2' || service === 'rds') return action.startsWith('purchase-');
  if (service === 'savingsplans') return action.startsWith('create-');
  return service === 'route53domains' && AWS_DOMAIN_SPEND_ACTIONS.has(action);
}

function isHerokuEconomicCli(pos) {
  return Boolean(pos[0] && (pos[0].startsWith('addons:create') || pos[0].startsWith('addons:upgrade')));
}

function isFlyEconomicCli(pos) {
  return pos[0] === 'scale' || (pos[0] === 'volumes' && pos[1] === 'create');
}

function isVercelEconomicCli(pos) {
  return pos[0] === 'billing' || (pos[0] === 'domains' && pos[1] === 'buy');
}

function isPlatformEconomicCli(executable, positional) {
  switch (executable) {
    case 'stripe':
      return positional.some((tok) => STRIPE_CLI_RESOURCES.has(tok));
    case 'gcloud':
      return positional.includes('billing');
    case 'aws':
      return isAwsEconomicCli(positional);
    case 'az':
      return positional[0] === 'billing' || positional[0] === 'consumption';
    case 'heroku':
      return isHerokuEconomicCli(positional);
    case 'fly':
    case 'flyctl':
      return isFlyEconomicCli(positional);
    case 'wrangler':
      return positional[0] === 'billing';
    case 'vercel':
      return isVercelEconomicCli(positional);
    default:
      return false;
  }
}

const PACKAGE_RUNNERS = new Set(['npx', 'bunx']);
const GLOBAL_VALUE_FLAGS = new Set([
  '--profile', '--region', '--project', '--api-key', '--config', '--account', '--subscription', '--scope',
]);

function isShellPrefixToken(tok) {
  return tok === 'sudo' || tok === 'env' || /^[a-z_]\w*=/.test(tok);
}

function resolveSegmentCommand(tokens) {
  let idx = 0;
  while (idx < tokens.length && isShellPrefixToken(tokens[idx])) idx += 1;
  let executable = (tokens[idx] || '').split('/').at(-1);
  idx += 1;
  if (executable && PACKAGE_RUNNERS.has(executable)) {
    while (idx < tokens.length && tokens[idx].startsWith('-')) idx += 1;
    executable = (tokens[idx] || '').split('/').at(-1).split('@')[0];
    idx += 1;
  }
  return { executable: executable || '', startIdx: idx };
}

function collectPositionalCliArgs(tokens, startIdx) {
  const positional = [];
  let idx = startIdx;
  while (idx < tokens.length) {
    const tok = tokens[idx];
    if (GLOBAL_VALUE_FLAGS.has(tok)) {
      idx += 2;
    } else if (tok.startsWith('-')) {
      idx += 1;
    } else {
      positional.push(tok);
      idx += 1;
    }
  }
  return positional;
}

function isEconomicCliSegment(rawSegment) {
  const tokens = stripNonEconomicQuotedStrings(rawSegment)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => tok.toLowerCase());
  const { executable, startIdx } = resolveSegmentCommand(tokens);
  if (!executable || NON_ECONOMIC_SHELL_EXECUTABLES.has(executable)) return false;
  return isPlatformEconomicCli(executable, collectPositionalCliArgs(tokens, startIdx));
}

const SUBSHELL_EXECUTABLES = new Set(['bash', 'sh', 'zsh']);

function stripLeadingShellPrefixes(segment) {
  let rest = segment.trimStart();
  while (rest) {
    const firstSpace = rest.search(/\s/);
    if (firstSpace < 0) break;
    if (!isShellPrefixToken(rest.slice(0, firstSpace).toLowerCase())) break;
    rest = rest.slice(firstSpace).trimStart();
  }
  return rest;
}

function hasShellEconomicCliCommand(rawCommand) {
  for (const segment of splitShellSegmentsOutsideQuotes(String(rawCommand || ''))) {
    const stripped = stripLeadingShellPrefixes(segment.trim());
    if (!stripped) continue;
    const firstExec = /^([\w./-]+)/.exec(stripped)?.[1]?.split('/').at(-1)?.toLowerCase();
    if (SUBSHELL_EXECUTABLES.has(firstExec || '')) {
      const subshell = extractSubshellCommand(stripped);
      if (subshell !== null && hasShellEconomicCliCommand(subshell)) return true;
    }
    if (isEconomicCliSegment(stripped)) return true;
  }
  return false;
}

function hasExplicitEconomicSignal(toolInput, metadata) {
  const financialControl = objectValue(toolInput.financialControl || toolInput.financial_control);
  if (toolInput.economicAction === true || metadata.economicAction === true) return true;
  return Boolean(financialControl.requisitionId || financialControl.reservationId);
}

function detectShellEconomicAction(normalizedToolName, toolInput, metadata) {
  const rawCommand = toolInput.command || toolInput.cmd;
  const shellText = shellEconomicText(normalizedToolName, rawCommand);
  if (!String(shellText || '').trim()) return false;
  if (containsEconomicUrl(shellText)) return true;
  if (hasShellEconomicCliCommand(rawCommand)) return true;
  const metadataContext = String(metadata.context || '');
  if (!metadataContext) return false;
  return containsEconomicUrl(metadataContext)
    || ECONOMIC_ACTION_PATTERNS.some((pattern) => pattern.test(metadataContext));
}

function collectFieldEntryTargets(fieldsInput) {
  if (!Array.isArray(fieldsInput)) return [];
  const out = [];
  for (const entry of fieldsInput) {
    const item = objectValue(entry);
    const entryOp = [item.action, item.operation, item.type, item.kind].map((v) => String(v || '')).join(' ');
    out.push(item.element, item.label, item.name, item.title, item.placeholder, item.ariaLabel, item.aria_label);
    if (SCREEN_MUTATION_PATTERN.test(entryOp)) out.push(item.text, item.value);
  }
  return out;
}

function collectScreenMutationTargets(normalizedToolName, toolInput, metadata) {
  if (!isDeclaredScreenMutation(normalizedToolName, toolInput)) return [];
  const declaredOperation = [toolInput.action, toolInput.operation, toolInput.type, toolInput.kind]
    .map((value) => String(value || ''))
    .join(' ');
  const isClickOrSubmit = SCREEN_MUTATION_PATTERN.test(normalizedToolName)
    || SCREEN_MUTATION_PATTERN.test(declaredOperation);
  const nonUrlTarget = parseEconomicCandidateUrl(toolInput.target) ? '' : toolInput.target;
  const fields = [
    toolInput.element,
    toolInput.label,
    toolInput.name,
    toolInput.title,
    toolInput.button,
    toolInput.control,
    toolInput.selector,
    toolInput.ariaLabel,
    toolInput.aria_label,
    toolInput.placeholder,
    toolInput.goal,
    toolInput.description,
    toolInput.prompt,
    nonUrlTarget,
    metadata.context,
    ...collectFieldEntryTargets(toolInput.fields),
  ];
  if (isClickOrSubmit) {
    fields.push(toolInput.text, toolInput.value);
  }
  return fields.map((value) => String(value || '').replace(/[_-]+/g, ' '));
}

function collectNavigationTargets(toolInput, metadata) {
  return [
    toolInput.url,
    toolInput.uri,
    toolInput.href,
    toolInput.link,
    toolInput.navigate,
    toolInput.target,
    toolInput.pageUrl,
    toolInput.page_url,
    toolInput.tabUrl,
    toolInput.tab_url,
    toolInput.currentUrl,
    toolInput.current_url,
    toolInput.origin,
    toolInput.code,
    toolInput.script,
    toolInput.expression,
    metadata.url,
    metadata.pageUrl,
    metadata.tabUrl,
  ].map((value) => String(value || '')).join(' ');
}

function getBrowserPageStatePath(options = {}) {
  const explicitDir = optionalString(options.runtimeDir)
    || optionalString(process.env.THUMBGATE_RUNTIME_DIR);
  const runtimeDir = explicitDir ? path.resolve(explicitDir) : getRuntimeDir(options);
  return path.join(runtimeDir, BROWSER_PAGE_STATE_FILE);
}

function normalizeBrowserPageId(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128 || DISALLOWED_PAGE_KEYS.has(trimmed)) return '';
  return trimmed;
}

function extractBrowserPageIds(toolInput = {}) {
  const input = objectValue(toolInput);
  const ids = [];
  for (const candidate of [input.page, input.pageId, input.page_id, input.tabId, input.tab_id, input.tab]) {
    const normalized = normalizeBrowserPageId(candidate);
    if (normalized && !ids.includes(normalized)) ids.push(normalized);
  }
  return ids;
}

function extractExplicitPageUrl(toolInput = {}, metadata = {}) {
  for (const candidate of [
    toolInput.url,
    toolInput.uri,
    toolInput.href,
    toolInput.navigate,
    toolInput.pageUrl,
    toolInput.page_url,
    toolInput.tabUrl,
    toolInput.tab_url,
    toolInput.currentUrl,
    toolInput.current_url,
    metadata.url,
    metadata.pageUrl,
    metadata.tabUrl,
  ]) {
    const text = optionalString(candidate);
    if (text && parseEconomicCandidateUrl(text)) return text;
  }
  return '';
}

function readBrowserPageStateMap(options = {}) {
  try {
    const parsed = JSON.parse(fs.readFileSync(getBrowserPageStatePath(options), 'utf8'));
    const pages = objectValue(parsed?.pages);
    const map = new Map();
    for (const [key, value] of Object.entries(pages)) {
      if (!DISALLOWED_PAGE_KEYS.has(key) && typeof value === 'string' && value) {
        map.set(key, value);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

function writeBrowserPageStateMap(map, options = {}) {
  const statePath = getBrowserPageStatePath(options);
  const pages = Object.fromEntries(Array.from(map.entries()).slice(-MAX_TRACKED_BROWSER_PAGES));
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const tempPath = `${statePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify({ pages }, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, statePath);
}

function isBrowserNavigateOrTabsNewCall(normalizedToolName, toolInput) {
  if (!SCREEN_TOOL_PATTERN.test(normalizedToolName)) return false;
  if (BROWSER_NAVIGATE_TOOL_PATTERN.test(normalizedToolName)) return true;
  const action = String(toolInput.action || toolInput.kind || toolInput.operation || toolInput.mode || '')
    .trim()
    .toLowerCase();
  if (BROWSER_TABS_TOOL_PATTERN.test(normalizedToolName)) {
    return BROWSER_TABS_NEW_ACTION_SET.has(action);
  }
  return toolInput.new_tab === true || BROWSER_NAVIGATE_ACTION_SET.has(action);
}

function recordBrowserPageNavigation(toolName, toolInput = {}, options = {}) {
  try {
    const normalizedToolName = String(toolName || '').trim();
    const input = objectValue(toolInput);
    if (!isBrowserNavigateOrTabsNewCall(normalizedToolName, input)) return false;
    const pageIds = extractBrowserPageIds(input);
    const url = extractExplicitPageUrl(input, objectValue(input.metadata));
    if (pageIds.length === 0 || !url) return false;
    const map = readBrowserPageStateMap(options);
    for (const pageId of pageIds) {
      map.delete(pageId);
      map.set(pageId, url);
    }
    writeBrowserPageStateMap(map, options);
    return true;
  } catch {
    return false;
  }
}

function lookupRecordedBrowserPageUrl(pageId, options = {}) {
  const normalizedPageId = normalizeBrowserPageId(pageId);
  if (!normalizedPageId) return '';
  return readBrowserPageStateMap(options).get(normalizedPageId) || '';
}

function hasRecordedEconomicPageUrl(normalizedToolName, toolInput, metadata, options) {
  if (!isDeclaredScreenMutation(normalizedToolName, toolInput)) return false;
  if (extractExplicitPageUrl(toolInput, metadata)) return false;
  const pageIds = extractBrowserPageIds(toolInput);
  if (pageIds.length === 0) return false;
  const stateMap = readBrowserPageStateMap(options);
  return pageIds.some((id) => containsEconomicUrl(stateMap.get(id) || ''));
}

function detectEconomicAction(toolName, toolInput = {}, options = {}) {
  const normalizedToolName = String(toolName || '').trim();
  if (isRemedyControlTool(normalizedToolName)) return false;
  const metadata = objectValue(toolInput.metadata);
  if (hasExplicitEconomicSignal(toolInput, metadata)) return true;
  if (isScreenObservationOnly(normalizedToolName, toolInput)) return false;
  if (SHELL_TOOL_PATTERN.test(normalizedToolName)) {
    return detectShellEconomicAction(normalizedToolName, toolInput, metadata);
  }
  const navigationTargets = collectNavigationTargets(toolInput, metadata);
  if (containsEconomicUrl(navigationTargets)) return true;
  if (hasRecordedEconomicPageUrl(normalizedToolName, toolInput, metadata, options)) return true;
  const command = shellEconomicText(normalizedToolName, toolInput.command || toolInput.cmd);
  if (containsEconomicUrl(command)) return true;
  const screenMutationTargets = collectScreenMutationTargets(normalizedToolName, toolInput, metadata);
  const combined = [
    normalizedToolName.replace(/[_-]+/g, ' '),
    command,
    toolInput.action,
    toolInput.operation,
    toolInput.kind,
    ...screenMutationTargets,
  ].map((value) => String(value || '')).join(' ');
  return ECONOMIC_ACTION_PATTERNS.some((pattern) => pattern.test(combined));
}

function isScreenObservationOnly(toolName, toolInput = {}) {
  const normalizedToolName = String(toolName || '').trim();
  if (!SCREEN_TOOL_PATTERN.test(normalizedToolName)) return false;
  const input = objectValue(toolInput);
  const declaredOperation = [input.action, input.operation, input.type, input.kind]
    .map((value) => String(value || ''))
    .join(' ');
  const toolDeclaresMutation = SCREEN_MUTATION_PATTERN.test(normalizedToolName);
  const declaredMutation = SCREEN_MUTATION_PATTERN.test(declaredOperation);
  const toolDeclaresObservation = SCREEN_OBSERVATION_PATTERN.test(normalizedToolName);
  const declaredObservation = SCREEN_OBSERVATION_PATTERN.test(declaredOperation);
  return toolDeclaresObservation || (!toolDeclaresMutation && !declaredMutation && declaredObservation);
}

function isDeclaredScreenMutation(toolName, toolInput = {}) {
  const normalizedToolName = String(toolName || '').trim();
  if (!SCREEN_TOOL_PATTERN.test(normalizedToolName)) return false;
  if (isScreenObservationOnly(normalizedToolName, toolInput)) return false;
  const input = objectValue(toolInput);
  if (Array.isArray(input.fields) && input.fields.length > 0) return true;
  const declaredOperation = [input.action, input.operation, input.type, input.kind]
    .map((value) => String(value || ''))
    .join(' ');
  return BROWSER_ACT_TOOL_PATTERN.test(normalizedToolName)
    || SCREEN_MUTATION_PATTERN.test(normalizedToolName)
    || SCREEN_MUTATION_PATTERN.test(declaredOperation)
    || SCREEN_FORM_ACTION_PATTERN.test(normalizedToolName)
    || SCREEN_FORM_ACTION_PATTERN.test(declaredOperation);
}

function detectOpaqueScreenMutation(toolName, toolInput = {}) {
  const normalizedToolName = String(toolName || '').trim();
  const input = objectValue(toolInput);
  const declaredOperation = [input.action, input.operation, input.type, input.kind]
    .map((value) => String(value || ''))
    .join(' ');
  const toolDeclaresMutation = SCREEN_MUTATION_PATTERN.test(normalizedToolName);
  const declaredMutation = SCREEN_MUTATION_PATTERN.test(declaredOperation);
  const toolDeclaresObservation = SCREEN_OBSERVATION_PATTERN.test(normalizedToolName);
  const declaredObservation = SCREEN_OBSERVATION_PATTERN.test(declaredOperation);
  if (toolDeclaresObservation || (!toolDeclaresMutation && !declaredMutation && declaredObservation)) {
    return false;
  }
  const hasCoordinate = Object.hasOwn(input, 'coordinate') || Object.hasOwn(input, 'coordinates')
    || (Object.hasOwn(input, 'x') && Object.hasOwn(input, 'y'));
  const hasOpaqueLocator = hasCoordinate
    || Object.hasOwn(input, 'selector')
    || Object.hasOwn(input, 'element')
    || Object.hasOwn(input, 'ref')
    || Object.hasOwn(input, 'elementId')
    || Object.hasOwn(input, 'element_id')
    || Object.hasOwn(input, 'nodeId')
    || Object.hasOwn(input, 'node_id')
    || (Object.hasOwn(input, 'ref_id') && Object.hasOwn(input, 'id'));
  if (!hasOpaqueLocator || !SCREEN_TOOL_PATTERN.test(normalizedToolName)) return false;
  return toolDeclaresMutation || declaredMutation
    || /(?:browser|computer|playwright|puppeteer|selenium)/i.test(normalizedToolName);
}

const NON_ECONOMIC_SHELL_EXECUTABLES = new Set([
  'rg', 'grep', 'egrep', 'fgrep', 'git', 'cat', 'head', 'tail', 'less', 'more',
  'echo', 'printf', 'herdr', 'sed', 'awk', 'jq', 'ls', 'find', 'wc', 'diff',
  'stat', 'mdfind', 'true', 'false', 'cd', 'pwd',
]);

function splitShellSegmentsOutsideQuotes(command) {
  const segments = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === '\\' && quote === '"' && i + 1 < command.length) {
        i += 1;
        current += command[i];
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '\'' || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '\\' && i + 1 < command.length) {
      current += ch + command[i + 1];
      i += 1;
      continue;
    }
    if ((ch === '&' && command[i + 1] === '&') || (ch === '|' && command[i + 1] === '|')) {
      segments.push(current);
      current = '';
      i += 1;
      continue;
    }
    if (ch === ';' || ch === '\n' || ch === '|') {
      segments.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) segments.push(current);
  return segments;
}

function stripNonEconomicQuotedStrings(segment) {
  let out = '';
  let i = 0;
  while (i < segment.length) {
    const ch = segment[i];
    if (ch !== '\'' && ch !== '"') {
      if (ch === '\\' && i + 1 < segment.length) {
        out += ch + segment[i + 1];
        i += 2;
      } else {
        out += ch;
        i += 1;
      }
      continue;
    }
    const quote = ch;
    let j = i + 1;
    while (j < segment.length) {
      if (segment[j] === '\\' && quote === '"' && j + 1 < segment.length) {
        j += 2;
        continue;
      }
      if (segment[j] === quote) break;
      j += 1;
    }
    if (j >= segment.length) {
      out += segment.slice(i);
      break;
    }
    const full = segment.slice(i, j + 1);
    const inner = segment.slice(i + 1, j);
    out += containsEconomicUrl(inner) ? full : ' ';
    i = j + 1;
  }
  return out;
}

function extractSubshellCommand(clean) {
  const flagMatch = /^[\w./-]+\s+-[a-z]*c\s+/i.exec(clean);
  if (!flagMatch) return null;
  const rest = clean.slice(flagMatch[0].length).trim();
  if (rest.length >= 2 && (rest[0] === '\'' || rest[0] === '"') && rest.at(-1) === rest[0]) {
    return rest.slice(1, -1);
  }
  return null;
}

function shellEconomicText(toolName, rawCommand) {
  if (!/^(?:bash|shell|terminal|execute_command|exec_command)$/i.test(toolName)) {
    return rawCommand;
  }
  const command = String(rawCommand || '');
  return splitShellSegmentsOutsideQuotes(command)
    .map((segment) => {
      let clean = segment.trim();
      while (/^(?:sudo|env)\s+/.test(clean) || /^[A-Za-z_]\w*=[^\s]+\s+/.test(clean)) {
        clean = clean.replace(/^(?:sudo|env)\s+/, '').replace(/^[A-Za-z_]\w*=[^\s]+\s+/, '');
      }
      if (!clean) return '';
      const executable = /^([\w./-]+)/.exec(clean)?.[1]?.split('/').at(-1)?.toLowerCase();
      if (!executable || NON_ECONOMIC_SHELL_EXECUTABLES.has(executable)) {
        return '';
      }
      if (['bash', 'sh', 'zsh'].includes(executable)) {
        const subshellCmd = extractSubshellCommand(clean);
        if (subshellCmd !== null) {
          return shellEconomicText('Bash', subshellCmd);
        }
      }
      if (executable === 'gh' && /\b(?:issue|pr|release|run|workflow|repo|status|search)\b/i.test(clean)) {
        return '';
      }
      return stripNonEconomicQuotedStrings(clean);
    })
    .join(' ');
}

function createPurchaseRequisition(input = {}, options = {}) {
  rejectCallerSelectedRequester(input);
  const now = options.now || new Date();
  const requester = authenticatedPrincipal(options);
  const taskId = requiredString(input.taskId, 'taskId');
  const vendor = requiredString(input.vendor, 'vendor');
  const purpose = requiredString(input.purpose, 'purpose');
  const sourceMessageId = requiredString(input.sourceMessageId, 'sourceMessageId');
  const amountUsd = positiveMoney(input.amountUsd, 'amountUsd');
  const approvedAction = buildActionAuthorization(input.toolName, input.toolInput, amountUsd);
  if (!detectEconomicAction(approvedAction.toolName, objectValue(input.toolInput), options)) {
    throw financialError('purchase requisitions must bind an exact economic tool action');
  }
  const evidence = stringArray(input.evidence);
  if (evidence.length === 0) throw financialError('evidence must contain at least one item');
  const ttlMs = boundedTtl(input.ttlMs, DEFAULT_TTL_MS);
  const idempotencyKey = requiredString(input.idempotencyKey || `${taskId}:${sourceMessageId}`, 'idempotencyKey');
  const requestIntent = {
    idempotencyKey,
    taskId,
    requester,
    vendor,
    purpose,
    sourceMessageId,
    amountUsd,
    approvedToolName: approvedAction.toolName,
    actionFingerprint: approvedAction.fingerprint,
    evidence,
  };
  // The financial and escalation ledgers are separate durable resources. A
  // retry after the escalation append but before the financial append must
  // reproduce the same identity and signed digest instead of stranding the
  // already-recorded approval behind an idempotency conflict.
  const requisitionId = input.requisitionId || stableRequisitionId(requestIntent);
  const approvalContextDigest = requestComparableHash({ requisitionId, ...requestIntent });
  return withLedgerLock(options, () => {
    const ledger = readLedger(options);
    const chain = validateLedgerChain(ledger.events, ledger.malformedRows, ledger.head, options);
    if (!chain.ok) throw financialError('financial ledger integrity verification failed');
    const existing = requisitionsFromEvents(ledger.events, options)
      .find((entry) => entry.idempotencyKey === idempotencyKey);
    if (existing) {
      if (requestIntentHash(existing) !== requestIntentHash(requestIntent)
        || (input.requisitionId && input.requisitionId !== existing.requisitionId)) {
        const error = financialError(`conflicting requisition for idempotency key '${idempotencyKey}'`);
        error.code = 'THUMBGATE_IDEMPOTENCY_CONFLICT';
        throw error;
      }
      return { recorded: false, duplicate: true, requisition: existing };
    }
    const escalationResult = requestEscalation({
      taskId,
      reason: `Purchase approval required: $${amountUsd.toFixed(2)} USD to ${vendor} for ${purpose}; exact action ${approvedAction.fingerprint}`,
      severity: 'critical',
      requester,
      evidence: [
        ...evidence,
        `sourceMessageId:${sourceMessageId}`,
        `requisitionId:${requisitionId}`,
      ],
      approvalContextDigest,
      ttlMs,
      idempotencyKey: `purchase:${idempotencyKey}`,
    }, options);
    const recorded = appendEventUnlocked({
      schemaVersion: 'financial-control-v2',
      eventType: 'requested',
      status: 'pending_approval',
      requisitionId,
      escalationId: escalationResult.escalation.escalationId,
      idempotencyKey,
      taskId,
      requester,
      vendor,
      purpose,
      sourceMessageId,
      amountUsd,
      approvedToolName: approvedAction.toolName,
      actionFingerprint: approvedAction.fingerprint,
      approvalContextDigest,
      currency: 'USD',
      evidence,
      requestedAt: now.toISOString(),
      // Cross-ledger retries must retain the deadline of the original human
      // escalation. Refreshing the financial deadline here would let a retry
      // resurrect an approval whose signed request already expired.
      expiresAt: escalationResult.escalation.expiresAt,
    }, options, ledger.events);
    return {
      recorded: true,
      duplicate: false,
      requisition: projectRequisitionFromEvents([...ledger.events, recorded], requisitionId, options),
    };
  });
}

function reservePurchaseRequisition(input = {}, options = {}) {
  rejectCallerSelectedRequester(input);
  const now = options.now || new Date();
  const requester = authenticatedPrincipal(options);
  const requisitionId = requiredString(input.requisitionId, 'requisitionId');
  return withLedgerLock(options, () => {
    const ledger = readLedger(options);
    assertLedgerHealthyData(ledger, options);
    const requisition = projectRequisitionFromEvents(ledger.events, requisitionId, options);
    if (!requisition) throw financialError(`unknown requisition '${requisitionId}'`);
    assertPrincipalOwnsRequisition(requester, requisition);
    const escalation = verifyPurchaseApprovalBinding(requisition, options);
    if (Date.parse(requisition.expiresAt) <= now.getTime()) {
      throw financialError(`requisition '${requisitionId}' is expired`);
    }
    if (['reserved', 'authorized', 'committed'].includes(requisition.status)) {
      const requestedKey = optionalString(input.idempotencyKey);
      if (requestedKey && requestedKey === requisition.reservationIdempotencyKey) {
        return { recorded: false, duplicate: true, requisition };
      }
      throw financialError(`requisition '${requisitionId}' is already ${requisition.status}`);
    }
    if (requisition.status === 'released') {
      throw financialError(`requisition '${requisitionId}' was released and cannot be reused`);
    }
    if (!requisition.actionFingerprint || !requisition.approvedToolName) {
      throw financialError(`requisition '${requisitionId}' predates exact-action authorization and cannot be reserved`);
    }

    const amountUsd = positiveMoney(input.amountUsd ?? requisition.amountUsd, 'amountUsd');
    if (amountUsd > requisition.amountUsd) {
      throw financialError(`reservation $${amountUsd.toFixed(2)} exceeds approved amount $${requisition.amountUsd.toFixed(2)}`);
    }
    assertScopeMatches(input, requisition);
    const ttlMs = boundedTtl(input.ttlMs, DEFAULT_RESERVATION_TTL_MS);
    const recorded = appendEventUnlocked({
      schemaVersion: 'financial-control-v2',
      eventType: 'reserved',
      status: 'reserved',
      requisitionId,
      reservationId: input.reservationId || `res_${crypto.randomUUID()}`,
      reservationIdempotencyKey: requiredString(input.idempotencyKey || `${requisitionId}:reserve`, 'idempotencyKey'),
      requester,
      approvedBy: escalation.actor,
      approvalReason: escalation.reason,
      vendor: requisition.vendor,
      purpose: requisition.purpose,
      sourceMessageId: requisition.sourceMessageId,
      approvedToolName: requisition.approvedToolName,
      actionFingerprint: requisition.actionFingerprint,
      amountUsd,
      currency: 'USD',
      reservedAt: now.toISOString(),
      reservationExpiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    }, options, ledger.events);
    return {
      recorded: true,
      duplicate: false,
      requisition: projectRequisitionFromEvents([...ledger.events, recorded], requisitionId, options),
    };
  });
}

function settlePurchaseRequisition(input = {}, options = {}) {
  rejectCallerSelectedRequester(input);
  const now = options.now || new Date();
  const requester = authenticatedPrincipal(options);
  const requisitionId = requiredString(input.requisitionId, 'requisitionId');
  const reservationId = requiredString(input.reservationId, 'reservationId');
  const status = requiredString(input.status, 'status');
  if (!SETTLEMENT_STATUSES.has(status)) {
    throw financialError('status must be committed or released');
  }
  return withLedgerLock(options, () => {
    const ledger = readLedger(options);
    assertLedgerHealthyData(ledger, options);
    const requisition = projectRequisitionFromEvents(ledger.events, requisitionId, options);
    if (!requisition) throw financialError(`unknown requisition '${requisitionId}'`);
    const allowedStates = status === 'committed' ? ['authorized'] : ['reserved', 'authorized'];
    if (!allowedStates.includes(requisition.status)) {
      throw financialError(`requisition '${requisitionId}' is ${requisition.status}, not ${allowedStates.join(' or ')}`);
    }
    if (reservationId !== requisition.reservationId) {
      throw financialError('reservationId does not match the active reservation');
    }
    assertPrincipalOwnsRequisition(requester, requisition);
    verifyPurchaseApprovalBinding(requisition, { ...options, allowConsumed: true });
    assertReservationBoundToApproval(requisition);

    const base = {
      schemaVersion: 'financial-control-v2',
      eventType: status,
      status,
      requisitionId,
      reservationId,
      requester,
      settledAt: now.toISOString(),
    };
    if (status === 'committed') {
      const actualAmountUsd = nonNegativeMoney(input.actualAmountUsd, 'actualAmountUsd');
      if (actualAmountUsd > requisition.reservedAmountUsd) {
        throw financialError(`actual amount $${actualAmountUsd.toFixed(2)} exceeds reservation $${requisition.reservedAmountUsd.toFixed(2)}`);
      }
      const evidence = stringArray(input.evidence);
      if (evidence.length === 0) throw financialError('committed spend requires receipt evidence');
      Object.assign(base, { actualAmountUsd, currency: 'USD', evidence });
    } else {
      base.reason = requiredString(input.reason, 'reason');
    }
    const recorded = appendEventUnlocked(base, options, ledger.events);
    return {
      recorded: true,
      requisition: projectRequisitionFromEvents([...ledger.events, recorded], requisitionId, options),
    };
  });
}

function listPurchaseRequisitions(options = {}) {
  const events = readEvents(options);
  return requisitionsFromEvents(events, options);
}

function requisitionsFromEvents(events, options = {}) {
  const ids = [...new Set(events.map((event) => event.requisitionId).filter(Boolean))];
  return ids
    .map((id) => projectRequisitionFromEvents(events, id, options))
    .filter(Boolean)
    .sort((left, right) => Date.parse(right.requestedAt) - Date.parse(left.requestedAt));
}

function projectRequisition(requisitionId, options = {}) {
  return projectRequisitionFromEvents(readEvents(options), requisitionId, options);
}

function projectRequisitionFromEvents(allEvents, requisitionId, options = {}) {
  const events = allEvents.filter((event) => event.requisitionId === requisitionId);
  const requested = events.find((event) => event.eventType === 'requested');
  if (!requested) return null;
  const now = options.now || new Date();
  const state = { ...requested, timeline: events };
  applyEscalationState(state, requested, now, options);
  for (const event of events.slice(1)) applyFinancialEvent(state, event, now);
  return state;
}

function applyEscalationState(state, requested, now, options) {
  const escalation = getEscalation(requested.escalationId, options);
  if (escalation?.status === 'approved') {
    Object.assign(state, {
      status: 'approved',
      approvedBy: escalation.actor,
      approvalReason: escalation.reason,
      approvedAt: escalation.decidedAt,
    });
  } else if (escalation?.status === 'rejected') {
    state.status = 'rejected';
  } else if (escalation?.status === 'cancelled') {
    state.status = 'cancelled';
  } else if (Date.parse(requested.expiresAt) <= now.getTime() || escalation?.status === 'expired') {
    state.status = 'expired';
  }
}

function applyFinancialEvent(state, event, now) {
  if (event.eventType === 'reserved') {
    const withdrawn = state.status === 'cancelled' || state.status === 'rejected';
    const reservationStatus = Date.parse(event.reservationExpiresAt) <= now.getTime()
      ? 'reservation_expired'
      : 'reserved';
    Object.assign(state, {
      status: withdrawn ? state.status : reservationStatus,
      reservationId: event.reservationId,
      reservationIdempotencyKey: event.reservationIdempotencyKey,
      reservedAmountUsd: event.amountUsd,
      reservedAt: event.reservedAt,
      reservationExpiresAt: event.reservationExpiresAt,
    });
  } else if (event.eventType === 'authorized') {
    Object.assign(state, {
      status: 'authorized',
      authorizationId: event.authorizationId,
      actionId: event.actionId,
      authorizedAt: event.authorizedAt,
      authorizedAmountUsd: event.estimatedCostUsd,
    });
  } else if (event.eventType === 'committed') {
    Object.assign(state, {
      status: 'committed',
      actualAmountUsd: event.actualAmountUsd,
      settlementEvidence: event.evidence,
      settledAt: event.settledAt,
    });
  } else if (event.eventType === 'released') {
    Object.assign(state, {
      status: 'released',
      releaseReason: event.reason,
      settledAt: event.settledAt,
    });
  }
}

function reconcilePurchaseLedger(options = {}) {
  return withLedgerLock(options, () => reconcilePurchaseLedgerUnlocked(options));
}

function reconcilePurchaseLedgerUnlocked(options = {}) {
  const ledger = readLedger(options);
  const chain = validateLedgerChain(ledger.events, ledger.malformedRows, ledger.head, options);
  const requisitions = listPurchaseRequisitions(options);
  const staleReservations = requisitions
    .filter((entry) => entry.status === 'reservation_expired')
    .map((entry) => entry.requisitionId);
  const totals = requisitions.reduce((acc, entry) => {
    if (entry.status === 'reserved') acc.reservedUsd += entry.reservedAmountUsd || 0;
    if (entry.status === 'authorized') acc.authorizedUsd += entry.authorizedAmountUsd || 0;
    if (entry.status === 'committed') acc.committedUsd += entry.actualAmountUsd || 0;
    if (entry.approvedBy) acc.approvedUsd += entry.amountUsd || 0;
    return acc;
  }, { approvedUsd: 0, reservedUsd: 0, authorizedUsd: 0, committedUsd: 0 });
  return {
    schemaVersion: 'financial-reconciliation-v2',
    generatedAt: (options.now || new Date()).toISOString(),
    ok: chain.ok && staleReservations.length === 0,
    eventCount: ledger.events.length,
    requisitionCount: requisitions.length,
    totals: mapMoney(totals),
    statusCounts: requisitions.reduce((acc, entry) => {
      acc[entry.status] = (acc[entry.status] || 0) + 1;
      return acc;
    }, {}),
    staleReservations,
    malformedRows: ledger.malformedRows,
    invalidEventHashes: chain.invalidEventHashes,
    invalidChainLinks: chain.invalidChainLinks,
    ledgerHeadMismatches: chain.ledgerHeadMismatches,
  };
}

function maybeRecordAllowedBrowserPage(input, options, allowed) {
  if (!allowed || options.consumeReservation !== true) return;
  recordBrowserPageNavigation(input.toolName, input.toolInput, options);
}

function evaluateFinancialControl(input = {}, options = {}) {
  const actionProfile = objectValue(input.actionProfile);
  const economicAction = actionProfile.economicAction === true
    || detectEconomicAction(input.toolName, input.toolInput, options);
  if (!economicAction) {
    maybeRecordAllowedBrowserPage(input, options, true);
    return allowNonEconomicAction();
  }

  const result = financialEvaluationContext(input, options);
  validateBudget(result);
  validateAttachedControl(result);
  validateRequisition(result, options);
  validateCostControl(result);
  consumeReservationIfAuthorized(result, input, options);
  const decision = buildFinancialDecision(result);
  maybeRecordAllowedBrowserPage(input, options, decision.mode === 'allow');
  return decision;
}

function allowNonEconomicAction() {
  return { mode: 'allow', economicAction: false, reasons: [], reasonCodes: [] };
}

function financialEvaluationContext(input, options) {
  const toolInput = objectValue(input.toolInput);
  const control = objectValue(toolInput.financialControl || toolInput.financial_control || input.financialControl);
  return {
    input,
    toolInput,
    control,
    budget: objectValue(input.costControl?.budget || input.budget),
    estimatedCostUsd: finiteNumber(input.costControl?.usage?.estimatedCostUsd, 0),
    requisitionId: optionalString(control.requisitionId),
    reservationId: optionalString(control.reservationId),
    actionId: optionalString(control.actionId),
    actionBinding: buildActionAuthorization(input.toolName, toolInput, finiteNumber(input.costControl?.usage?.estimatedCostUsd, 0)),
    principal: authenticatedPrincipal(options),
    requisition: null,
    authorization: null,
    reasons: [],
    reasonCodes: [],
  };
}

function addBlock(result, code, message) {
  result.reasonCodes.push(code);
  result.reasons.push(message);
}

function validateBudget(result) {
  const { budget, estimatedCostUsd } = result;
  const hasCostBudget = budget.hasMaxCostUsdPerAction === true || budget.hasRemainingCostUsd === true;
  if (!hasCostBudget) addBlock(result, 'missing_financial_budget', 'Economic actions require an explicit USD budget.');
  if ((budget.hasMaxCostUsdPerAction && budget.maxCostUsdPerAction === 0)
    || (budget.hasRemainingCostUsd && budget.remainingCostUsd === 0)) {
    addBlock(result, 'zero_spend_budget', 'Configured USD budget is $0.00; spending is prohibited.');
  }
  if (estimatedCostUsd <= 0) {
    addBlock(result, 'missing_cost_estimate', 'Economic actions require a positive, explicit cost estimate before approval.');
  }
}

function validateAttachedControl(result) {
  if (!result.requisitionId) {
    addBlock(result, 'missing_purchase_requisition', 'No purchase requisition is attached to this action.');
  }
  if (!result.reservationId) {
    addBlock(result, 'missing_budget_reservation', 'No approved budget reservation is attached to this action.');
  }
  if (!result.actionId) {
    addBlock(result, 'missing_action_id', 'A unique actionId is required to consume a financial reservation.');
  }
}

function reconciliationHasIntegrityFailure(reconciliation) {
  return !reconciliation.ok && (
    reconciliation.invalidEventHashes.length > 0
    || reconciliation.invalidChainLinks.length > 0
    || reconciliation.ledgerHeadMismatches.length > 0
    || reconciliation.malformedRows.length > 0
  );
}

function blockLedgerIntegrityFailures(result, reconciliation) {
  const anchorUnavailable = reconciliation.ledgerHeadMismatches.some(
    (entry) => optionalString(entry.rollbackResistantAnchorError)
  );
  const independentTampering = reconciliation.invalidEventHashes.length > 0
    || reconciliation.invalidChainLinks.length > 0
    || reconciliation.malformedRows.length > 0
    || reconciliation.ledgerHeadMismatches.some(
      (entry) => !optionalString(entry.rollbackResistantAnchorError)
    );
  if (independentTampering) {
    addBlock(result, 'financial_ledger_tampered', 'Financial ledger integrity verification failed.');
  }
  if (anchorUnavailable) {
    addBlock(
      result,
      'financial_ledger_anchor_unavailable',
      'Rollback-resistant financial ledger anchor is unavailable; financial actions fail closed.'
    );
  }
}

function validateRequisitionBindings(result, requisition, options) {
  try {
    verifyPurchaseApprovalBinding(requisition, options);
  } catch (error) {
    addBlock(result, 'financial_approval_binding_invalid', error.message);
  }
  try {
    assertReservationBoundToApproval(requisition);
  } catch (error) {
    addBlock(result, 'reservation_not_bound_to_approval', error.message);
  }
}

function validateRequisitionConstraints(result, requisition) {
  if (requisition.status !== 'reserved') {
    addBlock(result, 'requisition_not_reserved', `Purchase requisition '${result.requisitionId}' is ${requisition.status}, not reserved.`);
  }
  if (result.reservationId && requisition.reservationId !== result.reservationId) {
    addBlock(result, 'reservation_mismatch', 'Attached reservation does not match the requisition ledger.');
  }
  if (!sameIdentity(result.principal, requisition.requester)) {
    addBlock(result, 'runtime_principal_mismatch', 'Authenticated runtime principal does not own this purchase requisition.');
  }
  if (!requisition.approvedBy || sameIdentity(requisition.requester, requisition.approvedBy)) {
    addBlock(result, 'independent_approval_missing', 'An independently authenticated human approval is required.');
  }
  if (result.estimatedCostUsd > (requisition.reservedAmountUsd || 0)) {
    addBlock(result, 'reservation_amount_exceeded', `Estimated cost $${result.estimatedCostUsd.toFixed(2)} exceeds the reserved amount.`);
  }
  if (!requisition.actionFingerprint
    || result.actionBinding.fingerprint !== requisition.actionFingerprint) {
    addBlock(result, 'financial_action_mismatch', 'Actual tool action or USD amount does not match the independently approved action fingerprint.');
  }
  if (normalizeToolName(result.actionBinding.toolName) !== normalizeToolName(requisition.approvedToolName)) {
    addBlock(result, 'financial_tool_mismatch', 'Actual financial tool does not match the approved tool.');
  }
}

function validateRequisition(result, options) {
  const reconciliation = reconcilePurchaseLedger(options);
  if (reconciliationHasIntegrityFailure(reconciliation)) {
    blockLedgerIntegrityFailures(result, reconciliation);
    return;
  }
  if (!result.requisitionId) return;
  const requisition = projectRequisition(result.requisitionId, options);
  result.requisition = requisition;
  if (!requisition) {
    addBlock(result, 'unknown_purchase_requisition', `Purchase requisition '${result.requisitionId}' does not exist.`);
    return;
  }
  validateRequisitionBindings(result, requisition, options);
  validateRequisitionConstraints(result, requisition);
  validateScope(result, requisition);
}

function validateScope(result, requisition) {
  for (const field of ['vendor', 'purpose', 'sourceMessageId']) {
    const supplied = optionalString(result.control[field]);
    if (!supplied || normalizeScope(supplied) !== normalizeScope(requisition[field])) {
      addBlock(result, `${field}_mismatch`, `${field} must exactly match the approved requisition scope.`);
    }
  }
}

function validateCostControl(result) {
  if (result.input.costControl?.mode !== 'block') return;
  const reasons = result.input.costControl.reasons;
  addBlock(
    result,
    'cost_control_block',
    Array.isArray(reasons) && reasons.length > 0
      ? reasons.join(' ')
      : 'Configured cost control blocked this action.'
  );
}

function consumeReservationIfAuthorized(result, input, options) {
  if (result.reasonCodes.length > 0 || options.consumeReservation !== true) return;
  try {
    result.authorization = consumeReservation({
      requisitionId: result.requisitionId,
      reservationId: result.reservationId,
      actionId: result.actionId,
      estimatedCostUsd: result.estimatedCostUsd,
      principal: result.principal,
      toolName: input.toolName,
      actionFingerprint: result.actionBinding.fingerprint,
      vendor: result.control.vendor,
      purpose: result.control.purpose,
      sourceMessageId: result.control.sourceMessageId,
    }, options);
    result.requisition = result.authorization;
  } catch (error) {
    addBlock(result, 'reservation_consumption_failed', error.message);
  }
}

function consumeReservation(input, options) {
  return withLedgerLock(options, () => {
    const ledger = readLedger(options);
    const chain = validateLedgerChain(ledger.events, ledger.malformedRows, ledger.head, options);
    if (!chain.ok) throw financialError('financial ledger integrity check failed before authorization');
    const current = projectRequisitionFromEvents(ledger.events, input.requisitionId, options);
    if (current?.status !== 'reserved') {
      throw financialError(`purchase requisition '${input.requisitionId}' is not available for single-use authorization`);
    }
    if (current.reservationId !== input.reservationId) {
      throw financialError('reservation changed before authorization');
    }
    assertPrincipalOwnsRequisition(input.principal, current);
    verifyPurchaseApprovalBinding(current, options);
    assertReservationBoundToApproval(current);
    if (input.estimatedCostUsd > current.reservedAmountUsd) {
      throw financialError('estimated cost exceeds the signed purchase reservation');
    }
    if (input.actionFingerprint !== current.actionFingerprint) {
      throw financialError('financial action changed before authorization');
    }
    if (normalizeToolName(input.toolName) !== normalizeToolName(current.approvedToolName)) {
      throw financialError('financial tool changed before authorization');
    }
    assertScopeMatches(input, current);
    if (current.escalationId) {
      consumeVerifiedApproval(current.escalationId, { consumer: input.principal }, options);
    }
    appendEventUnlocked({
      schemaVersion: 'financial-control-v2',
      eventType: 'authorized',
      status: 'authorized',
      requisitionId: input.requisitionId,
      reservationId: input.reservationId,
      authorizationId: `auth_${crypto.randomUUID()}`,
      actionId: input.actionId,
      requester: input.principal,
      toolName: String(input.toolName || 'unknown'),
      actionFingerprint: input.actionFingerprint,
      estimatedCostUsd: input.estimatedCostUsd,
      currency: 'USD',
      authorizedAt: (options.now || new Date()).toISOString(),
    }, options, ledger.events);
    return projectRequisition(input.requisitionId, options);
  });
}

function buildFinancialDecision(result) {
  const requisition = result.requisition;
  return {
    mode: result.reasonCodes.length > 0 ? 'block' : 'allow',
    economicAction: true,
    deterministic: true,
    reasons: [...new Set(result.reasons)],
    reasonCodes: [...new Set(result.reasonCodes)],
    authorization: requisition ? {
      requisitionId: requisition.requisitionId,
      reservationId: requisition.reservationId || null,
      authorizationId: requisition.authorizationId || null,
      actionId: requisition.actionId || result.actionId || null,
      status: requisition.status,
      vendor: requisition.vendor,
      purpose: requisition.purpose,
      sourceMessageId: requisition.sourceMessageId,
      approvedAmountUsd: requisition.amountUsd,
      reservedAmountUsd: requisition.reservedAmountUsd || 0,
      approvedBy: requisition.approvedBy || null,
      actionFingerprint: requisition.actionFingerprint || null,
      approvedToolName: requisition.approvedToolName || null,
    } : null,
  };
}

function assertScopeMatches(input, requisition) {
  for (const field of ['vendor', 'purpose', 'sourceMessageId']) {
    const value = requiredString(input[field] ?? requisition[field], field);
    if (normalizeScope(value) !== normalizeScope(requisition[field])) {
      throw financialError(`${field} does not match the approved requisition`);
    }
  }
}

function readLedger(options = {}) {
  const inputPath = options.inputPath ? path.resolve(options.inputPath) : getLedgerPath(options);
  let raw;
  try {
    raw = fs.readFileSync(inputPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw financialError(`cannot read financial ledger: ${error.message}`);
    }
    return { events: [], malformedRows: [], head: readLedgerHead(options) };
  }
  const events = [];
  const malformedRows = [];
  raw.split('\n').forEach((line, index) => {
    if (!line.trim()) return;
    try {
      events.push(JSON.parse(line));
    } catch {
      malformedRows.push(index + 1);
    }
  });
  return { events, malformedRows, head: readLedgerHead(options) };
}

function readLedgerHead(options = {}) {
  try {
    return JSON.parse(fs.readFileSync(getLedgerHeadPath(options), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return { malformed: true };
  }
}

function readEvents(options = {}) {
  return readLedger(options).events;
}

function appendEventUnlocked(event, options, existingEvents) {
  const outputPath = getLedgerPath(options);
  const previous = existingEvents.at(-1) || null;
  const previousHead = previous
    ? { sequence: previous.sequence, eventHash: previous.eventHash }
    : null;
  // Resolve and verify the rollback-resistant witness before touching local
  // durable state. Missing production witness configuration therefore fails
  // closed without leaving a half-written financial transaction behind.
  const currentAnchor = readFinancialLedgerAnchor(options);
  if (!sameHead(currentAnchor, previousHead)) {
    throw financialError('rollback-resistant financial ledger anchor does not match the current ledger');
  }
  const chained = {
    ...event,
    sequence: existingEvents.length + 1,
    previousEventHash: previous?.eventHash || null,
  };
  chained.eventHash = hashEvent(chained);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const journalPath = getLedgerJournalPath(options);
  const journal = {
    schemaVersion: LEDGER_JOURNAL_SCHEMA,
    previousHead,
    event: chained,
  };
  journal.auth = signIntegrityRecord(journal, ledgerIntegrityKey(options));
  writeAtomicJson(journalPath, journal);
  const ledgerFd = fs.openSync(outputPath, 'a', 0o600);
  try {
    fs.writeSync(ledgerFd, `${JSON.stringify(chained)}\n`, null, 'utf8');
    fs.fsyncSync(ledgerFd);
  } finally {
    fs.closeSync(ledgerFd);
  }
  fsyncDirectoryFor(outputPath);
  writeLedgerHeadFile(chained, options);
  advanceFinancialLedgerAnchor(previousHead, chained, options);
  removeDurableFile(journalPath);
  return chained;
}

function writeLedgerHeadFile(event, options) {
  const headPath = getLedgerHeadPath(options);
  const temporaryPath = `${headPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  const head = {
    schemaVersion: LEDGER_HEAD_SCHEMA,
    sequence: event.sequence,
    eventHash: event.eventHash,
  };
  head.auth = signIntegrityRecord(head, ledgerIntegrityKey(options));
  writeAtomicJson(headPath, head, temporaryPath);
}

function withLedgerLock(options, callback) {
  return withFileLedgerLock(`${getLedgerPath(options)}.lock`, callback, {
    now: options.now,
    lockStaleMs: options.lockStaleMs,
    errorFactory: (message) => financialError(message),
    beforeCallback: () => recoverLedgerTransaction(options),
  });
}

function readLedgerJournal(journalPath) {
  try {
    return JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw financialError(`cannot recover financial ledger journal: ${error.message}`);
  }
}

function verifiedJournalEvent(journal, integrityKey) {
  const event = journal?.event;
  if (journal?.schemaVersion !== LEDGER_JOURNAL_SCHEMA
    || !event
    || event.eventHash !== hashEvent(event)
    || !verifyIntegrityRecord(journal, integrityKey)) {
    throw financialError('financial ledger journal integrity verification failed');
  }
  return event;
}

function recoverAppendedLedgerEvent({
  ledger,
  event,
  previousHead,
  currentAnchor,
  headAtPrevious,
  headAtEvent,
  journalPath,
  options,
}) {
  const preceding = ledger.events.at(-2) || null;
  const expectedPrevious = preceding
    ? { sequence: preceding.sequence, eventHash: preceding.eventHash }
    : null;
  const chain = validateLedgerChain(
    ledger.events,
    ledger.malformedRows,
    null,
    { ...options, skipLedgerHead: true }
  );
  const anchorAtPrevious = sameHead(currentAnchor, previousHead);
  const anchorAtEvent = sameHead(currentAnchor, { sequence: event.sequence, eventHash: event.eventHash });
  if (!sameHead(previousHead, expectedPrevious)
    || !chain.ok
    || (!headAtPrevious && !headAtEvent)
    || (!anchorAtPrevious && !anchorAtEvent)) {
    throw financialError('financial ledger journal does not match the recoverable append');
  }
  if (!headAtEvent) writeLedgerHeadFile(event, options);
  if (!anchorAtEvent) advanceFinancialLedgerAnchor(previousHead, event, options);
  removeDurableFile(journalPath);
}

function canDiscardPreparedLedgerEvent({ ledger, event, previousHead, currentAnchor, headAtPrevious, options }) {
  const currentChain = validateLedgerChain(ledger.events, ledger.malformedRows, ledger.head, options);
  return currentChain.ok
    && headAtPrevious
    && sameHead(currentAnchor, previousHead)
    && event.sequence === ledger.events.length + 1;
}

function recoverLedgerTransaction(options = {}) {
  const journalPath = getLedgerJournalPath(options);
  const journal = readLedgerJournal(journalPath);
  if (!journal) return;
  const integrityKey = ledgerIntegrityKey(options);
  const event = verifiedJournalEvent(journal, integrityKey);
  const ledger = readLedger(options);
  const currentLast = ledger.events.at(-1) || null;
  const previousHead = journal.previousHead;
  const currentHead = ledger.head;
  const currentAnchor = readFinancialLedgerAnchor(options);
  const eventAlreadyAppended = currentLast?.sequence === event.sequence
    && currentLast?.eventHash === event.eventHash;
  const headAtPrevious = sameHead(currentHead, previousHead);
  const headAtEvent = sameHead(currentHead, { sequence: event.sequence, eventHash: event.eventHash });

  if (eventAlreadyAppended) {
    recoverAppendedLedgerEvent({
      ledger,
      event,
      previousHead,
      currentAnchor,
      headAtPrevious,
      headAtEvent,
      journalPath,
      options,
    });
    return;
  }

  if (canDiscardPreparedLedgerEvent({
    ledger,
    event,
    previousHead,
    currentAnchor,
    headAtPrevious,
    options,
  })) {
    // The crash happened before the event append. The caller never received a
    // success response, so discard the prepared transaction instead of
    // executing it during recovery.
    removeDurableFile(journalPath);
    return;
  }
  throw financialError('financial ledger journal cannot be reconciled safely');
}

function sameHead(left, right) {
  if (!left && !right) return true;
  return left?.sequence === right?.sequence && left?.eventHash === right?.eventHash;
}

function writeAtomicJson(targetPath, value, temporaryPath = null) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporary = temporaryPath || `${targetPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  const fd = fs.openSync(temporary, 'w', 0o600);
  try {
    fs.writeSync(fd, `${JSON.stringify(value)}\n`, null, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, targetPath);
  fsyncDirectoryFor(targetPath);
}

function removeDurableFile(targetPath) {
  fs.unlinkSync(targetPath);
  fsyncDirectoryFor(targetPath);
}

function fsyncDirectoryFor(targetPath) {
  const directoryFd = fs.openSync(path.dirname(targetPath), 'r');
  try {
    fs.fsyncSync(directoryFd);
  } finally {
    fs.closeSync(directoryFd);
  }
}

function validateLedgerChain(events, malformedRows = [], ledgerHead = null, options = {}) {
  const invalidEventHashes = [];
  const invalidChainLinks = [];
  let previousHash = null;
  events.forEach((event, index) => {
    const sequence = index + 1;
    if (event.eventHash !== hashEvent(event)) {
      invalidEventHashes.push({ sequence, requisitionId: event.requisitionId, eventType: event.eventType });
    }
    if (event.sequence !== sequence || event.previousEventHash !== previousHash) {
      invalidChainLinks.push({
        sequence,
        recordedSequence: event.sequence,
        expectedPreviousEventHash: previousHash,
        recordedPreviousEventHash: event.previousEventHash,
      });
    }
    previousHash = event.eventHash || null;
  });
  const ledgerHeadMismatches = options.skipLedgerHead
    ? []
    : validateLedgerHead(events, ledgerHead, options);
  return {
    ok: malformedRows.length === 0
      && invalidEventHashes.length === 0
      && invalidChainLinks.length === 0
      && ledgerHeadMismatches.length === 0,
    invalidEventHashes,
    invalidChainLinks,
    ledgerHeadMismatches,
  };
}

function validateLedgerHead(events, ledgerHead, options = {}) {
  const expected = events.at(-1) || { sequence: 0, eventHash: null };
  const key = optionalString(
    options.financialLedgerIntegrityKey
      || options.approvalVerificationKey
      || options.approvalSigningKey
      || process.env.THUMBGATE_FINANCIAL_LEDGER_KEY
      || process.env.THUMBGATE_HUMAN_REVIEWER_KEY
  );
  let anchor = null;
  let anchorError = null;
  try {
    anchor = readFinancialLedgerAnchor(options);
  } catch (error) {
    anchorError = error.message;
  }
  if (events.length === 0 && ledgerHead === null && anchor === null && !anchorError) return [];
  if (key
    && ledgerHead?.schemaVersion === LEDGER_HEAD_SCHEMA
    && ledgerHead.sequence === expected.sequence
    && ledgerHead.eventHash === expected.eventHash
    && verifyIntegrityRecord(ledgerHead, key)
    && sameHead(anchor, expected)) return [];
  return [{
    recordedSequence: ledgerHead?.sequence ?? null,
    expectedSequence: expected.sequence,
    recordedEventHash: ledgerHead?.eventHash ?? null,
    expectedEventHash: expected.eventHash,
    authenticated: Boolean(key && verifyIntegrityRecord(ledgerHead, key)),
    rollbackResistantAnchorSequence: anchor?.sequence ?? null,
    rollbackResistantAnchorEventHash: anchor?.eventHash ?? null,
    rollbackResistantAnchorError: anchorError,
  }];
}

function assertLedgerHealthyData(ledger, options = {}) {
  if (!validateLedgerChain(ledger.events, ledger.malformedRows, ledger.head, options).ok) {
    throw financialError('financial ledger integrity verification failed');
  }
}

function ledgerIntegrityKey(options = {}) {
  const key = optionalString(
    options.financialLedgerIntegrityKey
      || options.approvalVerificationKey
      || options.approvalSigningKey
      || process.env.THUMBGATE_FINANCIAL_LEDGER_KEY
      || process.env.THUMBGATE_HUMAN_REVIEWER_KEY
  );
  if (!key) {
    throw financialError('financial ledger integrity key is required');
  }
  return key;
}

function signIntegrityRecord(record, key) {
  return {
    algorithm: 'hmac-sha256',
    keyId: crypto.createHash('sha256').update(key).digest('hex').slice(0, 16),
    signature: crypto.createHmac('sha256', key).update(integrityPayload(record)).digest('hex'),
  };
}

function verifyIntegrityRecord(record, key) {
  const auth = record?.auth;
  if (!record || auth?.algorithm !== 'hmac-sha256') return false;
  const expectedKeyId = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
  if (auth.keyId !== expectedKeyId || !/^[a-f0-9]{64}$/i.test(String(auth.signature || ''))) return false;
  const expected = crypto.createHmac('sha256', key).update(integrityPayload(record)).digest();
  const actual = Buffer.from(auth.signature, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function integrityPayload(record) {
  const copy = { ...record };
  delete copy.auth;
  return stableStringify(copy);
}

function hashEvent(event) {
  const copy = { ...event };
  delete copy.eventHash;
  return crypto.createHash('sha256').update(stableStringify(copy)).digest('hex');
}

function requestComparableHash(event) {
  const comparable = {
    requisitionId: event.requisitionId,
    ...requestIntentComparable(event),
  };
  return crypto.createHash('sha256').update(stableStringify(comparable)).digest('hex');
}

function requestIntentHash(event) {
  return crypto.createHash('sha256').update(stableStringify(requestIntentComparable(event))).digest('hex');
}

function stableRequisitionId(requestIntent) {
  return `req_${requestIntentHash(requestIntent).slice(0, 32)}`;
}

function requestIntentComparable(event) {
  return {
    idempotencyKey: event.idempotencyKey,
    taskId: event.taskId,
    requester: event.requester,
    vendor: event.vendor,
    purpose: event.purpose,
    sourceMessageId: event.sourceMessageId,
    amountUsd: event.amountUsd,
    approvedToolName: event.approvedToolName,
    actionFingerprint: event.actionFingerprint,
    evidence: event.evidence,
  };
}

function stableStringify(value) {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort((left, right) => left.localeCompare(right));
  const properties = keys.map((key) => [JSON.stringify(key), stableStringify(value[key])].join(':'));
  return ['{', properties.join(','), '}'].join('');
}

function buildActionAuthorization(toolName, toolInput, amountUsd) {
  const normalizedToolName = normalizeToolName(requiredString(toolName, 'toolName'));
  const exactToolInput = objectValue(toolInput);
  if (Object.keys(exactToolInput).length === 0) throw financialError('toolInput for the exact economic action is required');
  const payload = {
    schemaVersion: 'financial-action-authorization-v1',
    toolName: normalizedToolName,
    toolInput: stripControlMetadata(exactToolInput),
    amountUsd: roundMoney(Math.max(0, finiteNumber(amountUsd, 0))),
  };
  return {
    toolName: normalizedToolName,
    fingerprint: crypto.createHash('sha256').update(stableStringify(payload)).digest('hex'),
  };
}

function stripControlMetadata(value, depth = 0) {
  if (Array.isArray(value)) return value.map((entry) => stripControlMetadata(entry, depth + 1));
  if (!value || typeof value !== 'object') return value;
  // Only the explicitly namespaced ThumbGate authorization envelope is
  // transport metadata. Unnamespaced provider fields such as budget and usage
  // are economic inputs even at the tool_input root and must remain inside the
  // signed fingerprint. Hook cost telemetry belongs in costControl, not here.
  const excluded = depth === 0
    ? new Set(['financialControl', 'financial_control'])
    : new Set();
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !excluded.has(key))
    .map(([key, entry]) => [key, stripControlMetadata(entry, depth + 1)]));
}

function verifyPurchaseApprovalBinding(requisition, options) {
  let escalation;
  try {
    escalation = getVerifiedApproval(requisition.escalationId, options);
  } catch (error) {
    throw financialError(`requisition '${requisition.requisitionId}' approval verification failed: ${error.message}`);
  }
  if (escalation?.status !== 'approved') {
    throw financialError(`requisition '${requisition.requisitionId}' does not have independent human approval`);
  }
  const expectedApprovalContextDigest = requestComparableHash(requisition);
  if (!requisition.approvalContextDigest
    || requisition.approvalContextDigest !== expectedApprovalContextDigest
    || escalation.approvalContextDigest !== expectedApprovalContextDigest) {
    throw financialError(`requisition '${requisition.requisitionId}' approval is not bound to its exact purchase request`);
  }
  if (sameIdentity(requisition.requester, escalation.actor)) {
    throw financialError('requester cannot approve their own requisition');
  }
  return escalation;
}

function assertReservationBoundToApproval(requisition) {
  if (!['reserved', 'authorized', 'committed'].includes(requisition.status)) return;
  const reservation = requisition.timeline.findLast((event) => event.eventType === 'reserved');
  if (!reservation) throw financialError('reserved purchase has no reservation event');
  if (positiveMoney(reservation.amountUsd, 'reserved amount') > requisition.amountUsd) {
    throw financialError('reserved amount exceeds the signed purchase request');
  }
  if (reservation.actionFingerprint !== requisition.actionFingerprint
    || normalizeToolName(reservation.approvedToolName) !== normalizeToolName(requisition.approvedToolName)) {
    throw financialError('reservation action does not match the signed purchase request');
  }
  assertScopeMatches(reservation, requisition);
  if (!sameIdentity(reservation.requester, requisition.requester)) {
    throw financialError('reservation requester does not match the signed purchase request');
  }
}

function normalizeToolName(value) {
  return String(value || '').trim().toLowerCase();
}

function rejectCallerSelectedRequester(input) {
  if (Object.hasOwn(input, 'requester')) {
    throw financialError('requester is derived from the authenticated runtime and must not be supplied by the caller');
  }
}

function authenticatedPrincipal(options) {
  return requiredIdentity(options.authenticatedPrincipal || RUNTIME_PRINCIPAL, 'authenticatedPrincipal');
}

function assertPrincipalOwnsRequisition(principal, requisition) {
  if (!sameIdentity(principal, requisition.requester)) {
    throw financialError('authenticated runtime principal does not own this purchase requisition');
  }
}

function requiredIdentity(value, field) {
  if (!value || typeof value !== 'object') throw financialError(`${field} identity is required`);
  const identity = {
    id: requiredString(value.id, `${field}.id`),
    kind: requiredString(value.kind, `${field}.kind`),
  };
  if (!['agent', 'service', 'human'].includes(identity.kind)) {
    throw financialError(`${field}.kind must be agent, service, or human`);
  }
  const displayName = optionalString(value.displayName);
  if (displayName) identity.displayName = displayName;
  return identity;
}

function sameIdentity(left, right) {
  return left?.id === right?.id && left?.kind === right?.kind;
}

function positiveMoney(value, field) {
  const amount = finiteNumber(value, Number.NaN);
  if (!Number.isFinite(amount) || amount <= 0) throw financialError(`${field} must be greater than zero`);
  return roundMoney(amount);
}

function nonNegativeMoney(value, field) {
  const amount = finiteNumber(value, Number.NaN);
  if (!Number.isFinite(amount) || amount < 0) throw financialError(`${field} must be zero or greater`);
  return roundMoney(amount);
}

function roundMoney(value) {
  return Number(Number(value).toFixed(2));
}

function mapMoney(value) {
  return Object.fromEntries(Object.entries(value).map(([key, amount]) => [key, roundMoney(amount)]));
}

function boundedTtl(value, fallback) {
  return Math.min(MAX_TTL_MS, Math.max(1, finiteNumber(value, fallback)));
}

function requiredString(value, field) {
  const clean = String(value ?? '').trim();
  if (!clean) throw financialError(`${field} is required`);
  return clean;
}

function optionalString(value) {
  const clean = String(value ?? '').trim();
  return clean || undefined;
}

function stringArray(value) {
  return Array.isArray(value) ? value.map((entry) => String(entry).trim()).filter(Boolean) : [];
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeScope(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function financialError(message) {
  const error = new Error(message);
  error.code = 'THUMBGATE_FINANCIAL_CONTROL_ERROR';
  return error;
}

module.exports = {
  ECONOMIC_ACTION_PATTERNS,
  ECONOMIC_URL_PATTERNS,
  createPurchaseRequisition,
  buildActionAuthorization,
  detectEconomicAction,
  isRemedyControlTool,
  detectOpaqueScreenMutation,
  evaluateFinancialControl,
  getBrowserPageStatePath,
  getLedgerHeadPath,
  getLedgerJournalPath,
  getLedgerPath,
  getFinancialControlRuntimeOptions,
  getRuntimePrincipal,
  listPurchaseRequisitions,
  lookupRecordedBrowserPageUrl,
  projectRequisition,
  readEvents,
  recordBrowserPageNavigation,
  reconcilePurchaseLedger,
  reservePurchaseRequisition,
  settlePurchaseRequisition,
};
