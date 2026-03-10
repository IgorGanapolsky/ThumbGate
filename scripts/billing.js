#!/usr/bin/env node
/**
 * billing.js — Stripe billing integration using raw fetch (no stripe npm package).
 *
 * Functions:
 *   createCheckoutSession()  — Creates Stripe Checkout session for Cloud Pro
 *   provisionApiKey(customerId) — Generates unique API key, stores in api-keys.json
 *   validateApiKey(key) — Checks key exists and is active
 *   recordUsage(key) — Increments usage counter for the key
 *   handleWebhook(event) — Processes checkout.session.completed + subscription.deleted
 *
 * Local mode: When STRIPE_SECRET_KEY is not set, all Stripe calls are no-ops.
 * Keys stored in: .claude/memory/feedback/api-keys.json (gitignored)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const GITHUB_MARKETPLACE_WEBHOOK_SECRET = process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET || '';
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || '';

function getApiKeysPath() {
  return process.env._TEST_API_KEYS_PATH || path.resolve(
    __dirname,
    '../.claude/memory/feedback/api-keys.json'
  );
}

function getFunnelLedgerPath() {
  return process.env._TEST_FUNNEL_LEDGER_PATH || process.env.RLHF_FUNNEL_LEDGER_PATH || path.resolve(
    __dirname,
    '../.claude/memory/feedback/funnel-events.jsonl'
  );
}

function getLocalCheckoutSessionsPath() {
  return process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH || path.resolve(
    __dirname,
    '../.claude/memory/feedback/local-checkout-sessions.json'
  );
}

const LOCAL_MODE = !STRIPE_SECRET_KEY;

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
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }

  const normalized = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (v == null) continue;
    normalized[String(k)] = String(v);
  }
  return normalized;
}

function readInstallIdFromConfig({ cwd = process.cwd(), configPath } = {}) {
  const resolvedPath = configPath || path.resolve(cwd, '.rlhf/config.json');
  try {
    if (!fs.existsSync(resolvedPath)) {
      return null;
    }
    const parsed = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));
    if (!parsed || typeof parsed.installId !== 'string') {
      return null;
    }
    const installId = parsed.installId.trim();
    return installId || null;
  } catch {
    return null;
  }
}

function appendFunnelEvent({ stage, event, installId = null, evidence, metadata = {} } = {}) {
  if (!stage || !event) {
    return { written: false, reason: 'missing_stage_or_event' };
  }

  const payload = {
    timestamp: new Date().toISOString(),
    stage,
    event,
    evidence: evidence || event,
    installId: installId || null,
    metadata: sanitizeMetadata(metadata),
  };

  try {
    ensureParentDir(getFunnelLedgerPath());
    fs.appendFileSync(getFunnelLedgerPath(), `${JSON.stringify(payload)}\n`, 'utf-8');
    return { written: true, payload };
  } catch (err) {
    return {
      written: false,
      reason: 'write_failed',
      error: err && err.message ? err.message : 'unknown_error',
    };
  }
}

function loadFunnelLedger() {
  try {
    if (!fs.existsSync(getFunnelLedgerPath())) {
      return [];
    }

    const lines = fs
      .readFileSync(getFunnelLedgerPath(), 'utf-8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const events = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === 'object') {
          events.push(parsed);
        }
      } catch {
        // Ignore malformed lines to preserve append-only behavior.
      }
    }

    return events;
  } catch {
    return [];
  }
}

function loadLocalCheckoutSessions() {
  try {
    if (!fs.existsSync(getLocalCheckoutSessionsPath())) {
      return { sessions: {} };
    }

    const raw = fs.readFileSync(getLocalCheckoutSessionsPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.sessions !== 'object' || Array.isArray(parsed.sessions)) {
      return { sessions: {} };
    }

    return parsed;
  } catch {
    return { sessions: {} };
  }
}

function saveLocalCheckoutSessions(store) {
  ensureParentDir(getLocalCheckoutSessionsPath());
  fs.writeFileSync(getLocalCheckoutSessionsPath(), JSON.stringify(store, null, 2), 'utf-8');
}

function safeRate(numerator, denominator) {
  if (!denominator) {
    return 0;
  }
  return Number((numerator / denominator).toFixed(4));
}

function getFunnelAnalytics() {
  const events = loadFunnelLedger();
  const stageCounts = {
    acquisition: 0,
    activation: 0,
    paid: 0,
  };
  const eventCounts = {};

  for (const entry of events) {
    if (entry && typeof entry.stage === 'string') {
      if (Object.prototype.hasOwnProperty.call(stageCounts, entry.stage)) {
        stageCounts[entry.stage] += 1;
      }

      const eventName = typeof entry.event === 'string' ? entry.event : 'unknown';
      const key = `${entry.stage}:${eventName}`;
      eventCounts[key] = (eventCounts[key] || 0) + 1;
    }
  }

  return {
    totalEvents: events.length,
    stageCounts,
    eventCounts,
    conversionRates: {
      acquisitionToActivation: safeRate(stageCounts.activation, stageCounts.acquisition),
      activationToPaid: safeRate(stageCounts.paid, stageCounts.activation),
      acquisitionToPaid: safeRate(stageCounts.paid, stageCounts.acquisition),
    },
  };
}

// ---------------------------------------------------------------------------
// Key store helpers
// ---------------------------------------------------------------------------

/**
 * Load the API key store from disk.
 * Returns { keys: { [key]: { customerId, active, usageCount, createdAt } } }
 */
function loadKeyStore() {
  try {
    if (!fs.existsSync(getApiKeysPath())) {
      return { keys: {} };
    }
    const raw = fs.readFileSync(getApiKeysPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.keys !== 'object') {
      return { keys: {} };
    }
    return parsed;
  } catch {
    return { keys: {} };
  }
}

/**
 * Persist the key store to disk. Creates parent directory if needed.
 */
function saveKeyStore(store) {
  ensureParentDir(getApiKeysPath());
  fs.writeFileSync(getApiKeysPath(), JSON.stringify(store, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Stripe REST API helper
// ---------------------------------------------------------------------------

/**
 * Call the Stripe REST API using built-in fetch (Node 18+) or https module.
 * Returns parsed JSON response.
 * Throws on non-2xx responses with the Stripe error message.
 */
async function stripeRequest(method, endpoint, params = {}) {
  if (LOCAL_MODE) {
    throw new Error('STRIPE_SECRET_KEY not configured — local mode active');
  }

  const url = `https://api.stripe.com/v1${endpoint}`;

  // Stripe uses x-www-form-urlencoded for POST/DELETE bodies
  const body = method !== 'GET' && Object.keys(params).length > 0
    ? new URLSearchParams(flattenParams(params)).toString()
    : undefined;

  // For GET requests, add params as query string
  const fullUrl = method === 'GET' && Object.keys(params).length > 0
    ? `${url}?${new URLSearchParams(flattenParams(params)).toString()}`
    : url;

  const headers = {
    'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Stripe-Version': '2023-10-16',
  };

  // Use fetch if available (Node 18+), otherwise fall back to https module
  if (typeof fetch !== 'undefined') {
    const response = await fetch(fullUrl, {
      method,
      headers,
      body,
    });
    const json = await response.json();
    if (!response.ok) {
      const msg = (json.error && json.error.message) || `Stripe error ${response.status}`;
      const err = new Error(msg);
      err.stripeError = json.error;
      err.statusCode = response.status;
      throw err;
    }
    return json;
  }

  // Node <18 fallback via https module
  return new Promise((resolve, reject) => {
    const https = require('https');
    const urlObj = new URL(fullUrl);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: { ...headers },
    };
    if (body) {
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          if (res.statusCode >= 400) {
            const msg = (json.error && json.error.message) || `Stripe error ${res.statusCode}`;
            const err = new Error(msg);
            err.stripeError = json.error;
            err.statusCode = res.statusCode;
            reject(err);
          } else {
            resolve(json);
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Flatten nested objects into Stripe's dot-notation format.
 * e.g. { line_items: [{ price: 'p_123', quantity: 1 }] }
 *   => { 'line_items[0][price]': 'p_123', 'line_items[0][quantity]': '1' }
 */
function flattenParams(obj, prefix = '') {
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') {
          Object.assign(result, flattenParams(item, `${key}[${i}]`));
        } else {
          result[`${key}[${i}]`] = String(item);
        }
      });
    } else if (v !== null && typeof v === 'object') {
      Object.assign(result, flattenParams(v, key));
    } else if (v !== undefined && v !== null) {
      result[key] = String(v);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a Stripe Checkout Session for Cloud Pro.
 *
 * @param {object} opts
 * @param {string} opts.successUrl - Redirect URL on payment success
 * @param {string} opts.cancelUrl  - Redirect URL on cancel
 * @param {string} [opts.customerEmail] - Pre-fill customer email
 * @param {string} [opts.installId] - Correlation install id
 * @param {object} [opts.metadata] - Additional checkout metadata
 * @returns {Promise<{sessionId: string, url: string}>} in live mode
 *          or {sessionId: 'local_<uuid>', url: null} in local mode
 */
async function createCheckoutSession({ successUrl, cancelUrl, customerEmail, installId, metadata } = {}) {
  const resolvedInstallId = installId || readInstallIdFromConfig() || null;
  const checkoutMetadata = sanitizeMetadata({
    ...(metadata || {}),
    ...(resolvedInstallId ? { installId: resolvedInstallId } : {}),
  });

  if (LOCAL_MODE) {
    const localSessionId = `local_${crypto.randomUUID()}`;
    const localCustomerId = `local_customer_${localSessionId}`;
    const sessions = loadLocalCheckoutSessions();

    sessions.sessions[localSessionId] = {
      sessionId: localSessionId,
      customerId: localCustomerId,
      customerEmail: customerEmail || '',
      installId: resolvedInstallId,
      metadata: checkoutMetadata,
      createdAt: new Date().toISOString(),
      paymentStatus: 'paid',
      status: 'complete',
    };
    saveLocalCheckoutSessions(sessions);

    appendFunnelEvent({
      stage: 'acquisition',
      event: 'checkout_session_created',
      evidence: 'checkout_session_created',
      installId: resolvedInstallId,
      metadata: {
        provider: 'stripe',
        mode: 'local',
        sessionId: localSessionId,
        customerEmail: customerEmail || '',
      },
    });

    return {
      sessionId: localSessionId,
      url: null,
      localMode: true,
      metadata: checkoutMetadata,
    };
  }

  if (!STRIPE_PRICE_ID) {
    throw new Error('STRIPE_PRICE_ID not configured');
  }

  const params = {
    mode: 'subscription',
    line_items: [
      { price: STRIPE_PRICE_ID, quantity: 1 },
    ],
    success_url: successUrl || 'https://example.com/success?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: cancelUrl || 'https://example.com/cancel',
  };

  if (customerEmail) {
    params.customer_email = customerEmail;
  }

  if (Object.keys(checkoutMetadata).length > 0) {
    params.metadata = checkoutMetadata;
  }

  const session = await stripeRequest('POST', '/checkout/sessions', params);

  appendFunnelEvent({
    stage: 'acquisition',
    event: 'checkout_session_created',
    evidence: 'checkout_session_created',
    installId: resolvedInstallId,
    metadata: {
      provider: 'stripe',
      mode: 'live',
      sessionId: session.id,
      customerEmail: customerEmail || '',
    },
  });

  return {
    sessionId: session.id,
    url: session.url,
    metadata: checkoutMetadata,
  };
}

async function getCheckoutSessionStatus(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('sessionId is required');
  }

  if (LOCAL_MODE) {
    const store = loadLocalCheckoutSessions();
    const session = store.sessions[sessionId];

    if (!session) {
      return { found: false, localMode: true };
    }

    const provisioned = provisionApiKey(session.customerId, {
      installId: session.installId || null,
      source: 'local_checkout_session_lookup',
    });

    return {
      found: true,
      localMode: true,
      sessionId,
      paid: true,
      paymentStatus: session.paymentStatus || 'paid',
      customerId: session.customerId,
      customerEmail: session.customerEmail || '',
      installId: session.installId || null,
      apiKey: provisioned.key,
    };
  }

  const session = await stripeRequest('GET', `/checkout/sessions/${sessionId}`);
  const paymentStatus = session && typeof session.payment_status === 'string'
    ? session.payment_status
    : 'unknown';

  if (!session || paymentStatus !== 'paid') {
    return {
      found: Boolean(session),
      localMode: false,
      sessionId,
      paid: false,
      paymentStatus,
      status: session && typeof session.status === 'string' ? session.status : 'unknown',
    };
  }

  if (!session.customer || typeof session.customer !== 'string') {
    return {
      found: true,
      localMode: false,
      sessionId,
      paid: true,
      paymentStatus,
      customerId: null,
      customerEmail: '',
      installId: null,
      apiKey: null,
    };
  }

  const installId = session.metadata && typeof session.metadata.installId === 'string'
    ? session.metadata.installId
    : null;

  const provisioned = provisionApiKey(session.customer, {
    installId,
    source: 'stripe_checkout_session_lookup',
  });

  return {
    found: true,
    localMode: false,
    sessionId,
    paid: true,
    paymentStatus,
    customerId: session.customer,
    customerEmail: session.customer_details && typeof session.customer_details.email === 'string'
      ? session.customer_details.email
      : '',
    installId,
    apiKey: provisioned.key,
  };
}

/**
 * Provision a unique API key for a customer.
 * Stores { customerId, active: true, usageCount: 0, createdAt } in api-keys.json.
 *
 * @param {string} customerId - Stripe customer ID (e.g. cus_xxx)
 * @param {object} [opts]
 * @param {string} [opts.installId]
 * @param {string} [opts.source]
 * @returns {{ key: string, customerId: string, createdAt: string }}
 */
function provisionApiKey(customerId, opts = {}) {
  if (!customerId || typeof customerId !== 'string') {
    throw new Error('customerId is required');
  }

  const installId = opts.installId || null;
  const source = opts.source || 'provision';

  const store = loadKeyStore();

  // Check if this customer already has an active key — reuse it
  const existing = Object.entries(store.keys).find(
    ([, meta]) => meta.customerId === customerId && meta.active
  );

  if (existing) {
    if (installId && !existing[1].installId) {
      existing[1].installId = installId;
      saveKeyStore(store);
    }

    return {
      key: existing[0],
      customerId,
      createdAt: existing[1].createdAt,
      installId: existing[1].installId || null,
      reused: true,
    };
  }

  // Generate cryptographically random key: rlhf_<32 hex chars>
  const key = `rlhf_${crypto.randomBytes(16).toString('hex')}`;
  const createdAt = new Date().toISOString();

  store.keys[key] = {
    customerId,
    active: true,
    usageCount: 0,
    createdAt,
    installId,
    source,
  };

  saveKeyStore(store);

  return { key, customerId, createdAt, installId };
}

/**
 * Validate an API key.
 *
 * @param {string} key - API key to validate
 * @returns {{ valid: boolean, customerId?: string, usageCount?: number }}
 */
function validateApiKey(key) {
  if (!key || typeof key !== 'string') {
    return { valid: false };
  }

  const store = loadKeyStore();
  const meta = store.keys[key];

  if (!meta) {
    return { valid: false };
  }

  if (!meta.active) {
    return { valid: false, reason: 'key_disabled' };
  }

  return {
    valid: true,
    customerId: meta.customerId,
    usageCount: meta.usageCount,
    installId: meta.installId || null,
  };
}

/**
 * Record one usage event for an API key.
 * Increments usageCount in the key store.
 * Emits an activation event at first usage transition 0 -> 1.
 *
 * @param {string} key - API key to record usage for
 * @returns {{ recorded: boolean, usageCount?: number }}
 */
function recordUsage(key) {
  if (!key || typeof key !== 'string') {
    return { recorded: false };
  }

  const store = loadKeyStore();
  const meta = store.keys[key];

  if (!meta || !meta.active) {
    return { recorded: false };
  }

  const previousUsage = Number(meta.usageCount || 0);
  meta.usageCount = previousUsage + 1;
  saveKeyStore(store);

  if (previousUsage === 0) {
    appendFunnelEvent({
      stage: 'activation',
      event: 'api_key_first_usage',
      evidence: 'api_key_first_usage',
      installId: meta.installId || null,
      metadata: {
        customerId: meta.customerId,
        usageCount: '1',
      },
    });
  }

  return { recorded: true, usageCount: meta.usageCount };
}

/**
 * Rotate an API key for a customer.
 * Disables the old key (sets active: false, revokedAt: timestamp) and provisions a new one
 * for the same customerId + installId. The old key is preserved in the store for audit purposes.
 *
 * @param {string} oldKey - The current active API key to rotate
 * @returns {{ newKey: string, customerId: string, oldKey: string }}
 */
function rotateApiKey(oldKey) {
  if (!oldKey || typeof oldKey !== 'string') {
    return { rotated: false, reason: 'invalid_key' };
  }

  const store = loadKeyStore();
  const meta = store.keys[oldKey];

  if (!meta) {
    return { rotated: false, reason: 'key_not_found' };
  }

  if (!meta.active) {
    return { rotated: false, reason: 'key_already_disabled' };
  }

  const { customerId, installId } = meta;

  // Disable the old key (do not delete — preserve for audit)
  meta.active = false;
  meta.revokedAt = new Date().toISOString();
  saveKeyStore(store);

  // Provision a new key for the same customer (force new — old key is now inactive)
  const newKey = `rlhf_${require('crypto').randomBytes(16).toString('hex')}`;
  const createdAt = new Date().toISOString();

  const freshStore = loadKeyStore();
  freshStore.keys[newKey] = {
    customerId,
    active: true,
    usageCount: 0,
    createdAt,
    installId: installId || null,
    source: 'rotation',
  };
  saveKeyStore(freshStore);

  appendFunnelEvent({
    stage: 'paid',
    event: 'api_key_rotated',
    evidence: 'api_key_rotated',
    installId: installId || null,
    metadata: {
      customerId,
      oldKeyPrefix: oldKey.slice(0, 12),
      newKeyPrefix: newKey.slice(0, 12),
    },
  });

  return { rotated: true, newKey, customerId, oldKey };
}

/**
 * Disable all API keys for a customer (called on subscription cancellation).
 *
 * @param {string} customerId - Stripe customer ID
 * @returns {{ disabledCount: number }}
 */
function disableCustomerKeys(customerId) {
  if (!customerId || typeof customerId !== 'string') {
    return { disabledCount: 0 };
  }

  const store = loadKeyStore();
  let disabledCount = 0;

  for (const meta of Object.values(store.keys)) {
    if (meta.customerId === customerId && meta.active) {
      meta.active = false;
      disabledCount++;
    }
  }

  if (disabledCount > 0) {
    saveKeyStore(store);
  }

  return { disabledCount };
}

/**
 * Handle a Stripe webhook event.
 *
 * Supported events:
 *   checkout.session.completed — provision API key for the new customer
 *   customer.subscription.deleted — disable all keys for that customer
 *
 * @param {object} event - Parsed Stripe event object
 * @returns {{ handled: boolean, action?: string, result?: object }}
 */
function handleWebhook(event) {
  if (!event || !event.type) {
    return { handled: false, reason: 'missing_event_type' };
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data && event.data.object;
      if (!session) {
        return { handled: false, reason: 'missing_session_data' };
      }
      const customerId = session.customer;
      if (!customerId) {
        return { handled: false, reason: 'missing_customer_id' };
      }

      const installId = session.metadata && typeof session.metadata.installId === 'string'
        ? session.metadata.installId
        : null;

      const result = provisionApiKey(customerId, {
        installId,
        source: 'stripe_checkout_session_completed',
      });

      appendFunnelEvent({
        stage: 'paid',
        event: 'stripe_checkout_session_completed',
        evidence: 'stripe_checkout_session_completed',
        installId,
        metadata: {
          provider: 'stripe',
          customerId,
          checkoutSessionId: session.id || '',
        },
      });

      return {
        handled: true,
        action: 'provisioned_api_key',
        result,
      };
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data && event.data.object;
      if (!subscription) {
        return { handled: false, reason: 'missing_subscription_data' };
      }
      const customerId = subscription.customer;
      if (!customerId) {
        return { handled: false, reason: 'missing_customer_id' };
      }
      const result = disableCustomerKeys(customerId);
      return {
        handled: true,
        action: 'disabled_customer_keys',
        result,
      };
    }

    default:
      return { handled: false, reason: `unhandled_event_type:${event.type}` };
  }
}

/**
 * Verify a Stripe webhook signature.
 * Returns true if valid, false if STRIPE_WEBHOOK_SECRET is not set (local mode).
 *
 * @param {string|Buffer} rawBody - Raw request body bytes
 * @param {string} signature - Value of stripe-signature header
 * @returns {boolean}
 */
function verifyWebhookSignature(rawBody, signature) {
  if (!STRIPE_WEBHOOK_SECRET) {
    // Local mode — skip signature verification
    return true;
  }

  if (!signature || !rawBody) {
    return false;
  }

  // Stripe signature format: t=<timestamp>,v1=<hmac>,...
  const parts = {};
  for (const part of signature.split(',')) {
    const [k, v] = part.split('=');
    if (k && v) {
      parts[k] = v;
    }
  }

  if (!parts.t || !parts.v1) {
    return false;
  }

  // Timestamp tolerance: +/- 5 minutes (300 seconds)
  const timestamp = parseInt(parts.t, 10);
  const now = Math.floor(Date.now() / 1000);
  if (isNaN(timestamp) || Math.abs(now - timestamp) > 300) {
    return false;
  }

  const payload = `${parts.t}.${typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8')}`;
  const expected = crypto
    .createHmac('sha256', STRIPE_WEBHOOK_SECRET)
    .update(payload, 'utf-8')
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(parts.v1, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Verify a GitHub Marketplace webhook signature.
 * Returns true if valid, false if GITHUB_MARKETPLACE_WEBHOOK_SECRET is not set (local mode).
 *
 * @param {string|Buffer} rawBody - Raw request body bytes
 * @param {string} signature - Value of x-hub-signature-256 header
 * @returns {boolean}
 */
function verifyGithubWebhookSignature(rawBody, signature) {
  if (!GITHUB_MARKETPLACE_WEBHOOK_SECRET) {
    // Local mode — skip signature verification
    return true;
  }

  if (!signature || !rawBody) {
    return false;
  }

  const hmac = crypto.createHmac('sha256', GITHUB_MARKETPLACE_WEBHOOK_SECRET);
  const digest = Buffer.from(`sha256=${hmac.update(rawBody).digest('hex')}`, 'utf8');
  const checksum = Buffer.from(signature, 'utf8');

  return checksum.length === digest.length && crypto.timingSafeEqual(digest, checksum);
}

/**
 * Handle a GitHub Marketplace webhook event.
 *
 * Supported actions:
 *   purchased — provision API key for the new customer
 *   changed — plan update (upgrade/downgrade)
 *   cancelled — disable all keys for that customer
 *
 * @param {object} event - Parsed GitHub Marketplace event object
 * @returns {{ handled: boolean, action?: string, result?: object }}
 */
function handleGithubWebhook(event) {
  if (!event || typeof event !== 'object') {
    return { handled: false, reason: 'missing_payload_data' };
  }

  const { action, marketplace_purchase: marketplacePurchase } = event;
  if (!action || !marketplacePurchase) {
    return { handled: false, reason: 'missing_payload_data' };
  }

  const account = marketplacePurchase.account;
  if (!account || !account.id || !account.type) {
    return { handled: false, reason: 'missing_account_id' };
  }

  // Map GitHub account to customerId: github_<user|organization>_<id>
  const customerId = `github_${String(account.type).toLowerCase()}_${account.id}`;

  switch (action) {
    case 'purchased': {
      const result = provisionApiKey(customerId, { source: 'github_marketplace_purchased' });
      appendFunnelEvent({
        stage: 'paid',
        event: 'github_marketplace_purchased',
        evidence: 'github_marketplace_purchased',
        metadata: {
          provider: 'github',
          customerId,
          accountId: String(account.id),
          accountType: String(account.type),
        },
      });
      return {
        handled: true,
        action: 'provisioned_api_key',
        result,
      };
    }

    case 'cancelled': {
      const result = disableCustomerKeys(customerId);
      return {
        handled: true,
        action: 'disabled_customer_keys',
        result,
      };
    }

    case 'changed': {
      // Keep API access active on plan changes.
      const result = provisionApiKey(customerId, { source: 'github_marketplace_changed' });
      return {
        handled: true,
        action: 'plan_changed',
        result,
      };
    }

    default:
      return { handled: false, reason: `unhandled_action:${action}` };
  }
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

module.exports = {
  createCheckoutSession,
  getCheckoutSessionStatus,
  provisionApiKey,
  validateApiKey,
  recordUsage,
  rotateApiKey,
  disableCustomerKeys,
  handleWebhook,
  verifyWebhookSignature,
  verifyGithubWebhookSignature,
  handleGithubWebhook,
  loadKeyStore,
  appendFunnelEvent,
  loadFunnelLedger,
  getFunnelAnalytics,
  readInstallIdFromConfig,
  // Expose for testing
  _API_KEYS_PATH: getApiKeysPath(),
  _FUNNEL_LEDGER_PATH: getFunnelLedgerPath(),
  _LOCAL_CHECKOUT_SESSIONS_PATH: getLocalCheckoutSessionsPath(),
  _LOCAL_MODE: () => LOCAL_MODE,
};
