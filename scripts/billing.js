#!/usr/bin/env node
/**
 * billing.js — Stripe billing integration using raw fetch (no stripe npm package).
 *
 * Functions:
 *   createCheckoutSession()  — Creates Stripe Checkout session for $49/mo Cloud Pro
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
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || 'price_cloud_pro_49_monthly';
const API_KEYS_PATH = process.env._TEST_API_KEYS_PATH || path.resolve(
  __dirname,
  '../.claude/memory/feedback/api-keys.json'
);

const LOCAL_MODE = !STRIPE_SECRET_KEY;

// ---------------------------------------------------------------------------
// Key store helpers
// ---------------------------------------------------------------------------

/**
 * Load the API key store from disk.
 * Returns { keys: { [key]: { customerId, active, usageCount, createdAt } } }
 */
function loadKeyStore() {
  try {
    if (!fs.existsSync(API_KEYS_PATH)) {
      return { keys: {} };
    }
    const raw = fs.readFileSync(API_KEYS_PATH, 'utf-8');
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
  const dir = path.dirname(API_KEYS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(API_KEYS_PATH, JSON.stringify(store, null, 2), 'utf-8');
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
 * Create a Stripe Checkout Session for $49/mo Cloud Pro.
 *
 * @param {object} opts
 * @param {string} opts.successUrl - Redirect URL on payment success
 * @param {string} opts.cancelUrl  - Redirect URL on cancel
 * @param {string} [opts.customerEmail] - Pre-fill customer email
 * @returns {Promise<{sessionId: string, url: string}>} in live mode
 *          or {sessionId: 'local_<uuid>', url: null} in local mode
 */
async function createCheckoutSession({ successUrl, cancelUrl, customerEmail } = {}) {
  if (LOCAL_MODE) {
    return {
      sessionId: `local_${crypto.randomUUID()}`,
      url: null,
      localMode: true,
    };
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

  const session = await stripeRequest('POST', '/checkout/sessions', params);
  return {
    sessionId: session.id,
    url: session.url,
  };
}

/**
 * Provision a unique API key for a Stripe customer.
 * Stores { customerId, active: true, usageCount: 0, createdAt } in api-keys.json.
 *
 * @param {string} customerId - Stripe customer ID (e.g. cus_xxx)
 * @returns {{ key: string, customerId: string, createdAt: string }}
 */
function provisionApiKey(customerId) {
  if (!customerId || typeof customerId !== 'string') {
    throw new Error('customerId is required');
  }

  const store = loadKeyStore();

  // Check if this customer already has an active key — reuse it
  const existing = Object.entries(store.keys).find(
    ([, meta]) => meta.customerId === customerId && meta.active
  );
  if (existing) {
    return {
      key: existing[0],
      customerId,
      createdAt: existing[1].createdAt,
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
  };

  saveKeyStore(store);

  return { key, customerId, createdAt };
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
  };
}

/**
 * Record one usage event for an API key.
 * Increments usageCount in the key store.
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

  meta.usageCount = (meta.usageCount || 0) + 1;
  saveKeyStore(store);

  return { recorded: true, usageCount: meta.usageCount };
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
      const result = provisionApiKey(customerId);
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
    if (k && v) parts[k] = v;
  }

  if (!parts.t || !parts.v1) {
    return false;
  }

  const payload = `${parts.t}.${typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8')}`;
  const expected = crypto
    .createHmac('sha256', STRIPE_WEBHOOK_SECRET)
    .update(payload, 'utf-8')
    .digest('hex');

  // Constant-time comparison
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
  const digest = Buffer.from('sha256=' + hmac.update(rawBody).digest('hex'), 'utf8');
  const checksum = Buffer.from(signature, 'utf8');

  // Constant-time comparison
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
  const { action, marketplace_purchase } = event;
  if (!action || !marketplace_purchase) {
  return { handled: false, reason: 'missing_payload_data' };
  }

  const account = marketplace_purchase.account;
  if (!account || !account.id) {
  return { handled: false, reason: 'missing_account_id' };
  }

  // Map GitHub account to customerId: github_<user|organization>_<id>
  const customerId = `github_${account.type.toLowerCase()}_${account.id}`;

  switch (action) {
  case 'purchased': {
    const result = provisionApiKey(customerId);
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
    // In this simple model, we just ensure a key exists and is active.
    // Upgrades/downgrades don't change basic API access unless we had tiered features.
    const result = provisionApiKey(customerId);
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
  provisionApiKey,
  validateApiKey,
  recordUsage,
  disableCustomerKeys,
  handleWebhook,
  verifyWebhookSignature,
  verifyGithubWebhookSignature,
  handleGithubWebhook,
  loadKeyStore,
  // Expose for testing
  _API_KEYS_PATH: API_KEYS_PATH,
  _LOCAL_MODE: () => LOCAL_MODE,
  };

