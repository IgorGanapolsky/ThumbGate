#!/usr/bin/env node
/**
 * billing.js — Stripe billing integration using official Stripe SDK.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Stripe = require('stripe');
const { createTraceId } = require('./hosted-config');
const { getFeedbackPaths } = require('./feedback-loop');
const { getTelemetryAnalytics } = require('./telemetry-analytics');
const { loadWorkflowSprintLeads } = require('./workflow-sprint-intake');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CONFIG = {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
  GITHUB_MARKETPLACE_WEBHOOK_SECRET: process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET || '',
  GITHUB_MARKETPLACE_PLAN_PRICES_JSON: process.env.RLHF_GITHUB_MARKETPLACE_PLAN_PRICES_JSON || '',
  STRIPE_PRICE_ID: process.env.STRIPE_PRICE_ID || 'price_1RNdUBGGBpd520QYG1A9SWF4',
  get API_KEYS_PATH() {
    return process.env._TEST_API_KEYS_PATH || path.resolve(__dirname, '../.claude/memory/feedback/api-keys.json');
  },
  get FUNNEL_LEDGER_PATH() {
    return process.env._TEST_FUNNEL_LEDGER_PATH || process.env.RLHF_FUNNEL_LEDGER_PATH || path.resolve(__dirname, '../.claude/memory/feedback/funnel-events.jsonl');
  },
  get REVENUE_LEDGER_PATH() {
    return process.env._TEST_REVENUE_LEDGER_PATH || process.env.RLHF_REVENUE_LEDGER_PATH || path.resolve(__dirname, '../.claude/memory/feedback/revenue-events.jsonl');
  },
  get LOCAL_CHECKOUT_SESSIONS_PATH() {
    return process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH || path.resolve(__dirname, '../.claude/memory/feedback/local-checkout-sessions.json');
  }
};

let _stripeClient = null;
function getStripeClient() {
  if (!_stripeClient) {
    if (!CONFIG.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is missing. Stripe client cannot be initialized.');
    }
    _stripeClient = new Stripe(CONFIG.STRIPE_SECRET_KEY);
  }
  return _stripeClient;
}

const LOCAL_MODE = () => !CONFIG.STRIPE_SECRET_KEY;

function safeCompareHex(expectedHex, actualHex) {
  try {
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = Buffer.from(actualHex, 'hex');
    if (expected.length === 0 || expected.length !== actual.length) {
      return false;
    }
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return {};
  try {
    return JSON.parse(JSON.stringify(metadata));
  } catch {
    return { ...metadata };
  }
}

function appendJsonlRecord(filePath, payload) {
  try {
    ensureParentDir(filePath);
    fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf-8');
    return { written: true, payload };
  } catch (err) {
    return { written: false, reason: 'write_failed', error: err.message };
  }
}

function loadJsonlRecords(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf-8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch { return []; }
}

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeCurrency(value) {
  const text = normalizeText(value);
  return text ? text.toUpperCase() : null;
}

function normalizeInteger(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : null;
}

function pickFirstText(...values) {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) return normalized;
  }
  return null;
}

function safeRate(num, den) {
  return den ? Number((num / den).toFixed(4)) : 0;
}

function incrementCounter(target, key, amount = 1) {
  const resolvedKey = normalizeText(key) || 'unknown';
  target[resolvedKey] = (target[resolvedKey] || 0) + amount;
}

function extractAttribution(metadata = {}) {
  const safe = sanitizeMetadata(metadata);
  return {
    source: normalizeText(safe.utmSource || safe.source),
    medium: normalizeText(safe.utmMedium || safe.medium),
    campaign: normalizeText(safe.utmCampaign || safe.campaign),
    content: normalizeText(safe.utmContent || safe.content),
    term: normalizeText(safe.utmTerm || safe.term),
    community: normalizeText(safe.community || safe.subreddit),
    postId: normalizeText(safe.postId || safe.post_id),
    commentId: normalizeText(safe.commentId || safe.comment_id),
    campaignVariant: normalizeText(safe.campaignVariant || safe.variant),
    offerCode: normalizeText(safe.offerCode || safe.offer || safe.coupon),
    referrer: normalizeText(safe.referrer),
    landingPath: normalizeText(safe.landingPath),
    ctaId: normalizeText(safe.ctaId),
  };
}

function extractJourneyFields(metadata = {}) {
  const safe = sanitizeMetadata(metadata);
  const attribution = extractAttribution(safe);
  return {
    acquisitionId: normalizeText(safe.acquisitionId),
    visitorId: normalizeText(safe.visitorId),
    sessionId: normalizeText(safe.sessionId),
    ctaId: attribution.ctaId,
    ctaPlacement: normalizeText(safe.ctaPlacement),
    planId: normalizeText(safe.planId),
    community: attribution.community,
    postId: attribution.postId,
    commentId: attribution.commentId,
    campaignVariant: attribution.campaignVariant,
    offerCode: attribution.offerCode,
    referrer: attribution.referrer,
    referrerHost: normalizeText(safe.referrerHost),
    landingPath: attribution.landingPath,
    utmSource: attribution.source,
    utmMedium: attribution.medium,
    utmCampaign: attribution.campaign,
    utmContent: attribution.content,
    utmTerm: attribution.term,
  };
}

function resolveAttributionSource(attribution, fallback = null) {
  return attribution.source || normalizeText(fallback) || 'unknown';
}

function resolveAttributionCampaign(attribution) {
  return attribution.campaign || 'unassigned';
}

function resolveAcquisitionLeadKey(entry = {}) {
  const metadata = sanitizeMetadata(entry.metadata);
  const attribution = sanitizeMetadata(entry.attribution);
  return pickFirstText(
    entry.acquisitionId,
    metadata.acquisitionId,
    attribution.acquisitionId,
    entry.traceId,
    metadata.traceId,
    attribution.traceId,
    entry.visitorId,
    metadata.visitorId,
    attribution.visitorId,
    entry.sessionId,
    metadata.sessionId,
    attribution.sessionId,
    entry.installId,
    metadata.installId,
    attribution.installId,
    entry.orderId,
    metadata.orderId,
    entry.evidence
  );
}

function resolvePaidProviderEventKey(entry = {}) {
  const metadata = sanitizeMetadata(entry.metadata);
  return pickFirstText(
    entry.orderId,
    metadata.orderId,
    metadata.sessionId,
    metadata.marketplaceOrderId,
    entry.evidence,
    resolveAcquisitionLeadKey(entry)
  );
}

function resolveRevenueEventKey(entry = {}) {
  const metadata = sanitizeMetadata(entry.metadata);
  const attribution = sanitizeMetadata(entry.attribution);
  return pickFirstText(
    entry.orderId,
    metadata.orderId,
    metadata.marketplaceOrderId,
    entry.evidence,
    entry.traceId,
    metadata.traceId,
    attribution.traceId,
    entry.installId,
    metadata.installId,
    attribution.installId,
    entry.customerId
  );
}

function isQualifiedWorkflowSprintLead(entry = {}) {
  return Boolean(
    normalizeText(entry.contact && entry.contact.email) &&
    normalizeText(entry.qualification && entry.qualification.workflow) &&
    normalizeText(entry.qualification && entry.qualification.owner) &&
    normalizeText(entry.qualification && entry.qualification.blocker) &&
    normalizeText(entry.qualification && entry.qualification.runtime)
  );
}

function isOperatorGeneratedAcquisitionEntry(entry = {}) {
  const metadata = sanitizeMetadata(entry.metadata);
  const attribution = extractAttribution({
    ...metadata,
    ...sanitizeMetadata(entry.attribution),
    ...sanitizeMetadata(entry),
  });
  const source = normalizeText(attribution.source || metadata.source || entry.source);
  const medium = normalizeText(attribution.medium || metadata.medium || entry.utmMedium);
  const eventName = normalizeText(entry.event);

  return source === 'cli' ||
    medium === 'operator_outreach' ||
    eventName === 'outreach_target_generated' ||
    eventName === 'outreach_sequence_started' ||
    eventName === 'lead_list_generated';
}

function hasRevenueEventMatch(entries, target) {
  const targetKey = resolveRevenueEventKey(target);
  if (!targetKey) return false;
  return entries.some((entry) => {
    return normalizeText(entry.status) === normalizeText(target.status) &&
      resolveRevenueEventKey(entry) === targetKey;
  });
}

function hasFunnelEventMatch(entries, target) {
  const targetKey = resolvePaidProviderEventKey(target);
  if (!targetKey) return false;
  return entries.some((entry) => {
    return normalizeText(entry.stage) === normalizeText(target.stage) &&
      normalizeText(entry.event) === normalizeText(target.event) &&
      resolvePaidProviderEventKey(entry) === targetKey;
  });
}

function appendFunnelEvent({ stage, event, installId = null, traceId = null, evidence, metadata = {} } = {}) {
  if (!stage || !event) return { written: false, reason: 'missing_stage_or_event' };
  const payload = {
    timestamp: new Date().toISOString(),
    stage,
    event,
    evidence: evidence || event,
    installId: installId || null,
    traceId: traceId || metadata.traceId || null,
    ...extractJourneyFields(metadata),
    metadata: sanitizeMetadata(metadata),
  };
  return appendJsonlRecord(CONFIG.FUNNEL_LEDGER_PATH, payload);
}

function loadFunnelLedger() {
  return loadJsonlRecords(CONFIG.FUNNEL_LEDGER_PATH);
}

function loadRevenueLedger() {
  return loadJsonlRecords(CONFIG.REVENUE_LEDGER_PATH);
}

function appendRevenueEvent({
  provider,
  event,
  status = 'paid',
  customerId,
  orderId = null,
  installId = null,
  traceId = null,
  evidence = null,
  amountCents = null,
  currency = null,
  amountKnown = false,
  recurringInterval = null,
  attribution = {},
  metadata = {},
} = {}) {
  if (!provider || !event || !customerId) {
    return { written: false, reason: 'missing_required_fields' };
  }

  const normalizedAmount = normalizeInteger(amountCents);
  const journeyFields = extractJourneyFields({
    ...sanitizeMetadata(metadata),
    ...sanitizeMetadata(attribution),
  });
  const payload = {
    timestamp: new Date().toISOString(),
    provider: normalizeText(provider),
    event,
    status: normalizeText(status) || 'paid',
    orderId: normalizeText(orderId) || normalizeText(evidence) || null,
    evidence: evidence || orderId || event,
    customerId,
    installId: installId || null,
    traceId: traceId || metadata.traceId || null,
    amountCents: normalizedAmount,
    currency: normalizeCurrency(currency),
    amountKnown: Boolean(amountKnown && normalizedAmount !== null),
    recurringInterval: normalizeText(recurringInterval),
    attribution: extractAttribution({ ...sanitizeMetadata(metadata), ...sanitizeMetadata(attribution) }),
    ...journeyFields,
    metadata: sanitizeMetadata(metadata),
  };

  return appendJsonlRecord(CONFIG.REVENUE_LEDGER_PATH, payload);
}

function loadLocalCheckoutSessions() {
  try {
    const target = CONFIG.LOCAL_CHECKOUT_SESSIONS_PATH;
    if (!fs.existsSync(target)) return { sessions: {} };
    const parsed = JSON.parse(fs.readFileSync(target, 'utf-8'));
    return (parsed && typeof parsed.sessions === 'object') ? parsed : { sessions: {} };
  } catch { return { sessions: {} }; }
}

function saveLocalCheckoutSessions(store) {
  const target = CONFIG.LOCAL_CHECKOUT_SESSIONS_PATH;
  ensureParentDir(target);
  fs.writeFileSync(target, JSON.stringify(store, null, 2), 'utf-8');
}

function serializeStripeMetadata(metadata) {
  const safe = sanitizeMetadata(metadata);
  const serialized = {};
  for (const [key, value] of Object.entries(safe)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'object') continue;
    serialized[key] = String(value);
  }
  return serialized;
}

function parseGithubPlanPricing() {
  if (!CONFIG.GITHUB_MARKETPLACE_PLAN_PRICES_JSON) return {};
  try {
    const parsed = JSON.parse(CONFIG.GITHUB_MARKETPLACE_PLAN_PRICES_JSON);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function resolveGithubPlanPricing(planId) {
  const pricing = parseGithubPlanPricing();
  const raw = pricing[String(planId)];
  if (raw === undefined) {
    return { amountKnown: false, amountCents: null, currency: null, recurringInterval: null };
  }

  if (typeof raw === 'number') {
    return {
      amountKnown: Number.isFinite(raw),
      amountCents: normalizeInteger(raw),
      currency: 'USD',
      recurringInterval: null,
    };
  }

  if (!raw || typeof raw !== 'object') {
    return { amountKnown: false, amountCents: null, currency: null, recurringInterval: null };
  }

  const amountCents = normalizeInteger(raw.amountCents ?? raw.amount ?? raw.priceCents);
  return {
    amountKnown: amountCents !== null,
    amountCents,
    currency: normalizeCurrency(raw.currency) || 'USD',
    recurringInterval: normalizeText(raw.recurringInterval || raw.interval),
  };
}

function getFunnelAnalytics() {
  const events = loadFunnelLedger();
  const paidOrders = loadRevenueLedger().filter((entry) => entry && entry.status === 'paid');
  const stageCounts = { acquisition: 0, activation: 0, paid: 0 };
  const eventCounts = {};
  for (const entry of events) {
    if (entry && stageCounts.hasOwnProperty(entry.stage)) {
      stageCounts[entry.stage]++;
      const key = `${entry.stage}:${entry.event || 'unknown'}`;
      eventCounts[key] = (eventCounts[key] || 0) + 1;
    }
  }
  return {
    totalEvents: events.length,
    stageCounts,
    eventCounts,
    conversionRates: {
      acquisitionToActivation: safeRate(stageCounts.activation, stageCounts.acquisition),
      activationToPaid: safeRate(paidOrders.length, stageCounts.activation),
      acquisitionToPaid: safeRate(paidOrders.length, stageCounts.acquisition),
    },
    paidProviderEvents: stageCounts.paid,
  };
}

function getBusinessAnalytics() {
  const { FEEDBACK_DIR } = getFeedbackPaths();
  const telemetry = getTelemetryAnalytics(FEEDBACK_DIR);
  const events = loadFunnelLedger();
  const revenueEvents = loadRevenueLedger();
  const workflowSprintLeads = loadWorkflowSprintLeads();
  const funnel = getFunnelAnalytics();
  const acquisitionEvents = events.filter((entry) => entry && entry.stage === 'acquisition');
  const paidEvents = events.filter((entry) => entry && entry.stage === 'paid');
  const paidOrders = revenueEvents.filter((entry) => entry && entry.status === 'paid');
  const firstPaid = paidEvents[0] || null;
  const lastPaid = paidEvents[paidEvents.length - 1] || null;

  const signupsBySource = {};
  const signupsByCampaign = {};
  const signupsByCommunity = {};
  const signupsByPostId = {};
  const signupsByCommentId = {};
  const signupsByCampaignVariant = {};
  const signupsByOfferCode = {};
  const acquisitionLeadKeys = new Set();
  const operatorGeneratedAcquisitionBySource = {};
  const operatorGeneratedAcquisitionLeadKeys = new Set();
  for (const entry of acquisitionEvents) {
    const attribution = extractAttribution({
      ...sanitizeMetadata(entry.metadata),
      ...sanitizeMetadata(entry),
    });
    const sourceKey = resolveAttributionSource(attribution);
    const campaignKey = resolveAttributionCampaign(attribution);
    incrementCounter(signupsBySource, sourceKey);
    incrementCounter(signupsByCampaign, campaignKey);
    incrementCounter(signupsByCommunity, attribution.community);
    incrementCounter(signupsByPostId, attribution.postId);
    incrementCounter(signupsByCommentId, attribution.commentId);
    incrementCounter(signupsByCampaignVariant, attribution.campaignVariant);
    incrementCounter(signupsByOfferCode, attribution.offerCode);
    acquisitionLeadKeys.add(resolveAcquisitionLeadKey(entry) || `${entry.timestamp}:${entry.event}`);
    if (isOperatorGeneratedAcquisitionEntry(entry)) {
      incrementCounter(operatorGeneratedAcquisitionBySource, sourceKey);
      operatorGeneratedAcquisitionLeadKeys.add(resolveAcquisitionLeadKey(entry) || `${entry.timestamp}:${entry.event}`);
    }
  }

  const paidBySource = {};
  const paidByCampaign = {};
  const paidByCommunity = {};
  const paidByPostId = {};
  const paidByCommentId = {};
  const paidByCampaignVariant = {};
  const paidByOfferCode = {};
  const bookedRevenueBySourceCents = {};
  const bookedRevenueByCampaignCents = {};
  const bookedRevenueByCommunityCents = {};
  const bookedRevenueByPostIdCents = {};
  const bookedRevenueByCommentIdCents = {};
  const bookedRevenueByCampaignVariantCents = {};
  const bookedRevenueByOfferCodeCents = {};
  const bookedRevenueByCtaId = {};
  const bookedRevenueByLandingPath = {};
  const bookedRevenueByReferrerHost = {};
  const bookedRevenueByCurrency = {};
  const paidCustomerIds = new Set();
  const revenueByProvider = {};
  let bookedRevenueCents = 0;
  let amountKnownOrders = 0;
  let amountUnknownOrders = 0;
  let latestPaidAt = null;
  let latestPaidOrder = null;

  for (const entry of paidOrders) {
    const providerKey = normalizeText(entry.provider) || 'unknown';
    const attribution = extractAttribution({
      ...sanitizeMetadata(entry.attribution || {}),
      ...sanitizeMetadata(entry),
    });
    const sourceKey = resolveAttributionSource(attribution, providerKey);
    const campaignKey = resolveAttributionCampaign(attribution);
    incrementCounter(paidBySource, sourceKey);
    incrementCounter(paidByCampaign, campaignKey);
    incrementCounter(paidByCommunity, attribution.community);
    incrementCounter(paidByPostId, attribution.postId);
    incrementCounter(paidByCommentId, attribution.commentId);
    incrementCounter(paidByCampaignVariant, attribution.campaignVariant);
    incrementCounter(paidByOfferCode, attribution.offerCode);
    paidCustomerIds.add(entry.customerId);

    if (!revenueByProvider[providerKey]) {
      revenueByProvider[providerKey] = {
        paidOrders: 0,
        bookedRevenueCents: 0,
        amountKnownOrders: 0,
        amountUnknownOrders: 0,
        bookedRevenueByCurrency: {},
      };
    }

    const providerSummary = revenueByProvider[providerKey];
    providerSummary.paidOrders += 1;

    if (entry.amountKnown && Number.isInteger(entry.amountCents)) {
      const currency = normalizeCurrency(entry.currency) || 'UNKNOWN';
      amountKnownOrders += 1;
      bookedRevenueCents += entry.amountCents;
      incrementCounter(bookedRevenueBySourceCents, sourceKey, entry.amountCents);
      incrementCounter(bookedRevenueByCampaignCents, campaignKey, entry.amountCents);
      incrementCounter(bookedRevenueByCommunityCents, attribution.community, entry.amountCents);
      incrementCounter(bookedRevenueByPostIdCents, attribution.postId, entry.amountCents);
      incrementCounter(bookedRevenueByCommentIdCents, attribution.commentId, entry.amountCents);
      incrementCounter(bookedRevenueByCampaignVariantCents, attribution.campaignVariant, entry.amountCents);
      incrementCounter(bookedRevenueByOfferCodeCents, attribution.offerCode, entry.amountCents);
      incrementCounter(bookedRevenueByCtaId, entry.ctaId, entry.amountCents);
      incrementCounter(bookedRevenueByLandingPath, entry.landingPath, entry.amountCents);
      incrementCounter(bookedRevenueByReferrerHost, entry.referrerHost, entry.amountCents);
      incrementCounter(bookedRevenueByCurrency, currency, entry.amountCents);
      providerSummary.bookedRevenueCents += entry.amountCents;
      providerSummary.amountKnownOrders += 1;
      incrementCounter(providerSummary.bookedRevenueByCurrency, currency, entry.amountCents);
    } else {
      amountUnknownOrders += 1;
      providerSummary.amountUnknownOrders += 1;
    }

    if (!latestPaidAt || String(entry.timestamp || '') > latestPaidAt) {
      latestPaidAt = entry.timestamp || null;
      latestPaidOrder = {
        timestamp: entry.timestamp || null,
        provider: entry.provider || null,
        event: entry.event || null,
        orderId: entry.orderId || null,
        customerId: entry.customerId || null,
        amountCents: entry.amountCents ?? null,
        currency: entry.currency || null,
        amountKnown: Boolean(entry.amountKnown),
      };
    }
  }

  const conversionBySource = {};
  for (const sourceKey of new Set([...Object.keys(signupsBySource), ...Object.keys(paidBySource)])) {
    conversionBySource[sourceKey] = safeRate(paidBySource[sourceKey] || 0, signupsBySource[sourceKey] || 0);
  }

  const conversionByCampaign = {};
  for (const campaignKey of new Set([...Object.keys(signupsByCampaign), ...Object.keys(paidByCampaign)])) {
    conversionByCampaign[campaignKey] = safeRate(paidByCampaign[campaignKey] || 0, signupsByCampaign[campaignKey] || 0);
  }

  const conversionByCommunity = {};
  for (const communityKey of new Set([...Object.keys(signupsByCommunity), ...Object.keys(paidByCommunity)])) {
    conversionByCommunity[communityKey] = safeRate(paidByCommunity[communityKey] || 0, signupsByCommunity[communityKey] || 0);
  }

  const conversionByPostId = {};
  for (const postId of new Set([...Object.keys(signupsByPostId), ...Object.keys(paidByPostId)])) {
    conversionByPostId[postId] = safeRate(paidByPostId[postId] || 0, signupsByPostId[postId] || 0);
  }

  const conversionByCommentId = {};
  for (const commentId of new Set([...Object.keys(signupsByCommentId), ...Object.keys(paidByCommentId)])) {
    conversionByCommentId[commentId] = safeRate(paidByCommentId[commentId] || 0, signupsByCommentId[commentId] || 0);
  }

  const conversionByCampaignVariant = {};
  for (const variant of new Set([...Object.keys(signupsByCampaignVariant), ...Object.keys(paidByCampaignVariant)])) {
    conversionByCampaignVariant[variant] = safeRate(paidByCampaignVariant[variant] || 0, signupsByCampaignVariant[variant] || 0);
  }

  const conversionByOfferCode = {};
  for (const offerCode of new Set([...Object.keys(signupsByOfferCode), ...Object.keys(paidByOfferCode)])) {
    conversionByOfferCode[offerCode] = safeRate(paidByOfferCode[offerCode] || 0, signupsByOfferCode[offerCode] || 0);
  }

  const workflowSprintLeadStatus = {};
  const workflowSprintLeadBySource = {};
  const workflowSprintLeadByCampaign = {};
  const workflowSprintLeadByCommunity = {};
  const workflowSprintLeadByRuntime = {};
  const qualifiedWorkflowSprintLeadBySource = {};
  let workflowSprintLeadLatest = null;
  let workflowSprintLeadLatestAt = null;
  let workflowSprintLeadContactable = 0;
  let qualifiedWorkflowSprintLeadCount = 0;

  for (const entry of workflowSprintLeads) {
    if (!entry || typeof entry !== 'object') continue;
    incrementCounter(workflowSprintLeadStatus, entry.status);
    const attribution = extractAttribution(entry.attribution || {});
    incrementCounter(workflowSprintLeadBySource, resolveAttributionSource(attribution, 'workflow_sprint_intake'));
    incrementCounter(workflowSprintLeadByCampaign, resolveAttributionCampaign(attribution));
    incrementCounter(workflowSprintLeadByCommunity, attribution.community);
    incrementCounter(workflowSprintLeadByRuntime, entry.qualification?.runtime);

    if (entry.contact?.email) {
      workflowSprintLeadContactable += 1;
    }
    if (isQualifiedWorkflowSprintLead(entry)) {
      qualifiedWorkflowSprintLeadCount += 1;
      incrementCounter(
        qualifiedWorkflowSprintLeadBySource,
        resolveAttributionSource(attribution, 'workflow_sprint_intake')
      );
    }

    if (!workflowSprintLeadLatestAt || String(entry.submittedAt || '') > workflowSprintLeadLatestAt) {
      workflowSprintLeadLatestAt = entry.submittedAt || null;
      workflowSprintLeadLatest = {
        leadId: entry.leadId || null,
        submittedAt: entry.submittedAt || null,
        status: entry.status || null,
        email: entry.contact?.email || null,
        company: entry.contact?.company || null,
        workflow: entry.qualification?.workflow || null,
        owner: entry.qualification?.owner || null,
        runtime: entry.qualification?.runtime || null,
        source: attribution.source || null,
        campaign: attribution.campaign || null,
      };
    }
  }

  const unreconciledPaidEvents = paidEvents.filter((entry) => {
    const eventKey = resolvePaidProviderEventKey(entry);
    if (!eventKey) return true;
    return !paidOrders.some((order) => resolveRevenueEventKey(order) === eventKey);
  }).length;

  const trafficMetrics = {
    visitors: telemetry.visitors ? telemetry.visitors.uniqueVisitors || 0 : 0,
    sessions: telemetry.visitors ? telemetry.visitors.uniqueSessions || 0 : 0,
    pageViews: telemetry.visitors ? telemetry.visitors.pageViews || 0 : 0,
    ctaClicks: telemetry.ctas ? telemetry.ctas.totalClicks || 0 : 0,
    checkoutStarts: telemetry.ctas ? telemetry.ctas.totalClicks || 0 : 0,
    buyerLossFeedback: telemetry.buyerLoss ? telemetry.buyerLoss.totalSignals || 0 : 0,
    seoLandingViews: telemetry.seo ? telemetry.seo.landingViews || 0 : 0,
  };

  const operatorGeneratedAcquisition = {
    totalEvents: acquisitionEvents.filter(isOperatorGeneratedAcquisitionEntry).length,
    uniqueLeads: operatorGeneratedAcquisitionLeadKeys.size,
    bySource: operatorGeneratedAcquisitionBySource,
  };

  const dataQuality = {
    telemetryCoverage: Number(((
      (telemetry.visitors ? telemetry.visitors.visitorIdCoverageRate || 0 : 0) +
      (telemetry.visitors ? telemetry.visitors.sessionIdCoverageRate || 0 : 0) +
      (telemetry.visitors ? telemetry.visitors.acquisitionIdCoverageRate || 0 : 0)
    ) / 3).toFixed(4)),
    attributionCoverage: telemetry.visitors ? telemetry.visitors.attributionCoverageRate || 0 : 0,
    amountKnownCoverage: paidOrders.length ? safeRate(amountKnownOrders, paidOrders.length) : 0,
    unreconciledPaidEvents,
  };

  return {
    generatedAt: new Date().toISOString(),
    coverage: {
      source: 'funnel_ledger+revenue_ledger+workflow_sprint_leads',
      tracksBookedRevenue: true,
      tracksPaidOrders: true,
      tracksInvoices: false,
      tracksAttribution: true,
      tracksWorkflowSprintLeads: true,
      providerCoverage: {
        stripe: 'booked_revenue',
        githubMarketplace: CONFIG.GITHUB_MARKETPLACE_PLAN_PRICES_JSON ? 'configured_plan_prices' : 'paid_orders_only',
      },
    },
    funnel: {
      ...funnel,
      uniqueAcquisitionLeads: acquisitionLeadKeys.size,
      uniquePaidCustomers: paidCustomerIds.size,
      firstPaidAt: firstPaid ? firstPaid.timestamp || null : null,
      lastPaidAt: lastPaid ? lastPaid.timestamp || null : null,
      lastPaidEvent: lastPaid ? {
        timestamp: lastPaid.timestamp || null,
        event: lastPaid.event || null,
        evidence: lastPaid.evidence || null,
        customerId: lastPaid.metadata?.customerId || null,
        traceId: lastPaid.traceId || null,
      } : null,
    },
    signups: {
      total: acquisitionEvents.length,
      uniqueLeads: acquisitionLeadKeys.size,
      bySource: signupsBySource,
      byCampaign: signupsByCampaign,
      byCommunity: signupsByCommunity,
      byPostId: signupsByPostId,
      byCommentId: signupsByCommentId,
      byCampaignVariant: signupsByCampaignVariant,
      byOfferCode: signupsByOfferCode,
    },
    revenue: {
      paidProviderEvents: paidEvents.length,
      paidOrders: paidOrders.length,
      paidCustomers: paidCustomerIds.size,
      bookedRevenueCents,
      bookedRevenueByCurrency,
      amountKnownOrders,
      amountUnknownOrders,
      amountKnownCoverageRate: safeRate(amountKnownOrders, paidOrders.length),
      unreconciledPaidEvents,
      latestPaidAt,
      latestPaidOrder,
      byProvider: revenueByProvider,
    },
    pipeline: {
      workflowSprintLeads: {
        total: workflowSprintLeads.length,
        contactable: workflowSprintLeadContactable,
        byStatus: workflowSprintLeadStatus,
        bySource: workflowSprintLeadBySource,
        byCampaign: workflowSprintLeadByCampaign,
        byCommunity: workflowSprintLeadByCommunity,
        byRuntime: workflowSprintLeadByRuntime,
        latestLeadAt: workflowSprintLeadLatestAt,
        latestLead: workflowSprintLeadLatest,
      },
      qualifiedWorkflowSprintLeads: {
        total: qualifiedWorkflowSprintLeadCount,
        bySource: qualifiedWorkflowSprintLeadBySource,
      },
    },
    attribution: {
      acquisitionBySource: signupsBySource,
      acquisitionByCampaign: signupsByCampaign,
      acquisitionByCommunity: signupsByCommunity,
      acquisitionByPostId: signupsByPostId,
      acquisitionByCommentId: signupsByCommentId,
      acquisitionByCampaignVariant: signupsByCampaignVariant,
      acquisitionByOfferCode: signupsByOfferCode,
      paidBySource,
      paidByCampaign,
      paidByCommunity,
      paidByPostId,
      paidByCommentId,
      paidByCampaignVariant,
      paidByOfferCode,
      bookedRevenueBySourceCents,
      bookedRevenueByCampaignCents,
      bookedRevenueByCommunityCents,
      bookedRevenueByPostIdCents,
      bookedRevenueByCommentIdCents,
      bookedRevenueByCampaignVariantCents,
      bookedRevenueByOfferCodeCents,
      bookedRevenueByCtaId,
      bookedRevenueByLandingPath,
      bookedRevenueByReferrerHost,
      conversionBySource,
      conversionByCampaign,
      conversionByCommunity,
      conversionByPostId,
      conversionByCommentId,
      conversionByCampaignVariant,
      conversionByOfferCode,
    },
    trafficMetrics,
    operatorGeneratedAcquisition,
    dataQuality,
  };
}

function getBillingSummary() {
  const business = getBusinessAnalytics();
  const store = loadKeyStore();
  const keyEntries = Object.values(store.keys || {});
  const customers = new Map();
  const bySource = {};
  const activeBySource = {};
  let activeKeys = 0;
  let disabledKeys = 0;
  let totalUsage = 0;
  const activeCustomerIds = new Set();

  for (const meta of keyEntries) {
    const source = meta.source || 'unknown';
    const customerId = meta.customerId || 'unknown';
    const usageCount = Number(meta.usageCount || 0);
    bySource[source] = (bySource[source] || 0) + 1;
    totalUsage += usageCount;

    if (meta.active) {
      activeKeys += 1;
      activeBySource[source] = (activeBySource[source] || 0) + 1;
      activeCustomerIds.add(customerId);
    } else {
      disabledKeys += 1;
    }

    if (!customers.has(customerId)) {
      customers.set(customerId, {
        customerId,
        activeKeys: 0,
        totalKeys: 0,
        usageCount: 0,
        source,
        installId: meta.installId || null,
        createdAt: meta.createdAt || null,
        disabledAt: meta.disabledAt || null,
      });
    }

    const summary = customers.get(customerId);
    summary.totalKeys += 1;
    summary.usageCount += usageCount;
    if (meta.active) {
      summary.activeKeys += 1;
    }
    if (meta.source && (!summary.source || summary.source === 'unknown')) {
      summary.source = meta.source;
    }
    if (meta.installId && !summary.installId) {
      summary.installId = meta.installId;
    }
    if (meta.createdAt && (!summary.createdAt || meta.createdAt < summary.createdAt)) {
      summary.createdAt = meta.createdAt;
    }
    if (meta.disabledAt && (!summary.disabledAt || meta.disabledAt > summary.disabledAt)) {
      summary.disabledAt = meta.disabledAt;
    }
  }

  const orderedCustomers = Array.from(customers.values()).sort((a, b) => {
    const aTime = a.createdAt || '';
    const bTime = b.createdAt || '';
    return aTime.localeCompare(bTime) || a.customerId.localeCompare(b.customerId);
  });

  return {
    generatedAt: business.generatedAt,
    coverage: {
      ...business.coverage,
      source: 'funnel_ledger+revenue_ledger+key_store+workflow_sprint_leads',
    },
    funnel: business.funnel,
    signups: business.signups,
    revenue: business.revenue,
    pipeline: business.pipeline,
    attribution: business.attribution,
    trafficMetrics: business.trafficMetrics,
    operatorGeneratedAcquisition: business.operatorGeneratedAcquisition,
    dataQuality: business.dataQuality,
    keys: {
      total: keyEntries.length,
      active: activeKeys,
      disabled: disabledKeys,
      activeCustomers: activeCustomerIds.size,
      totalUsage,
      bySource,
      activeBySource,
    },
    customers: orderedCustomers,
  };
}

function loadKeyStore() {
  try {
    const target = CONFIG.API_KEYS_PATH;
    if (!fs.existsSync(target)) return { keys: {} };
    const parsed = JSON.parse(fs.readFileSync(target, 'utf-8'));
    return (parsed && typeof parsed.keys === 'object') ? parsed : { keys: {} };
  } catch { return { keys: {} }; }
}

function saveKeyStore(store) {
  const target = CONFIG.API_KEYS_PATH;
  ensureParentDir(target);
  fs.writeFileSync(target, JSON.stringify(store, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Core Exports
// ---------------------------------------------------------------------------

async function createCheckoutSession({ successUrl, cancelUrl, customerEmail, installId, traceId, metadata = {} } = {}) {
  const resolvedTraceId = traceId || metadata.traceId || createTraceId('checkout');
  const checkoutMetadata = sanitizeMetadata({ ...metadata, installId: installId || 'unknown', traceId: resolvedTraceId });

  if (LOCAL_MODE()) {
    const localSessionId = `test_session_${crypto.randomBytes(8).toString('hex')}`;
    const store = loadLocalCheckoutSessions();
    store.sessions[localSessionId] = { id: localSessionId, customer: `local_cus_${crypto.randomBytes(4).toString('hex')}`, metadata: checkoutMetadata, payment_status: 'paid', status: 'complete' };
    saveLocalCheckoutSessions(store);

    appendFunnelEvent({
      stage: 'acquisition',
      event: 'checkout_session_created',
      installId,
      traceId: resolvedTraceId,
      evidence: 'local_mode_manual',
      metadata: checkoutMetadata,
    });
    return { sessionId: localSessionId, url: null, localMode: true, traceId: resolvedTraceId, metadata: checkoutMetadata };
  }

  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.create({
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: customerEmail,
    payment_method_types: ['card', 'link'],
    mode: 'payment',
    line_items: [{ price: CONFIG.STRIPE_PRICE_ID, quantity: 1 }],
    metadata: serializeStripeMetadata(checkoutMetadata),
  });

  appendFunnelEvent({
    stage: 'acquisition',
    event: 'checkout_session_created',
    installId,
    traceId: resolvedTraceId,
    evidence: session.id,
    metadata: checkoutMetadata,
  });
  return { sessionId: session.id, url: session.url, localMode: false, traceId: resolvedTraceId, metadata: checkoutMetadata };
}

async function getCheckoutSessionStatus(sessionId) {
  if (LOCAL_MODE()) {
    const store = loadLocalCheckoutSessions();
    const session = store.sessions[sessionId];
    if (!session) return { found: false };
    const provisioned = provisionApiKey(session.customer, { installId: session.metadata?.installId, source: 'local_checkout_lookup' });
    return {
      found: true,
      localMode: true,
      sessionId,
      paid: true,
      paymentStatus: 'paid',
      status: 'complete',
      customerId: session.customer,
      installId: session.metadata?.installId,
      traceId: session.metadata?.traceId || null,
      acquisitionId: session.metadata?.acquisitionId || null,
      visitorId: session.metadata?.visitorId || null,
      visitorSessionId: session.metadata?.sessionId || null,
      ctaId: session.metadata?.ctaId || null,
      ctaPlacement: session.metadata?.ctaPlacement || null,
      planId: session.metadata?.planId || null,
      landingPath: session.metadata?.landingPath || null,
      referrerHost: session.metadata?.referrerHost || null,
      apiKey: provisioned.key,
    };
  }

  try {
    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const isPaid = session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
    const traceId = session.metadata?.traceId || null;

    if (!isPaid) return { found: true, localMode: false, sessionId, paid: false, paymentStatus: session.payment_status, status: session.status };

    const installId = session.metadata?.installId || null;
    const provisioned = provisionApiKey(session.customer, { installId, source: 'stripe_checkout_session_lookup' });

    return {
      found: true,
      localMode: false,
      sessionId,
      paid: true,
      paymentStatus: session.payment_status,
      customerId: session.customer,
      customerEmail: session.customer_details?.email || '',
      installId,
      traceId,
      acquisitionId: session.metadata?.acquisitionId || null,
      visitorId: session.metadata?.visitorId || null,
      visitorSessionId: session.metadata?.sessionId || null,
      ctaId: session.metadata?.ctaId || null,
      ctaPlacement: session.metadata?.ctaPlacement || null,
      planId: session.metadata?.planId || null,
      landingPath: session.metadata?.landingPath || null,
      referrerHost: session.metadata?.referrerHost || null,
      apiKey: provisioned.key,
    };
  } catch {
    return { found: false };
  }
}

function provisionApiKey(customerId, opts = {}) {
  if (!customerId || typeof customerId !== 'string') throw new Error('customerId is required');
  const store = loadKeyStore();
  const existing = Object.entries(store.keys).find(([, m]) => m.customerId === customerId && m.active);

  if (existing) {
    if (opts.installId && !existing[1].installId) { existing[1].installId = opts.installId; saveKeyStore(store); }
    return { key: existing[0], customerId, createdAt: existing[1].createdAt, installId: existing[1].installId || null, reused: true };
  }

  const key = `rlhf_${crypto.randomBytes(16).toString('hex')}`;
  const createdAt = new Date().toISOString();
  store.keys[key] = { customerId, active: true, usageCount: 0, createdAt, installId: opts.installId || null, source: opts.source || 'provision' };
  saveKeyStore(store);
  return { key, customerId, createdAt, installId: opts.installId || null };
}

function rotateApiKey(oldKey) {
  if (!oldKey) return { rotated: false, reason: 'missing_old_key' };
  const store = loadKeyStore();
  const meta = store.keys[oldKey];
  if (!meta || !meta.active) return { rotated: false, reason: 'key_not_active' };

  meta.active = false;
  meta.disabledAt = new Date().toISOString();
  const newKey = `rlhf_${crypto.randomBytes(16).toString('hex')}`;
  store.keys[newKey] = { customerId: meta.customerId, active: true, usageCount: 0, createdAt: new Date().toISOString(), installId: meta.installId, source: 'rotation', replacedKey: oldKey };
  saveKeyStore(store);
  return { rotated: true, key: newKey, oldKey };
}

function validateApiKey(key) {
  if (!key) return { valid: false };
  const store = loadKeyStore();
  const meta = store.keys[key];
  if (!meta || !meta.active) return { valid: false };
  return {
    valid: true,
    customerId: meta.customerId,
    usageCount: meta.usageCount || 0,
    installId: meta.installId || null,
    createdAt: meta.createdAt,
    metadata: meta,
  };
}

function recordUsage(key) {
  const store = loadKeyStore();
  const meta = store.keys[key];
  if (meta && meta.active) {
    const oldVal = meta.usageCount || 0;
    meta.usageCount = oldVal + 1;
    if (oldVal === 0) appendFunnelEvent({ stage: 'activation', event: 'api_key_first_usage', installId: meta.installId, evidence: key, metadata: { customerId: meta.customerId } });
    saveKeyStore(store);
    return { recorded: true, usageCount: meta.usageCount };
  }
  return { recorded: false };
}

/**
 * Report usage to Stripe for metered billing.
 */
async function reportUsageToStripe(subscriptionItemId, quantity = 1) {
  if (LOCAL_MODE()) return { reported: false, reason: 'local_mode' };
  try {
    const stripe = getStripeClient();
    const record = await stripe.subscriptionItems.createUsageRecord(subscriptionItemId, {
      quantity,
      timestamp: 'now',
      action: 'increment'
    });
    return { reported: true, record };
  } catch (err) {
    return { reported: false, error: err.message };
  }
}

function disableCustomerKeys(customerId) {
  const store = loadKeyStore();
  let disabledCount = 0;
  for (const [key, meta] of Object.entries(store.keys)) {
    if (meta.customerId === customerId && meta.active) { meta.active = false; meta.disabledAt = new Date().toISOString(); disabledCount++; }
  }
  if (disabledCount > 0) saveKeyStore(store);
  return { disabledCount };
}

function verifyWebhookSignature(rawBody, signature) {
  if (!CONFIG.STRIPE_WEBHOOK_SECRET) return true;
  if (!signature || !rawBody) return false;

  // Stripe signature format: t=<timestamp>,v1=<hmac>,...
  const parts = { v1: [] };
  for (const part of signature.split(',')) {
    const [k, v] = part.split('=');
    if (!k || !v) continue;
    if (k === 'v1') {
      parts.v1.push(v);
      continue;
    }
    parts[k] = v;
  }

  if (!parts.t || !Array.isArray(parts.v1) || parts.v1.length === 0) return false;

  // Timestamp tolerance: +/- 5 minutes
  const timestamp = parseInt(parts.t, 10);
  const now = Math.floor(Date.now() / 1000);
  if (isNaN(timestamp) || Math.abs(now - timestamp) > 300) return false;

  const payload = `${parts.t}.${typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8')}`;
  const expected = crypto.createHmac('sha256', CONFIG.STRIPE_WEBHOOK_SECRET).update(payload).digest('hex');

  return parts.v1.some((candidate) => safeCompareHex(expected, candidate));
}

async function handleWebhook(rawBody, signature) {
  if (LOCAL_MODE()) return { handled: false, reason: 'local_mode' };
  let event;
  try {
    const stripe = getStripeClient();
    event = stripe.webhooks.constructEvent(rawBody, signature, CONFIG.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return { handled: false, reason: 'invalid_signature', error: err.message };
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const customerId = session.customer;
      const installId = session.metadata?.installId;
      const traceId = session.metadata?.traceId || null;
      const attribution = extractAttribution(session.metadata);
      const result = provisionApiKey(customerId, { installId, source: 'stripe_webhook_checkout_completed' });
      const funnelRecord = {
        stage: 'paid',
        event: 'stripe_checkout_completed',
        evidence: session.id,
        metadata: {
          customerId,
          subscriptionId: session.subscription,
          sessionId: session.id,
          traceId,
          ...extractJourneyFields(session.metadata),
          ...attribution,
        },
      };
      if (!hasFunnelEventMatch(loadFunnelLedger(), funnelRecord)) {
        appendFunnelEvent({
          stage: 'paid',
          event: 'stripe_checkout_completed',
          installId,
          traceId,
          evidence: session.id,
          metadata: funnelRecord.metadata,
        });
      }
      const revenueRecord = {
        provider: 'stripe',
        event: 'stripe_checkout_completed',
        status: 'paid',
        customerId,
        orderId: session.id,
        metadata: {
          ...extractJourneyFields(session.metadata),
          sessionId: session.id,
          subscriptionId: session.subscription || null,
          mode: session.mode || null,
          paymentStatus: session.payment_status || null,
        },
      };
      if (!hasRevenueEventMatch(loadRevenueLedger(), revenueRecord)) {
        appendRevenueEvent({
          ...revenueRecord,
          installId,
          traceId,
          evidence: session.id,
          amountCents: session.amount_total,
          currency: session.currency,
          amountKnown: session.amount_total !== undefined && session.amount_total !== null,
          recurringInterval: session.mode === 'subscription' ? 'month' : null,
          attribution,
        });
      }
      return { handled: true, action: 'provisioned_api_key', result };
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      return { handled: true, action: 'disabled_customer_keys', result: disableCustomerKeys(sub.customer) };
    }
    default: return { handled: false, reason: `unhandled_event_type:${event.type}` };
  }
}

function verifyGithubWebhookSignature(rawBody, signature) {
  if (!CONFIG.GITHUB_MARKETPLACE_WEBHOOK_SECRET) return true;
  if (!signature || !rawBody) return false;
  const expected = crypto.createHmac('sha256', CONFIG.GITHUB_MARKETPLACE_WEBHOOK_SECRET).update(rawBody).digest('hex');
  const digest = Buffer.from(`sha256=${expected}`, 'utf8');
  const checksum = Buffer.from(signature, 'utf8');
  return checksum.length === digest.length && crypto.timingSafeEqual(digest, checksum);
}

function handleGithubWebhook(event) {
  if (!event) return { handled: false, reason: 'missing_payload_data' };
  const { action, marketplace_purchase: mp } = event;
  if (!action || !mp || !mp.account?.id) return { handled: false, reason: 'missing_payload_data' };
  const customerId = `github_${String(mp.account.type).toLowerCase()}_${mp.account.id}`;
  const marketplaceOrderId = normalizeText(mp.id) || `github_marketplace_${String(mp.account.id)}_${String(mp.plan?.id || 'unknown')}`;
  const planPricing = resolveGithubPlanPricing(mp.plan?.id);
  switch (action) {
    case 'purchased': {
      const result = provisionApiKey(customerId, { source: 'github_marketplace_purchased' });
      const funnelRecord = {
        stage: 'paid',
        event: 'github_marketplace_purchased',
        evidence: marketplaceOrderId,
        metadata: {
          provider: 'github_marketplace',
          customerId,
          accountId: String(mp.account.id),
          accountType: String(mp.account.type),
          source: 'github_marketplace',
          planId: mp.plan?.id || null,
          planName: mp.plan?.name || null,
          marketplaceOrderId,
        },
      };
      if (!hasFunnelEventMatch(loadFunnelLedger(), funnelRecord)) {
        appendFunnelEvent(funnelRecord);
      }
      const revenueRecord = {
        provider: 'github_marketplace',
        event: 'github_marketplace_purchased',
        status: 'paid',
        customerId,
        orderId: marketplaceOrderId,
        metadata: {
          accountId: String(mp.account.id),
          accountType: String(mp.account.type),
          planId: mp.plan?.id || null,
          planName: mp.plan?.name || null,
          marketplaceOrderId,
        },
      };
      if (!hasRevenueEventMatch(loadRevenueLedger(), revenueRecord)) {
        appendRevenueEvent({
          ...revenueRecord,
          evidence: marketplaceOrderId,
          amountCents: planPricing.amountCents,
          currency: planPricing.currency,
          amountKnown: planPricing.amountKnown,
          recurringInterval: planPricing.recurringInterval,
          attribution: { source: 'github_marketplace' },
        });
      }
      return { handled: true, action: 'provisioned_api_key', result };
    }
    case 'cancelled':
      if (!hasRevenueEventMatch(loadRevenueLedger(), {
        provider: 'github_marketplace',
        event: 'github_marketplace_cancelled',
        status: 'cancelled',
        customerId,
        orderId: marketplaceOrderId,
        metadata: { marketplaceOrderId },
      })) {
        appendRevenueEvent({
          provider: 'github_marketplace',
          event: 'github_marketplace_cancelled',
          status: 'cancelled',
          customerId,
          orderId: marketplaceOrderId,
          evidence: marketplaceOrderId,
          amountCents: planPricing.amountCents,
          currency: planPricing.currency,
          amountKnown: planPricing.amountKnown,
          recurringInterval: planPricing.recurringInterval,
          attribution: { source: 'github_marketplace' },
          metadata: {
            accountId: String(mp.account.id),
            accountType: String(mp.account.type),
            planId: mp.plan?.id || null,
            planName: mp.plan?.name || null,
            marketplaceOrderId,
          },
        });
      }
      return { handled: true, action: 'disabled_customer_keys', result: disableCustomerKeys(customerId) };
    case 'changed': {
      if (!hasRevenueEventMatch(loadRevenueLedger(), {
        provider: 'github_marketplace',
        event: 'github_marketplace_changed',
        status: 'changed',
        customerId,
        orderId: marketplaceOrderId,
        metadata: { marketplaceOrderId },
      })) {
        appendRevenueEvent({
          provider: 'github_marketplace',
          event: 'github_marketplace_changed',
          status: 'changed',
          customerId,
          orderId: marketplaceOrderId,
          evidence: marketplaceOrderId,
          amountCents: planPricing.amountCents,
          currency: planPricing.currency,
          amountKnown: planPricing.amountKnown,
          recurringInterval: planPricing.recurringInterval,
          attribution: { source: 'github_marketplace' },
          metadata: {
            accountId: String(mp.account.id),
            accountType: String(mp.account.type),
            planId: mp.plan?.id || null,
            planName: mp.plan?.name || null,
            marketplaceOrderId,
          },
        });
      }
      return { handled: true, action: 'plan_changed', result: provisionApiKey(customerId, { source: 'github_marketplace_changed' }) };
    }
    default: return { handled: false, reason: `unhandled_action:${action}` };
  }
}

module.exports = {
  createCheckoutSession, getCheckoutSessionStatus, provisionApiKey, rotateApiKey, validateApiKey, recordUsage, reportUsageToStripe, disableCustomerKeys, handleWebhook, verifyWebhookSignature, verifyGithubWebhookSignature, handleGithubWebhook, loadKeyStore, appendFunnelEvent, appendRevenueEvent, loadFunnelLedger, loadRevenueLedger, getFunnelAnalytics, getBusinessAnalytics, getBillingSummary,
  _API_KEYS_PATH: () => CONFIG.API_KEYS_PATH,
  _FUNNEL_LEDGER_PATH: () => CONFIG.FUNNEL_LEDGER_PATH,
  _REVENUE_LEDGER_PATH: () => CONFIG.REVENUE_LEDGER_PATH,
  _LOCAL_CHECKOUT_SESSIONS_PATH: () => CONFIG.LOCAL_CHECKOUT_SESSIONS_PATH,
  _LOCAL_MODE: () => LOCAL_MODE(),
};
