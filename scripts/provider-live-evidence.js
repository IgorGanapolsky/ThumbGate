#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

const { formatLocalDate, resolveAnalyticsWindow } = require('./analytics-window');
const { auditProviderSnapshot, digestBuyerEmail } = require('./provider-revenue-evidence');

const PAYPAL_API_BASE_URL = 'https://api-m.paypal.com';
const PAYPAL_REPORTING_MAX_LAG_MINUTES = 180;
const PAYPAL_PAGE_SIZE = 500;
const PAYPAL_MAX_PAGES = 20;
const PAYPAL_EVENT_PAGE_SIZE = 100;
const PAYPAL_MAX_EVENT_PAGES = 20;
const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
const PAYPAL_PAYMENT_EVENT_CODES = new Set(['T0002', 'T0005', 'T0006', 'T0007']);
const PAYPAL_REFUND_EVENT_CODES = new Set(['T1106', 'T1107', 'T1120', 'T1201']);
const PAYPAL_REVENUE_WEBHOOK_EVENTS = new Set([
  'PAYMENT.CAPTURE.COMPLETED',
  'PAYMENT.CAPTURE.REFUNDED',
  'PAYMENT.CAPTURE.REVERSED',
]);
const PAYPAL_API_HOSTS = new Set(['api-m.paypal.com', 'api-m.sandbox.paypal.com']);

function providerGap(provider, gap, diagnostics = null) {
  return {
    provider,
    audited: false,
    status: 'audit_incomplete',
    evidenceVerified: false,
    evidenceSource: null,
    evidenceDigest: null,
    revenue: null,
    individualPayments: [],
    individualPaymentStates: [],
    gap,
    diagnostics,
  };
}

function collectVerifiedIndividualPayments(snapshot, { now, timeZone = 'UTC' } = {}) {
  const nowDate = new Date(now || new Date().toISOString());
  if (Number.isNaN(nowDate.getTime())) return { ok: false, gap: 'Individual-payment audit requires a valid current timestamp.' };
  let window;
  try {
    window = resolveAnalyticsWindow({ window: '30d', now: nowDate.toISOString(), timeZone });
  } catch (error) {
    return { ok: false, gap: `Individual-payment audit window is invalid: ${error.message}` };
  }
  const transactions = Array.isArray(snapshot?.transactions) ? snapshot.transactions : [];
  const currency = String(snapshot?.currency || '').trim().toLowerCase();
  const sourceReference = String(snapshot?.source?.reference || '').trim();
  if (snapshot?.source?.kind !== 'provider_api_live' || !sourceReference || currency !== 'usd') {
    return { ok: false, gap: 'Individual payment requires live provider evidence in USD.' };
  }
  const evidenceSource = `provider_api_live:${sourceReference}`;
  const evidenceDigest = `sha256:${crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')}`;
  const ids = new Set();
  const payments = [];
  const states = [];
  for (const [index, transaction] of transactions.entries()) {
    const id = String(transaction?.id || '').trim();
    const createdAt = new Date(String(transaction?.createdAt || ''));
    const grossCents = transaction?.grossCents;
    const refundedCents = transaction?.refundedCents;
    const customerId = String(transaction?.customerId || '').trim();
    const buyerEmailDigest = String(transaction?.buyerEmailDigest || '').trim().toLowerCase();
    const status = String(transaction?.status || '').trim().toLowerCase();
    const attributed = transaction?.productAttribution?.verified === true &&
      String(transaction?.productAttribution?.product || '').trim().toLowerCase() === 'thumbgate';
    const external = transaction?.customerClassification === 'external' && transaction?.ownerTest === false;
    if (!id || ids.has(id) || Number.isNaN(createdAt.getTime()) ||
        createdAt.getTime() > nowDate.getTime() + 5 * 60 * 1000 ||
        !Number.isSafeInteger(grossCents) || grossCents <= 0 ||
        !Number.isSafeInteger(refundedCents) || refundedCents < 0 || refundedCents > grossCents ||
        !customerId || !/^sha256:[a-f0-9]{64}$/.test(buyerEmailDigest) || !attributed || !external ||
        !['completed', 'partially_refunded', 'refunded'].includes(status)) {
      return { ok: false, gap: `PayPal individual-payment candidate ${index} is malformed or unverified.` };
    }
    ids.add(id);
    const localDate = formatLocalDate(createdAt, window.timeZone);
    if (localDate < window.startLocalDate || localDate > window.endLocalDate) continue;
    const netCents = grossCents - refundedCents;
    const paymentState = {
      provider: 'paypal',
      id,
      createdAt: createdAt.toISOString(),
      localDate,
      timeZone: window.timeZone,
      status,
      grossCents,
      refundedCents,
      netCents,
      currency,
      customerId,
      buyerEmailDigest,
      customerClassification: 'external',
      ownerTest: false,
      productAttribution: { verified: true, product: 'thumbgate' },
      evidenceVerified: true,
      evidenceSource,
      evidenceDigest,
    };
    const invoiceId = String(transaction?.invoiceId || '').trim().slice(0, 127);
    if (invoiceId) paymentState.invoiceId = invoiceId;
    states.push(paymentState);
    if (netCents > 0) payments.push(paymentState);
  }
  return { ok: true, payments, states, evidenceSource, evidenceDigest };
}

function normalizeStrings(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => String(entry || '').trim()).filter(Boolean))];
}

function parseJsonObject(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function resolvePayPalConfig(env = process.env) {
  const clientId = env.THUMBGATE_PAYPAL_CLIENT_ID || env.PAYPAL_CLIENT_ID || '';
  const clientSecret = env.THUMBGATE_PAYPAL_CLIENT_SECRET || env.PAYPAL_CLIENT_SECRET || '';
  const rules = parseJsonObject(env.THUMBGATE_PAYPAL_EVIDENCE_RULES_JSON);
  const apiBaseUrl = env.THUMBGATE_PAYPAL_API_BASE_URL || PAYPAL_API_BASE_URL;
  const webhookId = String(env.THUMBGATE_PAYPAL_WEBHOOK_ID || '').trim();
  const webhookUrl = String(env.THUMBGATE_PAYPAL_WEBHOOK_URL || '').trim();
  const webhookLedgerPath = String(env.THUMBGATE_PAYPAL_WEBHOOK_LEDGER_PATH || '').trim();
  if (!clientId || !clientSecret) {
    return { configured: false, gap: 'PayPal direct audit is not configured: client ID and secret are both required.' };
  }
  if (!rules) {
    return { configured: false, gap: 'PayPal direct audit is not configured: THUMBGATE_PAYPAL_EVIDENCE_RULES_JSON is required.' };
  }
  const attribution = {
    customFieldValues: normalizeStrings(rules.customFieldValues),
    customFieldPrefixes: normalizeStrings(rules.customFieldPrefixes),
    invoiceIdPrefixes: normalizeStrings(rules.invoiceIdPrefixes),
    subjects: normalizeStrings(rules.subjects),
  };
  if (!Object.values(attribution).some((entries) => entries.length > 0)) {
    return { configured: false, gap: 'PayPal evidence rules require at least one exact ThumbGate attribution matcher.' };
  }
  if (rules.ownerIdentifiersReviewed !== true) {
    return { configured: false, gap: 'PayPal evidence rules must explicitly attest ownerIdentifiersReviewed=true.' };
  }
  if (rules.subscriptionsEnabled !== false) {
    return { configured: false, gap: 'PayPal direct audit currently requires subscriptionsEnabled=false; subscription-state reconciliation is not yet packaged as complete.' };
  }
  let parsedBaseUrl;
  try {
    parsedBaseUrl = new URL(apiBaseUrl);
  } catch {
    return { configured: false, gap: 'PayPal API base URL is invalid.' };
  }
  if (parsedBaseUrl.protocol !== 'https:' && env.NODE_ENV !== 'test') {
    return { configured: false, gap: 'PayPal API base URL must use HTTPS.' };
  }
  if (!PAYPAL_API_HOSTS.has(parsedBaseUrl.hostname) && env.NODE_ENV !== 'test') {
    return { configured: false, gap: 'PayPal API base URL must use the official live or sandbox host.' };
  }
  return {
    configured: true,
    clientId,
    clientSecret,
    apiBaseUrl: parsedBaseUrl.toString(),
    webhookId,
    webhookUrl,
    webhookLedgerPath,
    attribution,
    ownerAccountIds: new Set(normalizeStrings(rules.ownerAccountIds).map((entry) => entry.toLowerCase())),
    ownerEmails: new Set(normalizeStrings(rules.ownerEmails).map((entry) => entry.toLowerCase())),
  };
}

function formatZonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
}

function localMidnightToUtc(localDate, timeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(localDate || ''));
  if (!match) throw new Error('Invalid local date.');
  const target = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: 0,
    minute: 0,
    second: 0,
  };
  const targetUtc = Date.UTC(target.year, target.month - 1, target.day);
  let guess = targetUtc;
  for (let index = 0; index < 4; index += 1) {
    const actual = formatZonedParts(new Date(guess), timeZone);
    const actualUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    guess += targetUtc - actualUtc;
  }
  const verified = formatZonedParts(new Date(guess), timeZone);
  if (verified.year !== target.year || verified.month !== target.month || verified.day !== target.day || verified.hour !== 0) {
    throw new Error(`Could not resolve local midnight for ${localDate} in ${timeZone}.`);
  }
  return new Date(guess);
}

function shiftLocalDate(localDate, days) {
  const [year, month, day] = String(localDate).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function exactMoneyToCents(value) {
  const text = String(value ?? '').trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ''] = unsigned.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? (negative ? -cents : cents) : null;
}

function safeHeader(response, name) {
  try {
    return response.headers?.get?.(name) || null;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function responseJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function requestPayPalAccessToken(config, fetchImpl, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const tokenUrl = new URL('/v1/oauth2/token', config.apiBaseUrl);
  let response;
  try {
    response = await fetchWithTimeout(fetchImpl, tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
    }, timeoutMs);
  } catch {
    return { ok: false, gap: 'PayPal OAuth network request failed or timed out.', diagnostics: { configured: true } };
  }
  const payload = await responseJson(response);
  const paypalDebugId = safeHeader(response, 'paypal-debug-id');
  if (!response.ok || !payload?.access_token) {
    return {
      ok: false,
      gap: `PayPal OAuth failed with HTTP ${response.status}.`,
      diagnostics: { configured: true, paypalDebugId },
    };
  }
  return { ok: true, accessToken: payload.access_token, paypalDebugId };
}

function paypalAttributionMatches(info, rules) {
  const customValues = [info.custom_field, info.custom_id]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const invoice = String(info.invoice_id || '').trim();
  const subject = String(info.transaction_subject || '').trim();
  return customValues.some((custom) => rules.customFieldValues.includes(custom)) ||
    customValues.some((custom) => rules.customFieldPrefixes.some((prefix) => custom.startsWith(prefix))) ||
    rules.invoiceIdPrefixes.some((prefix) => invoice.startsWith(prefix)) ||
    rules.subjects.includes(subject);
}

function hashedCustomerId(accountId, email) {
  const identity = String(accountId || email || '').trim().toLowerCase();
  if (!identity) return null;
  return `paypal_${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24)}`;
}

function parsePayPalTransactions(details, config) {
  const rows = [];
  const rawKeys = new Set();
  for (const [index, detail] of details.entries()) {
    const info = detail?.transaction_info || {};
    const eventCode = String(info.transaction_event_code || '').trim().toUpperCase();
    const transactionId = String(info.transaction_id || '').trim();
    const initiatedAt = String(info.transaction_initiation_date || '').trim();
    const currency = String(info.transaction_amount?.currency_code || '').trim().toUpperCase();
    const cents = exactMoneyToCents(info.transaction_amount?.value);
    const rawKey = `${transactionId}|${eventCode}|${initiatedAt}|${cents}`;
    if (!transactionId || !eventCode || !initiatedAt || cents === null || rawKeys.has(rawKey)) {
      return { ok: false, gap: `PayPal transaction row ${index} is malformed or duplicated.` };
    }
    rawKeys.add(rawKey);
    rows.push({ detail, info, eventCode, transactionId, initiatedAt, currency, cents });
  }

  const payments = new Map();
  const paymentBaseIds = new Map();
  const ownerPaymentBaseIds = new Set();
  let ownerRowsExcluded = 0;
  let unrelatedRowsExcluded = 0;
  for (const row of rows) {
    if (!PAYPAL_PAYMENT_EVENT_CODES.has(row.eventCode)) continue;
    if (!paypalAttributionMatches(row.info, config.attribution)) {
      unrelatedRowsExcluded += 1;
      continue;
    }
    if (row.currency !== 'USD') return { ok: false, gap: `Attributed PayPal transaction ${row.transactionId} is not USD.` };
    if (row.cents <= 0) return { ok: false, gap: `Attributed PayPal payment ${row.transactionId} has a non-positive amount.` };
    const createdAt = new Date(row.initiatedAt);
    if (Number.isNaN(createdAt.getTime())) return { ok: false, gap: `Attributed PayPal payment ${row.transactionId} has an invalid timestamp.` };
    const providerStatus = String(row.info.transaction_status || '').trim().toUpperCase();
    if (!['S', 'V', 'D'].includes(providerStatus)) {
      return { ok: false, gap: `Attributed PayPal payment ${row.transactionId} is pending or has an unsupported status.` };
    }
    if (paymentBaseIds.has(row.transactionId) || ownerPaymentBaseIds.has(row.transactionId)) {
      return { ok: false, gap: `Attributed PayPal payment ${row.transactionId} is duplicated across provider rows.` };
    }
    const payer = row.detail?.payer_info || {};
    const accountId = String(payer.account_id || row.info.paypal_account_id || '').trim();
    const email = String(payer.email_address || '').trim().toLowerCase();
    const isOwner = config.ownerAccountIds.has(accountId.toLowerCase()) || config.ownerEmails.has(email);
    if (isOwner) {
      ownerRowsExcluded += 1;
      ownerPaymentBaseIds.add(row.transactionId);
      continue;
    }
    const customerId = hashedCustomerId(accountId, email);
    if (!customerId) return { ok: false, gap: `Attributed PayPal payment ${row.transactionId} has no stable payer identity.` };
    const buyerEmailDigest = digestBuyerEmail(email);
    const id = `${row.transactionId}:${row.eventCode}:${row.initiatedAt}`;
    const transaction = {
      id,
      providerTransactionId: row.transactionId,
      status: providerStatus === 'V' ? 'refunded' : (providerStatus === 'D' ? 'failed' : 'completed'),
      createdAt: createdAt.toISOString(),
      grossCents: row.cents,
      refundedCents: providerStatus === 'V' ? row.cents : 0,
      customerId,
      ...(buyerEmailDigest ? { buyerEmailDigest } : {}),
      customerClassification: 'external',
      ownerTest: false,
      productAttribution: { verified: true, product: 'thumbgate' },
    };
    const invoiceId = String(row.info.invoice_id || '').trim().slice(0, 127);
    if (invoiceId) transaction.invoiceId = invoiceId;
    if (payments.has(id)) return { ok: false, gap: `PayPal payment ${id} is duplicated.` };
    payments.set(id, transaction);
    const matches = paymentBaseIds.get(row.transactionId) || [];
    matches.push(transaction);
    paymentBaseIds.set(row.transactionId, matches);
  }

  for (const row of rows) {
    if (PAYPAL_PAYMENT_EVENT_CODES.has(row.eventCode)) continue;
    const referenceId = String(row.info.paypal_reference_id || '').trim();
    const referenced = referenceId ? (paymentBaseIds.get(referenceId) || []) : [];
    const directlyAttributed = paypalAttributionMatches(row.info, config.attribution);
    if (referenceId && ownerPaymentBaseIds.has(referenceId) && referenced.length === 0) {
      ownerRowsExcluded += 1;
      continue;
    }
    if (!PAYPAL_REFUND_EVENT_CODES.has(row.eventCode)) {
      if (directlyAttributed || referenced.length > 0) {
        return { ok: false, gap: `Attributed PayPal row ${row.transactionId} uses unsupported revenue event code ${row.eventCode}.` };
      }
      unrelatedRowsExcluded += 1;
      continue;
    }
    if (!directlyAttributed && referenced.length === 0) {
      unrelatedRowsExcluded += 1;
      continue;
    }
    if (referenced.length !== 1) {
      return { ok: false, gap: `PayPal refund ${row.transactionId} does not resolve to exactly one attributed payment.` };
    }
    if (row.currency !== 'USD' || row.cents >= 0) {
      return { ok: false, gap: `PayPal refund ${row.transactionId} must be a negative USD movement.` };
    }
    const payment = referenced[0];
    payment.refundedCents += Math.abs(row.cents);
    if (payment.refundedCents > payment.grossCents) {
      return { ok: false, gap: `PayPal refunds exceed gross for ${referenceId}.` };
    }
    payment.status = payment.refundedCents === payment.grossCents ? 'refunded' : 'partially_refunded';
  }

  return {
    ok: true,
    transactions: [...payments.values()],
    diagnostics: { ownerRowsExcluded, unrelatedRowsExcluded, rawRowCount: rows.length },
  };
}

async function collectPayPalCandidateSnapshot({
  env = process.env,
  fetchImpl = fetch,
  now = new Date().toISOString(),
  timeZone = 'UTC',
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
  const config = resolvePayPalConfig(env);
  if (!config.configured) return { ok: false, gap: config.gap, diagnostics: { configured: false } };
  const window = resolveAnalyticsWindow({ window: '30d', now, timeZone });
  const start = localMidnightToUtc(window.startLocalDate, window.timeZone);
  const endExclusive = localMidnightToUtc(shiftLocalDate(window.endLocalDate, 1), window.timeZone);
  const end = new Date(endExclusive.getTime() - 1000);

  const token = await requestPayPalAccessToken(config, fetchImpl, timeoutMs);
  if (!token.ok) return token;

  const requestReferences = [];
  const details = [];
  let expectedTotalPages = 1;
  let lastRefreshedAt = null;
  for (let page = 1; page <= expectedTotalPages; page += 1) {
    const url = new URL('/v1/reporting/transactions', config.apiBaseUrl);
    url.searchParams.set('start_date', start.toISOString());
    url.searchParams.set('end_date', end.toISOString());
    url.searchParams.set('fields', 'all');
    url.searchParams.set('balance_affecting_records_only', 'Y');
    url.searchParams.set('page_size', String(PAYPAL_PAGE_SIZE));
    url.searchParams.set('page', String(page));
    let response;
    try {
      response = await fetchWithTimeout(fetchImpl, url, {
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'PayPal-Enforce-ISO8601-Format': 'true',
        },
      }, timeoutMs);
    } catch {
      return { ok: false, gap: 'PayPal Transaction Search network request failed or timed out.', diagnostics: { configured: true, page } };
    }
    const payload = await responseJson(response);
    const debugId = safeHeader(response, 'paypal-debug-id');
    if (debugId) requestReferences.push(debugId);
    if (!response.ok || !payload || !Array.isArray(payload.transaction_details)) {
      return {
        ok: false,
        gap: `PayPal Transaction Search failed with HTTP ${response.status} or malformed JSON on page ${page}.`,
        diagnostics: { configured: true, page, paypalDebugId: debugId },
      };
    }
    const totalPages = Number(payload.total_pages ?? 1);
    const totalItems = Number(payload.total_items ?? payload.transaction_details.length);
    if (!Number.isSafeInteger(totalPages) || totalPages < 1 || totalPages > PAYPAL_MAX_PAGES ||
        !Number.isSafeInteger(totalItems) || totalItems < 0 || totalItems > PAYPAL_PAGE_SIZE * PAYPAL_MAX_PAGES) {
      return { ok: false, gap: 'PayPal result set is too large or has invalid pagination; shorten the query range.', diagnostics: { configured: true, page } };
    }
    if (page === 1) expectedTotalPages = totalPages;
    if (totalPages !== expectedTotalPages) {
      return { ok: false, gap: 'PayPal pagination changed during collection.', diagnostics: { configured: true, page } };
    }
    details.push(...payload.transaction_details);
    lastRefreshedAt = payload.last_refreshed_datetime || lastRefreshedAt;
  }

  const parsed = parsePayPalTransactions(details, config);
  if (!parsed.ok) return { ok: false, gap: parsed.gap, diagnostics: { configured: true, ...parsed.diagnostics } };
  const sourceReference = requestReferences.length > 0
    ? `paypal-debug-ids:${requestReferences.join(',')}`
    : `transaction-search:${window.startLocalDate}:${window.endLocalDate}`;
  return {
    ok: true,
    snapshot: {
      schemaVersion: 1,
      provider: 'paypal',
      generatedAt: new Date(now).toISOString(),
      source: {
        kind: 'provider_api_live',
        reference: sourceReference,
      },
      currency: 'usd',
      scope: {
        completeness: 'provider_reporting_lagged',
        timeZone: window.timeZone,
        startLocalDate: window.startLocalDate,
        endLocalDate: window.endLocalDate,
        maximumReportingLagMinutes: PAYPAL_REPORTING_MAX_LAG_MINUTES,
      },
      transactions: parsed.transactions,
      subscriptions: [],
    },
    diagnostics: {
      configured: true,
      collected: true,
      pageCount: expectedTotalPages,
      rawRowCount: details.length,
      candidateTransactionCount: parsed.transactions.length,
      ownerRowsExcluded: parsed.diagnostics.ownerRowsExcluded,
      unrelatedRowsExcluded: parsed.diagnostics.unrelatedRowsExcluded,
      lastRefreshedAt,
      maximumReportingLagMinutes: PAYPAL_REPORTING_MAX_LAG_MINUTES,
      financialTransactionsComplete: false,
    },
  };
}

function loadPayPalWebhookLedgerCandidate(ledgerPath, expectedWebhookId) {
  if (!ledgerPath) return { ok: false, gap: 'PayPal webhook ledger path is not configured.' };
  let raw;
  try {
    raw = fs.readFileSync(ledgerPath, 'utf8');
  } catch (error) {
    return { ok: false, gap: `PayPal webhook ledger could not be read: ${error.message}` };
  }
  const events = new Map();
  const transmissions = new Set();
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  for (const [index, line] of lines.entries()) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      return { ok: false, gap: `PayPal webhook ledger row ${index} is not valid JSON.` };
    }
    const body = decodeCanonicalBase64(row.rawBodyBase64);
    const eventId = String(row.eventId || '').trim();
    const transmissionId = String(row.transmissionId || '').trim();
    if (row.schemaVersion !== 1 || row.provider !== 'paypal' || !eventId || !transmissionId ||
        events.has(eventId) || transmissions.has(transmissionId) || !body ||
        row.webhookId !== expectedWebhookId || row.verificationStatus !== 'SUCCESS' ||
        row.verificationSource !== 'paypal_verify_webhook_signature_api') {
      return { ok: false, gap: `PayPal webhook ledger row ${index} is malformed, duplicated, or belongs to another webhook.` };
    }
    const digest = `sha256:${crypto.createHash('sha256').update(body).digest('hex')}`;
    if (row.payloadSha256 !== digest) {
      return { ok: false, gap: `PayPal webhook ledger row ${index} failed its raw-payload digest check.` };
    }
    let event;
    try {
      event = JSON.parse(body.toString('utf8'));
    } catch {
      return { ok: false, gap: `PayPal webhook ledger row ${index} contains invalid payload JSON.` };
    }
    if (event.id !== eventId || event.event_type !== row.eventType ||
        event.create_time !== row.eventCreatedAt || !PAYPAL_REVENUE_WEBHOOK_EVENTS.has(event.event_type) ||
        !event.resource || typeof event.resource !== 'object' || Array.isArray(event.resource)) {
      return { ok: false, gap: `PayPal webhook ledger row ${index} disagrees with its verified raw event.` };
    }
    transmissions.add(transmissionId);
    events.set(eventId, event);
  }
  return {
    ok: true,
    events,
    reference: `sha256:${crypto.createHash('sha256').update(raw).digest('hex')}`,
  };
}

function paypalResourceIdFromLink(resource, resourceName) {
  for (const link of Array.isArray(resource?.links) ? resource.links : []) {
    try {
      const match = new RegExp(`/v2/${resourceName}/([A-Za-z0-9_-]{1,128})/?$`).exec(new URL(link.href).pathname);
      if (match) return match[1];
    } catch { /* ignore malformed provider link */ }
  }
  return null;
}

function paypalCaptureIdFromEvent(event) {
  const resource = event?.resource || {};
  const direct = event?.event_type === 'PAYMENT.CAPTURE.COMPLETED' || event?.event_type === 'PAYMENT.CAPTURE.REVERSED'
    ? resource.id
    : resource?.supplementary_data?.related_ids?.capture_id;
  const captureId = String(direct || paypalResourceIdFromLink(resource, 'payments/captures') || '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(captureId) ? captureId : null;
}

function paypalOrderId(resource) {
  const orderId = String(resource?.supplementary_data?.related_ids?.order_id ||
    paypalResourceIdFromLink(resource, 'checkout/orders') || '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(orderId) ? orderId : null;
}

function samePayPalEvent(left, right) {
  const fingerprint = (event) => JSON.stringify({
    id: event?.id,
    eventType: event?.event_type,
    createdAt: event?.create_time,
    resourceId: event?.resource?.id,
    resourceStatus: event?.resource?.status,
    currency: event?.resource?.amount?.currency_code,
    value: event?.resource?.amount?.value,
    customId: event?.resource?.custom_id,
    invoiceId: event?.resource?.invoice_id,
    captureId: paypalCaptureIdFromEvent(event),
    orderId: paypalOrderId(event?.resource),
  });
  return fingerprint(left) === fingerprint(right);
}

function safePayPalNextUrl(href, config, expectedQuery) {
  let url;
  try {
    url = new URL(href, config.apiBaseUrl);
    const base = new URL(config.apiBaseUrl);
    if (url.origin !== base.origin || !/^\/v1\/notifications\/webhooks-events\/?$/.test(url.pathname) ||
        ['start_time', 'end_time', 'page_size'].some((key) => url.searchParams.get(key) !== expectedQuery[key])) return null;
  } catch {
    return null;
  }
  return url;
}

async function paypalGetJson(config, accessToken, fetchImpl, url, timeoutMs, label) {
  let response;
  try {
    response = await fetchWithTimeout(fetchImpl, url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    }, timeoutMs);
  } catch {
    return { ok: false, gap: `${label} network request failed or timed out.` };
  }
  const payload = await responseJson(response);
  const paypalDebugId = safeHeader(response, 'paypal-debug-id');
  if (!response.ok || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, gap: `${label} failed with HTTP ${response.status} or malformed JSON.`, paypalDebugId };
  }
  return { ok: true, payload, paypalDebugId };
}

function buildPayPalRecentTransaction(events, capture, order, config) {
  const captureId = String(capture?.id || '').trim();
  const orderId = paypalOrderId(capture);
  const status = String(capture?.status || '').trim().toUpperCase();
  const currency = String(capture?.amount?.currency_code || '').trim().toUpperCase();
  const grossCents = exactMoneyToCents(capture?.amount?.value);
  const createdAt = new Date(String(capture?.create_time || ''));
  if (!captureId || !orderId || order?.id !== orderId || order?.status !== 'COMPLETED' ||
      !['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(status) || currency !== 'USD' ||
      !Number.isSafeInteger(grossCents) || grossCents <= 0 || Number.isNaN(createdAt.getTime())) {
    return { ok: false, gap: `PayPal capture ${captureId || '(missing)'} has incomplete or unsupported current financial state.` };
  }
  const matches = [];
  for (const unit of Array.isArray(order.purchase_units) ? order.purchase_units : []) {
    for (const orderCapture of Array.isArray(unit?.payments?.captures) ? unit.payments.captures : []) {
      if (orderCapture?.id === captureId) matches.push({ unit, orderCapture });
    }
  }
  if (matches.length !== 1) return { ok: false, gap: `PayPal order ${orderId} does not contain exactly one matching capture ${captureId}.` };
  const { unit, orderCapture } = matches[0];
  if (String(orderCapture.status || '').toUpperCase() !== status ||
      String(orderCapture.amount?.currency_code || '').toUpperCase() !== currency ||
      exactMoneyToCents(orderCapture.amount?.value) !== grossCents) {
    return { ok: false, gap: `PayPal capture ${captureId} disagrees with order ${orderId}.` };
  }
  const captureCustomId = String(capture.custom_id || '').trim();
  const unitCustomId = String(unit.custom_id || '').trim();
  const captureInvoiceId = String(capture.invoice_id || '').trim();
  const unitInvoiceId = String(unit.invoice_id || '').trim();
  if ((captureCustomId && unitCustomId && captureCustomId !== unitCustomId) ||
      (captureInvoiceId && unitInvoiceId && captureInvoiceId !== unitInvoiceId)) {
    return { ok: false, gap: `PayPal capture ${captureId} attribution disagrees with order ${orderId}.` };
  }
  const attributionInfo = {
    custom_id: captureCustomId || unitCustomId,
    invoice_id: captureInvoiceId || unitInvoiceId,
    transaction_subject: unit.description,
  };
  if (!paypalAttributionMatches(attributionInfo, config.attribution)) {
    return { ok: true, transaction: null, excluded: 'unrelated' };
  }
  const payer = order?.payment_source?.paypal || order?.payer || {};
  const accountId = String(payer.account_id || payer.payer_id || '').trim();
  const email = String(payer.email_address || '').trim().toLowerCase();
  if (config.ownerAccountIds.has(accountId.toLowerCase()) || config.ownerEmails.has(email)) {
    return { ok: true, transaction: null, excluded: 'owner' };
  }
  if (events.some((event) => event.event_type === 'PAYMENT.CAPTURE.REVERSED')) {
    return { ok: true, transaction: null, excluded: 'reversed' };
  }
  const customerId = hashedCustomerId(accountId, email);
  if (!customerId) return { ok: false, gap: `PayPal order ${orderId} has no stable payer identity.` };
  const buyerEmailDigest = digestBuyerEmail(email);
  let refundedCents = exactMoneyToCents(capture?.seller_receivable_breakdown?.total_refunded_amount?.value);
  const refundCurrency = String(capture?.seller_receivable_breakdown?.total_refunded_amount?.currency_code || '').toUpperCase();
  if (refundedCents === null) refundedCents = 0;
  if ((refundedCents > 0 && refundCurrency !== 'USD') || refundedCents < 0 || refundedCents > grossCents ||
      (status === 'COMPLETED' && refundedCents !== 0) ||
      (status === 'PARTIALLY_REFUNDED' && (refundedCents <= 0 || refundedCents >= grossCents)) ||
      (status === 'REFUNDED' && refundedCents !== grossCents)) {
    return { ok: false, gap: `PayPal capture ${captureId} has an inconsistent refund state.` };
  }
  if (!events.some((event) => paypalCaptureIdFromEvent(event) === captureId)) {
    return { ok: false, gap: `PayPal capture ${captureId} has no matching recent provider event.` };
  }
  for (const event of events.filter((entry) => paypalCaptureIdFromEvent(entry) === captureId)) {
    const eventCustomId = String(event?.resource?.custom_id || '').trim();
    const eventInvoiceId = String(event?.resource?.invoice_id || '').trim();
    if ((eventCustomId && attributionInfo.custom_id && eventCustomId !== attributionInfo.custom_id) ||
        (eventInvoiceId && attributionInfo.invoice_id && eventInvoiceId !== attributionInfo.invoice_id)) {
      return { ok: false, gap: `PayPal event attribution disagrees with current capture ${captureId}.` };
    }
  }
  return {
    ok: true,
    transaction: {
      id: `paypal-recent:${captureId}`,
      providerTransactionId: captureId,
      status: status.toLowerCase(),
      createdAt: createdAt.toISOString(),
      grossCents,
      refundedCents,
      customerId,
      ...(buyerEmailDigest ? { buyerEmailDigest } : {}),
      customerClassification: 'external',
      ownerTest: false,
      productAttribution: { verified: true, product: 'thumbgate' },
      ...(String(attributionInfo.invoice_id || '').trim()
        ? { invoiceId: String(attributionInfo.invoice_id).trim().slice(0, 127) }
        : {}),
    },
  };
}

async function collectPayPalRecentPaymentSnapshot({
  env = process.env,
  fetchImpl = fetch,
  now = new Date().toISOString(),
  timeZone = 'UTC',
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
  const config = resolvePayPalConfig(env);
  if (!config.configured) return { ok: false, gap: config.gap, diagnostics: { configured: false } };
  if (!config.webhookId || !config.webhookUrl || !config.webhookLedgerPath) {
    return { ok: false, gap: 'PayPal recent-payment reconciliation requires webhook ID, URL, and ledger path.', diagnostics: { configured: true } };
  }
  let configuredWebhookUrl;
  try {
    configuredWebhookUrl = new URL(config.webhookUrl);
  } catch {
    return { ok: false, gap: 'PayPal recent-payment reconciliation requires a valid webhook URL.' };
  }
  if (!/^[A-Za-z0-9]{1,50}$/.test(config.webhookId) || configuredWebhookUrl.protocol !== 'https:' ||
      configuredWebhookUrl.username || configuredWebhookUrl.password || configuredWebhookUrl.hash) {
    return { ok: false, gap: 'PayPal recent-payment reconciliation requires a valid webhook ID and HTTPS callback URL.' };
  }
  const ledger = loadPayPalWebhookLedgerCandidate(config.webhookLedgerPath, config.webhookId);
  if (!ledger.ok) return { ok: false, gap: ledger.gap, diagnostics: { configured: true } };
  const token = await requestPayPalAccessToken(config, fetchImpl, timeoutMs);
  if (!token.ok) return token;
  const registration = await paypalGetJson(
    config, token.accessToken, fetchImpl,
    new URL(`/v1/notifications/webhooks/${encodeURIComponent(config.webhookId)}`, config.apiBaseUrl),
    timeoutMs, 'PayPal webhook registration lookup'
  );
  if (!registration.ok) return { ok: false, gap: registration.gap, diagnostics: { configured: true, paypalDebugId: registration.paypalDebugId } };
  const registeredEvents = new Set((Array.isArray(registration.payload.event_types) ? registration.payload.event_types : [])
    .map((event) => String(event?.name || '').trim()));
  if (registration.payload.id !== config.webhookId || registration.payload.url !== config.webhookUrl ||
      [...PAYPAL_REVENUE_WEBHOOK_EVENTS].some((event) => !registeredEvents.has(event))) {
    return { ok: false, gap: 'PayPal webhook registration does not match the configured ID, URL, and required revenue event set.' };
  }
  const nowDate = new Date(now);
  if (Number.isNaN(nowDate.getTime())) return { ok: false, gap: 'PayPal recent-payment reconciliation requires a valid current timestamp.' };
  const eventStart = new Date(nowDate.getTime() - (PAYPAL_REPORTING_MAX_LAG_MINUTES + 10) * 60000);
  let nextUrl = new URL('/v1/notifications/webhooks-events', config.apiBaseUrl);
  nextUrl.searchParams.set('start_time', eventStart.toISOString());
  nextUrl.searchParams.set('end_time', nowDate.toISOString());
  nextUrl.searchParams.set('page_size', String(PAYPAL_EVENT_PAGE_SIZE));
  const expectedQuery = Object.fromEntries(['start_time', 'end_time', 'page_size'].map((key) => [key, nextUrl.searchParams.get(key)]));
  const providerEvents = new Map();
  const requestReferences = [token.paypalDebugId, registration.paypalDebugId].filter(Boolean);
  const visited = new Set();
  let pageCount = 0;
  while (nextUrl) {
    if (pageCount >= PAYPAL_MAX_EVENT_PAGES || visited.has(nextUrl.toString())) {
      return { ok: false, gap: 'PayPal webhook event history pagination exceeded its safe bound or repeated a page.' };
    }
    visited.add(nextUrl.toString());
    pageCount += 1;
    const result = await paypalGetJson(config, token.accessToken, fetchImpl, nextUrl, timeoutMs, 'PayPal webhook event history');
    if (!result.ok) return { ok: false, gap: result.gap, diagnostics: { configured: true, page: pageCount, paypalDebugId: result.paypalDebugId } };
    if (!Array.isArray(result.payload.events) || result.payload.events.length > PAYPAL_EVENT_PAGE_SIZE) {
      return { ok: false, gap: `PayPal webhook event history page ${pageCount} is malformed or exceeds its requested page size.` };
    }
    if (result.paypalDebugId) requestReferences.push(result.paypalDebugId);
    for (const event of result.payload.events) {
      const eventId = String(event?.id || '').trim();
      const createdAt = new Date(String(event?.create_time || ''));
      if (!eventId || providerEvents.has(eventId) || Number.isNaN(createdAt.getTime()) ||
          createdAt < eventStart || createdAt > nowDate ||
          !event.resource || typeof event.resource !== 'object' || Array.isArray(event.resource)) {
        return { ok: false, gap: `PayPal webhook event history page ${pageCount} contains a malformed or duplicate event.` };
      }
      providerEvents.set(eventId, event);
    }
    const next = (Array.isArray(result.payload.links) ? result.payload.links : []).filter((link) => link?.rel === 'next');
    if (next.length > 1) return { ok: false, gap: 'PayPal webhook event history contains ambiguous next-page links.' };
    if (next.length === 0) nextUrl = null;
    else {
      nextUrl = safePayPalNextUrl(next[0].href, config, expectedQuery);
      if (!nextUrl) return { ok: false, gap: 'PayPal webhook event history returned an unsafe next-page URL.' };
    }
  }
  const revenueEvents = [...providerEvents.values()].filter((event) => PAYPAL_REVENUE_WEBHOOK_EVENTS.has(event.event_type));
  const byCapture = new Map();
  for (const event of revenueEvents) {
    const captureId = paypalCaptureIdFromEvent(event);
    if (!captureId) return { ok: false, gap: `PayPal revenue event ${event.id} has no valid capture reference.` };
    const entries = byCapture.get(captureId) || [];
    entries.push(event);
    byCapture.set(captureId, entries);
  }
  const transactions = [];
  let ownerRowsExcluded = 0;
  let unrelatedRowsExcluded = 0;
  let reversalRowsExcluded = 0;
  for (const [captureId, events] of byCapture) {
    const captureResult = await paypalGetJson(config, token.accessToken, fetchImpl,
      new URL(`/v2/payments/captures/${encodeURIComponent(captureId)}`, config.apiBaseUrl), timeoutMs, 'PayPal capture lookup');
    if (!captureResult.ok) return { ok: false, gap: captureResult.gap, diagnostics: { configured: true, paypalDebugId: captureResult.paypalDebugId } };
    if (captureResult.paypalDebugId) requestReferences.push(captureResult.paypalDebugId);
    const orderId = paypalOrderId(captureResult.payload);
    if (!orderId) return { ok: false, gap: `PayPal capture ${captureId} has no valid related order.` };
    const orderUrl = new URL(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, config.apiBaseUrl);
    orderUrl.searchParams.set('fields', 'payment_source');
    const orderResult = await paypalGetJson(config, token.accessToken, fetchImpl,
      orderUrl, timeoutMs, 'PayPal order lookup');
    if (!orderResult.ok) return { ok: false, gap: orderResult.gap, diagnostics: { configured: true, paypalDebugId: orderResult.paypalDebugId } };
    if (orderResult.paypalDebugId) requestReferences.push(orderResult.paypalDebugId);
    const built = buildPayPalRecentTransaction(events, captureResult.payload, orderResult.payload, config);
    if (!built.ok) return { ok: false, gap: built.gap, diagnostics: { configured: true } };
    if (built.excluded === 'owner') ownerRowsExcluded += 1;
    else if (built.excluded === 'unrelated') unrelatedRowsExcluded += 1;
    else if (built.excluded === 'reversed') reversalRowsExcluded += 1;
    else transactions.push(built.transaction);
  }
  let locallyMatchedEventCount = 0;
  for (const event of revenueEvents) {
    const eventId = event.id;
    if (ledger.events.has(eventId) && samePayPalEvent(event, ledger.events.get(eventId))) locallyMatchedEventCount += 1;
    else if (ledger.events.has(eventId)) return { ok: false, gap: `PayPal provider event ${eventId} disagrees with the locally verified delivery.` };
  }
  const window = resolveAnalyticsWindow({ window: '30d', now, timeZone });
  const localOnlyEventCount = [...ledger.events.entries()].filter(([eventId, event]) => {
    const createdAt = new Date(event.create_time);
    return createdAt >= eventStart && createdAt <= nowDate && !providerEvents.has(eventId);
  }).length;
  const referenceMaterial = JSON.stringify({
    eventIds: revenueEvents.map((event) => event.id).sort((a, b) => a.localeCompare(b)),
    requestReferences: [...new Set(requestReferences)].sort((a, b) => a.localeCompare(b)),
    ledgerReference: ledger.reference,
  });
  return {
    ok: true,
    snapshot: {
      schemaVersion: 1,
      provider: 'paypal',
      generatedAt: nowDate.toISOString(),
      source: { kind: 'provider_api_live', reference: `paypal-recent-reconciliation:sha256:${crypto.createHash('sha256').update(referenceMaterial).digest('hex')}` },
      currency: 'usd',
      scope: {
        completeness: 'provider_reporting_lagged',
        timeZone: window.timeZone,
        startLocalDate: window.startLocalDate,
        endLocalDate: window.endLocalDate,
        maximumReportingLagMinutes: PAYPAL_REPORTING_MAX_LAG_MINUTES,
      },
      transactions,
      subscriptions: [],
    },
    diagnostics: {
      configured: true,
      registeredWebhookVerified: true,
      eventPageCount: pageCount,
      providerEventCount: providerEvents.size,
      revenueEventCount: revenueEvents.length,
      candidateTransactionCount: transactions.length,
      ownerRowsExcluded,
      unrelatedRowsExcluded,
      reversalRowsExcluded,
      locallyMatchedEventCount,
      missedLocalWebhookCount: revenueEvents.length - locallyMatchedEventCount,
      localOnlyEventCount,
      financialTransactionsComplete: false,
    },
  };
}

function mergePayPalIndividualSnapshots(reporting, recent) {
  const transactions = [...reporting.transactions];
  const byProviderId = new Map(transactions.map((transaction, index) => [transaction.providerTransactionId, { transaction, index }]));
  for (const transaction of recent.transactions) {
    const prior = byProviderId.get(transaction.providerTransactionId);
    if (!prior) {
      transactions.push(transaction);
      continue;
    }
    if (prior.transaction.grossCents !== transaction.grossCents || prior.transaction.customerId !== transaction.customerId ||
        prior.transaction.buyerEmailDigest !== transaction.buyerEmailDigest ||
        String(prior.transaction.invoiceId || '') !== String(transaction.invoiceId || '') ||
        Math.abs(new Date(prior.transaction.createdAt).getTime() - new Date(transaction.createdAt).getTime()) > 15 * 60 * 1000) {
      return { ok: false, gap: `PayPal reporting and recent detail disagree for capture ${transaction.providerTransactionId}.` };
    }
    transactions[prior.index] = { ...transaction, id: prior.transaction.id };
  }
  const reference = `paypal-merged:sha256:${crypto.createHash('sha256').update(JSON.stringify([
    reporting.source.reference, recent.source.reference,
  ])).digest('hex')}`;
  return { ok: true, snapshot: { ...reporting, source: { kind: 'provider_api_live', reference }, transactions } };
}

async function auditPayPalLiveEvidence(options = {}) {
  const config = resolvePayPalConfig(options.env || process.env);
  const recentSettings = config.configured ? [config.webhookId, config.webhookUrl, config.webhookLedgerPath] : [];
  if (recentSettings.some(Boolean) && !recentSettings.every(Boolean)) {
    return providerGap('paypal', 'PayPal recent-payment reconciliation is partially configured; webhook ID, URL, and ledger path are all required.', { configured: true });
  }
  const candidate = await collectPayPalCandidateSnapshot(options);
  if (!candidate.ok) return providerGap('paypal', candidate.gap, candidate.diagnostics);
  const recentConfigured = Boolean(config.configured && config.webhookId && config.webhookUrl && config.webhookLedgerPath);
  let evidenceSnapshot = candidate.snapshot;
  let recent = null;
  if (recentConfigured) {
    recent = await collectPayPalRecentPaymentSnapshot(options);
    if (!recent.ok) return providerGap('paypal', recent.gap, { ...candidate.diagnostics, recentPaymentReconciliation: recent.diagnostics || null });
    const merged = mergePayPalIndividualSnapshots(candidate.snapshot, recent.snapshot);
    if (!merged.ok) return providerGap('paypal', merged.gap, { ...candidate.diagnostics, recentPaymentReconciliation: recent.diagnostics });
    evidenceSnapshot = merged.snapshot;
  }
  const individual = collectVerifiedIndividualPayments(evidenceSnapshot, options);
  if (!individual.ok) return providerGap('paypal', individual.gap, candidate.diagnostics);
  const result = auditProviderSnapshot(candidate.snapshot, {
    expectedProvider: 'paypal',
    now: options.now,
    timeZone: options.timeZone,
  });
  return {
    ...result,
    status: recent ? 'provider_api_and_recent_events_collected_but_incomplete' : 'provider_api_collected_but_incomplete',
    evidenceSource: `provider_api_live:${evidenceSnapshot.source.reference}`,
    gap: recent
      ? 'Authenticated recent PayPal events and current capture/order details can prove individual payments, but they do not enumerate every balance-affecting movement; global revenue remains incomplete.'
      : 'PayPal Transaction Search can lag by up to three hours; current-day all-transaction completeness requires authenticated recent event reconciliation before this slice can enter global revenue arithmetic.',
    individualPayments: individual.payments,
    individualPaymentStates: individual.states,
    diagnostics: {
      ...candidate.diagnostics,
      recentPaymentReconciliation: recent?.diagnostics || null,
      recentPaymentReconciliationConfigured: recentConfigured,
      verifiedIndividualPaymentCount: individual.payments.length,
      verifiedIndividualPaymentStateCount: individual.states.length,
      individualPaymentEvidenceDigest: individual.evidenceDigest,
    },
  };
}

function decodeCanonicalBase64(value) {
  const text = String(value || '').trim();
  if (!text || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
  const buffer = Buffer.from(text, 'base64');
  return buffer.toString('base64') === text ? buffer : null;
}

function collectGithubMarketplaceLedgerCandidate({
  ledgerPath,
  secret,
  now = new Date().toISOString(),
  timeZone = 'UTC',
} = {}) {
  if (!ledgerPath) return { ok: false, gap: 'GitHub Marketplace signed webhook ledger path is not configured.' };
  if (!secret) return { ok: false, gap: 'GitHub Marketplace webhook secret is not configured; stored deliveries cannot be re-verified.' };
  let raw;
  try {
    raw = fs.readFileSync(ledgerPath, 'utf8');
  } catch (error) {
    return { ok: false, gap: `GitHub Marketplace webhook ledger could not be read: ${error.message}` };
  }
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  const deliveries = [];
  const deliveryIds = new Set();
  for (const [index, line] of lines.entries()) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      return { ok: false, gap: `GitHub Marketplace webhook ledger row ${index} is not valid JSON.` };
    }
    const body = decodeCanonicalBase64(row.rawBodyBase64);
    const deliveryId = String(row.deliveryId || '').trim();
    const signature = String(row.signature || '').trim();
    if (row.schemaVersion !== 1 || row.eventName !== 'marketplace_purchase' || !deliveryId || deliveryIds.has(deliveryId) || !body) {
      return { ok: false, gap: `GitHub Marketplace webhook ledger row ${index} is malformed or duplicated.` };
    }
    deliveryIds.add(deliveryId);
    const expectedDigest = `sha256:${crypto.createHash('sha256').update(body).digest('hex')}`;
    const expectedSignature = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
    const signatureBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expectedSignature);
    if (row.payloadSha256 !== expectedDigest || signatureBytes.length !== expectedBytes.length ||
        !crypto.timingSafeEqual(signatureBytes, expectedBytes)) {
      return { ok: false, gap: `GitHub Marketplace webhook ledger row ${index} failed digest or HMAC verification.` };
    }
    let event;
    try {
      event = JSON.parse(body.toString('utf8'));
    } catch {
      return { ok: false, gap: `GitHub Marketplace webhook ledger row ${index} contains invalid payload JSON.` };
    }
    if (!['purchased', 'changed', 'cancelled'].includes(event.action) || !event.marketplace_purchase?.account?.id) {
      return { ok: false, gap: `GitHub Marketplace webhook ledger row ${index} contains an unsupported Marketplace event.` };
    }
    deliveries.push({ row, event });
  }
  const window = resolveAnalyticsWindow({ window: '30d', now, timeZone });
  return {
    ok: true,
    snapshot: {
      schemaVersion: 1,
      provider: 'githubMarketplace',
      generatedAt: new Date(now).toISOString(),
      source: {
        kind: 'signed_webhook_ledger',
        reference: `sha256:${crypto.createHash('sha256').update(raw).digest('hex')}`,
      },
      currency: 'usd',
      scope: {
        completeness: 'subscription_events_only',
        timeZone: window.timeZone,
        startLocalDate: window.startLocalDate,
        endLocalDate: window.endLocalDate,
      },
      transactions: [],
      subscriptions: [],
    },
    diagnostics: {
      deliveryCount: deliveries.length,
      signaturesVerified: true,
      subscriptionEventsVerified: true,
      financialTransactionsComplete: false,
      officialFinancialSourceRequired: 'GitHub Marketplace Transactions CSV export',
    },
  };
}

function auditGithubMarketplaceLedgerEvidence(options = {}) {
  const candidate = collectGithubMarketplaceLedgerCandidate(options);
  if (!candidate.ok) return providerGap('githubMarketplace', candidate.gap, candidate.diagnostics || null);
  return providerGap(
    'githubMarketplace',
    'Signed GitHub Marketplace webhooks verify subscription-event integrity, not charged transaction amounts, proration, refunds, or complete financial history. The official Transactions CSV export is still required for global revenue arithmetic.',
    candidate.diagnostics
  );
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.endsWith('\r') ? field.slice(0, -1) : field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  if (field.length > 0 || row.length > 0) {
    row.push(field.endsWith('\r') ? field.slice(0, -1) : field);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((cell) => cell !== ''));
}

function collectGithubMarketplaceCsvSnapshot({
  csvPath,
  expectedAppName,
  ownerAccountIds = [],
  ownerIdentifiersReviewed = false,
  exportScope = null,
  now = new Date().toISOString(),
  timeZone = 'UTC',
} = {}) {
  if (!csvPath) return { ok: false, gap: 'GitHub Marketplace Transactions CSV path is not configured.' };
  if (!expectedAppName) return { ok: false, gap: 'GitHub Marketplace expected app name is required for product attribution.' };
  if (ownerIdentifiersReviewed !== true) return { ok: false, gap: 'GitHub Marketplace owner identifiers must be explicitly reviewed.' };
  if (String(exportScope || '').trim().toLowerCase() !== 'all') return { ok: false, gap: 'GitHub Marketplace CSV must be exported with the entire-duration scope.' };
  let raw;
  let stat;
  try {
    raw = fs.readFileSync(csvPath);
    stat = fs.statSync(csvPath);
  } catch (error) {
    return { ok: false, gap: `GitHub Marketplace Transactions CSV could not be read: ${error.message}` };
  }
  let rows;
  try {
    rows = parseCsvRows(raw.toString('utf8'));
  } catch (error) {
    return { ok: false, gap: `GitHub Marketplace Transactions CSV is malformed: ${error.message}` };
  }
  if (rows.length < 1) return { ok: false, gap: 'GitHub Marketplace Transactions CSV has no header row.' };
  const headers = rows[0].map((header) => header.trim());
  const requiredHeaders = [
    'date',
    'app_name',
    'user_login',
    'user_id',
    'user_type',
    'country',
    'amount_in_cents',
    'renewal_frequency',
    'marketplace_listing_plan_id',
    'region',
    'postal_code',
  ];
  if (new Set(headers).size !== headers.length || requiredHeaders.some((header) => !headers.includes(header))) {
    return { ok: false, gap: 'GitHub Marketplace Transactions CSV headers are missing, duplicated, or incompatible.' };
  }
  const window = resolveAnalyticsWindow({ window: '30d', now, timeZone });
  const ownerIds = new Set(normalizeStrings(ownerAccountIds).map((entry) => entry.toLowerCase()));
  const seenRows = new Set();
  const transactions = [];
  let ownerRowsExcluded = 0;
  let zeroAmountRows = 0;
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index].length !== headers.length) {
      return { ok: false, gap: `GitHub Marketplace Transactions CSV row ${index + 1} has the wrong column count.` };
    }
    const entry = Object.fromEntries(headers.map((header, column) => [header, rows[index][column].trim()]));
    if (entry.app_name !== expectedAppName) {
      return { ok: false, gap: `GitHub Marketplace CSV row ${index + 1} does not match the expected app name.` };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || !entry.user_id || !entry.user_login ||
        !['User', 'Organization'].includes(entry.user_type) || !entry.marketplace_listing_plan_id ||
        !['Monthly', 'Yearly'].includes(entry.renewal_frequency)) {
      return { ok: false, gap: `GitHub Marketplace Transactions CSV row ${index + 1} has invalid identity, date, plan, or renewal fields.` };
    }
    const parsedDate = new Date(`${entry.date}T00:00:00.000Z`);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== entry.date) {
      return { ok: false, gap: `GitHub Marketplace Transactions CSV row ${index + 1} has an impossible calendar date.` };
    }
    if (!/^\d+$/.test(entry.amount_in_cents)) {
      return { ok: false, gap: `GitHub Marketplace Transactions CSV row ${index + 1} has a negative or non-integer amount.` };
    }
    const amountCents = Number(entry.amount_in_cents);
    if (!Number.isSafeInteger(amountCents)) {
      return { ok: false, gap: `GitHub Marketplace Transactions CSV row ${index + 1} has an unsafe amount.` };
    }
    const canonical = JSON.stringify(entry);
    const rowDigest = crypto.createHash('sha256').update(canonical).digest('hex');
    if (seenRows.has(rowDigest)) {
      return { ok: false, gap: `GitHub Marketplace Transactions CSV row ${index + 1} duplicates another row without a provider transaction ID.` };
    }
    seenRows.add(rowDigest);
    if (ownerIds.has(entry.user_id.toLowerCase())) {
      ownerRowsExcluded += 1;
      continue;
    }
    if (amountCents === 0) {
      zeroAmountRows += 1;
      continue;
    }
    if (entry.date < window.startLocalDate || entry.date > window.endLocalDate) continue;
    const createdAt = new Date(localMidnightToUtc(entry.date, window.timeZone).getTime() + 12 * 60 * 60 * 1000);
    transactions.push({
      id: `github-csv-${rowDigest}`,
      status: 'completed',
      createdAt: createdAt.toISOString(),
      grossCents: amountCents,
      refundedCents: 0,
      customerId: `github_${entry.user_type.toLowerCase()}_${crypto.createHash('sha256').update(entry.user_id).digest('hex').slice(0, 24)}`,
      customerClassification: 'external',
      ownerTest: false,
      productAttribution: { verified: true, product: 'thumbgate' },
    });
  }
  const digest = `sha256:${crypto.createHash('sha256').update(raw).digest('hex')}`;
  return {
    ok: true,
    snapshot: {
      schemaVersion: 1,
      provider: 'githubMarketplace',
      generatedAt: stat.mtime.toISOString(),
      source: {
        kind: 'provider_api_export',
        reference: `github-marketplace-transactions-csv:${digest}`,
      },
      currency: 'usd',
      scope: {
        completeness: 'all_transactions',
        subscriptionsCompleteness: 'not_audited',
        timeZone: window.timeZone,
        startLocalDate: window.startLocalDate,
        endLocalDate: window.endLocalDate,
      },
      transactions,
      subscriptions: [],
    },
    diagnostics: {
      csvDigest: digest,
      sourceRowCount: rows.length - 1,
      candidateTransactionCount: transactions.length,
      ownerRowsExcluded,
      zeroAmountRows,
      subscriptionsComplete: false,
      mrrClaimed: false,
    },
  };
}

function auditGithubMarketplaceCsvEvidence(options = {}) {
  const candidate = collectGithubMarketplaceCsvSnapshot(options);
  if (!candidate.ok) return providerGap('githubMarketplace', candidate.gap, candidate.diagnostics || null);
  const result = auditProviderSnapshot(candidate.snapshot, {
    expectedProvider: 'githubMarketplace',
    now: options.now,
    timeZone: options.timeZone,
  });
  return { ...result, diagnostics: candidate.diagnostics };
}

module.exports = {
  PAYPAL_MAX_PAGES,
  PAYPAL_PAGE_SIZE,
  PAYPAL_REPORTING_MAX_LAG_MINUTES,
  auditGithubMarketplaceCsvEvidence,
  auditGithubMarketplaceLedgerEvidence,
  auditPayPalLiveEvidence,
  buildPayPalRecentTransaction,
  collectVerifiedIndividualPayments,
  collectGithubMarketplaceLedgerCandidate,
  collectGithubMarketplaceCsvSnapshot,
  collectPayPalCandidateSnapshot,
  collectPayPalRecentPaymentSnapshot,
  exactMoneyToCents,
  localMidnightToUtc,
  loadPayPalWebhookLedgerCandidate,
  mergePayPalIndividualSnapshots,
  parsePayPalTransactions,
  parseCsvRows,
  providerGap,
  resolvePayPalConfig,
};
