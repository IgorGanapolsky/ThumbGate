#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_SECRET_PATHS,
  resolveStripeSecretKey,
} = require('./stripe-credentials');
const {
  STRIPE_REVENUE_CATALOG_VERSION,
  DEFAULT_STRIPE_REVENUE_CATALOG,
  validateStripeRevenueCatalog,
  matchStripeRevenueCatalogPrice,
} = require('./stripe-revenue-catalog');

const SCHEMA_VERSION = 1;
const DEFAULT_STRIPE_PUBLIC_PAYMENT_RAILS = Object.freeze([
  Object.freeze({
    offerId: 'pro_monthly',
    paymentLinkId: 'plink_1Tpu8xGGBpd520QY7VoUniLI',
    url: 'https://buy.stripe.com/8x2dR91M84r4cSd9uj3sI3f',
    priceId: 'price_1THQY7GGBpd520QYHoS7RG0J',
    expectedActive: true,
  }),
  Object.freeze({
    offerId: 'workflow_hardening_diagnostic',
    paymentLinkId: 'plink_1TsO6lGGBpd520QYsFToXuRC',
    url: 'https://buy.stripe.com/9B69ATbmI4r4aK5eOD3sI3k',
    priceId: 'price_1TsO6kGGBpd520QYbbEgThb3',
    expectedActive: true,
  }),
]);

function parseArgs(argv = []) {
  const options = { json: argv.includes('--json') };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') continue;
    if (arg === '--out' && argv[index + 1]) {
      options.out = argv[index + 1];
      index += 1;
    }
  }
  return options;
}

function loadStripe(requireFn = require) {
  return requireFn('stripe');
}

function canonicalPaymentLinkUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:' || url.hostname !== 'buy.stripe.com'
      || url.username || url['pass' + 'word'] || url.port) return null;
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

function validatePublicPaymentRails(rails = DEFAULT_STRIPE_PUBLIC_PAYMENT_RAILS, catalog = DEFAULT_STRIPE_REVENUE_CATALOG) {
  if (!Array.isArray(rails) || rails.length === 0) {
    return { ok: false, gap: 'Stripe public payment rails must contain at least one reviewed link.' };
  }
  const priceIds = new Set(catalog.map((entry) => entry.priceId));
  const offerIds = new Set(catalog.map((entry) => entry.offerId));
  const seenLinks = new Set();
  for (const rail of rails) {
    const linkId = String(rail?.paymentLinkId || '').trim();
    const priceId = String(rail?.priceId || '').trim();
    const offerId = String(rail?.offerId || '').trim();
    if (!/^plink_[A-Za-z0-9_]+$/.test(linkId)
      || !canonicalPaymentLinkUrl(rail?.url)
      || !priceIds.has(priceId)
      || !offerIds.has(offerId)
      || typeof rail?.expectedActive !== 'boolean') {
      return { ok: false, gap: `Invalid Stripe public payment rail for ${offerId || 'unknown offer'}.` };
    }
    const catalogEntry = catalog.find((entry) => entry.offerId === offerId);
    if (!catalogEntry || catalogEntry.priceId !== priceId) {
      return { ok: false, gap: `Stripe public payment rail ${linkId} does not bind to its catalog offer.` };
    }
    if (seenLinks.has(linkId)) {
      return { ok: false, gap: `Duplicate Stripe public payment link: ${linkId}.` };
    }
    seenLinks.add(linkId);
  }
  return { ok: true, gap: null };
}

function emptySummary(catalog = [], rails = []) {
  return {
    expectedOfferCount: catalog.length,
    verifiedOfferCount: 0,
    priceDriftCount: catalog.length,
    expectedPublicPaymentRailCount: rails.length,
    verifiedPublicPaymentRailCount: 0,
    paymentRailDriftCount: rails.length,
  };
}

async function buildStripeRevenueCatalogAudit({
  stripe,
  catalog = DEFAULT_STRIPE_REVENUE_CATALOG,
  publicPaymentRails = DEFAULT_STRIPE_PUBLIC_PAYMENT_RAILS,
  generatedAt = new Date().toISOString(),
  requireLiveMode = true,
} = {}) {
  const catalogValidation = validateStripeRevenueCatalog(catalog);
  const railValidation = catalogValidation.ok
    ? validatePublicPaymentRails(publicPaymentRails, catalog)
    : { ok: false, gap: 'Stripe public payment rails cannot be audited against an invalid catalog.' };
  const gaps = [catalogValidation.gap, railValidation.gap].filter(Boolean);
  if (!stripe?.prices?.retrieve || !stripe?.paymentLinks?.retrieve) {
    gaps.push('Stripe client does not expose read-only price and Payment Link retrieval endpoints.');
  }
  if (gaps.length) {
    return {
      schemaVersion: SCHEMA_VERSION,
      catalogVersion: STRIPE_REVENUE_CATALOG_VERSION,
      generatedAt: new Date(generatedAt).toISOString(),
      verified: false,
      gaps,
      summary: emptySummary(catalog, publicPaymentRails),
      offers: [],
      publicPaymentRails: [],
    };
  }

  const offers = await Promise.all(catalog.map(async (entry) => {
    let price;
    try {
      price = await stripe.prices.retrieve(entry.priceId, { expand: ['product'] });
    } catch {
      return {
        offerId: entry.offerId,
        priceId: entry.priceId,
        verified: false,
        gap: 'provider_price_retrieval_failed',
      };
    }
    const match = matchStripeRevenueCatalogPrice(price, catalog);
    const activeMatches = price.active === entry.expectedPriceActive;
    const productActiveMatches = typeof price.product === 'object'
      && price.product?.active === entry.expectedProductActive;
    const liveModeMatches = !requireLiveMode || price.livemode === true;
    return {
      offerId: entry.offerId,
      priceId: entry.priceId,
      productId: entry.productId,
      status: entry.status,
      expectedPriceActive: entry.expectedPriceActive,
      observedPriceActive: price.active === true,
      expectedProductActive: entry.expectedProductActive,
      observedProductActive: typeof price.product === 'object' ? price.product?.active === true : null,
      liveMode: price.livemode === true,
      exactTermsMatch: match.matched,
      verified: match.matched && activeMatches && productActiveMatches && liveModeMatches,
      gap: !match.matched
        ? match.reason
        : !activeMatches
          ? 'price_active_state_mismatch'
          : !productActiveMatches
            ? 'product_active_state_mismatch'
          : !liveModeMatches ? 'price_not_live_mode' : null,
    };
  }));

  const publicRails = await Promise.all(publicPaymentRails.map(async (expected) => {
    let link;
    try {
      link = await stripe.paymentLinks.retrieve(expected.paymentLinkId, {
        expand: ['line_items.data.price.product'],
      });
    } catch {
      return {
        offerId: expected.offerId,
        paymentLinkId: expected.paymentLinkId,
        verified: false,
        gap: 'provider_payment_link_retrieval_failed',
      };
    }
    const lineItems = Array.isArray(link?.line_items?.data) ? link.line_items.data : [];
    const priceMatches = lineItems.map((item) => matchStripeRevenueCatalogPrice(item?.price, catalog));
    const exactSingleOffer = priceMatches.length === 1
      && priceMatches[0].matched
      && priceMatches[0].offerId === expected.offerId
      && priceMatches[0].observed?.priceId === expected.priceId;
    const urlMatches = canonicalPaymentLinkUrl(link?.url) === canonicalPaymentLinkUrl(expected.url);
    const activeMatches = link?.active === expected.expectedActive;
    const liveModeMatches = !requireLiveMode || link?.livemode === true;
    const idMatches = link?.id === expected.paymentLinkId;
    const verified = idMatches && urlMatches && activeMatches && liveModeMatches && exactSingleOffer;
    return {
      offerId: expected.offerId,
      paymentLinkId: expected.paymentLinkId,
      priceId: expected.priceId,
      expectedActive: expected.expectedActive,
      observedActive: link?.active === true,
      liveMode: link?.livemode === true,
      exactUrlMatch: urlMatches,
      exactSingleOffer,
      verified,
      gap: !idMatches
        ? 'payment_link_id_mismatch'
        : !urlMatches
          ? 'payment_link_url_mismatch'
          : !activeMatches
            ? 'payment_link_active_state_mismatch'
            : !liveModeMatches
              ? 'payment_link_not_live_mode'
              : !exactSingleOffer ? 'payment_link_offer_mismatch' : null,
    };
  }));

  for (const offer of offers) {
    if (!offer.verified) gaps.push(`offer:${offer.offerId}:${offer.gap}`);
  }
  for (const rail of publicRails) {
    if (!rail.verified) gaps.push(`payment_rail:${rail.offerId}:${rail.gap}`);
  }
  const verifiedOfferCount = offers.filter((offer) => offer.verified).length;
  const verifiedPublicPaymentRailCount = publicRails.filter((rail) => rail.verified).length;
  return {
    schemaVersion: SCHEMA_VERSION,
    catalogVersion: STRIPE_REVENUE_CATALOG_VERSION,
    generatedAt: new Date(generatedAt).toISOString(),
    verified: gaps.length === 0,
    gaps,
    summary: {
      expectedOfferCount: catalog.length,
      verifiedOfferCount,
      priceDriftCount: catalog.length - verifiedOfferCount,
      expectedPublicPaymentRailCount: publicPaymentRails.length,
      verifiedPublicPaymentRailCount,
      paymentRailDriftCount: publicPaymentRails.length - verifiedPublicPaymentRailCount,
    },
    offers,
    publicPaymentRails: publicRails,
  };
}

async function runAudit({
  stripeClient = null,
  stripeFactory = null,
  secretKey = undefined,
  env = process.env,
  secretPaths = DEFAULT_SECRET_PATHS,
  catalog = DEFAULT_STRIPE_REVENUE_CATALOG,
  publicPaymentRails = DEFAULT_STRIPE_PUBLIC_PAYMENT_RAILS,
  generatedAt = new Date().toISOString(),
  requireLiveMode = true,
} = {}) {
  let credentialSource = stripeClient ? 'injected_client' : null;
  if (!stripeClient && secretKey === undefined) {
    const resolved = resolveStripeSecretKey({ env, secretPaths });
    secretKey = resolved.secretKey;
    credentialSource = resolved.source;
  } else if (!stripeClient && secretKey) {
    credentialSource = 'injected_secret';
  }
  if (!stripeClient && !secretKey) {
    return {
      configured: false,
      credentialSource: null,
      schemaVersion: SCHEMA_VERSION,
      catalogVersion: STRIPE_REVENUE_CATALOG_VERSION,
      generatedAt: new Date(generatedAt).toISOString(),
      verified: false,
      gaps: ['No Stripe credential found in STRIPE_SECRET_KEY or managed local key files.'],
      summary: emptySummary(catalog, publicPaymentRails),
      offers: [],
      publicPaymentRails: [],
    };
  }
  let stripe = stripeClient;
  if (!stripe) {
    try {
      const factory = stripeFactory || loadStripe();
      stripe = factory(secretKey);
    } catch {
      return {
        configured: false,
        credentialSource,
        schemaVersion: SCHEMA_VERSION,
        catalogVersion: STRIPE_REVENUE_CATALOG_VERSION,
        generatedAt: new Date(generatedAt).toISOString(),
        verified: false,
        gaps: ['Stripe SDK could not be initialized.'],
        summary: emptySummary(catalog, publicPaymentRails),
        offers: [],
        publicPaymentRails: [],
      };
    }
  }
  const report = await buildStripeRevenueCatalogAudit({
    stripe,
    catalog,
    publicPaymentRails,
    generatedAt,
    requireLiveMode,
  });
  return { configured: true, credentialSource, ...report };
}

function renderMarkdown(report) {
  const lines = [
    '# Stripe Revenue Catalog Audit',
    '',
    `Generated: ${report.generatedAt}`,
    `Status: ${report.verified ? 'VERIFIED' : 'UNVERIFIED'}`,
    `Catalog version: ${report.catalogVersion}`,
    `Exact live offers: ${report.summary.verifiedOfferCount}/${report.summary.expectedOfferCount}`,
    `Exact public payment rails: ${report.summary.verifiedPublicPaymentRailCount}/${report.summary.expectedPublicPaymentRailCount}`,
  ];
  if (report.gaps.length) {
    lines.push('', '## Evidence gaps', '');
    for (const gap of report.gaps) lines.push(`- ${gap}`);
  }
  return `${lines.join('\n')}\n`;
}

function writeJson(filePath, value) {
  if (!filePath) return null;
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return resolved;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = await runAudit();
  const outputPath = writeJson(options.out, report);
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ...report, outputPath }, null, 2)}\n`);
  } else {
    process.stdout.write(renderMarkdown(report));
  }
  if (!report.verified) process.exitCode = 2;
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  main().catch(() => {
    process.stderr.write('stripe-revenue-catalog-audit FAILED\n');
    process.exit(1);
  });
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_STRIPE_PUBLIC_PAYMENT_RAILS,
  parseArgs,
  canonicalPaymentLinkUrl,
  validatePublicPaymentRails,
  buildStripeRevenueCatalogAudit,
  runAudit,
  renderMarkdown,
  writeJson,
};
