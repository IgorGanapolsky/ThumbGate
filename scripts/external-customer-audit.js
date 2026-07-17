#!/usr/bin/env node
/**
 * external-customer-audit.js — reconcile known non-owner Stripe activity.
 *
 * Background. The unified revenue rollup ships raw Stripe totals: lifetime
 * net, MRR, active subscription count. Those numbers include the owner's
 * own purchases and subscriptions. On a small operator-run product that
 * inflates the apparent customer base — the difference between "1 active
 * sub" and "0 real customers" is whether the operator subscribed to their
 * own product to test billing.
 *
 * This script splits Stripe activity by owner-vs-external email and reports
 * the external-only counts. Owner emails are configured via the
 * THUMBGATE_OWNER_EMAILS env var (comma-separated, case-insensitive). Defaults
 * to the THUMBGATE_TRIAL_EMAIL_REPLY_TO support address used elsewhere.
 *
 * Runs in CI under the Daily Revenue Loop alongside the existing Stripe
 * audit, so we can compare raw vs external-only counts.
 *
 * Usage:
 *   node scripts/external-customer-audit.js
 *   node scripts/external-customer-audit.js --json
 *   node scripts/external-customer-audit.js --strict   # exit 2 if 0 known non-owner paying identities
 *
 * Env:
 *   STRIPE_SECRET_KEY        preferred; managed local key files are fallback
 *   THUMBGATE_OWNER_EMAILS   comma-separated owner emails to exclude
 *                            (default: iganapolsky@gmail.com,igor.ganapolsky@gmail.com)
 */

'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const {
  DEFAULT_SECRET_PATHS,
  readSecretFile,
  resolveStripeSecretKey,
} = require('./stripe-credentials');
const { eventOccursInWindow, formatLocalDate, resolveAnalyticsWindow } = require('./analytics-window');
const { digestBuyerEmail } = require('./provider-revenue-evidence');
const {
  STRIPE_REVENUE_CATALOG_VERSION,
  DEFAULT_STRIPE_REVENUE_CATALOG,
  validateStripeRevenueCatalog,
  matchStripeRevenueCatalogPrice,
} = require('./stripe-revenue-catalog');

function parseArgs(argv = []) {
  return {
    json: argv.includes('--json'),
    strict: argv.includes('--strict'),
  };
}

function parseOwnerEmails(env = process.env) {
  const raw = env.THUMBGATE_OWNER_EMAILS;
  if (raw?.trim()) {
    return raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  }
  return [
    'iganapolsky@gmail.com',
    'igor.ganapolsky@gmail.com',
  ];
}

function isOwnerEmail(email, ownerEmails) {
  if (!email) return false;
  return ownerEmails.includes(String(email).toLowerCase().trim());
}

function classifyEmail(email, ownerEmails) {
  if (!String(email || '').trim()) return 'unknown';
  return isOwnerEmail(email, ownerEmails) ? 'owner' : 'external';
}

function dollars(cents) {
  return Number(cents || 0) / 100;
}

function loadStripe(requireFn = require) {
  return requireFn('stripe');
}

// Stripe's cursor pagination has no hard stop — we iterate until `has_more`
// is false. The optional `max` is a runaway-guard only; default 100,000
// (well above any sane lifetime list for this product) so the audit never
// silently truncates real data the way an earlier 1000-cap did. Tests can
// pass a small max to exercise truncation behavior explicitly.
async function listAllPaged(listFn, params = {}, max = 100000) {
  const out = [];
  let startingAfter;
  while (out.length < max) {
    const page = await listFn({ ...params, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
    if (!page?.data) break;
    if (page.data.length === 0) break;
    for (const row of page.data) {
      out.push(row);
      if (out.length >= max) return out;
    }
    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return out;
}

function emailOfCustomer(obj) {
  if (!obj || typeof obj === 'string') return null;
  if (obj.email) return obj.email;
  if (obj.customer && typeof obj.customer === 'object') return obj.customer.email || null;
  return null;
}

function chargeEmail(charge) {
  return emailOfCustomer(charge) || charge.billing_details?.email || null;
}

function sessionEmail(session) {
  return session.customer_email || session.customer_details?.email || null;
}

function paymentIntentId(value) {
  const paymentIntent = value?.payment_intent;
  return typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id || null;
}

function productReference(value) {
  if (!value) return { known: false, id: null, name: null };
  if (typeof value === 'string') return { known: false, id: value, name: null };
  return {
    known: Boolean(String(value.name || '').trim()),
    id: value.id || null,
    name: String(value.name || '').trim() || null,
  };
}

function isThumbGateProductName(value) {
  return String(value || '').toLowerCase().includes('thumbgate');
}

function subscriptionPriceReferences(subscription = {}) {
  const items = subscription.items?.data || [];
  if (items.length) return items.map((item) => item.price || {}).filter(Boolean);
  return [subscription.plan || subscription.price].filter(Boolean);
}

function partitionCharges(rows, ownerEmails) {
  const result = { all: [], owner: [], external: [], unknown: [] };
  for (const ch of rows) {
    const bucket = classifyEmail(chargeEmail(ch), ownerEmails);
    result.all.push(ch);
    result[bucket].push(ch);
  }
  return result;
}

function summarizeCharges(rows) {
  const gross = rows.reduce((s, c) => s + (c.amount || 0), 0);
  const refunded = rows.reduce((s, c) => s + (c.amount_refunded || 0), 0);
  const netByEmail = new Map();
  for (const charge of rows) {
    const email = String(chargeEmail(charge) || '').toLowerCase().trim();
    if (!email) continue;
    const net = Number(charge.amount || 0) - Number(charge.amount_refunded || 0);
    netByEmail.set(email, (netByEmail.get(email) || 0) + net);
  }
  return {
    chargeCount: rows.length,
    netPositiveChargeCount: rows.filter((charge) => (
      Number(charge.amount || 0) - Number(charge.amount_refunded || 0) > 0
    )).length,
    identifiedCustomerCount: netByEmail.size,
    uniqueCustomerCount: [...netByEmail.values()].filter((net) => net > 0).length,
    grossCents: gross,
    refundedCents: refunded,
    netCents: gross - refunded,
    gross: dollars(gross),
    net: dollars(gross - refunded),
  };
}

function monthlyRecurringCents(price = {}) {
  const amount = Number(price.unit_amount ?? price.amount ?? 0);
  const intervalCount = Math.max(1, Number(price.recurring?.interval_count ?? price.interval_count ?? 1));
  const interval = price.recurring?.interval ?? price.interval;
  if (interval === 'year') return amount / (12 * intervalCount);
  if (interval === 'week') return amount * 52 / (12 * intervalCount);
  if (interval === 'day') return amount * 365 / (12 * intervalCount);
  if (interval === 'month') return amount / intervalCount;
  return amount;
}

function subscriptionMRRCents(subscription = {}) {
  const items = subscription.items?.data || [];
  if (items.length) {
    return items.reduce((sum, item) => (
      sum + monthlyRecurringCents(item.price || {}) * Math.max(1, Number(item.quantity || 1))
    ), 0);
  }
  return monthlyRecurringCents(subscription.plan || subscription.price || {});
}

function stripeCreatedIso(value = {}) {
  const createdSeconds = Number(value.created);
  if (!Number.isFinite(createdSeconds) || createdSeconds <= 0) return null;
  return new Date(createdSeconds * 1000).toISOString();
}

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(String(value || '')).digest('hex')}`;
}

function buildStripeIndividualPaymentEvidence(charges = [], contexts = new Map(), {
  now,
  timeZone = 'UTC',
} = {}) {
  const nowDate = new Date(now || new Date().toISOString());
  if (Number.isNaN(nowDate.getTime())) {
    return {
      verified: false,
      gap: 'Stripe individual-payment evidence requires a valid audit timestamp.',
      payments: [],
      states: [],
    };
  }
  const ids = new Set();
  const states = [];
  for (const charge of charges) {
    const id = String(charge?.id || '').trim();
    const createdAt = new Date(String(stripeCreatedIso(charge) || ''));
    const grossCents = Number(charge?.amount);
    const refundedCents = Number(charge?.amount_refunded || 0);
    const currency = String(charge?.currency || 'usd').trim().toLowerCase();
    const payerEmail = String(chargeEmail(charge) || '').trim().toLowerCase();
    const context = contexts.get(id) || {};
    const sessionIds = [...(context.sessionIds || [])].sort();
    const productIds = [...(context.productIds || [])].sort();
    const priceIds = [...(context.priceIds || [])].sort();
    const offerIds = [...(context.offerIds || [])].sort();
    const buyerEmailDigest = digestBuyerEmail(payerEmail);
    if (!id || ids.has(id) || Number.isNaN(createdAt.getTime()) ||
        createdAt.getTime() > nowDate.getTime() + 5 * 60 * 1000 ||
        !Number.isSafeInteger(grossCents) || grossCents <= 0 ||
        !Number.isSafeInteger(refundedCents) || refundedCents < 0 || refundedCents > grossCents ||
        currency !== 'usd' || !buyerEmailDigest || sessionIds.length === 0 || productIds.length === 0 ||
        priceIds.length === 0 || offerIds.length === 0) {
      return {
        verified: false,
        gap: `Stripe individual-payment candidate ${id || 'unknown'} is malformed or lacks exact product, payer, or checkout evidence.`,
        payments: [],
        states: [],
      };
    }
    ids.add(id);
    const netCents = grossCents - refundedCents;
    const status = netCents === 0
      ? 'refunded'
      : refundedCents > 0 ? 'partially_refunded' : 'completed';
    const customerId = sha256(`stripe-payer:${payerEmail}`);
    const invoiceId = String(charge?.invoice?.id || charge?.invoice || '').trim().slice(0, 127) || null;
    const evidenceRecord = {
      provider: 'stripe',
      id,
      createdAt: createdAt.toISOString(),
      status,
      grossCents,
      refundedCents,
      netCents,
      currency,
      customerId,
      buyerEmailDigest,
      paymentIntentId: String(charge?.payment_intent?.id || charge?.payment_intent || '').trim() || null,
      invoiceId,
      sessionIds,
      productIds,
      priceIds,
      offerIds,
      catalogVersion: STRIPE_REVENUE_CATALOG_VERSION,
    };
    const localDate = formatLocalDate(createdAt, timeZone);
    const state = {
      provider: 'stripe',
      id,
      createdAt: createdAt.toISOString(),
      localDate,
      timeZone,
      isToday: localDate === formatLocalDate(nowDate, timeZone),
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
      catalogVersion: STRIPE_REVENUE_CATALOG_VERSION,
      offerIds,
      evidenceVerified: true,
      evidenceSource: 'provider_api_live:stripe-checkout-product-reconciliation',
      evidenceDigest: sha256(JSON.stringify(evidenceRecord)),
      ...(invoiceId ? { invoiceId } : {}),
    };
    states.push(state);
  }
  return {
    verified: true,
    gap: null,
    payments: states.filter((payment) => payment.netCents > 0),
    states,
  };
}

function localDateRange(startLocalDate, endLocalDate) {
  const dates = [];
  const cursor = new Date(`${startLocalDate}T00:00:00.000Z`);
  const end = new Date(`${endLocalDate}T00:00:00.000Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function summarizeAttributedRevenueWindows(charges = [], { now, timeZone = 'UTC' } = {}) {
  const today = resolveAnalyticsWindow({ window: 'today', now, timeZone });
  const trailing30Days = resolveAnalyticsWindow({ window: '30d', now, timeZone });
  let missingCreatedAtCount = 0;
  let todayGrossRevenueCents = 0;
  let todayNetRevenueCents = 0;
  let trailing30DayGrossRevenueCents = 0;
  let trailing30DayNetRevenueCents = 0;
  const dailyGrossRevenueCents = Object.fromEntries(
    localDateRange(trailing30Days.startLocalDate, trailing30Days.endLocalDate)
      .map((localDate) => [localDate, 0])
  );
  const dailyNetRevenueCents = Object.fromEntries(
    Object.keys(dailyGrossRevenueCents).map((localDate) => [localDate, 0])
  );

  for (const charge of charges) {
    const createdAt = stripeCreatedIso(charge);
    if (!createdAt) {
      missingCreatedAtCount += 1;
      continue;
    }
    const grossCents = Number(charge.amount || 0);
    const netCents = grossCents - Number(charge.amount_refunded || 0);
    if (eventOccursInWindow(createdAt, today)) {
      todayGrossRevenueCents += grossCents;
      todayNetRevenueCents += netCents;
    }
    if (eventOccursInWindow(createdAt, trailing30Days)) {
      trailing30DayGrossRevenueCents += grossCents;
      trailing30DayNetRevenueCents += netCents;
      const localDate = formatLocalDate(new Date(createdAt), trailing30Days.timeZone);
      dailyGrossRevenueCents[localDate] += grossCents;
      dailyNetRevenueCents[localDate] += netCents;
    }
  }

  return {
    verified: missingCreatedAtCount === 0,
    gap: missingCreatedAtCount === 0
      ? null
      : `${missingCreatedAtCount} attributed charge(s) lacked Stripe created timestamps, so time-window revenue is incomplete.`,
    basis: 'Stripe charge created time with current charge-level refund totals; this is charge-cohort revenue, not balance-transaction cash-flow timing.',
    timeZone: today.timeZone,
    asOf: today.now,
    todayLocalDate: today.endLocalDate,
    trailing30DayStartLocalDate: trailing30Days.startLocalDate,
    missingCreatedAtCount,
    todayGrossRevenueCents,
    todayNetRevenueCents,
    trailing30DayGrossRevenueCents,
    trailing30DayNetRevenueCents,
    dailyGrossRevenueCents,
    dailyNetRevenueCents,
  };
}

function subsMRR(rows) {
  return rows.reduce((sum, subscription) => sum + subscriptionMRRCents(subscription), 0);
}

async function buildProductAttribution({
  stripe,
  sessions,
  successfulCharges,
  externalSubs,
  ownerEmails,
  accountExternalNetCents,
  now,
  timeZone = 'UTC',
  productCatalog = DEFAULT_STRIPE_REVENUE_CATALOG,
}) {
  const catalogValidation = validateStripeRevenueCatalog(productCatalog);
  if (!catalogValidation.ok) {
    return {
      verified: false,
      scope: 'stripe_revenue_catalog_invalid',
      gap: catalogValidation.gap,
      thumbgate: {
        uniquePayingCustomerCount: 0,
        netRevenueCents: 0,
        activeSubscriptionCount: 0,
        mrrCents: 0,
        revenueWindows: summarizeAttributedRevenueWindows([], { now, timeZone }),
        individualPaymentEvidenceVerified: false,
        individualPaymentEvidenceGap: catalogValidation.gap,
        individualPayments: [],
        individualPaymentStates: [],
      },
      paidExternalSessionCount: 0,
      zeroAmountPaidStatusSessionCount: 0,
      auditedPaidExternalSessionCount: 0,
      identityConflictCount: 0,
      unresolvedSessionCount: 0,
      unresolvedReasons: {
        lineItemFetchFailed: 0,
        productIdentityUnavailable: 0,
        catalogTermsMismatch: 0,
        paymentIntentMissing: 0,
        chargeNotFound: 0,
        payerIdentityConflict: 0,
        mixedProductSession: 0,
      },
      unresolvedSubscriptionCount: 0,
      mixedProductSubscriptionCount: 0,
      catalogTermsMismatchCount: 0,
      unmatchedExternalNetCents: accountExternalNetCents,
      catalogVersion: STRIPE_REVENUE_CATALOG_VERSION,
    };
  }
  const zeroAmountPaidStatusSessions = sessions.filter((session) => (
    session.payment_status === 'paid' && Number(session.amount_total || 0) <= 0
  ));
  const paidExternalSessions = sessions.filter((session) => (
    session.payment_status === 'paid' &&
    Number(session.amount_total || 0) > 0 &&
    classifyEmail(sessionEmail(session), ownerEmails) === 'external'
  ));
  const lineItemsApi = stripe?.checkout?.sessions?.listLineItems;
  if (paidExternalSessions.length && typeof lineItemsApi !== 'function') {
    return {
      verified: false,
      scope: 'stripe_account_wide',
      gap: 'Paid known non-owner sessions exist, but Stripe line-item access is unavailable for ThumbGate product attribution.',
      thumbgate: {
        uniquePayingCustomerCount: 0,
        netRevenueCents: 0,
        activeSubscriptionCount: 0,
        mrrCents: 0,
        revenueWindows: summarizeAttributedRevenueWindows([], { now, timeZone }),
      },
      paidExternalSessionCount: paidExternalSessions.length,
      zeroAmountPaidStatusSessionCount: zeroAmountPaidStatusSessions.length,
      auditedPaidExternalSessionCount: 0,
      identityConflictCount: 0,
      unresolvedSessionCount: paidExternalSessions.length,
      unmatchedExternalNetCents: accountExternalNetCents,
      catalogVersion: STRIPE_REVENUE_CATALOG_VERSION,
    };
  }

  const successfulChargesByPaymentIntent = new Map();
  for (const charge of successfulCharges) {
    const id = paymentIntentId(charge);
    if (!id) continue;
    const matches = successfulChargesByPaymentIntent.get(id) || [];
    matches.push(charge);
    successfulChargesByPaymentIntent.set(id, matches);
  }

  const attributedPayingEmails = new Set();
  const reconciledExternalChargeIds = new Set();
  const attributedThumbGateCharges = new Map();
  const attributedThumbGateContexts = new Map();
  let auditedPaidExternalSessionCount = 0;
  let identityConflictCount = 0;
  let unresolvedSessionCount = 0;
  let lineItemErrorCount = 0;
  let catalogTermsMismatchCount = 0;
  const unresolvedReasons = {
    lineItemFetchFailed: 0,
    productIdentityUnavailable: 0,
    catalogTermsMismatch: 0,
    paymentIntentMissing: 0,
    chargeNotFound: 0,
    payerIdentityConflict: 0,
    mixedProductSession: 0,
  };

  for (const session of paidExternalSessions) {
    let lineItems;
    try {
      lineItems = await listAllPaged(
        (params) => lineItemsApi.call(stripe.checkout.sessions, session.id, params),
        { expand: ['data.price.product'] },
        1000
      );
      auditedPaidExternalSessionCount += 1;
    } catch {
      lineItemErrorCount += 1;
      unresolvedSessionCount += 1;
      unresolvedReasons.lineItemFetchFailed += 1;
      continue;
    }

    const catalogMatches = lineItems.map((item) => matchStripeRevenueCatalogPrice(item.price, productCatalog));
    if (catalogMatches.some((match) => match.reason === 'catalog_terms_mismatch')) {
      unresolvedSessionCount += 1;
      catalogTermsMismatchCount += 1;
      unresolvedReasons.catalogTermsMismatch += 1;
      continue;
    }
    const productsKnown = catalogMatches.length > 0 && catalogMatches.every((match) => match.complete);
    const allThumbGate = productsKnown && catalogMatches.every((match) => match.matched);
    const intentId = paymentIntentId(session);
    const matchingCharges = intentId ? (successfulChargesByPaymentIntent.get(intentId) || []) : [];
    const checkoutEmail = String(sessionEmail(session) || '').trim().toLowerCase();
    const externalCharges = matchingCharges.filter((charge) => (
      classifyEmail(chargeEmail(charge), ownerEmails) === 'external' &&
      String(chargeEmail(charge) || '').trim().toLowerCase() === checkoutEmail
    ));
    const conflictingCharges = matchingCharges.filter((charge) => (
      classifyEmail(chargeEmail(charge), ownerEmails) !== 'external' ||
      String(chargeEmail(charge) || '').trim().toLowerCase() !== checkoutEmail
    ));

    if (!productsKnown) {
      unresolvedSessionCount += 1;
      unresolvedReasons.productIdentityUnavailable += 1;
      continue;
    }
    if (!intentId) {
      unresolvedSessionCount += 1;
      unresolvedReasons.paymentIntentMissing += 1;
      continue;
    }
    if (matchingCharges.length === 0) {
      unresolvedSessionCount += 1;
      unresolvedReasons.chargeNotFound += 1;
      continue;
    }
    if (conflictingCharges.length || externalCharges.length === 0) {
      identityConflictCount += 1;
      unresolvedReasons.payerIdentityConflict += 1;
      continue;
    }

    const anyThumbGate = catalogMatches.some((match) => match.matched);
    if (anyThumbGate && !allThumbGate) {
      unresolvedSessionCount += 1;
      unresolvedReasons.mixedProductSession += 1;
      continue;
    }

    for (const charge of externalCharges) reconciledExternalChargeIds.add(charge.id);
    if (!allThumbGate) continue;
    for (const charge of externalCharges) {
      attributedThumbGateCharges.set(charge.id, charge);
      const context = attributedThumbGateContexts.get(charge.id) || {
        sessionIds: new Set(),
        productIds: new Set(),
        priceIds: new Set(),
        offerIds: new Set(),
      };
      context.sessionIds.add(String(session.id));
      for (const match of catalogMatches) {
        if (match.observed?.productId) context.productIds.add(String(match.observed.productId));
        if (match.observed?.priceId) context.priceIds.add(String(match.observed.priceId));
        if (match.offerId) context.offerIds.add(String(match.offerId));
      }
      attributedThumbGateContexts.set(charge.id, context);
    }
    const netCents = externalCharges.reduce((sum, charge) => (
      sum + Number(charge.amount || 0) - Number(charge.amount_refunded || 0)
    ), 0);
    if (netCents <= 0) continue;
    attributedPayingEmails.add(String(sessionEmail(session)).toLowerCase().trim());
  }

  const attributedCharges = [...attributedThumbGateCharges.values()];
  const individualPaymentEvidence = buildStripeIndividualPaymentEvidence(
    attributedCharges,
    attributedThumbGateContexts,
    { now, timeZone }
  );
  const thumbgateNetRevenueCents = attributedCharges.reduce((sum, charge) => (
    sum + Number(charge.amount || 0) - Number(charge.amount_refunded || 0)
  ), 0);
  const revenueWindows = summarizeAttributedRevenueWindows(attributedCharges, { now, timeZone });

  const reconciledExternalNetCents = successfulCharges
    .filter((charge) => reconciledExternalChargeIds.has(charge.id))
    .reduce((sum, charge) => sum + Number(charge.amount || 0) - Number(charge.amount_refunded || 0), 0);
  const unmatchedExternalNetCents = Math.max(0, accountExternalNetCents - reconciledExternalNetCents);

  let activeSubscriptionCount = 0;
  let subscriptionMrrCents = 0;
  let unresolvedSubscriptionCount = 0;
  let mixedProductSubscriptionCount = 0;
  for (const subscription of externalSubs) {
    const refs = subscriptionPriceReferences(subscription);
    const catalogMatches = refs.map((price) => matchStripeRevenueCatalogPrice(price, productCatalog));
    if (catalogMatches.some((match) => match.reason === 'catalog_terms_mismatch')) {
      unresolvedSubscriptionCount += 1;
      catalogTermsMismatchCount += 1;
      continue;
    }
    if (!catalogMatches.length || catalogMatches.some((match) => !match.complete)) {
      unresolvedSubscriptionCount += 1;
      continue;
    }
    const thumbGateRefs = catalogMatches.filter((match) => match.matched);
    if (thumbGateRefs.length > 0 && thumbGateRefs.length !== catalogMatches.length) {
      unresolvedSubscriptionCount += 1;
      mixedProductSubscriptionCount += 1;
      continue;
    }
    if (thumbGateRefs.length === 0) continue;
    activeSubscriptionCount += 1;
    subscriptionMrrCents += subscriptionMRRCents(subscription);
    const email = emailOfCustomer(subscription);
    if (email) attributedPayingEmails.add(String(email).toLowerCase().trim());
  }

  const verified = lineItemErrorCount === 0 &&
    unresolvedSessionCount === 0 &&
    identityConflictCount === 0 &&
    unresolvedSubscriptionCount === 0 &&
    unmatchedExternalNetCents === 0;
  return {
    verified,
    scope: 'reconciled_paid_checkout_and_active_subscription',
    gap: verified
      ? null
      : 'ThumbGate revenue remains unverified where product, payment-intent, payer identity, refund net, or active-subscription evidence does not reconcile.',
    thumbgate: {
      uniquePayingCustomerCount: attributedPayingEmails.size,
      netRevenueCents: thumbgateNetRevenueCents,
      activeSubscriptionCount,
      mrrCents: subscriptionMrrCents,
      revenueWindows,
      individualPaymentEvidenceVerified: individualPaymentEvidence.verified,
      individualPaymentEvidenceGap: individualPaymentEvidence.gap,
      individualPayments: individualPaymentEvidence.payments,
      individualPaymentStates: individualPaymentEvidence.states,
    },
    paidExternalSessionCount: paidExternalSessions.length,
    zeroAmountPaidStatusSessionCount: zeroAmountPaidStatusSessions.length,
    auditedPaidExternalSessionCount,
    identityConflictCount,
    unresolvedSessionCount,
    unresolvedReasons,
    unresolvedSubscriptionCount,
    mixedProductSubscriptionCount,
    catalogTermsMismatchCount,
    unmatchedExternalNetCents,
    catalogVersion: STRIPE_REVENUE_CATALOG_VERSION,
  };
}

async function runAudit({
  stripeClient = null,
  stripeFactory = null,
  secretKey = undefined,
  env = process.env,
  secretPaths = DEFAULT_SECRET_PATHS,
  ownerEmails = parseOwnerEmails(),
  now = undefined,
  timeZone = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  productCatalog = DEFAULT_STRIPE_REVENUE_CATALOG,
} = {}) {
  let credentialSource = stripeClient ? 'injected_client' : null;
  if (!stripeClient && secretKey === undefined) {
    const resolved = resolveStripeSecretKey({ env, secretPaths });
    secretKey = resolved.secretKey;
    credentialSource = resolved.source;
  } else if (!stripeClient && secretKey) {
    credentialSource = 'injected_secret';
  }
  if (!secretKey && !stripeClient) {
    return {
      configured: false,
      gap: 'No Stripe credential found in STRIPE_SECRET_KEY or managed local key files',
      ownerEmails,
    };
  }
  let stripe = stripeClient;
  if (!stripe) {
    try {
      const factory = stripeFactory || loadStripe();
      stripe = factory(secretKey);
    } catch (error) {
      return { configured: false, gap: `Stripe SDK unavailable: ${error.message}`, ownerEmails };
    }
  }
  // Explicit null guard for static analyzers: at this point the branches
  // above either assigned `stripe` or returned. Make the precondition
  // unambiguous so Sonar's reliability check stays at A.
  if (!stripe?.charges?.list || !stripe?.subscriptions?.list || !stripe?.checkout?.sessions?.list) {
    return { configured: false, gap: 'Stripe client does not expose the expected list endpoints', ownerEmails };
  }

  const [charges, subscriptions, sessions] = await Promise.all([
    listAllPaged((p) => stripe.charges.list(p), { expand: ['data.customer'] }),
    listAllPaged((p) => stripe.subscriptions.list(p), { status: 'all', expand: ['data.customer'] }),
    listAllPaged((p) => stripe.checkout.sessions.list(p), {}),
  ]);

  const successfulCharges = charges.filter((c) => c.status === 'succeeded' || c.paid === true);
  const partitioned = partitionCharges(successfulCharges, ownerEmails);

  const subs = subscriptions.filter((s) => s.status === 'active' || s.status === 'trialing');
  const activeSubs = subs.filter((s) => s.status === 'active');
  const trialingSubs = subs.filter((s) => s.status === 'trialing');
  const externalSubs = activeSubs.filter((s) => classifyEmail(emailOfCustomer(s), ownerEmails) === 'external');
  const ownerSubs = activeSubs.filter((s) => classifyEmail(emailOfCustomer(s), ownerEmails) === 'owner');
  const unknownSubs = activeSubs.filter((s) => classifyEmail(emailOfCustomer(s), ownerEmails) === 'unknown');
  const externalTrials = trialingSubs.filter((s) => classifyEmail(emailOfCustomer(s), ownerEmails) === 'external');
  const ownerTrials = trialingSubs.filter((s) => classifyEmail(emailOfCustomer(s), ownerEmails) === 'owner');
  const unknownTrials = trialingSubs.filter((s) => classifyEmail(emailOfCustomer(s), ownerEmails) === 'unknown');

  const externalSessions = sessions.filter((s) => classifyEmail(sessionEmail(s), ownerEmails) === 'external');
  const ownerSessions = sessions.filter((s) => classifyEmail(sessionEmail(s), ownerEmails) === 'owner');
  const unknownSessions = sessions.filter((s) => classifyEmail(sessionEmail(s), ownerEmails) === 'unknown');
  const completedSessions = sessions.filter((s) => s.status === 'complete');
  const externalCompletedSessions = externalSessions.filter((s) => s.status === 'complete');
  const paidSessions = sessions.filter((s) => s.payment_status === 'paid');
  const externalPaidSessions = externalSessions.filter((s) => s.payment_status === 'paid');
  const ownerPaidSessions = ownerSessions.filter((s) => s.payment_status === 'paid');
  const unknownPaidSessions = unknownSessions.filter((s) => s.payment_status === 'paid');
  const monetaryPaidSessions = paidSessions.filter((s) => Number(s.amount_total || 0) > 0);
  const monetaryExternalPaidSessions = externalPaidSessions.filter((s) => Number(s.amount_total || 0) > 0);
  const zeroAmountPaidStatusSessions = paidSessions.filter((s) => Number(s.amount_total || 0) <= 0);
  const allSessions = sessions.length;
  const externalSessionsCount = externalSessions.length;
  const accountExternalSummary = summarizeCharges(partitioned.external);
  const productAttribution = await buildProductAttribution({
    stripe,
    sessions,
    successfulCharges,
    externalSubs,
    ownerEmails,
    accountExternalNetCents: accountExternalSummary.netCents,
    now,
    timeZone,
    productCatalog,
  });

  return {
    configured: true,
    credentialSource,
    ownerEmails,
    generatedAt: new Date().toISOString(),
    classificationNote: 'External means a known email not present in THUMBGATE_OWNER_EMAILS. Missing email stays unknown and never counts as external proof.',
    productAttribution,
    charges: {
      all: summarizeCharges(partitioned.all),
      owner: summarizeCharges(partitioned.owner),
      external: accountExternalSummary,
      unknown: summarizeCharges(partitioned.unknown),
    },
    subscriptions: {
      activeOrTrialing: subs.length,
      activeExternal: externalSubs.length,
      activeOwner: ownerSubs.length,
      activeUnknown: unknownSubs.length,
      trialingExternal: externalTrials.length,
      trialingOwner: ownerTrials.length,
      trialingUnknown: unknownTrials.length,
      mrrAllCents: subsMRR(activeSubs),
      mrrExternalCents: subsMRR(externalSubs),
      mrrAll: dollars(subsMRR(activeSubs)),
      mrrExternal: dollars(subsMRR(externalSubs)),
    },
    checkout: {
      totalSessions: allSessions,
      externalSessions: externalSessionsCount,
      ownerSessions: ownerSessions.length,
      unknownSessions: unknownSessions.length,
      statusCompleteAll: completedSessions.length,
      statusCompleteExternal: externalCompletedSessions.length,
      completedAll: completedSessions.length,
      completedExternal: externalCompletedSessions.length,
      paidAll: paidSessions.length,
      paidExternal: externalPaidSessions.length,
      paidOwner: ownerPaidSessions.length,
      paidUnknown: unknownPaidSessions.length,
      monetaryPaidAll: monetaryPaidSessions.length,
      monetaryPaidExternal: monetaryExternalPaidSessions.length,
      zeroAmountPaidStatusAll: zeroAmountPaidStatusSessions.length,
      completionRateAll: allSessions ? completedSessions.length / allSessions : 0,
      // External rate uses the external denominator — dividing external
      // completions by total sessions would systematically undercount the
      // real-customer conversion (Codex P2 finding).
      completionRateExternal: externalSessionsCount ? externalCompletedSessions.length / externalSessionsCount : 0,
      paidRateExternal: externalSessionsCount ? externalPaidSessions.length / externalSessionsCount : 0,
    },
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# External Customer Audit');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt || new Date().toISOString()}`);
  if (!report.configured) {
    lines.push(`Status: NOT CONFIGURED — ${report.gap}`);
    return lines.join('\n') + '\n';
  }
  lines.push(`Owner emails filtered: ${report.ownerEmails.join(', ')}`);
  lines.push('');
  lines.push('## Charges (lifetime)');
  lines.push('');
  lines.push('| Bucket | Succeeded charges | Net-positive identities | Gross | Refunded | Net |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const k of ['all', 'owner', 'external', 'unknown']) {
    const s = report.charges[k];
    lines.push(`| ${k} | ${s.chargeCount} | ${s.uniqueCustomerCount} | $${s.gross.toFixed(2)} | $${dollars(s.refundedCents).toFixed(2)} | $${s.net.toFixed(2)} |`);
  }
  lines.push('');
  lines.push('## Active subscriptions');
  lines.push('');
  lines.push(`- All active or trialing: ${report.subscriptions.activeOrTrialing} (MRR $${report.subscriptions.mrrAll.toFixed(2)})`);
  lines.push(`- **Known non-owner**: ${report.subscriptions.activeExternal} (MRR $${report.subscriptions.mrrExternal.toFixed(2)})`);
  lines.push(`- Owner: ${report.subscriptions.activeOwner}`);
  lines.push(`- Unknown identity: ${report.subscriptions.activeUnknown}`);
  lines.push(`- Trialing, not counted as active revenue: ${report.subscriptions.trialingExternal + report.subscriptions.trialingOwner + report.subscriptions.trialingUnknown}`);
  lines.push('');
  lines.push('## Checkout sessions');
  lines.push('');
  lines.push(`- Total sessions ever created: ${report.checkout.totalSessions}`);
  lines.push(`- Status complete (all; not payment proof): ${report.checkout.statusCompleteAll} (${(report.checkout.completionRateAll * 100).toFixed(2)}%)`);
  lines.push(`- Status complete (known non-owner; not payment proof): ${report.checkout.statusCompleteExternal} (${(report.checkout.completionRateExternal * 100).toFixed(2)}%)`);
  lines.push(`- Stripe payment_status=paid (known non-owner): ${report.checkout.paidExternal} (${(report.checkout.paidRateExternal * 100).toFixed(2)}%)`);
  lines.push(`- **Positive-amount paid-status sessions (known non-owner)**: ${report.checkout.monetaryPaidExternal}`);
  lines.push(`- Zero-amount paid-status sessions (all identities): ${report.checkout.zeroAmountPaidStatusAll}`);
  lines.push(`- Unknown identity sessions: ${report.checkout.unknownSessions}`);
  lines.push('');
  lines.push('## Account-wide identity evidence');
  lines.push('');
  const realCustomers = report.charges.external.uniqueCustomerCount;
  const realRevenue = report.charges.external.net;
  const realSubs = report.subscriptions.activeExternal;
  const realMrr = report.subscriptions.mrrExternal;
  lines.push(`- **Known non-owner paying identities lifetime: ${realCustomers}**`);
  lines.push(`- **Known non-owner net revenue lifetime: $${realRevenue.toFixed(2)}**`);
  lines.push(`- **Known non-owner active subscriptions: ${realSubs}**  (MRR $${realMrr.toFixed(2)})`);
  lines.push(`- Identity caveat: ${report.classificationNote}`);
  lines.push(`- ThumbGate-attributed paying identities: ${report.productAttribution.thumbgate.uniquePayingCustomerCount}`);
  lines.push(`- ThumbGate-attributed net revenue: $${dollars(report.productAttribution.thumbgate.netRevenueCents).toFixed(2)}`);
  const revenueWindows = report.productAttribution.thumbgate.revenueWindows;
  lines.push(`- ThumbGate-attributed gross today (${revenueWindows.timeZone}): $${dollars(revenueWindows.todayGrossRevenueCents).toFixed(2)}`);
  lines.push(`- ThumbGate-attributed gross trailing 30 days: $${dollars(revenueWindows.trailing30DayGrossRevenueCents).toFixed(2)}`);
  lines.push(`- Time-window attribution verified: ${revenueWindows.verified}`);
  lines.push(`- Time-window basis: ${revenueWindows.basis}`);
  if (revenueWindows.gap) lines.push(`- Time-window caveat: ${revenueWindows.gap}`);
  lines.push(`- ThumbGate-attributed active subscriptions: ${report.productAttribution.thumbgate.activeSubscriptionCount} (MRR $${dollars(report.productAttribution.thumbgate.mrrCents).toFixed(2)})`);
  lines.push(`- Product attribution verified: ${report.productAttribution.verified}`);
  if (report.productAttribution.gap) lines.push(`- Product-attribution caveat: ${report.productAttribution.gap}`);
  return lines.join('\n') + '\n';
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const report = await runAudit();
  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(renderMarkdown(report));
  }
  if (args.strict && report.configured) {
    const real = report.charges.external.uniqueCustomerCount;
    if (real === 0) process.exit(2);
  }
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  main().catch((error) => {
    process.stderr.write(`external-customer-audit FAILED: ${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_SECRET_PATHS,
  parseArgs,
  parseOwnerEmails,
  isOwnerEmail,
  classifyEmail,
  readSecretFile,
  resolveStripeSecretKey,
  listAllPaged,
  monthlyRecurringCents,
  subscriptionMRRCents,
  stripeCreatedIso,
  localDateRange,
  summarizeAttributedRevenueWindows,
  productReference,
  isThumbGateProductName,
  buildProductAttribution,
  buildStripeIndividualPaymentEvidence,
  runAudit,
  renderMarkdown,
};
