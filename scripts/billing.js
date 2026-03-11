#!/usr/bin/env node
/**
 * billing.js — Stripe billing integration using official Stripe SDK.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Stripe = require('stripe');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CONFIG = {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
  GITHUB_MARKETPLACE_WEBHOOK_SECRET: process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET || '',
  STRIPE_PRICE_ID: process.env.STRIPE_PRICE_ID || 'price_1RNdUBGGBpd520QYG1A9SWF4',
  STRIPE_ONE_TIME_PRICE_ID: process.env.STRIPE_ONE_TIME_PRICE_ID || 'price_1RNeMBGGBpd520QYNmZYZY12',
  get API_KEYS_PATH() {
    return process.env._TEST_API_KEYS_PATH || path.resolve(__dirname, '../.claude/memory/feedback/api-keys.json');
  },
  get FUNNEL_LEDGER_PATH() {
    return process.env._TEST_FUNNEL_LEDGER_PATH || process.env.RLHF_FUNNEL_LEDGER_PATH || path.resolve(__dirname, '../.claude/memory/feedback/funnel-events.jsonl');
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
  return { ...metadata };
}

function appendFunnelEvent({ stage, event, installId = null, evidence, metadata = {} } = {}) {
  if (!stage || !event) return { written: false, reason: 'missing_stage_or_event' };
  const payload = { timestamp: new Date().toISOString(), stage, event, evidence: evidence || event, installId: installId || null, metadata: sanitizeMetadata(metadata) };
  try {
    const target = CONFIG.FUNNEL_LEDGER_PATH;
    ensureParentDir(target);
    fs.appendFileSync(target, `${JSON.stringify(payload)}\n`, 'utf-8');
    return { written: true, payload };
  } catch (err) {
    return { written: false, reason: 'write_failed', error: err.message };
  }
}

function loadFunnelLedger() {
  try {
    const target = CONFIG.FUNNEL_LEDGER_PATH;
    if (!fs.existsSync(target)) return [];
    return fs.readFileSync(target, 'utf-8').split('\n').map(l => l.trim()).filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
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

function getFunnelAnalytics() {
  const events = loadFunnelLedger();
  const stageCounts = { acquisition: 0, activation: 0, paid: 0 };
  const eventCounts = {};
  for (const entry of events) {
    if (entry && stageCounts.hasOwnProperty(entry.stage)) {
      stageCounts[entry.stage]++;
      const key = `${entry.stage}:${entry.event || 'unknown'}`;
      eventCounts[key] = (eventCounts[key] || 0) + 1;
    }
  }
  const safeRate = (num, den) => den ? Number((num / den).toFixed(4)) : 0;
  return { totalEvents: events.length, stageCounts, eventCounts, conversionRates: { acquisitionToActivation: safeRate(stageCounts.activation, stageCounts.acquisition), activationToPaid: safeRate(stageCounts.paid, stageCounts.activation), acquisitionToPaid: safeRate(stageCounts.paid, stageCounts.acquisition) } };
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

async function createCheckoutSession({ successUrl, cancelUrl, customerEmail, installId, metadata = {} } = {}) {
  const checkoutMetadata = { ...metadata, installId: installId || 'unknown' };

  if (LOCAL_MODE()) {
    const localSessionId = `test_session_${crypto.randomBytes(8).toString('hex')}`;
    const store = loadLocalCheckoutSessions();
    store.sessions[localSessionId] = { id: localSessionId, customer: `local_cus_${crypto.randomBytes(4).toString('hex')}`, metadata: checkoutMetadata, payment_status: 'paid', status: 'complete' };
    saveLocalCheckoutSessions(store);

    appendFunnelEvent({ stage: 'acquisition', event: 'checkout_session_created', installId, evidence: 'local_mode_manual', metadata: checkoutMetadata });
    return { sessionId: localSessionId, url: null, localMode: true, metadata: checkoutMetadata };
  }

  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.create({
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: customerEmail,
    mode: metadata.oneTime ? 'payment' : 'subscription',
    line_items: [{ price: metadata.oneTime ? CONFIG.STRIPE_ONE_TIME_PRICE_ID : CONFIG.STRIPE_PRICE_ID, quantity: 1 }],
    metadata: checkoutMetadata,
  });

  appendFunnelEvent({ stage: 'acquisition', event: 'checkout_session_created', installId, evidence: session.id, metadata: checkoutMetadata });
  return { sessionId: session.id, url: session.url, localMode: false, metadata: checkoutMetadata };
}

async function getCheckoutSessionStatus(sessionId) {
  if (LOCAL_MODE()) {
    const store = loadLocalCheckoutSessions();
    const session = store.sessions[sessionId];
    if (!session) return { found: false };
    const provisioned = provisionApiKey(session.customer, { installId: session.metadata?.installId, source: 'local_checkout_lookup' });
    return { found: true, localMode: true, sessionId, paid: true, paymentStatus: 'paid', status: 'complete', customerId: session.customer, installId: session.metadata?.installId, apiKey: provisioned.key };
  }

  try {
    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const isPaid = session.payment_status === 'paid' || session.payment_status === 'no_payment_required';

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
  return (meta && meta.active) ? { valid: true, metadata: meta } : { valid: false };
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
      const result = provisionApiKey(customerId, { installId, source: 'stripe_webhook_checkout_completed' });
      appendFunnelEvent({ stage: 'paid', event: 'stripe_checkout_completed', installId, evidence: session.id, metadata: { customerId, subscriptionId: session.subscription } });
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
  switch (action) {
    case 'purchased': {
      const result = provisionApiKey(customerId, { source: 'github_marketplace_purchased' });
      appendFunnelEvent({ stage: 'paid', event: 'github_marketplace_purchased', evidence: 'github_marketplace_purchased', metadata: { provider: 'github', customerId, accountId: String(mp.account.id), accountType: String(mp.account.type) } });
      return { handled: true, action: 'provisioned_api_key', result };
    }
    case 'cancelled': return { handled: true, action: 'disabled_customer_keys', result: disableCustomerKeys(customerId) };
    case 'changed': return { handled: true, action: 'plan_changed', result: provisionApiKey(customerId, { source: 'github_marketplace_changed' }) };
    default: return { handled: false, reason: `unhandled_action:${action}` };
  }
}

module.exports = {
  createCheckoutSession, getCheckoutSessionStatus, provisionApiKey, rotateApiKey, validateApiKey, recordUsage, reportUsageToStripe, disableCustomerKeys, handleWebhook, verifyGithubWebhookSignature, handleGithubWebhook, loadKeyStore, appendFunnelEvent, loadFunnelLedger, getFunnelAnalytics,
  _API_KEYS_PATH: () => CONFIG.API_KEYS_PATH,
  _FUNNEL_LEDGER_PATH: () => CONFIG.FUNNEL_LEDGER_PATH,
  _LOCAL_CHECKOUT_SESSIONS_PATH: () => CONFIG.LOCAL_CHECKOUT_SESSIONS_PATH,
  _LOCAL_MODE: () => LOCAL_MODE(),
};
