#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { runAudit: auditStripeLiveEvidence } = require('./external-customer-audit');
const { auditPayPalLiveEvidence } = require('./provider-live-evidence');
const { digestBuyerEmail } = require('./provider-revenue-evidence');
const { OFFER_CATALOG } = require('./revenue-offer-system');
const {
  VERIFIED_PAYMENT_DIGEST_PATTERN,
  VERIFIED_PAYMENT_SOURCE_PATTERN,
  advanceSalesLead,
  getSalesPipelinePath,
  loadSalesLeads,
} = require('./sales-pipeline');

function normalizeRequiredText(value, label, maxLength = 1000) {
  const text = String(value || '').trim().slice(0, maxLength);
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function parseArgs(argv = []) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const eqIndex = arg.indexOf('=', 2);
    const rawKey = eqIndex === -1 ? arg.slice(2) : arg.slice(2, eqIndex);
    const key = rawKey.replaceAll(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (eqIndex !== -1) {
      options[key] = arg.slice(eqIndex + 1);
      continue;
    }
    const nextArg = argv[index + 1];
    if (nextArg && !nextArg.startsWith('--')) {
      options[key] = nextArg;
      index += 1;
      continue;
    }
    options[key] = true;
  }
  return options;
}

const SUPPORTED_PAYMENT_PROVIDERS = new Set(['paypal', 'stripe']);

function offer(id, leadOffers = [id]) {
  return Object.freeze([id, Object.freeze(leadOffers)]);
}

const OFFERS = Object.freeze({
  [OFFER_CATALOG.workflow_hardening_diagnostic.priceCents]: offer(
    'workflow_hardening_diagnostic', ['workflow_hardening_diagnostic', 'workflow_diagnostic']),
  [OFFER_CATALOG.workflow_hardening_sprint.priceCents]: offer('workflow_hardening_sprint'),
  [OFFER_CATALOG.workflow_hardening_sprint.priceCents
    - OFFER_CATALOG.workflow_hardening_diagnostic.priceCents]: offer(
    'workflow_hardening_sprint_diagnostic_credit_balance', ['workflow_hardening_sprint']),
  [OFFER_CATALOG.pro.priceCents]: offer('pro_monthly', ['pro', 'pro_self_serve', 'pro_monthly']),
  [OFFER_CATALOG.pro.annualPriceCents]: offer('pro_annual', ['pro', 'pro_self_serve', 'pro_annual']),
  4900: offer('team_monthly_legacy', ['team', 'team_monthly_legacy']),
  [OFFER_CATALOG.workflow_reliability_operations.priceCents]: offer('workflow_reliability_operations'),
  [OFFER_CATALOG.enterprise_governance_pilot.priceCents]: offer('enterprise_governance_pilot'),
  [OFFER_CATALOG.enterprise_reliability_operations.priceCents]: offer('enterprise_reliability_operations'),
});

function offerIdsFor(payment = {}) {
  const attribution = payment.productAttribution || {};
  const values = [
    ...(Array.isArray(payment.offerIds) ? payment.offerIds : []),
    payment.offerId,
    ...(Array.isArray(attribution.offerIds) ? attribution.offerIds : []),
    attribution.offerId,
  ];
  return [...new Set(values
    .map((value) => String(value || '').trim().slice(0, 120))
    .filter(Boolean))].sort();
}

function matchPaymentOffer(payment = {}, lead = {}) {
  const leadOffer = String(lead.offer || '').trim();
  const identity = OFFERS[payment.grossCents];
  if (!identity) {
    throw new Error(`${payment.provider} payment ${payment.id} amount has no exact ThumbGate offer.`);
  }
  const [offerId, leadOffers] = identity;
  const offerIds = Array.isArray(payment.offerIds) ? payment.offerIds : [];
  if (payment.provider === 'stripe' && offerIds.length !== 1) {
    throw new Error(`Stripe ${payment.id} requires one catalog offer ID.`);
  }
  if (payment.provider === 'paypal' && offerIds.length > 1) {
    throw new Error(`PayPal ${payment.id} has multiple offer IDs.`);
  }
  if (offerIds.length === 1 && offerIds[0] !== offerId) {
    throw new Error(`${payment.provider} payment ${payment.id} offer disagrees with amount.`);
  }
  if (!leadOffers.includes(leadOffer)) {
    throw new Error(`${payment.provider} payment ${payment.id} is for ${offerId}, not ${leadOffer || '(missing)'}.`);
  }
  const buyerDigest = digestBuyerEmail(lead.contact?.email);
  if (!buyerDigest) {
    throw new Error(`Sales lead ${lead.leadId || '(missing)'} needs buyer email.`);
  }
  if (payment.buyerEmailDigest !== buyerDigest) {
    throw new Error(`${payment.provider} payment ${payment.id} buyer does not match lead ${lead.leadId || '(missing)'}.`);
  }
  return {
    paymentOfferId: offerId,
    buyerEmailDigest: buyerDigest,
  };
}

function validateVerifiedPayment(payment = {}, expectedId, expectedProvider = 'paypal', { auditedAt } = {}) {
  const paymentId = String(payment.id || '').trim();
  const provider = String(payment.provider || '').trim().toLowerCase();
  const evidenceSource = String(payment.evidenceSource || '').trim();
  const evidenceDigest = String(payment.evidenceDigest || '').trim().toLowerCase();
  const status = String(payment.status || '').trim().toLowerCase();
  const grossCents = payment.grossCents;
  const refundedCents = payment.refundedCents;
  const netCents = payment.netCents;
  const currency = String(payment.currency || '').trim().toLowerCase();
  const createdAt = new Date(String(payment.createdAt || ''));
  const auditTime = new Date(String(auditedAt || ''));
  const productAttribution = payment.productAttribution || {};
  const invoiceId = String(payment.invoiceId || '').trim().slice(0, 127) || null;
  const offerIds = offerIdsFor(payment);
  const buyerEmailDigest = String(payment.buyerEmailDigest || '').trim().toLowerCase();

  if (paymentId !== expectedId || provider !== expectedProvider ||
      !SUPPORTED_PAYMENT_PROVIDERS.has(provider) || payment.evidenceVerified !== true
      || !VERIFIED_PAYMENT_SOURCE_PATTERN.test(evidenceSource)
      || !VERIFIED_PAYMENT_DIGEST_PATTERN.test(evidenceDigest)
      || !Number.isSafeInteger(grossCents) || grossCents <= 0
      || !Number.isSafeInteger(refundedCents) || refundedCents < 0 || refundedCents > grossCents
      || !Number.isSafeInteger(netCents) || netCents < 0 || netCents !== grossCents - refundedCents
      || currency !== 'usd'
      || !/^sha256:[a-f0-9]{64}$/.test(buyerEmailDigest)
      || (netCents === 0 ? status !== 'refunded' : !['completed', 'partially_refunded'].includes(status))
      || Number.isNaN(createdAt.getTime())
      || Number.isNaN(auditTime.getTime()) || createdAt.getTime() > auditTime.getTime() + 5 * 60 * 1000
      || payment.customerClassification !== 'external' || payment.ownerTest !== false
      || productAttribution.verified !== true
      || String(productAttribution.product || '').trim().toLowerCase() !== 'thumbgate') {
    throw new Error(`${expectedProvider} payment is malformed or lacks verified evidence.`);
  }

  return {
    provider,
    id: paymentId,
    status,
    grossCents,
    refundedCents,
    netCents,
    currency,
    createdAt: createdAt.toISOString(),
    evidenceSource,
    evidenceDigest,
    invoiceId,
    offerIds,
    buyerEmailDigest,
  };
}

function findPaymentUse(leads, payment) {
  for (const lead of leads) {
    for (const event of [...(lead.history || [])].reverse()) {
      const evidence = event.evidence || {};
      if (['provider_payment', 'provider_refund'].includes(evidence.kind)
          && evidence.provider === payment.provider
          && evidence.reference === payment.id
          && evidence.verified === true) {
        return { leadId: lead.leadId, event };
      }
    }
  }
  return null;
}

async function withPaymentReconciliationLock(statePath, operation, options = {}) {
  const lockPath = `${statePath}.reconcile.lock`;
  const retryDelayMs = options.retryDelayMs || 10;
  const maxAttempts = options.maxAttempts || 400;
  const staleAfterMs = options.staleAfterMs || 30_000;
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  let acquired = false;
  for (let attempt = 0; attempt < maxAttempts && !acquired; attempt += 1) {
    try {
      fs.mkdirSync(lockPath);
      acquired = true;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > staleAfterMs) {
          fs.rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch (statError) {
        if (statError?.code !== 'ENOENT') throw statError;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  if (!acquired) throw new Error('Sales payment reconciliation is busy; retry after the active reconciliation finishes.');
  try {
    return await operation();
  } finally {
    fs.rmSync(lockPath, { recursive: true, force: true });
  }
}

async function reconcileProviderPayment(payload = {}, options = {}) {
  const leadId = normalizeRequiredText(payload.leadId || payload.lead, 'leadId', 160);
  const paymentId = normalizeRequiredText(payload.paymentId || payload.payment, 'paymentId', 1000);
  const provider = String(payload.provider || 'paypal').trim().toLowerCase();
  if (!SUPPORTED_PAYMENT_PROVIDERS.has(provider)) {
    throw new Error(`provider must be one of: ${[...SUPPORTED_PAYMENT_PROVIDERS].join(', ')}.`);
  }

  const stateOptions = {
    statePath: options.statePath || payload.statePath || null,
    feedbackDir: options.feedbackDir || payload.feedbackDir || null,
  };
  const preflightLead = loadSalesLeads(stateOptions).find((entry) => entry.leadId === leadId);
  if (!preflightLead) throw new Error(`Unknown sales lead: ${leadId}`);

  const auditOptions = {
    env: options.env || process.env,
    now: options.now || payload.now,
    timeZone: options.timeZone || payload.timeZone,
  };
  const audit = provider === 'paypal'
    ? await (options.auditPayPalLiveEvidence || auditPayPalLiveEvidence)({
      ...auditOptions,
      fetchImpl: options.fetchImpl,
    })
    : await (options.auditStripeLiveEvidence || auditStripeLiveEvidence)({
      ...auditOptions,
      stripeClient: options.stripeClient,
      stripeFactory: options.stripeFactory,
      secretKey: options.stripeSecretKey,
      secretPaths: options.secretPaths,
    });
  const auditedAt = new Date(String(audit?.generatedAt || options.now || payload.now || new Date().toISOString()));
  const reconciliationAt = Number.isNaN(auditedAt.getTime())
    ? new Date().toISOString()
    : auditedAt.toISOString();
  const stripeEvidence = audit?.productAttribution?.thumbgate || {};
  const candidates = provider === 'stripe'
    ? (Array.isArray(stripeEvidence.individualPaymentStates)
      ? stripeEvidence.individualPaymentStates
      : (Array.isArray(audit?.individualPaymentStates) ? audit.individualPaymentStates : []))
    : (Array.isArray(audit?.individualPaymentStates)
      ? audit.individualPaymentStates
      : (Array.isArray(audit?.individualPayments) ? audit.individualPayments : []));
  const candidate = candidates.find((payment) => String(payment?.id || '').trim() === paymentId);
  if (!candidate) {
    const gap = String(audit?.gap || '').trim();
    throw new Error(gap
      ? `Live ${provider} audit did not verify payment ${paymentId}: ${gap}`
      : `Live ${provider} audit did not verify payment ${paymentId}.`);
  }
  const payment = validateVerifiedPayment(candidate, paymentId, provider, {
    auditedAt: reconciliationAt,
  });

  return withPaymentReconciliationLock(getSalesPipelinePath(stateOptions), () => {
  const leads = loadSalesLeads(stateOptions);
  const lead = leads.find((entry) => entry.leadId === leadId);
  if (!lead) throw new Error(`Unknown sales lead: ${leadId}`);
  const offerMatch = matchPaymentOffer(payment, lead);
  const existingUse = findPaymentUse(leads, payment);
  if (existingUse && existingUse.leadId !== leadId) {
    throw new Error(`${provider} payment ${paymentId} is already attributed to another sales lead.`);
  }
  if (payment.netCents === 0) {
    if (!existingUse || existingUse.leadId !== leadId || !['paid', 'lost'].includes(lead.stage)) {
      throw new Error(`Fully refunded ${provider} payment ${paymentId} cannot create a new paid pipeline record.`);
    }
    if (lead.stage === 'lost' && existingUse.event.evidence.kind === 'provider_refund') {
      return {
        provider: payment.provider,
        paymentId: payment.id,
        leadId,
        stage: lead.stage,
        amountCents: lead.revenue.amountCents,
        currency: lead.revenue.currency,
        offerId: offerMatch.paymentOfferId,
        evidenceDigest: existingUse.event.evidence.digest,
        reverifiedEvidenceDigest: payment.evidenceDigest,
        unchanged: true,
        statePath: getSalesPipelinePath(stateOptions),
      };
    }
    if (lead.stage !== 'paid') {
      throw new Error(`Sales lead ${leadId} cannot apply a full refund from stage ${lead.stage}.`);
    }
    const refunded = advanceSalesLead({
      leadId,
      stage: 'lost',
      amountCents: 0,
      currency: 'usd',
      timestamp: reconciliationAt,
      evidenceKind: 'provider_refund',
      evidenceProvider: payment.provider,
      evidenceSource: payment.evidenceSource,
      evidenceRef: payment.id,
      evidenceVerified: true,
      evidenceDigest: payment.evidenceDigest,
      evidenceInvoiceId: payment.invoiceId,
      evidenceOfferId: offerMatch.paymentOfferId,
      evidenceBuyerDigest: offerMatch.buyerEmailDigest,
      actor: 'provider-reconciliation',
      note: `Paid status retired after authenticated live ${provider} evidence verified a full refund.`,
    }, stateOptions);
    return {
      provider: payment.provider,
      paymentId: payment.id,
      leadId,
      stage: refunded.lead.stage,
      amountCents: refunded.lead.revenue.amountCents,
      currency: refunded.lead.revenue.currency,
      offerId: offerMatch.paymentOfferId,
      evidenceDigest: payment.evidenceDigest,
      unchanged: refunded.unchanged,
      statePath: getSalesPipelinePath(stateOptions),
    };
  }
  const existingBindingMatches = existingUse?.event?.evidence?.offerId === offerMatch.paymentOfferId
    && existingUse?.event?.evidence?.buyerDigest === offerMatch.buyerEmailDigest;
  if (existingUse && existingUse.leadId === leadId && lead.stage === 'paid'
      && lead.revenue.amountCents === payment.netCents && existingBindingMatches) {
    return {
      provider: payment.provider,
      paymentId: payment.id,
      leadId,
      stage: lead.stage,
      amountCents: lead.revenue.amountCents,
      currency: lead.revenue.currency,
      offerId: offerMatch.paymentOfferId,
      evidenceDigest: existingUse.event.evidence.digest,
      reverifiedEvidenceDigest: payment.evidenceDigest,
      unchanged: true,
      statePath: getSalesPipelinePath(stateOptions),
    };
  }
  if (existingUse && existingUse.leadId === leadId && lead.stage !== 'paid') {
    throw new Error(`Sales lead ${leadId} cannot restore paid revenue from stage ${lead.stage}.`);
  }
  if (lead.stage === 'paid') {
    if (!existingUse) throw new Error(`Sales lead ${leadId} is already paid with different evidence.`);
  }

  const upgradesLegacyBinding = Boolean(existingUse
    && lead.revenue.amountCents === payment.netCents
    && !existingBindingMatches);

  const result = advanceSalesLead({
    leadId,
    stage: 'paid',
    amountCents: payment.netCents,
    currency: 'usd',
    timestamp: existingUse ? reconciliationAt : payment.createdAt,
    evidenceKind: 'provider_payment',
    evidenceProvider: payment.provider,
    evidenceSource: payment.evidenceSource,
    evidenceRef: payment.id,
    evidenceVerified: true,
    evidenceDigest: payment.evidenceDigest,
    evidenceInvoiceId: payment.invoiceId,
    evidenceOfferId: offerMatch.paymentOfferId,
    evidenceBuyerDigest: offerMatch.buyerEmailDigest,
    actor: 'provider-reconciliation',
    note: existingUse
      ? (upgradesLegacyBinding
        ? `Live ${provider} buyer and offer binding added.`
        : `Paid amount updated from authenticated live ${provider} refund-adjusted evidence.`)
      : `Paid status reconciled from authenticated live ${provider} evidence.`,
    force: payload.force === true,
  }, stateOptions);

  return {
    provider: payment.provider,
    paymentId: payment.id,
    leadId,
    stage: result.lead.stage,
    amountCents: result.lead.revenue.amountCents,
    currency: result.lead.revenue.currency,
    offerId: offerMatch.paymentOfferId,
    evidenceDigest: payment.evidenceDigest,
    unchanged: result.unchanged,
    statePath: getSalesPipelinePath(stateOptions),
  };
  });
}

async function runCli(argv = process.argv.slice(2), options = {}) {
  const args = parseArgs(argv);
  return reconcileProviderPayment({
    leadId: args.lead || args.leadId,
    paymentId: args.payment || args.paymentId,
    provider: args.provider,
    force: args.force === true,
    now: args.now,
    timeZone: args.timeZone,
  }, {
    ...options,
    statePath: args.state || options.statePath,
    feedbackDir: args.feedbackDir || options.feedbackDir,
  });
}

function isCliInvocation(argv = process.argv) {
  const invokedPath = argv[1];
  if (!invokedPath) return false;
  try {
    return fs.realpathSync(path.resolve(invokedPath)) === fs.realpathSync(__filename);
  } catch {
    return path.resolve(invokedPath) === path.resolve(__filename);
  }
}

if (isCliInvocation()) {
  runCli()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error?.message || error);
      process.exitCode = 1;
    });
}

module.exports = {
  findPaymentUse,
  isCliInvocation,
  parseArgs,
  reconcileProviderPayment,
  runCli,
  validateVerifiedPayment,
  withPaymentReconciliationLock,
};
