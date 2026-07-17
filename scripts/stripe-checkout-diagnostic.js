#!/usr/bin/env node
/**
 * stripe-checkout-diagnostic.js — answer "WHY did 1000 checkout sessions
 * produce 0 completed payments?"
 *
 * Background. The external-customer audit found a large number of raw Stripe
 * Checkout sessions with no completions. A raw session is not proof that a
 * buyer reached checkout: crawlers, monitors, owner verification, and route
 * probes can all create sessions. This script separates session creation from
 * stronger intent and payment evidence before proposing a cause.
 *
 * What this exposes:
 *   1. Checkout session terminal status breakdown (complete / expired /
 *      open / etc) plus payment_intent status when present.
 *   2. PaymentIntent last_payment_error reasons (decline codes, network
 *      rejections, fraud blocks).
 *   3. Stripe Account requirements — currently_due, past_due,
 *      eventually_due — the explicit fields blocking the account from
 *      processing payments normally.
 *   4. Charges_enabled / payouts_enabled / disabled_reason on the account.
 *   5. Webhook endpoint health — when did we last receive a
 *      checkout.session.completed event vs the last attempt.
 *
 * This is the diagnostic that should run BEFORE anyone speculates about
 * "is the checkout broken" — it produces hard data on which exact failure
 * mode is biting.
 *
 * Run modes:
 *   node scripts/stripe-checkout-diagnostic.js           # markdown report
 *   node scripts/stripe-checkout-diagnostic.js --json    # machine output
 *
 * Required env:
 *   STRIPE_SECRET_KEY     live Stripe key (read access)
 */

'use strict';

const path = require('node:path');
const { parseCheckoutReference } = require('./checkout-attribution-reference');

function parseArgs(argv = []) {
  return {
    json: argv.includes('--json'),
    // Default raised from 100 to 10000 to match the audit's uncapped posture.
    // A diagnostic framed around "lifetime 2000+ sessions" should look at
    // the lifetime, not a 100-row sample. Caller can pass --limit=N to
    // restrict for development.
    limit: extractIntFlag(argv, '--limit=', 10000),
  };
}

function extractIntFlag(argv, prefix, fallback) {
  const match = argv.find((arg) => arg.startsWith(prefix));
  if (!match) return fallback;
  const n = Number(match.slice(prefix.length));
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function loadStripe(requireFn = require) {
  return requireFn('stripe');
}

async function listAllPaged(listFn, params = {}, max = 100000) {
  // Default raised from 1000 to 100,000 to match external-customer-audit's
  // uncapped posture (Codex P1). The cap is a runaway-guard, not a silent
  // truncator. Tests pass a small max to exercise the bound explicitly.
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

function bucketSessions(sessions) {
  const byStatus = new Map();
  const byPaymentStatus = new Map();
  for (const s of sessions) {
    const status = s.status || 'unknown';
    byStatus.set(status, (byStatus.get(status) || 0) + 1);
    const ps = s.payment_status || 'none';
    byPaymentStatus.set(ps, (byPaymentStatus.get(ps) || 0) + 1);
  }
  return {
    byStatus: Object.fromEntries(byStatus),
    byPaymentStatus: Object.fromEntries(byPaymentStatus),
  };
}

function bucketPaymentIntentErrors(intents) {
  const byErrorCode = new Map();
  const byErrorType = new Map();
  const byDeclineCode = new Map();
  let withError = 0;
  for (const pi of intents) {
    const err = pi.last_payment_error;
    if (!err) continue;
    withError += 1;
    const code = err.code || 'no_code';
    const type = err.type || 'no_type';
    const decline = err.decline_code || 'no_decline_code';
    byErrorCode.set(code, (byErrorCode.get(code) || 0) + 1);
    byErrorType.set(type, (byErrorType.get(type) || 0) + 1);
    byDeclineCode.set(decline, (byDeclineCode.get(decline) || 0) + 1);
  }
  return {
    intentsWithError: withError,
    intentsTotal: intents.length,
    byErrorCode: Object.fromEntries(byErrorCode),
    byErrorType: Object.fromEntries(byErrorType),
    byDeclineCode: Object.fromEntries(byDeclineCode),
  };
}

function safeRate(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function normalizeEvidenceText(value) {
  const text = String(value == null ? '' : value).trim();
  return text || null;
}

function extractSessionAttribution(session = {}) {
  const metadata = session.metadata && typeof session.metadata === 'object'
    ? session.metadata
    : {};
  let reference = {};
  try {
    reference = parseCheckoutReference(session.client_reference_id) || {};
  } catch (_) {
    reference = {};
  }
  return {
    source: normalizeEvidenceText(
      metadata.source
      || metadata.utmSource
      || metadata.utm_source
      || reference.source
    ),
    planId: normalizeEvidenceText(
      metadata.planId
      || metadata.plan_id
      || metadata.thumbgate_tier
      || reference.planId
    ),
    hasTraceId: Boolean(normalizeEvidenceText(
      metadata.traceId
      || metadata.trace_id
      || reference.traceId
    )),
    hasAcquisitionId: Boolean(normalizeEvidenceText(
      metadata.acquisitionId
      || metadata.acquisition_id
      || reference.acquisitionId
    )),
  };
}

function hasCustomerIdentityEvidence(session = {}) {
  return Boolean(
    normalizeEvidenceText(session.customer_email)
    || normalizeEvidenceText(session.customer_details?.email)
  );
}

function getSessionEmail(session = {}) {
  return normalizeEvidenceText(
    session.customer_email
    || session.customer_details?.email
  );
}

function isPlaceholderIdentityEmail(value) {
  const email = normalizeEvidenceText(value)?.toLowerCase();
  if (!email || !email.includes('@')) return false;
  const [localPart, domain = ''] = email.split('@');
  const reservedDomains = new Set([
    'example.com',
    'example.net',
    'example.org',
    'localhost',
    'invalid',
  ]);
  if (reservedDomains.has(domain) || domain.endsWith('.test')) return true;
  return /^(?:test|buyer|demo|fake|sample|operator|owner|qa|user)(?:[+._-]|\d|$)/i.test(localPart);
}

function identityEvidenceKind(session = {}) {
  const email = getSessionEmail(session);
  if (!email) return 'none';
  return isPlaceholderIdentityEmail(email)
    ? 'placeholder_email'
    : 'non_placeholder_email';
}

function hasPaymentAttemptEvidence(session = {}) {
  return Boolean(
    normalizeEvidenceText(session.payment_intent)
    || normalizeEvidenceText(session.payment_status) === 'paid'
  );
}

function isCompletedSession(session = {}) {
  return session.status === 'complete' || session.payment_status === 'paid';
}

function incrementBucket(map, key) {
  const normalizedKey = normalizeEvidenceText(key) || 'unknown';
  map.set(normalizedKey, (map.get(normalizedKey) || 0) + 1);
}

function countPossibleAutomationClusters(sessionFacts, maxSpanSeconds = 5) {
  const sorted = sessionFacts
    .filter((fact) => Number.isFinite(fact.created))
    .sort((left, right) => left.created - right.created);
  let clusterCount = 0;
  let sessionCount = 0;
  let cursor = 0;

  while (cursor < sorted.length) {
    const cluster = [sorted[cursor]];
    let next = cursor + 1;
    while (
      next < sorted.length
      && sorted[next].created - cluster[0].created <= maxSpanSeconds
    ) {
      cluster.push(sorted[next]);
      next += 1;
    }
    const distinctPlans = new Set(cluster.map((fact) => fact.planId).filter(Boolean));
    const lacksStrongIntent = cluster.every((fact) => !fact.strongIntentEvidence);
    if (cluster.length >= 2 && distinctPlans.size >= 2 && lacksStrongIntent) {
      clusterCount += 1;
      sessionCount += cluster.length;
    }
    cursor = next;
  }

  return { clusterCount, sessionCount, maxSpanSeconds };
}

function summarizeSessionEvidence(sessions = []) {
  const sourceBuckets = new Map();
  const planBuckets = new Map();
  let completedEvidenceSessions = 0;
  let paymentAttemptSessions = 0;
  let identifiedSessions = 0;
  let placeholderIdentitySessions = 0;
  let credibleIdentifiedSessions = 0;
  let attributedSessions = 0;
  let strongIntentEvidenceSessions = 0;
  let attributionOnlySessions = 0;

  const facts = sessions.map((session) => {
    const attribution = extractSessionAttribution(session);
    const completed = isCompletedSession(session);
    const paymentAttempt = hasPaymentAttemptEvidence(session);
    const identityKind = identityEvidenceKind(session);
    const identified = identityKind !== 'none';
    const placeholderIdentity = identityKind === 'placeholder_email';
    const credibleIdentity = identityKind === 'non_placeholder_email';
    const attributed = Boolean(
      attribution.source
      || attribution.planId
      || attribution.hasTraceId
      || attribution.hasAcquisitionId
    );
    const strongIntentEvidence = completed || paymentAttempt || credibleIdentity;

    if (completed) completedEvidenceSessions += 1;
    if (paymentAttempt) paymentAttemptSessions += 1;
    if (identified) identifiedSessions += 1;
    if (placeholderIdentity) placeholderIdentitySessions += 1;
    if (credibleIdentity) credibleIdentifiedSessions += 1;
    if (attributed) attributedSessions += 1;
    if (strongIntentEvidence) strongIntentEvidenceSessions += 1;
    if (attributed && !strongIntentEvidence) attributionOnlySessions += 1;
    incrementBucket(sourceBuckets, attribution.source);
    incrementBucket(planBuckets, attribution.planId);

    return {
      created: Number(session.created),
      planId: attribution.planId,
      strongIntentEvidence,
    };
  });

  const possibleAutomation = countPossibleAutomationClusters(facts);
  return {
    totalSessions: sessions.length,
    completedEvidenceSessions,
    paymentAttemptSessions,
    identifiedSessions,
    placeholderIdentitySessions,
    credibleIdentifiedSessions,
    attributedSessions,
    strongIntentEvidenceSessions,
    attributionOnlySessions,
    rawOnlySessions: sessions.length - strongIntentEvidenceSessions,
    possibleAutomationClusters: possibleAutomation.clusterCount,
    possibleAutomationSessions: possibleAutomation.sessionCount,
    possibleAutomationWindowSeconds: possibleAutomation.maxSpanSeconds,
    bySource: Object.fromEntries(sourceBuckets),
    byPlan: Object.fromEntries(planBuckets),
  };
}

function toIsoTimestamp(epochSeconds) {
  return Number.isFinite(epochSeconds)
    ? new Date(epochSeconds * 1000).toISOString()
    : null;
}

function summarizeSessionRecency(
  sessions = [],
  nowEpochSeconds = Math.floor(Date.now() / 1000)
) {
  const now = Number(nowEpochSeconds);
  const datedSessions = sessions.filter((session) => {
    const created = Number(session.created);
    return Number.isFinite(created) && created <= now;
  });
  const latestAt = (predicate) => {
    const latest = datedSessions
      .filter(predicate)
      .reduce((maximum, session) => Math.max(maximum, Number(session.created)), -Infinity);
    return toIsoTimestamp(latest);
  };
  const summarizeWindow = (seconds) => {
    const cutoff = now - seconds;
    const windowSessions = datedSessions.filter((session) => Number(session.created) >= cutoff);
    const evidence = summarizeSessionEvidence(windowSessions);
    return {
      totalSessions: evidence.totalSessions,
      completedEvidenceSessions: evidence.completedEvidenceSessions,
      paymentAttemptSessions: evidence.paymentAttemptSessions,
      credibleIdentifiedSessions: evidence.credibleIdentifiedSessions,
      strongIntentEvidenceSessions: evidence.strongIntentEvidenceSessions,
      rawOnlySessions: evidence.rawOnlySessions,
    };
  };

  return {
    asOf: toIsoTimestamp(now),
    latestSessionAt: latestAt(() => true),
    latestStrongIntentAt: latestAt((session) => (
      isCompletedSession(session)
      || hasPaymentAttemptEvidence(session)
      || identityEvidenceKind(session) === 'non_placeholder_email'
    )),
    latestCredibleIdentityAt: latestAt((session) => (
      identityEvidenceKind(session) === 'non_placeholder_email'
    )),
    latestPaymentAttemptAt: latestAt(hasPaymentAttemptEvidence),
    latestCompletedAt: latestAt(isCompletedSession),
    windows: {
      last24Hours: summarizeWindow(24 * 60 * 60),
      last7Days: summarizeWindow(7 * 24 * 60 * 60),
      last30Days: summarizeWindow(30 * 24 * 60 * 60),
    },
  };
}

function classifyCheckoutFunnel({
  sessions = [],
  paymentIntents = [],
  account = {},
  nowEpochSeconds = Math.floor(Date.now() / 1000),
} = {}) {
  const buckets = bucketSessions(sessions);
  const total = sessions.length;
  const complete = buckets.byStatus.complete || 0;
  const expired = buckets.byStatus.expired || 0;
  const open = buckets.byStatus.open || 0;
  const paid = buckets.byPaymentStatus.paid || 0;
  const piErrors = bucketPaymentIntentErrors(paymentIntents);
  const sessionEvidence = summarizeSessionEvidence(sessions);
  const sessionRecency = summarizeSessionRecency(sessions, nowEpochSeconds);
  const conversionRate = safeRate(complete, total);
  const paidRate = safeRate(paid, total);
  const abandonmentRate = safeRate(expired + open, total);

  let primaryDiagnosis = 'insufficient_data';
  let recommendation = 'Collect more checkout sessions before changing the offer.';

  if (account.configured && account.chargesEnabled === false) {
    primaryDiagnosis = 'stripe_account_blocked';
    recommendation = 'Resolve Stripe account requirements before changing landing-page copy.';
  } else if (piErrors.intentsWithError > 0) {
    primaryDiagnosis = 'payment_attempt_failures';
    recommendation = 'Fix the payment-method or decline-code pattern shown in PaymentIntent errors.';
  } else if (complete > 0 && paid === 0) {
    primaryDiagnosis = 'post_checkout_payment_or_webhook_gap';
    recommendation = 'Inspect payment status and webhook provisioning because sessions complete without paid confirmation.';
  } else if (
    complete > 0
    && sessionRecency.latestCompletedAt
    && sessionRecency.windows.last30Days.completedEvidenceSessions === 0
  ) {
    primaryDiagnosis = 'historical_checkout_conversion_no_recent_payment_evidence';
    recommendation = 'Checkout converted historically, but no completion evidence appears in the last 30 days. Prioritize recent verified entrants and provider-confirmed payment rather than scaling old source attribution.';
  } else if (complete > 0) {
    primaryDiagnosis = 'checkout_can_convert';
    recommendation = 'Checkout can convert. Attribute the converting source and scale that segment cautiously.';
  } else if (
    total >= 20
    && sessionEvidence.paymentAttemptSessions === 0
    && sessionEvidence.credibleIdentifiedSessions === 0
    && abandonmentRate >= 0.8
  ) {
    primaryDiagnosis = 'unverified_session_noise_or_pre_payment_exit';
    recommendation = 'Raw Stripe sessions do not prove buyer abandonment. Correlate first-party CTA receipts, exclude automated and owner probes, and only then test offer changes.';
  } else if (
    total >= 20
    && sessionEvidence.paymentAttemptSessions === 0
    && sessionEvidence.credibleIdentifiedSessions > 0
    && abandonmentRate >= 0.8
  ) {
    primaryDiagnosis = 'identified_pre_payment_dropoff';
    recommendation = 'Identified checkout entrants did not produce a payment attempt. Review those attributed journeys and the offer handoff without treating anonymous sessions as buyers.';
  } else if (
    total >= 20
    && sessionEvidence.strongIntentEvidenceSessions > 0
    && conversionRate < 0.01
    && abandonmentRate >= 0.8
  ) {
    primaryDiagnosis = 'evidence_backed_checkout_dropoff';
    recommendation = 'Some sessions contain identity or payment-attempt evidence but did not convert. Segment those journeys by offer and source before changing price or copy.';
  }

  return {
    totalSessions: total,
    completedSessions: complete,
    paidSessions: paid,
    expiredOrOpenSessions: expired + open,
    checkoutConversionRate: conversionRate,
    paidSessionRate: paidRate,
    abandonmentRate,
    paymentIntentsTotal: paymentIntents.length,
    paymentIntentsWithError: piErrors.intentsWithError,
    strongIntentEvidenceSessions: sessionEvidence.strongIntentEvidenceSessions,
    rawOnlySessions: sessionEvidence.rawOnlySessions,
    possibleAutomationClusters: sessionEvidence.possibleAutomationClusters,
    recent30DayCompletedEvidenceSessions: sessionRecency.windows.last30Days.completedEvidenceSessions,
    primaryDiagnosis,
    recommendation,
  };
}

async function getAccountHealth(stripe) {
  try {
    const account = await stripe.accounts.retrieve();
    return {
      configured: true,
      id: account.id,
      type: account.type,
      country: account.country,
      defaultCurrency: account.default_currency,
      detailsSubmitted: account.details_submitted,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      disabledReason: account.requirements?.disabled_reason || null,
      currentlyDue: account.requirements?.currently_due || [],
      pastDue: account.requirements?.past_due || [],
      eventuallyDue: account.requirements?.eventually_due || [],
      pendingVerification: account.requirements?.pending_verification || [],
      capabilities: account.capabilities || {},
    };
  } catch (error) {
    return { configured: false, gap: `accounts.retrieve failed: ${error.message}` };
  }
}

async function getWebhookHealth(stripe) {
  try {
    const endpoints = await stripe.webhookEndpoints.list({ limit: 20 });
    const summary = (endpoints.data || []).map((ep) => ({
      id: ep.id,
      url: ep.url,
      status: ep.status,
      enabledEvents: ep.enabled_events,
      apiVersion: ep.api_version,
      createdAt: new Date(ep.created * 1000).toISOString(),
    }));
    return { configured: true, endpoints: summary };
  } catch (error) {
    return { configured: false, gap: `webhookEndpoints.list failed: ${error.message}` };
  }
}

async function runDiagnostic({
  stripeClient = null,
  secretKey = process.env.STRIPE_SECRET_KEY,
  limit = 10000,
} = {}) {
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
  if (!stripe?.checkout?.sessions?.list || !stripe?.paymentIntents?.list || !stripe?.accounts?.retrieve) {
    return { configured: false, gap: 'Stripe client does not expose the expected endpoints' };
  }

  const [sessions, account, webhooks] = await Promise.all([
    listAllPaged((p) => stripe.checkout.sessions.list(p), {}, limit),
    getAccountHealth(stripe),
    getWebhookHealth(stripe),
  ]);

  // Codex P1: only analyze PaymentIntents that came from checkout sessions.
  // The previous version pulled the account's entire paymentIntents.list
  // — that contaminates the error-rate analysis with intents from other
  // flows (subscriptions, manual invoices, etc.). Pulling per-session keeps
  // the error rate tied to checkout flow specifically.
  const checkoutLinkedIntentIds = sessions
    .map((s) => (typeof s.payment_intent === 'string' ? s.payment_intent : null))
    .filter(Boolean);
  const paymentIntents = await Promise.all(
    checkoutLinkedIntentIds.slice(0, limit).map(async (id) => {
      try {
        return await stripe.paymentIntents.retrieve(id);
      } catch {
        return null;
      }
    })
  ).then((arr) => arr.filter(Boolean));

  // Cross-link: for the most recent N sessions, look up the associated
  // payment_intent's last_payment_error if any.
  const recentSessions = sessions.slice(0, Math.min(20, sessions.length));
  const recentSessionDetail = await Promise.all(
    recentSessions.map(async (s) => {
      let piError = null;
      if (s.payment_intent && typeof s.payment_intent === 'string') {
        try {
          const pi = await stripe.paymentIntents.retrieve(s.payment_intent);
          piError = pi.last_payment_error || null;
        } catch (_e) {
          piError = null;
        }
      }
      const attribution = extractSessionAttribution(s);
      return {
        sessionId: s.id,
        status: s.status,
        paymentStatus: s.payment_status,
        createdAt: new Date(s.created * 1000).toISOString(),
        expiresAt: s.expires_at ? new Date(s.expires_at * 1000).toISOString() : null,
        hasCustomerIdentity: hasCustomerIdentityEvidence(s),
        identityEvidence: identityEvidenceKind(s),
        amountTotal: s.amount_total,
        currency: s.currency,
        hasPaymentIntent: typeof s.payment_intent === 'string',
        attribution,
        piErrorCode: piError?.code || null,
        piErrorType: piError?.type || null,
        piErrorDeclineCode: piError?.decline_code || null,
      };
    })
  );

  const generatedAt = new Date();
  const nowEpochSeconds = Math.floor(generatedAt.getTime() / 1000);
  const sessionEvidence = summarizeSessionEvidence(sessions);
  const sessionRecency = summarizeSessionRecency(sessions, nowEpochSeconds);
  const funnelDiagnosis = classifyCheckoutFunnel({
    sessions,
    paymentIntents,
    account,
    nowEpochSeconds,
  });

  return {
    configured: true,
    generatedAt: generatedAt.toISOString(),
    sessionsExamined: sessions.length,
    paymentIntentsExamined: paymentIntents.length,
    sessionBuckets: bucketSessions(sessions),
    sessionEvidence,
    sessionRecency,
    paymentIntentErrors: bucketPaymentIntentErrors(paymentIntents),
    funnelDiagnosis,
    account,
    webhooks,
    recentSessions: recentSessionDetail,
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Stripe Checkout Diagnostic');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt || new Date().toISOString()}`);
  if (!report.configured) {
    lines.push(`Status: NOT CONFIGURED — ${report.gap}`);
    return lines.join('\n') + '\n';
  }
  lines.push('');
  lines.push('## Headline question: why are checkout sessions not completing?');
  lines.push('');
  lines.push(`Examined ${report.sessionsExamined} checkout sessions and ${report.paymentIntentsExamined} payment intents.`);
  if (report.funnelDiagnosis) {
    lines.push('');
    lines.push(`**Primary diagnosis: \`${report.funnelDiagnosis.primaryDiagnosis}\`**`);
    lines.push(`Recommendation: ${report.funnelDiagnosis.recommendation}`);
    lines.push(`Checkout completion rate: ${(report.funnelDiagnosis.checkoutConversionRate * 100).toFixed(2)}%; paid-session rate: ${(report.funnelDiagnosis.paidSessionRate * 100).toFixed(2)}%; expired/open rate: ${(report.funnelDiagnosis.abandonmentRate * 100).toFixed(2)}%.`);
  }
  lines.push('');
  lines.push('> Evidence boundary: a raw Stripe Checkout session is not proof of a buyer. Crawlers, monitoring, owner verification, and route probes can create sessions without human purchase intent.');
  if (report.sessionEvidence) {
    lines.push('');
    lines.push('### Session evidence quality');
    lines.push('');
    lines.push(`- Strong intent evidence (completed, non-placeholder identity, or payment attempt): **${report.sessionEvidence.strongIntentEvidenceSessions}**`);
    lines.push(`- Non-placeholder identity evidence: **${report.sessionEvidence.credibleIdentifiedSessions}**`);
    lines.push(`- Placeholder/test identity evidence: **${report.sessionEvidence.placeholderIdentitySessions}**`);
    lines.push(`- Raw-only session creations: **${report.sessionEvidence.rawOnlySessions}**`);
    lines.push(`- Attribution-only sessions: **${report.sessionEvidence.attributionOnlySessions}**`);
    lines.push(`- Possible multi-offer automation clusters: **${report.sessionEvidence.possibleAutomationClusters}** (${report.sessionEvidence.possibleAutomationSessions} sessions within ${report.sessionEvidence.possibleAutomationWindowSeconds}s windows)`);
    lines.push('');
    lines.push('The automation-cluster count is a heuristic, not proof of bot traffic. It flags near-simultaneous session creation for multiple offers with no identity, completion, or payment-attempt evidence.');
  }
  if (report.sessionRecency?.windows) {
    lines.push('');
    lines.push('### Recency boundary');
    lines.push('');
    lines.push('| Window | Sessions | Completed | Payment attempt | Non-placeholder identity | Strong intent | Raw-only |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const [label, key] of [
      ['24 hours', 'last24Hours'],
      ['7 days', 'last7Days'],
      ['30 days', 'last30Days'],
    ]) {
      const window = report.sessionRecency.windows[key];
      lines.push(`| ${label} | ${window.totalSessions} | ${window.completedEvidenceSessions} | ${window.paymentAttemptSessions} | ${window.credibleIdentifiedSessions} | ${window.strongIntentEvidenceSessions} | ${window.rawOnlySessions} |`);
    }
    lines.push('');
    lines.push(`- Latest session: ${report.sessionRecency.latestSessionAt || 'none'}`);
    lines.push(`- Latest strong-intent evidence: ${report.sessionRecency.latestStrongIntentAt || 'none'}`);
    lines.push(`- Latest non-placeholder identity: ${report.sessionRecency.latestCredibleIdentityAt || 'none'}`);
    lines.push(`- Latest payment-attempt evidence: ${report.sessionRecency.latestPaymentAttemptAt || 'none'}`);
    lines.push(`- Latest completed evidence: ${report.sessionRecency.latestCompletedAt || 'none'}`);
    lines.push('');
    lines.push('Historical conversion proves that checkout has worked before; it does not prove current buyer intent or current conversion. The time windows above are event-time evidence, not outreach consent.');
  }
  lines.push('');
  lines.push('### Checkout session status breakdown');
  lines.push('');
  lines.push('| Status | Count |');
  lines.push('| --- | ---: |');
  for (const [k, v] of Object.entries(report.sessionBuckets.byStatus)) {
    lines.push(`| ${k} | ${v} |`);
  }
  lines.push('');
  lines.push('### Payment status breakdown');
  lines.push('');
  lines.push('| Payment status | Count |');
  lines.push('| --- | ---: |');
  for (const [k, v] of Object.entries(report.sessionBuckets.byPaymentStatus)) {
    lines.push(`| ${k} | ${v} |`);
  }
  lines.push('');
  lines.push('## Payment intent failure modes');
  lines.push('');
  const pie = report.paymentIntentErrors;
  lines.push(`${pie.intentsWithError} of ${pie.intentsTotal} payment intents have a recorded \`last_payment_error\`.`);
  if (pie.intentsWithError > 0) {
    lines.push('');
    lines.push('### By error code');
    lines.push('');
    lines.push('| Code | Count |');
    lines.push('| --- | ---: |');
    for (const [k, v] of Object.entries(pie.byErrorCode)) {
      lines.push(`| \`${k}\` | ${v} |`);
    }
    lines.push('');
    lines.push('### By decline code (card-specific)');
    lines.push('');
    lines.push('| Decline code | Count |');
    lines.push('| --- | ---: |');
    for (const [k, v] of Object.entries(pie.byDeclineCode)) {
      lines.push(`| \`${k}\` | ${v} |`);
    }
  }
  lines.push('');
  lines.push('## Stripe Account health (acct from STRIPE_SECRET_KEY)');
  lines.push('');
  if (report.account.configured) {
    lines.push(`- Account ID: \`${report.account.id}\``);
    lines.push(`- Type / Country / Currency: ${report.account.type} / ${report.account.country} / ${report.account.defaultCurrency}`);
    lines.push(`- **details_submitted: ${report.account.detailsSubmitted}**`);
    lines.push(`- **charges_enabled: ${report.account.chargesEnabled}**`);
    lines.push(`- **payouts_enabled: ${report.account.payoutsEnabled}**`);
    lines.push(`- disabled_reason: \`${report.account.disabledReason || '(none)'}\``);
    lines.push(`- currently_due: ${report.account.currentlyDue.length ? '`' + report.account.currentlyDue.join('`, `') + '`' : '_(none)_'}`);
    lines.push(`- past_due: ${report.account.pastDue.length ? '`' + report.account.pastDue.join('`, `') + '`' : '_(none)_'}`);
    lines.push(`- pending_verification: ${report.account.pendingVerification.length ? '`' + report.account.pendingVerification.join('`, `') + '`' : '_(none)_'}`);
    lines.push('');
    lines.push('**This is the single most diagnostic block.** If `charges_enabled` is `false`, every checkout session WILL fail at the payment step regardless of UI quality. If `currently_due` or `past_due` is non-empty, Stripe is gating the account on operator action.');
  } else {
    lines.push(`Account: NOT AVAILABLE — ${report.account.gap}`);
  }
  lines.push('');
  lines.push('## Webhook endpoints');
  lines.push('');
  if (report.webhooks.configured) {
    if (report.webhooks.endpoints.length === 0) {
      lines.push('_No webhook endpoints configured._ Payment confirmation cannot be received post-checkout. **This alone produces a 100% "no completed checkouts" perception** even when checkouts actually complete on Stripe, because our local ledger is never written.');
    } else {
      lines.push('| Status | URL | Events |');
      lines.push('| --- | --- | ---: |');
      for (const ep of report.webhooks.endpoints) {
        lines.push(`| ${ep.status} | \`${ep.url}\` | ${ep.enabledEvents.length} |`);
      }
    }
  } else {
    lines.push(`Webhooks: NOT AVAILABLE — ${report.webhooks.gap}`);
  }
  lines.push('');
  lines.push('## Recent sessions (last 20)');
  lines.push('');
  lines.push('| Created | Status | Pay status | Amount | Identity evidence | Payment attempt | Source | Plan | PI error code | PI decline |');
  lines.push('| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |');
  for (const s of report.recentSessions) {
    const amt = s.amountTotal != null ? `${(s.amountTotal / 100).toFixed(2)} ${(s.currency || '').toUpperCase()}` : '—';
    const code = s.piErrorCode || '—';
    const decline = s.piErrorDeclineCode || '—';
    const identity = s.identityEvidence || (s.hasCustomerIdentity ? 'present' : 'none');
    const attempt = s.hasPaymentIntent ? 'yes' : 'no';
    const source = s.attribution?.source || 'unknown';
    const plan = s.attribution?.planId || 'unknown';
    lines.push(`| ${s.createdAt} | ${s.status} | ${s.paymentStatus} | ${amt} | ${identity} | ${attempt} | ${source} | ${plan} | \`${code}\` | \`${decline}\` |`);
  }
  lines.push('');
  lines.push('## Top diagnosis paths');
  lines.push('');
  lines.push('Read top-to-bottom. The first match is almost always the bottleneck.');
  lines.push('');
  if (report.account.configured) {
    if (!report.account.chargesEnabled) {
      lines.push('1. **`charges_enabled = false`** — the account cannot process payments. Every session fails at the Stripe page. Resolve by completing the `currently_due` / `past_due` requirements above. **This is the binding blocker.**');
    } else if (report.account.currentlyDue.length || report.account.pastDue.length) {
      lines.push('1. **Account has outstanding requirements** — charges may be enabled but with friction. Resolve the listed items before treating any other diagnosis seriously.');
    }
  }
  const expired = report.sessionBuckets.byStatus.expired || 0;
  const open = report.sessionBuckets.byStatus.open || 0;
  const complete = report.sessionBuckets.byStatus.complete || 0;
  if (complete === 0 && expired + open > 50) {
    lines.push('2. **Sessions are uniformly expiring or staying open with zero completions.** Combined with healthy account flags, this proves non-conversion but not buyer abandonment. Separate human CTA receipts from crawler, monitor, owner, and route-probe traffic before changing the offer.');
  }
  if (report.paymentIntentErrors.intentsTotal === 0 && report.sessionEvidence?.rawOnlySessions > 0) {
    lines.push('3. **No session produced a PaymentIntent, and the raw-only count is non-zero.** This cannot distinguish anonymous human exits from synthetic session creation. Correlate first-party CTA telemetry or provider receipts before naming a buyer failure mode.');
  } else if (report.paymentIntentErrors.intentsWithError === 0 && report.paymentIntentErrors.intentsTotal > 0) {
    lines.push('3. **Payment attempts exist without a recorded `last_payment_error`.** Segment identified and attributed journeys before inferring whether the remaining loss is checkout friction, an incomplete authentication step, or later abandonment.');
  }
  if (report.webhooks.configured && report.webhooks.endpoints.length === 0) {
    lines.push('4. **No webhooks configured.** The session counts above come from Stripe API directly and are NOT undercounted by missing webhooks (Codex P2 correction). What missing webhooks DO break: post-completion side effects on our backend — provisioning, trial-welcome emails, local revenue-ledger writes. Wire `https://thumbgate.ai/v1/billing/webhook` listening for `checkout.session.completed` / `payment_intent.succeeded` to close that loop.');
  }
  lines.push('');
  lines.push('## Honest limits of this diagnostic');
  lines.push('');
  lines.push('- This script reports what Stripe has on file. It cannot see UX friction outside Stripe (broken redirects, blocked-region geofencing, slow page loads).');
  lines.push('- Stripe session creation alone cannot distinguish a buyer from a crawler, monitor, owner verification, or route probe. Human-intent claims require first-party CTA evidence, identity evidence, a PaymentIntent, or a completed payment.');
  lines.push('- Recent-sessions table is the last 20 only; for full forensics inspect Stripe Dashboard → Payments → Checkout Sessions.');
  lines.push('- Webhook delivery success rates are not available via the list endpoint; check Stripe Dashboard → Developers → Webhooks for per-event attempt history.');
  return lines.join('\n') + '\n';
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const report = await runDiagnostic({ limit: args.limit });
  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(renderMarkdown(report));
  }
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  main().catch((error) => {
    process.stderr.write(`stripe-checkout-diagnostic FAILED: ${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  bucketSessions,
  bucketPaymentIntentErrors,
  extractSessionAttribution,
  isPlaceholderIdentityEmail,
  identityEvidenceKind,
  summarizeSessionEvidence,
  summarizeSessionRecency,
  countPossibleAutomationClusters,
  classifyCheckoutFunnel,
  runDiagnostic,
  renderMarkdown,
};
