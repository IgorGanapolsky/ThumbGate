#!/usr/bin/env node
'use strict';

/**
 * scripts/ucp-agentic-checkout-diode.js
 *
 * ThumbGate Pre-Action Firewall for Google Universal Cart & Universal Commerce Protocol (UCP),
 * Shopify Checkout, and Stripe Agentic Commerce tool calls (<0.5ms on local CPU).
 *
 * Protects autonomous procurement, B2B purchasing, and e-commerce AI agents against:
 *   1. Multi-Merchant Cart Spend Overruns (`gate:ucp:multi_merchant_spend_cap`)
 *   2. Cart-to-Checkout Price Surge / SKU Drift (`gate:ucp:price_drift_and_sku_lock`)
 *   3. Duplicate Multi-Retailer Order Retries (`gate:ucp:idempotent_checkout_fence`)
 *   4. Unverified Seller-of-Record / Redirect Spoofing (`gate:ucp:seller_of_record_allowlist`)
 */

const crypto = require('node:crypto');

const DEFAULT_POLICY = {
  maxCartTotalCents: 50000, // $500.00 default autonomous cart cap
  maxSingleMerchantCents: 25000, // $250.00 per merchant cap
  maxPriceDriftBps: 0, // 0 bps tolerance: checkout price cannot exceed quoted cart price
  allowedSellersOfRecord: [
    'shopify',
    'target.com',
    'walmart.com',
    'wayfair.com',
    'nike.com',
    'sephora.com',
    'ulta.com',
    'quince.com',
    'stevemadden.com',
    'stripe',
  ],
};

function computeCartExecutionHash(cartPayload = {}) {
  const items = Array.isArray(cartPayload.items) ? cartPayload.items : [];
  const canonicalItems = items
    .map(i => `${String(i.merchant || '').toLowerCase()}:${i.sku}:${Number(i.quantity || 1)}:${Number(i.unitPriceCents || 0)}`)
    .sort()
    .join('|');
  const raw = `${cartPayload.cartId || 'ucp_cart'}::${canonicalItems}::${cartPayload.paymentInstrument || 'default'}`;
  return `ucp_${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32)}`;
}

/**
 * Evaluate a proposed UCP / Universal Cart / Shopify / Stripe checkout tool call in <0.5ms.
 */
function evaluateUcpCheckoutGate({
  toolName = 'ucp_checkout_execute',
  cartPayload = {},
  quotedSnapshot = null,
  executedOrderHashes = new Set(),
  policy = DEFAULT_POLICY,
} = {}) {
  const startNs = process.hrtime.bigint();
  const mergedPolicy = { ...DEFAULT_POLICY, ...policy };
  const items = Array.isArray(cartPayload.items) ? cartPayload.items : [];

  let decision = 'allow';
  let gateId = 'gate:ucp:verified_checkout';
  let reason = 'Universal Cart (UCP) multi-merchant checkout verified within spend, seller, and SKU bounds';

  const executionHash = computeCartExecutionHash(cartPayload);

  // 1. Idempotent Checkout Fence (prevent double-ordering across retailers on retry)
  if (executedOrderHashes instanceof Set && executedOrderHashes.has(executionHash)) {
    decision = 'block';
    gateId = 'gate:ucp:idempotent_checkout_fence';
    reason = `Duplicate UCP checkout blocked: execution hash ${executionHash} already settled`;
  }

  // 2. Seller-of-Record Allowlist (prevent prompt-injected merchant redirect)
  if (decision === 'allow') {
    const allowedSet = new Set((mergedPolicy.allowedSellersOfRecord || []).map(s => s.toLowerCase()));
    for (const item of items) {
      const seller = String(item.sellerOfRecord || item.merchant || '').toLowerCase().trim();
      const isAllowedSeller = allowedSet.has(seller) || Array.from(allowedSet).some(a => seller.endsWith('.' + a) || seller.startsWith(a + ':'));
      if (!seller || !isAllowedSeller) {
        decision = 'block';
        gateId = 'gate:ucp:seller_of_record_allowlist';
        reason = `Unverified seller of record '${item.sellerOfRecord || item.merchant || 'unknown'}' blocked before Google Pay / UCP transfer`;
        break;
      }
    }
  }

  // 3. Cart-to-Checkout Price Surge & SKU Lock
  if (decision === 'allow' && quotedSnapshot && Array.isArray(quotedSnapshot.items)) {
    const quoteMap = new Map(quotedSnapshot.items.map(q => [`${String(q.merchant || '').toLowerCase()}:${q.sku}`, q]));
    for (const item of items) {
      const key = `${String(item.merchant || '').toLowerCase()}:${item.sku}`;
      const quoted = quoteMap.get(key);
      if (!quoted) {
        decision = 'block';
        gateId = 'gate:ucp:price_drift_and_sku_lock';
        reason = `Unquoted SKU '${item.sku}' (${item.merchant}) injected into UCP cart without user quote approval`;
        break;
      }
      const maxAllowedPrice = Number(quoted.unitPriceCents) * (1 + Number(mergedPolicy.maxPriceDriftBps || 0) / 10000);
      if (Number(item.unitPriceCents) > maxAllowedPrice) {
        decision = 'block';
        gateId = 'gate:ucp:price_drift_and_sku_lock';
        reason = `Price surge detected on SKU '${item.sku}' (${item.merchant}): quoted ${quoted.unitPriceCents}c vs checkout ${item.unitPriceCents}c`;
        break;
      }
    }
  }

  // 4. Multi-Merchant & Aggregate Cart Spend Ceiling
  let totalCartCents = 0;
  const merchantTotals = {};
  for (const item of items) {
    const lineCents = Math.round(Number(item.unitPriceCents || 0) * Number(item.quantity || 1));
    totalCartCents += lineCents;
    const m = String(item.merchant || 'unknown').toLowerCase();
    merchantTotals[m] = (merchantTotals[m] || 0) + lineCents;
  }

  if (decision === 'allow') {
    for (const [merchant, cents] of Object.entries(merchantTotals)) {
      if (cents > mergedPolicy.maxSingleMerchantCents) {
        decision = 'block';
        gateId = 'gate:ucp:multi_merchant_spend_cap';
        reason = `Single-merchant spend for '${merchant}' ($${(cents / 100).toFixed(2)}) exceeds cap ($${(mergedPolicy.maxSingleMerchantCents / 100).toFixed(2)})`;
        break;
      }
    }
  }

  if (decision === 'allow' && totalCartCents > mergedPolicy.maxCartTotalCents) {
    decision = 'block';
    gateId = 'gate:ucp:multi_merchant_spend_cap';
    reason = `Aggregate UCP Universal Cart total ($${(totalCartCents / 100).toFixed(2)}) exceeds autonomous budget ceiling ($${(mergedPolicy.maxCartTotalCents / 100).toFixed(2)})`;
  }

  if (decision === 'allow' && executedOrderHashes instanceof Set) {
    executedOrderHashes.add(executionHash);
  }

  const latencyMs = Number((Number(process.hrtime.bigint() - startNs) / 1e6).toFixed(3));
  return {
    toolName,
    decision,
    allowed: decision === 'allow',
    gateId,
    latencyMs,
    totalCartCents,
    merchantCount: Object.keys(merchantTotals).length,
    executionHash,
    reason,
  };
}

if (require.main === module) {
  const executed = new Set();
  const quote = {
    items: [
      { merchant: 'shopify:quince.com', sku: 'cashmere-crew-m', quantity: 1, unitPriceCents: 5000 },
      { merchant: 'ulta.com', sku: 'lip-oil-01', quantity: 2, unitPriceCents: 2400 },
    ],
  };
  const validPass = evaluateUcpCheckoutGate({
    cartPayload: { cartId: 'ucp_holiday_01', items: quote.items, paymentInstrument: 'google_pay_visa_5302' },
    quotedSnapshot: quote,
    executedOrderHashes: executed,
  });
  const retryBlock = evaluateUcpCheckoutGate({
    cartPayload: { cartId: 'ucp_holiday_01', items: quote.items, paymentInstrument: 'google_pay_visa_5302' },
    quotedSnapshot: quote,
    executedOrderHashes: executed,
  });
  const overrunBlock = evaluateUcpCheckoutGate({
    cartPayload: {
      cartId: 'ucp_holiday_02',
      items: [{ merchant: 'wayfair.com', sku: 'sectional-sofa', quantity: 2, unitPriceCents: 180000 }],
    },
    executedOrderHashes: executed,
  });
  console.log(JSON.stringify({ validPass, retryBlock, overrunBlock }, null, 2));
}

module.exports = {
  DEFAULT_POLICY,
  computeCartExecutionHash,
  evaluateUcpCheckoutGate,
};
