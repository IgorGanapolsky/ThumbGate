'use strict';

const STRIPE_REVENUE_CATALOG_VERSION = 'thumbgate-stripe-revenue-catalog-v1';

// These immutable Stripe price/product pairs are the reviewed ThumbGate
// buyer rails. Product names are intentionally not evidence: the live $499
// diagnostic uses a generic product name and that same product also has a
// separate $999 price. Exact price + product + commercial terms prevent both
// false negatives and name/product lookalike attribution.
const DEFAULT_STRIPE_REVENUE_CATALOG = Object.freeze([
  Object.freeze({
    offerId: 'pro_monthly',
    priceId: 'price_1THQY7GGBpd520QYHoS7RG0J',
    productId: 'prod_UE7SR5NFBkumEp',
    unitAmountCents: 1900,
    currency: 'usd',
    cadence: 'month',
    intervalCount: 1,
    status: 'current',
    expectedPriceActive: true,
    expectedProductActive: true,
  }),
  Object.freeze({
    offerId: 'pro_annual',
    priceId: 'price_1THQZ7GGBpd520QYxzDRnxhB',
    productId: 'prod_UE7SR5NFBkumEp',
    unitAmountCents: 14900,
    currency: 'usd',
    cadence: 'year',
    intervalCount: 1,
    status: 'current',
    expectedPriceActive: true,
    expectedProductActive: true,
  }),
  Object.freeze({
    offerId: 'workflow_hardening_diagnostic',
    priceId: 'price_1TsO6kGGBpd520QYbbEgThb3',
    productId: 'prod_Us8Nf20z0bOb1g',
    unitAmountCents: 49900,
    currency: 'usd',
    cadence: 'one_time',
    intervalCount: null,
    status: 'current',
    expectedPriceActive: true,
    expectedProductActive: true,
  }),
  Object.freeze({
    offerId: 'team_monthly_legacy',
    priceId: 'price_1TMIagGGBpd520QY1fUOawZt',
    productId: 'prod_UIxPkrYI2OvDmW',
    unitAmountCents: 4900,
    currency: 'usd',
    cadence: 'month',
    intervalCount: 1,
    status: 'retired_existing_contracts_only',
    expectedPriceActive: true,
    expectedProductActive: false,
  }),
]);

function normalizeId(value) {
  return String(value || '').trim();
}

function normalizeCurrency(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePositiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function inspectStripePrice(price = {}) {
  const product = price?.product;
  const productId = typeof product === 'string'
    ? normalizeId(product)
    : normalizeId(product?.id);
  const recurring = price?.recurring || null;
  return {
    priceId: normalizeId(price?.id),
    productId,
    unitAmountCents: normalizePositiveInteger(price?.unit_amount),
    currency: normalizeCurrency(price?.currency),
    cadence: recurring ? normalizeId(recurring.interval).toLowerCase() : 'one_time',
    intervalCount: recurring ? normalizePositiveInteger(recurring.interval_count || 1) : null,
  };
}

function validateStripeRevenueCatalog(catalog = DEFAULT_STRIPE_REVENUE_CATALOG) {
  if (!Array.isArray(catalog) || catalog.length === 0) {
    return { ok: false, gap: 'Stripe revenue catalog must contain at least one exact offer identity.' };
  }
  const seenPrices = new Set();
  for (const entry of catalog) {
    const priceId = normalizeId(entry?.priceId);
    const productId = normalizeId(entry?.productId);
    const amount = normalizePositiveInteger(entry?.unitAmountCents);
    const currency = normalizeCurrency(entry?.currency);
    const cadence = normalizeId(entry?.cadence).toLowerCase();
    const intervalCount = cadence === 'one_time'
      ? null
      : normalizePositiveInteger(entry?.intervalCount || 1);
    if (!normalizeId(entry?.offerId) || !/^price_[A-Za-z0-9_]+$/.test(priceId)
      || !/^prod_[A-Za-z0-9_]+$/.test(productId) || !amount
      || !/^[a-z]{3}$/.test(currency)
      || !['one_time', 'day', 'week', 'month', 'year'].includes(cadence)
      || (cadence !== 'one_time' && !intervalCount)
      || typeof entry?.expectedPriceActive !== 'boolean'
      || typeof entry?.expectedProductActive !== 'boolean') {
      return { ok: false, gap: `Invalid Stripe revenue catalog entry for ${normalizeId(entry?.offerId) || 'unknown offer'}.` };
    }
    if (seenPrices.has(priceId)) {
      return { ok: false, gap: `Duplicate Stripe revenue catalog price: ${priceId}.` };
    }
    seenPrices.add(priceId);
  }
  return { ok: true, gap: null };
}

function matchStripeRevenueCatalogPrice(price = {}, catalog = DEFAULT_STRIPE_REVENUE_CATALOG) {
  const catalogValidation = validateStripeRevenueCatalog(catalog);
  if (!catalogValidation.ok) {
    return { matched: false, complete: false, reason: 'catalog_invalid', gap: catalogValidation.gap };
  }
  const observed = inspectStripePrice(price);
  if (!observed.priceId || !observed.productId || !observed.unitAmountCents
    || !observed.currency || !observed.cadence
    || (observed.cadence !== 'one_time' && !observed.intervalCount)) {
    return { matched: false, complete: false, reason: 'price_identity_incomplete', observed };
  }
  const entry = catalog.find((candidate) => candidate.priceId === observed.priceId);
  if (!entry) {
    return { matched: false, complete: true, reason: 'price_not_in_catalog', observed };
  }
  const expected = {
    priceId: entry.priceId,
    productId: entry.productId,
    unitAmountCents: entry.unitAmountCents,
    currency: normalizeCurrency(entry.currency),
    cadence: normalizeId(entry.cadence).toLowerCase(),
    intervalCount: entry.cadence === 'one_time' ? null : Number(entry.intervalCount || 1),
  };
  const matched = Object.keys(expected).every((key) => observed[key] === expected[key]);
  return {
    matched,
    complete: true,
    reason: matched ? 'exact_catalog_match' : 'catalog_terms_mismatch',
    offerId: matched ? entry.offerId : null,
    status: matched ? entry.status : null,
    observed,
  };
}

const defaultCatalogValidation = validateStripeRevenueCatalog(DEFAULT_STRIPE_REVENUE_CATALOG);
if (!defaultCatalogValidation.ok) throw new Error(defaultCatalogValidation.gap);

module.exports = {
  STRIPE_REVENUE_CATALOG_VERSION,
  DEFAULT_STRIPE_REVENUE_CATALOG,
  inspectStripePrice,
  validateStripeRevenueCatalog,
  matchStripeRevenueCatalogPrice,
};
