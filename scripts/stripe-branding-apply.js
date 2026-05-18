#!/usr/bin/env node
/**
 * stripe-branding-apply.js — write the missing Stripe branding identity.
 *
 * Background. stripe-business-identity-probe.js (PR #2100) revealed the
 * checkout page renders with:
 *   - businessName  ✅ "Thumbgate Ops"
 *   - statementDescriptor ✅ "THUMBGATE"
 *   - websiteUrl ✅ thumbgate.ai
 *   - supportEmail ❌ MISSING
 *   - productDescription ❌ MISSING
 *   - branding.logo ❌ MISSING
 *   - branding.icon ❌ MISSING
 *
 * Missing branding is the leading hypothesis for the 100 lifetime
 * checkout sessions / 0 completions / 0 payment_intent errors pattern:
 * buyers reach the Stripe page, see an unbranded form, and bail.
 *
 * This script writes the missing fields via the Stripe API. It is
 * idempotent — re-running after a successful run is a no-op because
 * every field is checked against current value before write.
 *
 * Run (locally or in CI):
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-branding-apply.js
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-branding-apply.js --dry-run
 *
 * Required env:
 *   STRIPE_SECRET_KEY      live Stripe key with file_uploads + account.write
 *
 * Optional env:
 *   THUMBGATE_LOGO_PATH    override default logo file (public/assets/brand/thumbgate-logo-1200x360.png)
 *   THUMBGATE_ICON_PATH    override default icon file (public/assets/brand/thumbgate-icon-512.png)
 *   THUMBGATE_SUPPORT_EMAIL override support email (default igor.ganapolsky@gmail.com)
 *
 * Exit codes:
 *   0  branding now matches desired state (either no-op or successfully applied)
 *   1  failure (missing key, file not found, Stripe API error)
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULTS = {
  logoPath: path.join(REPO_ROOT, 'public/assets/brand/thumbgate-logo-1200x360.png'),
  iconPath: path.join(REPO_ROOT, 'public/assets/brand/thumbgate-icon-512.png'),
  supportEmail: 'igor.ganapolsky@gmail.com',
  productDescription:
    'ThumbGate is a pre-action gate layer for AI coding agents. ' +
    'Capture a thumbs-down on a bad agent action and the next matching ' +
    'tool call is blocked automatically across Claude Code, Cursor, ' +
    'Codex, Gemini CLI, Amp, Cline, and OpenCode. Subscription billing ' +
    'for Pro ($19/mo) and Team ($49/seat/mo) tiers. Refunds within 7 days.',
};

function parseArgs(argv = []) {
  return { dryRun: argv.includes('--dry-run'), json: argv.includes('--json') };
}

function readEnv(name, fallback = '') {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

async function uploadFile(stripe, filePath, purpose) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`asset not found at ${filePath} for purpose=${purpose}`);
  }
  const file = await stripe.files.create({
    purpose,
    file: {
      data: fs.readFileSync(filePath),
      name: path.basename(filePath),
      type: filePath.toLowerCase().endsWith('.png') ? 'image/png' : (filePath.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream'),
    },
  });
  return file.id;
}

async function applyBranding({ stripe, options }) {
  const account = await stripe.accounts.retrieve();
  const bp = account.business_profile || {};
  const branding = account.settings?.branding || {};

  const desired = {
    supportEmail: options.supportEmail,
    productDescription: options.productDescription,
  };

  const current = {
    supportEmail: bp.support_email || null,
    productDescription: bp.product_description || null,
    logo: branding.logo || null,
    icon: branding.icon || null,
  };

  const actions = [];

  const businessProfilePatch = {};
  if (!current.supportEmail || current.supportEmail !== desired.supportEmail) {
    businessProfilePatch.support_email = desired.supportEmail;
    actions.push({ field: 'business_profile.support_email', from: current.supportEmail, to: desired.supportEmail });
  }
  if (!current.productDescription || current.productDescription.length < 50) {
    businessProfilePatch.product_description = desired.productDescription;
    actions.push({
      field: 'business_profile.product_description',
      from: current.productDescription,
      to: `${desired.productDescription.slice(0, 80)}…`,
    });
  }

  const settingsBrandingPatch = {};
  let logoFileId = null;
  let iconFileId = null;

  if (!current.logo) {
    if (options.dryRun) {
      actions.push({ field: 'settings.branding.logo', from: null, to: '(would upload)' });
    } else {
      logoFileId = await uploadFile(stripe, options.logoPath, 'business_logo');
      settingsBrandingPatch.logo = logoFileId;
      actions.push({ field: 'settings.branding.logo', from: null, to: logoFileId });
    }
  }
  if (!current.icon) {
    if (options.dryRun) {
      actions.push({ field: 'settings.branding.icon', from: null, to: '(would upload)' });
    } else {
      iconFileId = await uploadFile(stripe, options.iconPath, 'business_icon');
      settingsBrandingPatch.icon = iconFileId;
      actions.push({ field: 'settings.branding.icon', from: null, to: iconFileId });
    }
  }

  if (actions.length === 0) {
    return { changed: false, actions: [], current };
  }

  if (options.dryRun) {
    return { changed: false, actions, current, dryRun: true };
  }

  const updatePayload = {};
  if (Object.keys(businessProfilePatch).length > 0) updatePayload.business_profile = businessProfilePatch;
  if (Object.keys(settingsBrandingPatch).length > 0) {
    updatePayload.settings = { branding: settingsBrandingPatch };
  }

  const updated = await stripe.accounts.update(account.id, updatePayload);

  return {
    changed: true,
    actions,
    current,
    accountId: updated.id,
    finalBusinessProfile: updated.business_profile,
    finalBranding: updated.settings?.branding,
  };
}

function renderHuman(result) {
  const lines = [];
  if (result.dryRun) lines.push('DRY RUN — no Stripe writes performed.');
  if (result.changed === false && !result.dryRun) {
    lines.push('No-op: Stripe branding already matches desired state.');
    return lines.join('\n');
  }
  lines.push('Stripe branding actions:');
  for (const a of result.actions) {
    const fromStr = a.from === null ? '(missing)' : JSON.stringify(a.from).slice(0, 60);
    lines.push(`  - ${a.field}: ${fromStr} → ${a.to}`);
  }
  if (result.accountId) lines.push(`Updated account ${result.accountId}.`);
  return lines.join('\n');
}

async function main(argv) {
  const args = parseArgs(argv);

  const secretKey = readEnv('STRIPE_SECRET_KEY');
  if (!secretKey) {
    process.stderr.write('STRIPE_SECRET_KEY is not set.\n');
    process.exit(1);
  }

  const options = {
    logoPath: readEnv('THUMBGATE_LOGO_PATH', DEFAULTS.logoPath),
    iconPath: readEnv('THUMBGATE_ICON_PATH', DEFAULTS.iconPath),
    supportEmail: readEnv('THUMBGATE_SUPPORT_EMAIL', DEFAULTS.supportEmail),
    productDescription: DEFAULTS.productDescription,
    dryRun: args.dryRun,
  };

  const stripeFactory = require('stripe');
  const stripe = stripeFactory(secretKey);

  try {
    const result = await applyBranding({ stripe, options });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(`${renderHuman(result)}\n`);
    }
  } catch (error) {
    process.stderr.write(`stripe-branding-apply FAILED: ${error.message}\n`);
    if (error.raw) {
      process.stderr.write(`  stripe error code: ${error.raw.code || 'unknown'}\n`);
      process.stderr.write(`  stripe error type: ${error.raw.type || 'unknown'}\n`);
    }
    process.exit(1);
  }
}

if (path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main(process.argv.slice(2));
}

module.exports = { applyBranding, DEFAULTS, parseArgs, renderHuman };
