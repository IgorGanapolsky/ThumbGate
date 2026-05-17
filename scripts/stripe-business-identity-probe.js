#!/usr/bin/env node
/**
 * stripe-business-identity-probe.js — what does the buyer see at the Stripe
 * checkout page?
 *
 * Background. The stripe-checkout-diagnostic (PR #2097) revealed that 100
 * lifetime checkout sessions ended with 100% open/expired, 100% no customer
 * email, and zero payment_intent errors. That's a "buyer reaches Stripe page
 * and immediately closes the tab" pattern, not a card-decline or KYC pattern.
 *
 * The next question is: WHAT exactly do buyers see on the Stripe-hosted page?
 * The Stripe page is a JS-rendered SPA — buyers see whatever Stripe pulls
 * from the merchant's business_profile + branding + Payment Link config.
 * If business_profile.name is unset, statement_descriptor is generic, or
 * the Payment Link metadata doesn't carry product identity, buyers see
 * "Stripe Checkout" with no recognition signal — and they bail.
 *
 * This script pulls every Stripe-side configuration that contributes to
 * what a buyer sees in the first 3 seconds of the checkout page:
 *
 *   - account.business_profile (name, url, support, description, mcc)
 *   - account.settings.payments.statement_descriptor
 *   - account.settings.card_payments.statement_descriptor_prefix
 *   - account.settings.branding (logo, icon, primary_color, secondary_color)
 *   - paymentLinks.list (per-link: active, custom_text, submit_type,
 *     billing_address_collection, phone_number_collection, metadata)
 *   - products.list (per-product: name, description, images, statement_descriptor)
 *
 * The output names the specific identity fields that are MISSING — those
 * are the ones to fix in Stripe Dashboard to bring brand recognition to
 * the first paint of the checkout page.
 *
 * Run:
 *   node scripts/stripe-business-identity-probe.js
 *   node scripts/stripe-business-identity-probe.js --json
 *
 * Required env:
 *   STRIPE_SECRET_KEY     live Stripe key (read access)
 */

'use strict';

const path = require('node:path');

function parseArgs(argv = []) {
  return { json: argv.includes('--json') };
}

function loadStripe(requireFn = require) {
  return requireFn('stripe');
}

async function listAllPaged(listFn, params = {}, max = 100) {
  const out = [];
  let startingAfter;
  while (out.length < max) {
    const page = await listFn({ ...params, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
    if (!page?.data) break;
    for (const row of page.data) {
      out.push(row);
      if (out.length >= max) return out;
    }
    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return out;
}

function extractAccountIdentity(account) {
  const bp = account.business_profile || {};
  const settings = account.settings || {};
  return {
    accountId: account.id,
    businessName: bp.name || null,
    supportEmail: bp.support_email || null,
    supportUrl: bp.support_url || null,
    productDescription: bp.product_description || null,
    websiteUrl: bp.url || null,
    mcc: bp.mcc || null,
    statementDescriptor: settings.payments?.statement_descriptor || null,
    statementDescriptorPrefix: settings.card_payments?.statement_descriptor_prefix || null,
    brandingLogo: settings.branding?.logo || null,
    brandingIcon: settings.branding?.icon || null,
    brandingPrimaryColor: settings.branding?.primary_color || null,
    brandingSecondaryColor: settings.branding?.secondary_color || null,
  };
}

function diagnoseIdentityGaps(identity) {
  const gaps = [];
  if (!identity.businessName) {
    gaps.push({ severity: 'critical', field: 'business_profile.name', message: 'Stripe checkout page has no merchant name to display. Buyer sees "Stripe Checkout" with no recognition signal.' });
  } else if (!/thumbgate/i.test(identity.businessName)) {
    gaps.push({ severity: 'warning', field: 'business_profile.name', message: `Merchant name is "${identity.businessName}", not "ThumbGate". Buyer arriving from thumbgate.ai may not recognize this name.` });
  }
  if (!identity.brandingLogo && !identity.brandingIcon) {
    gaps.push({ severity: 'critical', field: 'settings.branding.logo|icon', message: 'No logo or icon configured. Stripe page shows generic placeholder, breaking visual continuity from thumbgate.ai.' });
  }
  if (!identity.statementDescriptor) {
    gaps.push({ severity: 'warning', field: 'settings.payments.statement_descriptor', message: 'No statement descriptor. Card statements will show a Stripe-default string instead of "THUMBGATE" — increases dispute risk and reduces brand recall.' });
  } else if (!/thumbgate/i.test(identity.statementDescriptor)) {
    gaps.push({ severity: 'warning', field: 'settings.payments.statement_descriptor', message: `Statement descriptor is "${identity.statementDescriptor}", not ThumbGate-branded. Buyer card statement will not reference the product they bought.` });
  }
  if (!identity.websiteUrl) {
    gaps.push({ severity: 'info', field: 'business_profile.url', message: 'business_profile.url not set. Stripe receipt emails won\'t link back to the merchant site.' });
  } else if (!/thumbgate/i.test(identity.websiteUrl)) {
    gaps.push({ severity: 'warning', field: 'business_profile.url', message: `business_profile.url is "${identity.websiteUrl}". Buyer-facing emails will show this URL — should match the site they came from.` });
  }
  if (!identity.supportEmail) {
    gaps.push({ severity: 'info', field: 'business_profile.support_email', message: 'No support_email configured. Stripe checkout page has no contact path for confused buyers.' });
  }
  if (!identity.productDescription) {
    gaps.push({ severity: 'info', field: 'business_profile.product_description', message: 'No product_description configured. Stripe page first paint shows no context for what the buyer is buying.' });
  }
  return gaps;
}

function summarizePaymentLinks(links) {
  return links.map((pl) => ({
    id: pl.id,
    url: pl.url,
    active: pl.active,
    submitType: pl.submit_type,
    billingAddressCollection: pl.billing_address_collection,
    phoneNumberCollection: pl.phone_number_collection?.enabled || false,
    hasCustomText: Boolean(pl.custom_text && Object.keys(pl.custom_text).filter((k) => pl.custom_text[k]).length > 0),
    metadataKeys: Object.keys(pl.metadata || {}),
  }));
}

function diagnosePaymentLinks(links) {
  const gaps = [];
  for (const link of links) {
    if (!link.active) {
      gaps.push({ severity: 'critical', linkId: link.id, message: `Payment Link ${link.id} is INACTIVE but still on file. If our site is sending buyers to it, every checkout dies at the first hop.` });
    }
    if (link.phoneNumberCollection) {
      gaps.push({ severity: 'warning', linkId: link.id, message: `Payment Link ${link.id} requires phone number. Adds friction; buyers often bail at the phone field for SaaS purchases.` });
    }
    if (link.billingAddressCollection && link.billingAddressCollection !== 'auto') {
      gaps.push({ severity: 'info', linkId: link.id, message: `Payment Link ${link.id} forces billing_address_collection=${link.billingAddressCollection}. "auto" is the friction-minimizing default.` });
    }
  }
  return gaps;
}

async function runProbe({ stripeClient = null, secretKey = process.env.STRIPE_SECRET_KEY } = {}) {
  if (!secretKey && !stripeClient) {
    return { configured: false, gap: 'STRIPE_SECRET_KEY is not set' };
  }
  let stripe = stripeClient;
  if (!stripe) {
    try {
      const factory = loadStripe();
      stripe = factory(secretKey);
    } catch (error) {
      return { configured: false, gap: `Stripe SDK unavailable: ${error.message}` };
    }
  }
  if (!stripe?.accounts?.retrieve || !stripe?.paymentLinks?.list) {
    return { configured: false, gap: 'Stripe client does not expose accounts.retrieve / paymentLinks.list' };
  }
  let account;
  try {
    account = await stripe.accounts.retrieve();
  } catch (error) {
    return { configured: false, gap: `accounts.retrieve failed: ${error.message}` };
  }
  const paymentLinks = await listAllPaged((p) => stripe.paymentLinks.list(p), {}, 10000);  // Codex P2: was 50, silently truncating accounts with >50 Payment Links

  const identity = extractAccountIdentity(account);
  const identityGaps = diagnoseIdentityGaps(identity);
  const linkSummary = summarizePaymentLinks(paymentLinks);
  const linkGaps = diagnosePaymentLinks(linkSummary);

  return {
    configured: true,
    generatedAt: new Date().toISOString(),
    identity,
    identityGaps,
    paymentLinks: linkSummary,
    paymentLinkGaps: linkGaps,
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Stripe Business Identity Probe');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt || new Date().toISOString()}`);
  if (!report.configured) {
    lines.push(`Status: NOT CONFIGURED — ${report.gap}`);
    return lines.join('\n') + '\n';
  }
  lines.push('');
  lines.push('## What does the buyer see on the Stripe checkout page?');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('| --- | --- |');
  for (const [k, v] of Object.entries(report.identity)) {
    const shown = v === null || v === undefined ? '_(not set)_' : String(v);
    lines.push(`| \`${k}\` | ${shown} |`);
  }
  lines.push('');
  lines.push('## Identity gaps');
  lines.push('');
  if (report.identityGaps.length === 0) {
    lines.push('_No identity gaps. Buyer should see a complete, branded checkout page._');
  } else {
    for (const g of report.identityGaps) {
      lines.push(`- **[${g.severity}] \`${g.field}\`** — ${g.message}`);
    }
  }
  lines.push('');
  lines.push('## Payment Links');
  lines.push('');
  lines.push(`Total: ${report.paymentLinks.length}`);
  lines.push('');
  lines.push('| Active | URL | Submit | Bill addr | Phone | Custom text | Metadata keys |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const pl of report.paymentLinks) {
    lines.push(`| ${pl.active ? '✓' : '✗'} | \`${pl.url}\` | ${pl.submitType || '—'} | ${pl.billingAddressCollection || '—'} | ${pl.phoneNumberCollection ? '✓' : '—'} | ${pl.hasCustomText ? '✓' : '—'} | ${pl.metadataKeys.join(', ') || '—'} |`);
  }
  lines.push('');
  lines.push('## Payment Link gaps');
  lines.push('');
  if (report.paymentLinkGaps.length === 0) {
    lines.push('_No Payment Link gaps._');
  } else {
    for (const g of report.paymentLinkGaps) {
      lines.push(`- **[${g.severity}] \`${g.linkId}\`** — ${g.message}`);
    }
  }
  lines.push('');
  lines.push('## What this probe cannot see');
  lines.push('');
  lines.push('- The Stripe page renders JS-side after first paint. Visual quality of the rendered page (layout shifts, scary upsells, geo-blocked notices) is not in the API response.');
  lines.push('- Buyer-side issues (slow connection, region blocking, ad-blocker breaking Stripe scripts) are not visible here.');
  lines.push('- For a ground-truth check, open a live Payment Link in incognito on a fresh device.');
  return lines.join('\n') + '\n';
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const report = await runProbe();
  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(renderMarkdown(report));
  }
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  main().catch((error) => {
    process.stderr.write(`stripe-business-identity-probe FAILED: ${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  extractAccountIdentity,
  diagnoseIdentityGaps,
  summarizePaymentLinks,
  diagnosePaymentLinks,
  runProbe,
  renderMarkdown,
};
