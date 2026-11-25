'use strict';

// AGENT-3667 item H, 25 Nov 2026. An outside report said live checkout pointed at an archived Stripe price.
// What the code actually does: subscription checkout sends inline `price_data`, so Stripe makes a new one-off
// price for every session (it reads active:false by design). The configured price ids (STRIPE_PRICE_ID_*) only
// travel as session metadata and are matched against paid invoices later. If one of those ids is archived, the
// metadata would name a price that no longer exists, so this module verifies each configured id against Stripe,
// keeps the answer for /health, and keeps a known-archived id out of the metadata.
const TTL_MS = 10 * 60 * 1000;

let lastResult = null;

function describePrice(name, id, price) {
  if (!price) return { name, id, ok: false, active: null, reason: 'not_found' };
  const active = price.active === true;
  return {
    name,
    id,
    ok: active,
    active,
    amount: Number.isFinite(price.unit_amount) ? price.unit_amount : null,
    currency: price.currency || null,
    interval: price.recurring ? price.recurring.interval : null,
    product: typeof price.product === 'string' ? price.product : (price.product && price.product.id) || null,
    ...(active ? {} : { reason: 'archived' }),
  };
}

/**
 * Look up every configured price id. `configured` is [{ name, id }]. Never throws: a Stripe error for one id is
 * reported on that id, so /health can show it.
 */
async function verifyCheckoutPrices({ stripe, configured, now = Date.now() }) {
  const seen = new Map();
  for (const { name, id } of configured) {
    if (!id) {
      seen.set(`${name}:`, { name, id: null, ok: false, active: null, reason: 'unset' });
      continue;
    }
    try {
      seen.set(`${name}:${id}`, describePrice(name, id, await stripe.prices.retrieve(id)));
    } catch (error) {
      const missing = error && (error.code === 'resource_missing' || error.statusCode === 404);
      seen.set(`${name}:${id}`, { name, id, ok: false, active: null, reason: missing ? 'not_found' : `lookup_failed:${(error && error.code) || 'error'}` });
    }
  }
  const prices = [...seen.values()];
  lastResult = { ok: prices.every((p) => p.ok), checkedAt: new Date(now).toISOString(), prices };
  return lastResult;
}

function getCheckoutPriceStatus() {
  return lastResult;
}

function isStale(now = Date.now()) {
  return !lastResult || now - Date.parse(lastResult.checkedAt) > TTL_MS;
}

// A configured id the last check found archived or missing must not be written into session metadata.
// An id that has not been checked yet passes: an unreachable Stripe lookup must never block a buyer.
function activePriceIdOrNull(id) {
  if (!id || !lastResult) return id || null;
  const known = lastResult.prices.find((p) => p.id === id);
  return known && known.ok === false && (known.reason === 'archived' || known.reason === 'not_found') ? null : id;
}

function resetCheckoutPriceStatus() {
  lastResult = null;
}

module.exports = { verifyCheckoutPrices, getCheckoutPriceStatus, activePriceIdOrNull, isStale, resetCheckoutPriceStatus, describePrice };
