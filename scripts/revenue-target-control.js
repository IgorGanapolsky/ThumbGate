#!/usr/bin/env node
'use strict';

const { execFileSync } = require('node:child_process');

const { formatLocalDate } = require('./analytics-window');
const { DEFAULT_PUBLIC_APP_ORIGIN } = require('./hosted-config');
const { localDateRange, runAudit } = require('./external-customer-audit');
const { buildRevenueOfferSystem } = require('./revenue-offer-system');
const {
  auditWorkflowCommercialProof,
  loadWorkflowSprintLeadSnapshots,
  loadWorkflowSprintLeads,
} = require('./workflow-sprint-intake');
const { auditProviderEvidenceFiles } = require('./provider-revenue-evidence');
const {
  auditGithubMarketplaceCsvEvidence,
  auditGithubMarketplaceLedgerEvidence,
  auditPayPalLiveEvidence,
} = require('./provider-live-evidence');
const {
  auditSalesPipeline,
  loadSalesLeads,
  summarizeSalesPipeline,
} = require('./sales-pipeline');

const RELEASE_APPROVAL = 'APPROVE PUSH, PR, AND DEPLOY OF THE CHECKOUT AND REVENUE EVIDENCE GATES';
const TARGET_HOURLY_GROSS_CENTS = 100000;
const TARGET_DAILY_GROSS_CENTS = TARGET_HOURLY_GROSS_CENTS * 24;
const TARGET_30_DAY_GROSS_CENTS = TARGET_DAILY_GROSS_CENTS * 30;
const DEFAULT_TIMEOUT_MS = 10000;
const DOCUMENTED_REVENUE_PROVIDERS = Object.freeze({
  stripe: Object.freeze({ role: 'primary_card_and_subscription', requiredForGlobalClaim: true }),
  paypal: Object.freeze({ role: 'documented_fallback', requiredForGlobalClaim: true }),
  merchantOfRecord: Object.freeze({ role: 'documented_digital_product_rail', requiredForGlobalClaim: true }),
  githubMarketplace: Object.freeze({ role: 'tracked_marketplace_provider', requiredForGlobalClaim: true }),
});

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseArgs(argv = [], env = process.env) {
  const values = {};
  for (const arg of argv) {
    if (!arg.startsWith('--') || !arg.includes('=')) continue;
    const separator = arg.indexOf('=');
    values[arg.slice(2, separator)] = arg.slice(separator + 1);
  }
  return {
    json: argv.includes('--json'),
    strict: argv.includes('--strict'),
    pipelinePath: values['pipeline-path'] || null,
    feedbackDir: values['feedback-dir'] || null,
    providerEvidencePaths: {
      paypal: values['paypal-evidence'] || null,
      merchantOfRecord: values['mor-evidence'] || values['merchant-of-record-evidence'] || null,
      githubMarketplace: values['github-marketplace-evidence'] || null,
    },
    providerApiEnabled: !argv.includes('--no-provider-api'),
    githubMarketplaceCsvPath: values['github-marketplace-transactions-csv'] || env.THUMBGATE_GITHUB_MARKETPLACE_TRANSACTIONS_CSV || null,
    githubMarketplaceAppName: values['github-marketplace-app-name'] || env.THUMBGATE_GITHUB_MARKETPLACE_APP_NAME || null,
    githubMarketplaceOwnerAccountIds: String(env.THUMBGATE_GITHUB_MARKETPLACE_OWNER_ACCOUNT_IDS || '')
      .split(',').map((entry) => entry.trim()).filter(Boolean),
    githubMarketplaceOwnerIdentifiersReviewed: env.THUMBGATE_GITHUB_MARKETPLACE_OWNER_IDENTIFIERS_REVIEWED === '1',
    githubMarketplaceCsvScope: values['github-marketplace-csv-scope'] || env.THUMBGATE_GITHUB_MARKETPLACE_CSV_SCOPE || null,
    githubWebhookLedgerPath: values['github-marketplace-webhook-ledger'] || env.THUMBGATE_GITHUB_MARKETPLACE_WEBHOOK_LEDGER_PATH || null,
    morProvider: values['mor-provider'] || env.THUMBGATE_MOR_PROVIDER || null,
    productionOrigin: values['production-origin'] || DEFAULT_PUBLIC_APP_ORIGIN,
    expectedSha: values['expected-sha'] || null,
    now: values.now || undefined,
    timeZone: values.timezone || values['time-zone'] || process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    timeoutMs: parsePositiveInteger(values['timeout-ms'], DEFAULT_TIMEOUT_MS),
  };
}

function normalizeSha(value) {
  const sha = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{7,64}$/.test(sha) ? sha : null;
}

function shasMatch(left, right) {
  const a = normalizeSha(left);
  const b = normalizeSha(right);
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

function getGitHead() {
  try {
    return normalizeSha(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }));
  } catch {
    return null;
  }
}

async function inspectProductionDeployment({
  productionOrigin = DEFAULT_PUBLIC_APP_ORIGIN,
  expectedSha = getGitHead(),
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const healthUrl = new URL('/health', productionOrigin).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(healthUrl, { signal: controller.signal });
    const text = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
    const deployedSha = normalizeSha(payload?.buildSha);
    const healthy = response.ok && (payload?.status === 'ok' || payload?.ok === true);
    return {
      inspected: true,
      healthUrl,
      httpStatus: response.status,
      healthy,
      expectedSha: normalizeSha(expectedSha),
      deployedSha,
      expectedRevisionDeployed: healthy && shasMatch(expectedSha, deployedSha),
      gap: deployedSha ? null : 'Production health did not return a valid buildSha.',
    };
  } catch (error) {
    return {
      inspected: false,
      healthUrl,
      httpStatus: null,
      healthy: false,
      expectedSha: normalizeSha(expectedSha),
      deployedSha: null,
      expectedRevisionDeployed: false,
      gap: `Production health inspection failed: ${error.message}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function revenueSliceReconciles(revenue = null) {
  if (!revenue || revenue.verified !== true || String(revenue.currency || '').toLowerCase() !== 'usd') return false;
  const start = revenue.trailing30DayStartLocalDate;
  const end = revenue.todayLocalDate;
  if (!start || !end) return false;
  const expectedKeys = localDateRange(start, end);
  const gross = revenue.dailyGrossRevenueCents || {};
  const net = revenue.dailyNetRevenueCents || {};
  if (expectedKeys.length !== 30 || JSON.stringify(Object.keys(gross).sort()) !== JSON.stringify(expectedKeys) ||
      JSON.stringify(Object.keys(net).sort()) !== JSON.stringify(expectedKeys)) return false;
  const grossValues = expectedKeys.map((key) => numberOrNull(gross[key]));
  const netValues = expectedKeys.map((key) => numberOrNull(net[key]));
  if (grossValues.some((value) => value === null || value < 0) || netValues.some((value) => value === null || value < 0)) return false;
  return grossValues.reduce((sum, value) => sum + value, 0) === numberOrNull(revenue.trailing30DayGrossRevenueCents) &&
    netValues.reduce((sum, value) => sum + value, 0) === numberOrNull(revenue.trailing30DayNetRevenueCents) &&
    numberOrNull(gross[end]) === numberOrNull(revenue.todayGrossRevenueCents) &&
    numberOrNull(net[end]) === numberOrNull(revenue.todayNetRevenueCents);
}

function sumNullable(entries, field) {
  const values = entries.map((entry) => numberOrNull(entry.revenue?.[field]));
  return values.every((value) => value !== null) ? values.reduce((sum, value) => sum + value, 0) : null;
}

function aggregateProviderRevenue(providers = {}) {
  const entries = Object.values(providers).filter((entry) => entry.aggregateRevenue !== false);
  if (!entries.length || entries.some((entry) => !entry.audited || !revenueSliceReconciles(entry.revenue))) return null;
  const first = entries[0].revenue;
  if (entries.some((entry) => entry.revenue.timeZone !== first.timeZone ||
      entry.revenue.todayLocalDate !== first.todayLocalDate ||
      entry.revenue.trailing30DayStartLocalDate !== first.trailing30DayStartLocalDate)) return null;
  const dates = localDateRange(first.trailing30DayStartLocalDate, first.todayLocalDate);
  const dailyGrossRevenueCents = Object.fromEntries(dates.map((date) => [date,
    entries.reduce((sum, entry) => sum + entry.revenue.dailyGrossRevenueCents[date], 0)]));
  const dailyNetRevenueCents = Object.fromEntries(dates.map((date) => [date,
    entries.reduce((sum, entry) => sum + entry.revenue.dailyNetRevenueCents[date], 0)]));
  return {
    verified: true,
    currency: 'usd',
    basis: 'sum of date-aligned, provider-reconciled ThumbGate revenue slices',
    timeZone: first.timeZone,
    todayLocalDate: first.todayLocalDate,
    trailing30DayStartLocalDate: first.trailing30DayStartLocalDate,
    todayGrossRevenueCents: sumNullable(entries, 'todayGrossRevenueCents'),
    todayNetRevenueCents: sumNullable(entries, 'todayNetRevenueCents'),
    trailing30DayGrossRevenueCents: sumNullable(entries, 'trailing30DayGrossRevenueCents'),
    trailing30DayNetRevenueCents: sumNullable(entries, 'trailing30DayNetRevenueCents'),
    dailyGrossRevenueCents,
    dailyNetRevenueCents,
    externalMrrCents: sumNullable(entries, 'externalMrrCents'),
    activeExternalSubscriptions: sumNullable(entries, 'activeExternalSubscriptions'),
    externalPayingCustomerIdentities: sumNullable(entries, 'externalPayingCustomerIdentities'),
  };
}

function normalizeProcessorAlias(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized === 'stripe') return 'stripe';
  if (normalized === 'paypal') return 'paypal';
  return null;
}

function normalizeIndividualPayments(value, provider, generatedAt) {
  if (value === undefined || value === null) return { ok: true, payments: [], gap: null };
  if (!Array.isArray(value)) return { ok: false, payments: [], gap: `${provider} individual-payment evidence is not an array.` };
  const now = new Date(generatedAt);
  if (Number.isNaN(now.getTime())) return { ok: false, payments: [], gap: 'Control generatedAt is invalid.' };
  const seen = new Set();
  const payments = [];
  for (const [index, payment] of value.entries()) {
    const id = String(payment?.id || '').trim();
    const createdAt = new Date(String(payment?.createdAt || ''));
    const grossCents = payment?.grossCents;
    const refundedCents = payment?.refundedCents;
    const netCents = payment?.netCents;
    const customerId = String(payment?.customerId || '').trim();
    const timeZone = String(payment?.timeZone || '').trim();
    const localDate = String(payment?.localDate || '').trim();
    const evidenceSource = String(payment?.evidenceSource || '').trim();
    const evidenceDigest = String(payment?.evidenceDigest || '').trim();
    const attributed = payment?.productAttribution?.verified === true &&
      String(payment?.productAttribution?.product || '').trim().toLowerCase() === 'thumbgate';
    const external = payment?.customerClassification === 'external' && payment?.ownerTest === false;
    let computedLocalDate = null;
    try {
      computedLocalDate = formatLocalDate(createdAt, timeZone);
    } catch {
      computedLocalDate = null;
    }
    if (payment?.provider !== provider || payment?.evidenceVerified !== true ||
        !id || seen.has(id) || Number.isNaN(createdAt.getTime()) ||
        createdAt.getTime() > now.getTime() + 5 * 60 * 1000 ||
        !Number.isSafeInteger(grossCents) || grossCents <= 0 ||
        !Number.isSafeInteger(refundedCents) || refundedCents < 0 || refundedCents > grossCents ||
        !Number.isSafeInteger(netCents) || netCents <= 0 || netCents !== grossCents - refundedCents ||
        !customerId || (provider === 'paypal' && !/^paypal_[a-f0-9]{24}$/.test(customerId)) ||
        !attributed || !external || computedLocalDate !== localDate ||
        !evidenceSource.startsWith('provider_api_live:') || !/^sha256:[a-f0-9]{64}$/.test(evidenceDigest)) {
      return { ok: false, payments: [], gap: `${provider} individual-payment evidence row ${index} is malformed or unverified.` };
    }
    seen.add(id);
    payments.push({
      provider,
      id,
      createdAt: createdAt.toISOString(),
      localDate,
      timeZone,
      grossCents,
      refundedCents,
      netCents,
      customerId,
      customerClassification: 'external',
      ownerTest: false,
      productAttribution: { verified: true, product: 'thumbgate' },
      evidenceVerified: true,
      evidenceSource,
      evidenceDigest,
      isToday: localDate === formatLocalDate(now, timeZone),
    });
  }
  return { ok: true, payments, gap: null };
}

function normalizeProviderCoverage(input = null, {
  stripeConfigured,
  productAttributionVerified,
  windowAttributionVerified,
  stripeRevenue = null,
  morProvider = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const provided = input && typeof input === 'object' ? input : {};
  const providers = {};
  for (const [provider, definition] of Object.entries(DOCUMENTED_REVENUE_PROVIDERS)) {
    const morProcessorAlias = provider === 'merchantOfRecord' ? normalizeProcessorAlias(morProvider) : null;
    if (morProcessorAlias && providers[morProcessorAlias]) {
      const processor = providers[morProcessorAlias];
      providers[provider] = {
        ...definition,
        audited: processor.audited,
        status: processor.audited ? `covered_by_${morProcessorAlias}_processor` : 'processor_audit_incomplete',
        evidenceVerified: processor.evidenceVerified,
        evidenceSource: processor.evidenceSource,
        evidenceDigest: processor.evidenceDigest,
        revenue: processor.revenue,
        individualPayments: processor.individualPayments,
        individualPaymentGap: processor.individualPaymentGap,
        aggregateRevenue: false,
        processor: morProcessorAlias,
        gap: processor.audited ? null : `The configured Merchant-of-Record role uses ${morProcessorAlias}, whose processor evidence is incomplete.`,
      };
      continue;
    }
    const entry = provided[provider] || {};
    const evidenceSource = typeof entry.evidenceSource === 'string' && entry.evidenceSource.trim()
      ? entry.evidenceSource.trim()
      : null;
    const evidenceVerified = entry.evidenceVerified === true;
    const revenue = entry.revenue || null;
    const individual = normalizeIndividualPayments(entry.individualPayments, provider, generatedAt);
    let audited = entry.audited === true && evidenceVerified && evidenceSource !== null && revenueSliceReconciles(revenue);
    let status = entry.status || (audited ? 'audited' : 'not_audited');
    if (provider === 'stripe' && !provided[provider]) {
      audited = stripeConfigured && productAttributionVerified && windowAttributionVerified && revenueSliceReconciles(stripeRevenue);
      status = audited ? 'product_and_window_attribution_audited' : 'audit_incomplete';
    }
    providers[provider] = {
      ...definition,
      audited,
      status,
      evidenceVerified: provider === 'stripe' && !provided[provider] ? audited : evidenceVerified,
      evidenceSource: provider === 'stripe' && !provided[provider]
        ? (audited ? 'stripe_product_attributed_charge_cohort_audit' : null)
        : evidenceSource,
      evidenceDigest: entry.evidenceDigest || null,
      diagnostics: entry.diagnostics || null,
      revenue: provider === 'stripe' && !provided[provider] ? stripeRevenue : revenue,
      individualPayments: individual.ok ? individual.payments : [],
      individualPaymentGap: individual.gap,
      aggregateRevenue: true,
      processor: provider,
      gap: entry.gap || (audited
        ? null
        : `${provider} revenue is not reconciled with a verified evidence source and exact 30-day slice in this control.`),
    };
  }
  const required = Object.entries(providers).filter(([, entry]) => entry.requiredForGlobalClaim);
  return {
    completeForGlobalClaim: required.every(([, entry]) => entry.audited),
    providers,
    morProvider: String(morProvider || '').trim() || null,
    boundary: 'A global ThumbGate revenue claim requires reconciliation for every documented collection role. When multiple roles use one processor, that processor slice covers each role but enters global arithmetic exactly once.',
  };
}

function buildRevenueTargetControl({
  externalCustomerAudit = null,
  salesLeads = [],
  workflowSprintLeads = [],
  workflowSprintSnapshots = null,
  deployment = {},
  providerCoverage = null,
  morProvider = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const offerSystem = buildRevenueOfferSystem();
  const pipelineSummary = summarizeSalesPipeline(salesLeads);
  const pipelineAudit = auditSalesPipeline(salesLeads);
  const expansionAudit = auditWorkflowCommercialProof(workflowSprintLeads, salesLeads, {
    now: generatedAt,
    workflowSnapshots: Array.isArray(workflowSprintSnapshots) ? workflowSprintSnapshots : workflowSprintLeads,
  });
  const attribution = externalCustomerAudit?.productAttribution || {};
  const thumbgate = attribution.thumbgate || {};
  const revenueWindows = thumbgate.revenueWindows || {};
  const stripeConfigured = externalCustomerAudit?.configured === true;
  const productAttributionVerified = stripeConfigured && attribution.verified === true;
  const windowAttributionVerified = productAttributionVerified && revenueWindows.verified === true;
  const lifetimeNetRevenueCents = productAttributionVerified
    ? numberOrNull(thumbgate.netRevenueCents)
    : null;
  const stripeRevenue = windowAttributionVerified ? {
    verified: true,
    currency: 'usd',
    basis: revenueWindows.basis || 'stripe_product_attributed_charge_cohorts',
    timeZone: revenueWindows.timeZone,
    todayLocalDate: revenueWindows.todayLocalDate,
    trailing30DayStartLocalDate: revenueWindows.trailing30DayStartLocalDate,
    todayGrossRevenueCents: numberOrNull(revenueWindows.todayGrossRevenueCents),
    todayNetRevenueCents: numberOrNull(revenueWindows.todayNetRevenueCents),
    trailing30DayGrossRevenueCents: numberOrNull(revenueWindows.trailing30DayGrossRevenueCents),
    trailing30DayNetRevenueCents: numberOrNull(revenueWindows.trailing30DayNetRevenueCents),
    dailyGrossRevenueCents: revenueWindows.dailyGrossRevenueCents || {},
    dailyNetRevenueCents: revenueWindows.dailyNetRevenueCents || {},
    externalMrrCents: numberOrNull(thumbgate.mrrCents),
    activeExternalSubscriptions: numberOrNull(thumbgate.activeSubscriptionCount),
    externalPayingCustomerIdentities: numberOrNull(thumbgate.uniquePayingCustomerCount),
  } : null;
  const normalizedProviderCoverage = normalizeProviderCoverage(providerCoverage, {
    stripeConfigured,
    productAttributionVerified,
    windowAttributionVerified,
    stripeRevenue,
    morProvider,
    generatedAt,
  });
  const globalRevenue = normalizedProviderCoverage.completeForGlobalClaim
    ? aggregateProviderRevenue(normalizedProviderCoverage.providers)
    : null;
  const todayGrossRevenueCents = numberOrNull(globalRevenue?.todayGrossRevenueCents);
  const todayNetRevenueCents = numberOrNull(globalRevenue?.todayNetRevenueCents);
  const trailing30DayGrossRevenueCents = numberOrNull(globalRevenue?.trailing30DayGrossRevenueCents);
  const trailing30DayNetRevenueCents = numberOrNull(globalRevenue?.trailing30DayNetRevenueCents);
  const externalMrrCents = numberOrNull(globalRevenue?.externalMrrCents);
  const activeExternalSubscriptions = numberOrNull(globalRevenue?.activeExternalSubscriptions);
  const externalPayingCustomers = numberOrNull(globalRevenue?.externalPayingCustomerIdentities);
  const dailyGross = globalRevenue?.dailyGrossRevenueCents || {};
  const dailyNet = globalRevenue?.dailyNetRevenueCents || {};
  const expectedDailyKeys = globalRevenue
    ? localDateRange(globalRevenue.trailing30DayStartLocalDate, globalRevenue.todayLocalDate)
    : [];
  const dailyValues = expectedDailyKeys.map((key) => numberOrNull(dailyGross[key]));
  const dailyNetValues = expectedDailyKeys.map((key) => numberOrNull(dailyNet[key]));
  const dailySeriesReconciled = revenueSliceReconciles(globalRevenue);
  const dailyEvidenceComplete = normalizedProviderCoverage.completeForGlobalClaim && dailySeriesReconciled;
  const daysMeetingDailyTarget = dailyEvidenceComplete
    ? dailyValues.filter((value) => value >= TARGET_DAILY_GROSS_CENTS).length
    : null;
  const daysMeetingDailyNetTarget = dailyEvidenceComplete
    ? dailyNetValues.filter((value) => value >= TARGET_DAILY_GROSS_CENTS).length
    : null;

  const auditedProviderSlices = Object.values(normalizedProviderCoverage.providers)
    .filter((entry) => entry.audited && entry.revenue && entry.aggregateRevenue !== false);
  const verifiedIndividualPayments = Object.values(normalizedProviderCoverage.providers)
    .filter((entry) => entry.aggregateRevenue !== false)
    .flatMap((entry) => entry.individualPayments || []);
  const firstExternalPaymentAchieved = (productAttributionVerified && lifetimeNetRevenueCents > 0 &&
    numberOrNull(thumbgate.uniquePayingCustomerCount) > 0) || auditedProviderSlices.some((entry) =>
    numberOrNull(entry.revenue.trailing30DayNetRevenueCents) > 0 &&
    numberOrNull(entry.revenue.externalPayingCustomerIdentities) > 0) || verifiedIndividualPayments.length > 0;
  const sameDayPaymentAchieved = auditedProviderSlices.some((entry) =>
    numberOrNull(entry.revenue.todayGrossRevenueCents) > 0 && numberOrNull(entry.revenue.todayNetRevenueCents) > 0) ||
    verifiedIndividualPayments.some((payment) => payment.isToday === true);
  const recurringRevenueAchieved = auditedProviderSlices.some((entry) =>
    numberOrNull(entry.revenue.externalMrrCents) > 0 && numberOrNull(entry.revenue.activeExternalSubscriptions) > 0);
  const productizedRecurringRevenueAchieved = expansionAudit.verifiedRecurringCount > 0;
  const enterpriseRevenueAchieved = expansionAudit.verifiedEnterpriseCount > 0;
  const trailing30AverageHourlyGrossCents = trailing30DayGrossRevenueCents === null
    ? null
    : trailing30DayGrossRevenueCents / (30 * 24);
  const revenueThresholdAchieved = dailyEvidenceComplete &&
    trailing30DayGrossRevenueCents >= TARGET_30_DAY_GROSS_CENTS &&
    trailing30DayNetRevenueCents >= TARGET_30_DAY_GROSS_CENTS &&
    daysMeetingDailyTarget === 30 &&
    daysMeetingDailyNetTarget === 30;
  const controlRevisionDeployed = deployment.healthy === true && deployment.expectedRevisionDeployed === true;
  const targetVerified = revenueThresholdAchieved &&
    controlRevisionDeployed;

  const gaps = [];
  if (!stripeConfigured) gaps.push(externalCustomerAudit?.gap || 'Stripe revenue audit is not configured.');
  if (stripeConfigured && !productAttributionVerified) {
    gaps.push(attribution.gap || 'ThumbGate product attribution is not verified.');
  }
  if (productAttributionVerified && !windowAttributionVerified) {
    gaps.push(revenueWindows.gap || 'Product-attributed time-window revenue is not verified.');
  }
  if (!firstExternalPaymentAchieved) gaps.push('No provider-verified ThumbGate external payment is proven. Missing providers are not inferred as zero.');
  if (!sameDayPaymentAchieved) gaps.push('No provider-verified positive ThumbGate external payment is proven for today.');
  if (!recurringRevenueAchieved) gaps.push('No active provider-verified ThumbGate external recurring revenue is proven.');
  if (!productizedRecurringRevenueAchieved) {
    gaps.push('No productized recurring service has exact signed-scope, buyer, offer, amount, current billing period, and provider-payment reconciliation.');
  }
  if (!enterpriseRevenueAchieved) {
    gaps.push('No Enterprise offer has exact signed-scope, buyer, offer, amount, and provider-payment reconciliation.');
  }
  if (!expansionAudit.ok) {
    gaps.push(`${expansionAudit.unverifiedPaidTeamCount} paid-team record(s) fail commercial-proof reconciliation.`);
  }
  if (!normalizedProviderCoverage.completeForGlobalClaim) {
    const missingProviders = Object.entries(normalizedProviderCoverage.providers)
      .filter(([, entry]) => entry.requiredForGlobalClaim && !entry.audited)
      .map(([provider]) => provider);
    gaps.push(`Global revenue proof is incomplete because these documented providers are not reconciled: ${missingProviders.join(', ')}.`);
  }
  if (normalizedProviderCoverage.completeForGlobalClaim && !globalRevenue) {
    gaps.push('Provider slices are individually valid but their dates or time zones do not align for global aggregation.');
  }
  if (!pipelineAudit.ok) gaps.push(`${pipelineAudit.unverified} sales pipeline record(s) lack stage evidence.`);
  if (pipelineSummary.paid === 0) gaps.push('No sales pipeline record has verified paid-stage evidence.');
  if (!dailyEvidenceComplete) gaps.push('The exact 30-day product-attributed gross and net series is missing or does not reconcile to its window totals.');
  if (dailyEvidenceComplete && daysMeetingDailyTarget < 30) {
    gaps.push(`${30 - daysMeetingDailyTarget} of 30 day(s) are below the $24,000 daily gross target.`);
  }
  if (dailyEvidenceComplete && daysMeetingDailyNetTarget < 30) {
    gaps.push(`${30 - daysMeetingDailyNetTarget} of 30 day(s) are below the $24,000 daily refund-adjusted cohort-net target.`);
  }
  if (!controlRevisionDeployed) {
    gaps.push(deployment.gap || 'Production buildSha does not match the revenue-control revision.');
  }

  let status = 'not_achieved';
  if (!stripeConfigured || !productAttributionVerified || !windowAttributionVerified ||
      !normalizedProviderCoverage.completeForGlobalClaim || !globalRevenue) {
    status = 'evidence_incomplete';
  } else if (targetVerified) {
    status = 'target_achieved_verified';
  } else if (firstExternalPaymentAchieved || recurringRevenueAchieved) {
    status = 'traction_below_target';
  }

  let nextAction = 'VERIFY STRIPE PRODUCT ATTRIBUTION AND TIME-WINDOW REVENUE';
  if (!controlRevisionDeployed) {
    nextAction = RELEASE_APPROVAL;
  } else if (!normalizedProviderCoverage.completeForGlobalClaim) {
    nextAction = 'CONFIGURE OR REFRESH READ-ONLY PROVIDER REVENUE EVIDENCE';
  } else if (!pipelineAudit.ok) {
    nextAction = 'RECONCILE SALES-PIPELINE RECEIPTS BEFORE NEW OUTREACH';
  } else if (!firstExternalPaymentAchieved) {
    nextAction = 'APPROVE ONE VALUE-FIRST MESSAGE TO ONE QUALIFIED BUYER';
  } else if (!productizedRecurringRevenueAchieved) {
    nextAction = 'QUALIFY THE FIRST PAID CUSTOMER FOR A FIXED-SCOPE RECURRING OPERATIONS PROPOSAL';
  } else if (!enterpriseRevenueAchieved) {
    nextAction = 'QUALIFY ONE PROOF-BACKED BUYER FOR THE FIXED-SCOPE ENTERPRISE GOVERNANCE PILOT';
  } else if (!targetVerified) {
    nextAction = 'CLOSE THE VERIFIED DAILY REVENUE GAP WITHOUT PAID ACQUISITION';
  } else {
    nextAction = 'MAINTAIN PROVIDER VERIFICATION AND THE 30-DAY DAILY REVENUE FLOOR';
  }

  return {
    generatedAt,
    status,
    claim: targetVerified
      ? 'The $1,000/hour, every-day 30-day gross revenue control is verified for this evidence snapshot.'
      : 'The $1,000/hour target is not verified by this evidence snapshot.',
    target: {
      hourlyGrossCents: TARGET_HOURLY_GROSS_CENTS,
      dailyGrossCents: TARGET_DAILY_GROSS_CENTS,
      trailing30DayGrossCents: TARGET_30_DAY_GROSS_CENTS,
      definition: 'Globally reconciled ThumbGate gross and refund-adjusted net must each be at least $24,000 on every one of 30 consecutive local calendar days. Every documented collection provider must contribute an exact, date-aligned, USD revenue slice; missing evidence is unknown, never zero. Arithmetic, pipeline, checkout status, owner tests, and account-wide cash do not count.',
    },
    actual: {
      scope: globalRevenue ? 'all_documented_providers_reconciled' : 'global_revenue_unverified',
      todayGrossRevenueCents,
      todayNetRevenueCents,
      trailing30DayGrossRevenueCents,
      trailing30DayNetRevenueCents,
      trailing30AverageHourlyGrossCents,
      lifetimeNetRevenueCents: null,
      stripeLifetimeNetRevenueCents: lifetimeNetRevenueCents,
      externalMrrCents,
      activeExternalSubscriptions,
      externalPayingCustomerIdentities: externalPayingCustomers,
      daysWithCompleteEvidence: dailyEvidenceComplete ? dailyValues.length : 0,
      daysMeetingDailyTarget,
      daysMeetingDailyNetTarget,
      providerScoped: Object.fromEntries(Object.entries(normalizedProviderCoverage.providers).map(([provider, entry]) => [provider, {
        audited: entry.audited,
        processor: entry.processor,
        aggregateRevenue: entry.aggregateRevenue,
        revenue: entry.audited ? entry.revenue : null,
      }])),
    },
    milestones: {
      firstExternalPayment: { achieved: firstExternalPaymentAchieved, verifiedIndividualPaymentCount: verifiedIndividualPayments.length },
      sameDayExternalPayment: {
        achieved: sameDayPaymentAchieved,
        verifiedIndividualPaymentCount: verifiedIndividualPayments.filter((payment) => payment.isToday === true).length,
      },
      externalRecurringRevenue: { achieved: recurringRevenueAchieved },
      productizedRecurringRevenue: {
        achieved: productizedRecurringRevenueAchieved,
        verifiedContractCount: expansionAudit.verifiedRecurringCount,
        verifiedRevenueCents: expansionAudit.verifiedRecurringRevenueCents,
        historicalContractCount: expansionAudit.historicalRecurringCount,
        scheduledContractCount: expansionAudit.scheduledRecurringCount,
      },
      enterpriseRevenue: {
        achieved: enterpriseRevenueAchieved,
        verifiedContractCount: expansionAudit.verifiedEnterpriseCount,
      },
      thirtyConsecutiveTargetDays: { achieved: revenueThresholdAchieved },
      targetWithCurrentControlDeployed: { achieved: targetVerified },
    },
    evidence: {
      stripeConfigured,
      productAttributionVerified,
      windowAttributionVerified,
      revenueWindowBasis: globalRevenue?.basis || null,
      dailySeriesReconciled,
      timeZone: revenueWindows.timeZone || null,
      todayLocalDate: revenueWindows.todayLocalDate || null,
      trailing30DayStartLocalDate: revenueWindows.trailing30DayStartLocalDate || null,
      pipeline: {
        auditOk: pipelineAudit.ok,
        total: pipelineSummary.total,
        verifiedPaid: pipelineSummary.paid,
        bookedRevenueCents: pipelineSummary.bookedRevenueCents,
        evidenceGapCount: pipelineSummary.evidenceGapCount,
      },
      expansionCommercialProof: expansionAudit,
      deployment,
      providerCoverage: normalizedProviderCoverage,
    },
    offerSystem: {
      status: offerSystem.status,
      offerCount: Object.keys(offerSystem.offers).length,
      proofRule: offerSystem.proofRule,
    },
    zeroSpend: {
      paidAcquisitionAllowed: false,
      sellerFeesAllowed: false,
      revenueShareAllowed: false,
      verificationBoundary: 'Policy enforcement only; this control does not claim to be a complete financial-ledger audit of seller spend.',
    },
    gaps,
    nextAction,
  };
}

function dollars(cents) {
  return cents === null ? 'UNVERIFIED' : `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

function renderMarkdown(control) {
  return [
    '# Revenue Target Control',
    '',
    `Generated: ${control.generatedAt}`,
    `Status: ${control.status}`,
    `Verdict: ${control.claim}`,
    '',
    `- Today attributed gross: ${dollars(control.actual.todayGrossRevenueCents)}`,
    `- Trailing 30-day attributed gross: ${dollars(control.actual.trailing30DayGrossRevenueCents)}`,
    `- Attributed MRR: ${dollars(control.actual.externalMrrCents)}`,
    `- Verified productized recurring contracts: ${control.milestones.productizedRecurringRevenue.verifiedContractCount}`,
    `- Verified Enterprise contracts: ${control.milestones.enterpriseRevenue.verifiedContractCount}`,
    `- Days meeting $24,000: ${control.actual.daysMeetingDailyTarget ?? 'UNVERIFIED'}/30`,
    `- Current control deployed: ${control.evidence.deployment.expectedRevisionDeployed === true}`,
    '',
    '## Gaps',
    '',
    ...control.gaps.map((gap) => `- ${gap}`),
    '',
    `Next approval/action: ${control.nextAction}`,
    '',
  ].join('\n');
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const expectedSha = normalizeSha(options.expectedSha) || getGitHead();
  const [externalCustomerAudit, deployment, paypalLiveEvidence] = await Promise.all([
    runAudit({ now: options.now, timeZone: options.timeZone }),
    inspectProductionDeployment({
      productionOrigin: options.productionOrigin,
      expectedSha,
      timeoutMs: options.timeoutMs,
    }),
    options.providerApiEnabled && !options.providerEvidencePaths.paypal
      ? auditPayPalLiveEvidence({ now: options.now, timeZone: options.timeZone })
      : Promise.resolve(null),
  ]);
  const salesLeadOptions = options.pipelinePath
    ? { statePath: options.pipelinePath }
    : { feedbackDir: options.feedbackDir };
  const salesLeads = loadSalesLeads(salesLeadOptions);
  const workflowSprintLeads = loadWorkflowSprintLeads(options.feedbackDir);
  const workflowSprintSnapshots = loadWorkflowSprintLeadSnapshots(options.feedbackDir);
  const providerCoverage = auditProviderEvidenceFiles({
    paths: options.providerEvidencePaths,
    now: options.now,
    timeZone: options.timeZone,
  });
  if (!options.providerEvidencePaths.paypal && paypalLiveEvidence) {
    providerCoverage.paypal = paypalLiveEvidence;
  }
  if (!options.providerEvidencePaths.githubMarketplace) {
    providerCoverage.githubMarketplace = options.githubMarketplaceCsvPath
      ? auditGithubMarketplaceCsvEvidence({
          csvPath: options.githubMarketplaceCsvPath,
          expectedAppName: options.githubMarketplaceAppName,
          ownerAccountIds: options.githubMarketplaceOwnerAccountIds,
          ownerIdentifiersReviewed: options.githubMarketplaceOwnerIdentifiersReviewed,
          exportScope: options.githubMarketplaceCsvScope,
          now: options.now,
          timeZone: options.timeZone,
        })
      : auditGithubMarketplaceLedgerEvidence({
          ledgerPath: options.githubWebhookLedgerPath,
          secret: process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET || '',
          now: options.now,
          timeZone: options.timeZone,
        });
  }
  const control = buildRevenueTargetControl({
    externalCustomerAudit,
    salesLeads,
    workflowSprintLeads,
    workflowSprintSnapshots,
    deployment,
    providerCoverage,
    morProvider: options.morProvider,
    generatedAt: options.now || new Date().toISOString(),
  });
  process.stdout.write(options.json ? `${JSON.stringify(control, null, 2)}\n` : renderMarkdown(control));
  if (options.strict && control.status !== 'target_achieved_verified') process.exitCode = 2;
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  DOCUMENTED_REVENUE_PROVIDERS,
  RELEASE_APPROVAL,
  TARGET_30_DAY_GROSS_CENTS,
  TARGET_DAILY_GROSS_CENTS,
  TARGET_HOURLY_GROSS_CENTS,
  aggregateProviderRevenue,
  buildRevenueTargetControl,
  getGitHead,
  inspectProductionDeployment,
  normalizeSha,
  normalizeProviderCoverage,
  normalizeProcessorAlias,
  parseArgs,
  renderMarkdown,
  revenueSliceReconciles,
  shasMatch,
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`revenue-target-control FAILED: ${error.message}\n`);
    process.exit(1);
  });
}
