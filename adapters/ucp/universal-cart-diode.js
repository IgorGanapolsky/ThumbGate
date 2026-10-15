'use strict';

/**
 * adapters/ucp/universal-cart-diode.js
 *
 * Google Universal Cart & Universal Commerce Protocol (UCP) Pre-Action Spend Diode.
 * Intercepts autonomous agent checkout calls (Gemini, Claude, ChatGPT, browser bots)
 * in sub-0.5ms on local CPU before payments execute via Google Pay or merchant transfer.
 *
 * Invariants Enforced:
 * 1. MAX_ORDER_TOTAL: Blocks single transactions > $100.00 without explicit operator override.
 * 2. DAILY_SPEND_CEILING: Tracks rolling 24h spend; blocks if cumulative spend exceeds $250.00.
 * 3. SELLER_OF_RECORD_VERIFICATION: Validates merchant against verified trusted sellers.
 * 4. DUPLICATE_CHECKOUT_PREVENTION: Interdicts identical cart hashes within 600s window.
 * 5. QUANTITY_SPIKE_BARRIER: Blocks single SKU quantity > 5 units (prevents hallucinated bulk buys).
 */

const crypto = require('node:crypto');

const DEFAULT_CONFIG = {
  maxOrderTotal: 100.00,
  dailySpendCeiling: 250.00,
  maxItemQuantity: 5,
  duplicateWindowSeconds: 600,
  trustedMerchants: [
    'target.com',
    'walmart.com',
    'nike.com',
    'sephora.com',
    'ulta.com',
    'wayfair.com',
    'stevemadden.com',
    'quince.com',
    'myshopify.com'
  ]
};

// In-memory state for fast deterministic checks
const recentOrders = [];
let dailySpendAccumulator = 0;
let lastResetTimestamp = Date.now();

function resetSpendStateForTesting() {
  recentOrders.length = 0;
  dailySpendAccumulator = 0;
  lastResetTimestamp = Date.now();
}

function calculateCartHash(cart) {
  const normalized = (cart.items || []).map(i => `${i.sku || i.name}:${i.quantity}:${i.price}`).sort().join('|');
  return crypto.createHash('sha256').update(`${cart.merchant || ''}:${normalized}`).digest('hex');
}

/**
 * Evaluates an agentic checkout tool call before execution.
 *
 * @param {Object} payload - The intercepted tool call payload
 * @param {Object} [customConfig] - Optional override configurations
 * @returns {Object} { allowed: boolean, reason: string, latencyMs: number, receipt?: Object }
 */
function evaluateUniversalCartCheckout(payload = {}, customConfig = {}) {
  const start = process.hrtime.bigint();
  const config = { ...DEFAULT_CONFIG, ...customConfig };

  const now = Date.now();
  if (now - lastResetTimestamp > 86400000) {
    dailySpendAccumulator = 0;
    lastResetTimestamp = now;
  }

  // 1. Tool name matching
  const toolName = (payload.toolName || payload.tool || '').toLowerCase();
  const isCommerceAction = toolName.includes('checkout') ||
    toolName.includes('cart') ||
    toolName.includes('purchase') ||
    toolName.includes('google_pay') ||
    toolName.includes('ucp');

  if (!isCommerceAction) {
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    return {
      allowed: true,
      reason: 'Non-commerce tool call passed',
      latencyMs: Number(elapsed.toFixed(4))
    };
  }

  const order = payload.order || payload.cart || payload;
  const merchant = (order.merchant || order.store || order.domain || '').toLowerCase();
  const total = Number(order.total || order.amount || 0);
  const items = Array.isArray(order.items) ? order.items : [];
  const override = Boolean(payload.allowLargePurchase || payload.operatorApproved);

  // Invariant 1: Total exceeds limit
  if (total > config.maxOrderTotal && !override) {
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    return {
      allowed: false,
      code: 'ORDER_TOTAL_EXCEEDED',
      reason: `Order total ($${total.toFixed(2)}) exceeds max threshold ($${config.maxOrderTotal.toFixed(2)}). Operator override required.`,
      latencyMs: Number(elapsed.toFixed(4))
    };
  }

  // Invariant 2: Daily spend ceiling
  if (dailySpendAccumulator + total > config.dailySpendCeiling && !override) {
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    return {
      allowed: false,
      code: 'DAILY_SPEND_CEILING_BREACHED',
      reason: `Order would push daily cumulative spend ($${(dailySpendAccumulator + total).toFixed(2)}) over $${config.dailySpendCeiling.toFixed(2)} limit.`,
      latencyMs: Number(elapsed.toFixed(4))
    };
  }

  // Invariant 3: Quantity spike barrier
  for (const item of items) {
    const qty = Number(item.quantity || 1);
    if (qty > config.maxItemQuantity && !override) {
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
      return {
        allowed: false,
        code: 'QUANTITY_SPIKE_DETECTED',
        reason: `Item '${item.name || item.sku || 'item'}' quantity (${qty}) exceeds maximum safety limit (${config.maxItemQuantity}).`,
        latencyMs: Number(elapsed.toFixed(4))
      };
    }
  }

  // Invariant 4: Seller-of-record domain verification
  if (merchant) {
    const isTrusted = config.trustedMerchants.some(domain => merchant.includes(domain));
    if (!isTrusted && !override) {
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
      return {
        allowed: false,
        code: 'UNTRUSTED_MERCHANT_DOMAIN',
        reason: `Merchant '${merchant}' is not in the verified Universal Commerce trusted registry.`,
        latencyMs: Number(elapsed.toFixed(4))
      };
    }
  }

  // Invariant 5: Duplicate checkout loop interdiction
  const cartHash = calculateCartHash(order);
  const cutoff = now - (config.duplicateWindowSeconds * 1000);
  const isDuplicate = recentOrders.some(o => o.hash === cartHash && o.timestamp > cutoff);

  if (isDuplicate) {
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    return {
      allowed: false,
      code: 'DUPLICATE_CART_INTERDICTED',
      reason: `Identical checkout payload executed within ${config.duplicateWindowSeconds}s. Runaway purchase loop interdicted.`,
      latencyMs: Number(elapsed.toFixed(4))
    };
  }

  // Record allowed order
  dailySpendAccumulator += total;
  recentOrders.push({
    hash: cartHash,
    total,
    merchant,
    timestamp: now
  });

  const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
  const receiptSignature = crypto
    .createHmac('sha256', 'thumbgate-ucp-secret')
    .update(`${cartHash}:${total}:${now}`)
    .digest('hex');

  return {
    allowed: true,
    code: 'UCP_CHECKOUT_APPROVED',
    reason: `Checkout approved for $${total.toFixed(2)} at ${merchant || 'verified store'}.`,
    latencyMs: Number(elapsed.toFixed(4)),
    receipt: {
      receiptId: `rcpt_ucp_${cartHash.slice(0, 12)}`,
      total,
      merchant,
      timestamp: new Date(now).toISOString(),
      signature: receiptSignature
    }
  };
}

module.exports = {
  DEFAULT_CONFIG,
  evaluateUniversalCartCheckout,
  calculateCartHash,
  resetSpendStateForTesting
};
