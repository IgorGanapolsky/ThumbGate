'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { getFeedbackPaths } = require('./feedback-loop');
const { redactSecrets } = require('./secret-redaction');
const { OFFER_CATALOG, qualifyRevenueOffer } = require('./revenue-offer-system');
const { appendWorkflowRun } = require('./workflow-runs');
const {
  evaluateLeadEvidenceAtStage,
  loadSalesLeads,
} = require('./sales-pipeline');

const WORKFLOW_SPRINT_LEADS_FILE = 'workflow-sprint-leads.jsonl';
const WORKFLOW_SPRINT_INTAKE_LIMITS_FILE = 'workflow-sprint-intake-limits.json';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_OPERATOR_ALERT_EMAIL = 'igor.ganapolsky@gmail.com';
const INTAKE_ALERT_WINDOW_MS = 60 * 60 * 1000;
const MAX_INTAKE_ALERTS_PER_WINDOW = 5;
const MAX_ALERT_RATE_KEYS = 10000;
const MAX_INTAKES_PER_CLIENT_HOUR = 10;
const MAX_PERSISTED_INTAKE_KEYS = 10000;
const DUPLICATE_INTAKE_WINDOW_MS = 15 * 60 * 1000;
const intakeAlertTimesByKey = new Map();
const intakeAlertDedupByKey = new Map();
const WORKFLOW_SPRINT_STATUS_FLOW = [
  'new',
  'qualified',
  'named_pilot',
  'proof_backed_run',
  'paid_team',
];
const SIGNED_SCOPE_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SIGNED_SCOPE_EVIDENCE_MODE = 'local_reference_and_sha256_digest_not_remote_contract_platform_verification';
const CONTRACTABLE_OFFER_IDS = Object.freeze([
  'workflow_hardening_sprint',
  'workflow_reliability_operations',
  'enterprise_governance_pilot',
  'enterprise_reliability_operations',
]);
const RECURRING_OFFER_IDS = new Set([
  'workflow_reliability_operations',
  'enterprise_reliability_operations',
]);
const ENTERPRISE_OFFER_IDS = new Set([
  'enterprise_governance_pilot',
  'enterprise_reliability_operations',
]);
const DIAGNOSTIC_CREDIT_CENTS = OFFER_CATALOG.workflow_hardening_diagnostic.priceCents;
const RECURRING_PERIOD_MIN_MS = 27 * 24 * 60 * 60 * 1000;
const RECURRING_PERIOD_MAX_MS = 32 * 24 * 60 * 60 * 1000;
const RECURRING_PREPAY_MAX_MS = 7 * 24 * 60 * 60 * 1000;
const QUALIFICATION_ZERO_SPEND_STATUS = 'proceed_zero_cost';
const QUALIFICATION_REVIEW_REQUIRED_FIELDS = Object.freeze([
  'severityAndFrequency',
  'measurableImpact',
  'urgencyAndTrigger',
  'decisionAuthority',
  'budgetMechanism',
  'offerFit',
  'proofRequired',
  'nextStep',
]);
const QUALIFICATION_DECISION_ROUTES = Object.freeze({
  start_diagnostic: 'diagnostic',
  scope_sprint: 'diagnostic',
  qualify_for_signed_proposal: 'close',
});
const QUALIFICATION_DECISION_OFFER_IDS = Object.freeze({
  start_diagnostic: Object.freeze(['workflow_hardening_diagnostic']),
  scope_sprint: Object.freeze(['workflow_hardening_sprint']),
  qualify_for_signed_proposal: Object.freeze([
    'workflow_reliability_operations',
    'enterprise_governance_pilot',
    'enterprise_reliability_operations',
  ]),
});

function normalizeText(value, maxLength = 280) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function normalizeSafeText(value, maxLength = 280) {
  const text = normalizeText(value, maxLength);
  return text ? redactSecrets(text) : null;
}

function normalizeEmail(value) {
  const email = normalizeText(value, 320);
  if (!email) return null;
  const normalized = email.toLowerCase();
  return EMAIL_PATTERN.test(normalized) ? normalized : null;
}

function sha256Digest(value) {
  return `sha256:${crypto.createHash('sha256').update(String(value)).digest('hex')}`;
}

function normalizeProofArtifacts(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeText(entry, 512))
    .filter(Boolean);
}

function normalizeCommercialEvidence(value = {}) {
  const evidence = value && typeof value === 'object' ? value : {};
  return {
    source: normalizeText(evidence.source, 160),
    reference: normalizeText(evidence.reference, 1000),
  };
}

function normalizePositiveInteger(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function sanitizeQualificationReview(value = {}) {
  const review = value && typeof value === 'object' ? value : {};
  return {
    evidenceBased: review.evidenceBased === true,
    reviewedAt: normalizeText(review.reviewedAt, 64),
    reviewedBy: normalizeText(review.reviewedBy, 160),
    route: normalizeText(review.route, 64),
    decision: normalizeText(review.decision, 120),
    recommendedOfferId: normalizeText(review.recommendedOfferId, 120),
    severityAndFrequency: normalizeSafeText(review.severityAndFrequency, 1000),
    measurableImpact: normalizeSafeText(review.measurableImpact, 1000),
    urgencyAndTrigger: normalizeSafeText(review.urgencyAndTrigger, 1000),
    decisionAuthority: normalizeSafeText(review.decisionAuthority, 1000),
    budgetMechanism: normalizeSafeText(review.budgetMechanism, 1000),
    offerFit: normalizeSafeText(review.offerFit, 1000),
    proofRequired: normalizeSafeText(review.proofRequired, 1000),
    nextStep: normalizeSafeText(review.nextStep, 1000),
    evidenceReferences: Array.isArray(review.evidenceReferences)
      ? review.evidenceReferences.map((entry) => normalizeSafeText(entry, 1000)).filter(Boolean)
      : [],
    zeroSpendStatus: normalizeText(review.zeroSpendStatus, 64),
    priceUnderstandingConfirmed: review.priceUnderstandingConfirmed === true,
    workflowCount: normalizePositiveInteger(review.workflowCount, 1),
    authorityConfirmed: review.authorityConfirmed === true,
    urgencyDays: normalizePositiveInteger(review.urgencyDays, 9999),
    budgetCents: normalizeNonNegativeInteger(review.budgetCents, 0),
    readyToImplement: review.readyToImplement === true,
    proofBackedSprint: review.proofBackedSprint === true,
    completedEnterprisePilot: review.completedEnterprisePilot === true,
    requiresUnavailableHostedFeature: review.requiresUnavailableHostedFeature === true,
  };
}

function isEvidenceBasedQualificationReview(value = {}) {
  const review = sanitizeQualificationReview(value);
  const reviewedAt = new Date(String(review.reviewedAt || ''));
  const expectedRoute = QUALIFICATION_DECISION_ROUTES[review.decision];
  const expectedOfferIds = QUALIFICATION_DECISION_OFFER_IDS[review.decision] || [];
  return review.evidenceBased === true &&
    Boolean(review.reviewedBy) &&
    !Number.isNaN(reviewedAt.getTime()) &&
    QUALIFICATION_REVIEW_REQUIRED_FIELDS.every((field) => Boolean(review[field])) &&
    review.evidenceReferences.length > 0 &&
    review.evidenceReferences.every((entry) => !/^REPLACE_WITH_/i.test(entry)) &&
    review.zeroSpendStatus === QUALIFICATION_ZERO_SPEND_STATUS &&
    Boolean(expectedRoute) &&
    review.route === expectedRoute &&
    Boolean(review.recommendedOfferId && OFFER_CATALOG[review.recommendedOfferId]) &&
    expectedOfferIds.includes(review.recommendedOfferId);
}

function requireQualificationReview(payload = {}, lead = {}, { now = new Date().toISOString() } = {}) {
  const reviewedBy = normalizeText(payload.reviewedBy, 160);
  const review = sanitizeQualificationReview({
    ...(payload.qualificationReview && typeof payload.qualificationReview === 'object'
      ? payload.qualificationReview
      : {}),
    reviewedBy,
    reviewedAt: now,
  });
  const missing = QUALIFICATION_REVIEW_REQUIRED_FIELDS.filter((field) => !review[field]);
  if (!reviewedBy || missing.length > 0 || review.evidenceReferences.length === 0) {
    const err = new Error(
      `qualified requires reviewedBy, evidenceReferences, and a complete qualification review${missing.length ? `; missing: ${missing.join(', ')}` : ''}.`
    );
    err.statusCode = 400;
    throw err;
  }
  if (review.evidenceReferences.some((entry) => /^REPLACE_WITH_/i.test(entry))) {
    const err = new Error('qualified requires actual qualification evidence references, not placeholders.');
    err.statusCode = 400;
    throw err;
  }
  if (review.zeroSpendStatus !== QUALIFICATION_ZERO_SPEND_STATUS) {
    const err = new Error('qualified requires zeroSpendStatus=proceed_zero_cost.');
    err.statusCode = 400;
    throw err;
  }

  const decision = lead.offer === 'workflow_hardening_diagnostic' &&
      review.requiresUnavailableHostedFeature !== true
    ? {
        decision: 'start_diagnostic',
        offerId: 'workflow_hardening_diagnostic',
        rationale: 'The buyer requested the bounded diagnostic and the evidence review is complete.',
      }
    : qualifyRevenueOffer({
        workflow: lead.qualification?.workflow,
        owner: lead.qualification?.owner || review.decisionAuthority,
        repeatedFailure: lead.qualification?.blocker || review.severityAndFrequency,
        workflowCount: review.workflowCount,
        authorityConfirmed: review.authorityConfirmed,
        urgencyDays: review.urgencyDays,
        budgetCents: review.budgetCents,
        readyToImplement: review.readyToImplement,
        proofBackedSprint: review.proofBackedSprint,
        completedEnterprisePilot: review.completedEnterprisePilot,
        requiresUnavailableHostedFeature: review.requiresUnavailableHostedFeature,
      });
  if (!decision.offerId || decision.decision === 'needs_diagnostic_intake' ||
      decision.decision === 'discarded_paid_requirement' ||
      decision.decision === 'not_fit_unavailable_capability') {
    const err = new Error(`qualified is not allowed by the offer-fit decision: ${decision.decision}.`);
    err.statusCode = 400;
    throw err;
  }

  const qualificationReview = {
    ...review,
    evidenceBased: true,
    route: decision.decision === 'qualify_for_signed_proposal' ? 'close' : 'diagnostic',
    decision: decision.decision,
    recommendedOfferId: decision.offerId,
  };
  if (!isEvidenceBasedQualificationReview(qualificationReview)) {
    const err = new Error('qualified review failed the evidence-based qualification integrity check.');
    err.statusCode = 400;
    throw err;
  }
  return qualificationReview;
}

function sanitizeCommercialProof(value = {}) {
  const proof = value && typeof value === 'object' ? value : {};
  const scope = normalizeCommercialEvidence(proof.scope);
  const payment = normalizeCommercialEvidence(proof.payment);
  return {
    scope: {
      ...scope,
      signedBy: normalizeText(proof.scope && proof.scope.signedBy, 320),
      signedAt: normalizeText(proof.scope && proof.scope.signedAt, 64),
      digest: normalizeText(proof.scope && proof.scope.digest, 160)?.toLowerCase() || null,
      offerId: normalizeText(proof.scope && proof.scope.offerId, 120),
      amountCents: normalizePositiveInteger(proof.scope && proof.scope.amountCents, 0),
      currency: normalizeText(proof.scope && proof.scope.currency, 16)?.toLowerCase() || null,
      billing: normalizeText(proof.scope && proof.scope.billing, 64),
      workflowCount: normalizePositiveInteger(proof.scope && proof.scope.workflowCount, 0),
      creditCents: normalizePositiveInteger(proof.scope && proof.scope.creditCents, 0),
      creditSalesLeadId: normalizeText(proof.scope && proof.scope.creditSalesLeadId, 160),
      priorPilotReference: normalizeText(proof.scope && proof.scope.priorPilotReference, 1000),
      priorPilotDigest: normalizeText(proof.scope && proof.scope.priorPilotDigest, 160)?.toLowerCase() || null,
    },
    payment: {
      ...payment,
      salesLeadId: normalizeText(proof.payment && proof.payment.salesLeadId, 160),
      amountCents: normalizePositiveInteger(proof.payment && proof.payment.amountCents, 0),
      currency: normalizeText(proof.payment && proof.payment.currency, 16)?.toLowerCase() || null,
      paidAt: normalizeText(proof.payment && proof.payment.paidAt, 64),
      provider: normalizeText(proof.payment && proof.payment.provider, 80)?.toLowerCase() || null,
      digest: normalizeText(proof.payment && proof.payment.digest, 160)?.toLowerCase() || null,
      verified: proof.payment && proof.payment.verified === true,
      offerId: normalizeText(proof.payment && proof.payment.offerId, 120),
      buyerEmailMatch: proof.payment && proof.payment.buyerEmailMatch === true,
      creditSalesLeadId: normalizeText(proof.payment && proof.payment.creditSalesLeadId, 160),
      creditPaymentReference: normalizeText(proof.payment && proof.payment.creditPaymentReference, 1000),
      creditPaymentDigest: normalizeText(proof.payment && proof.payment.creditPaymentDigest, 160)?.toLowerCase() || null,
      invoiceId: normalizeText(proof.payment && proof.payment.invoiceId, 127),
      billingPeriodStart: normalizeText(proof.payment && proof.payment.billingPeriodStart, 64),
      billingPeriodEnd: normalizeText(proof.payment && proof.payment.billingPeriodEnd, 64),
    },
  };
}

function normalizeWorkflowSprintStatus(value, fallback = null) {
  const normalized = normalizeText(value, 64);
  if (!normalized) return fallback;
  if (WORKFLOW_SPRINT_STATUS_FLOW.includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function isDiagnosticIntake(payload = {}) {
  const planId = String(normalizeText(payload.planId, 120) || '').toLowerCase();
  const ctaId = String(normalizeText(payload.ctaId, 120) || '').toLowerCase();
  return planId === 'diagnostic'
    || planId === 'sprint_diagnostic'
    || Boolean(ctaId && ctaId.startsWith('diagnostic_'));
}

function slugify(value, fallback = 'workflow_sprint') {
  const normalized = normalizeText(value, 120);
  if (!normalized) return fallback;
  const slug = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || fallback;
}

function buildStatusHistoryEntry({
  fromStatus = null,
  toStatus,
  actor = null,
  note = null,
  reviewedBy = null,
  proofArtifacts = [],
  timestamp = new Date().toISOString(),
} = {}) {
  return {
    fromStatus: normalizeWorkflowSprintStatus(fromStatus, null),
    toStatus: normalizeWorkflowSprintStatus(toStatus, 'new'),
    at: normalizeText(timestamp, 64) || new Date().toISOString(),
    actor: normalizeText(actor, 160),
    note: normalizeSafeText(note, 1000),
    reviewedBy: normalizeText(reviewedBy, 160),
    proofArtifacts: normalizeProofArtifacts(proofArtifacts),
  };
}

function sanitizeWorkflowSprintLead(entry = {}) {
  const submittedAt = normalizeText(entry.submittedAt, 64) || new Date().toISOString();
  const updatedAt = normalizeText(entry.updatedAt, 64) || submittedAt;
  const status = normalizeWorkflowSprintStatus(entry.status, 'new');
  const proofArtifacts = normalizeProofArtifacts(entry.proof && entry.proof.artifacts);
  const reviewedBy = normalizeText(entry.proof && entry.proof.reviewedBy, 160);
  const history = Array.isArray(entry.statusHistory) && entry.statusHistory.length
    ? entry.statusHistory
      .map((item) => buildStatusHistoryEntry(item))
      .filter(Boolean)
    : [buildStatusHistoryEntry({
      fromStatus: null,
      toStatus: status,
      timestamp: updatedAt,
      actor: entry.actor || null,
      note: entry.statusNote || null,
      reviewedBy,
      proofArtifacts,
    })];

  return {
    leadId: normalizeText(entry.leadId, 160) || `lead_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
    submittedAt,
    updatedAt,
    status,
    offer: normalizeText(entry.offer, 120) || 'workflow_hardening_sprint',
    contact: {
      name: normalizeSafeText(entry.contact && entry.contact.name, 160),
      email: normalizeEmail(entry.contact && entry.contact.email),
      company: normalizeSafeText(entry.contact && entry.contact.company, 160),
    },
    qualification: {
      workflow: normalizeSafeText(entry.qualification && entry.qualification.workflow, 240),
      owner: normalizeSafeText(entry.qualification && entry.qualification.owner, 160),
      blocker: normalizeSafeText(entry.qualification && entry.qualification.blocker, 1000),
      runtime: normalizeSafeText(entry.qualification && entry.qualification.runtime, 160),
      urgency: normalizeSafeText(entry.qualification && entry.qualification.urgency, 1000),
      note: normalizeSafeText(entry.qualification && entry.qualification.note, 1000),
    },
    qualificationReview: sanitizeQualificationReview(entry.qualificationReview),
    attribution: {
      acquisitionId: normalizeSafeText(entry.attribution && entry.attribution.acquisitionId, 160),
      visitorId: normalizeSafeText(entry.attribution && entry.attribution.visitorId, 160),
      sessionId: normalizeSafeText(entry.attribution && entry.attribution.sessionId, 160),
      traceId: normalizeSafeText(entry.attribution && entry.attribution.traceId, 160),
      installId: normalizeSafeText(entry.attribution && entry.attribution.installId, 160),
      source: normalizeSafeText(entry.attribution && entry.attribution.source, 120),
      utmSource: normalizeSafeText(entry.attribution && entry.attribution.utmSource, 120),
      utmMedium: normalizeSafeText(entry.attribution && entry.attribution.utmMedium, 120),
      utmCampaign: normalizeSafeText(entry.attribution && entry.attribution.utmCampaign, 160),
      utmContent: normalizeSafeText(entry.attribution && entry.attribution.utmContent, 160),
      utmTerm: normalizeSafeText(entry.attribution && entry.attribution.utmTerm, 160),
      creator: normalizeSafeText(entry.attribution && entry.attribution.creator, 120),
      community: normalizeSafeText(entry.attribution && entry.attribution.community, 120),
      postId: normalizeSafeText(entry.attribution && entry.attribution.postId, 120),
      commentId: normalizeSafeText(entry.attribution && entry.attribution.commentId, 120),
      campaignVariant: normalizeSafeText(entry.attribution && entry.attribution.campaignVariant, 120),
      offerCode: normalizeSafeText(entry.attribution && entry.attribution.offerCode, 120),
      ctaId: normalizeSafeText(entry.attribution && entry.attribution.ctaId, 120),
      ctaPlacement: normalizeSafeText(entry.attribution && entry.attribution.ctaPlacement, 120),
      planId: normalizeSafeText(entry.attribution && entry.attribution.planId, 120),
      page: normalizeSafeText(entry.attribution && entry.attribution.page, 160),
      landingPath: normalizeSafeText(entry.attribution && entry.attribution.landingPath, 160),
      referrerHost: normalizeSafeText(entry.attribution && entry.attribution.referrerHost, 255),
      referrer: normalizeSafeText(entry.attribution && entry.attribution.referrer, 255),
    },
    workflowProgress: {
      qualifiedAt: normalizeText(entry.workflowProgress && entry.workflowProgress.qualifiedAt, 64),
      namedPilotAt: normalizeText(entry.workflowProgress && entry.workflowProgress.namedPilotAt, 64),
      proofBackedRunAt: normalizeText(entry.workflowProgress && entry.workflowProgress.proofBackedRunAt, 64),
      paidTeamAt: normalizeText(entry.workflowProgress && entry.workflowProgress.paidTeamAt, 64),
      lastRecurringPaymentAt: normalizeText(entry.workflowProgress && entry.workflowProgress.lastRecurringPaymentAt, 64),
    },
    proof: {
      artifacts: proofArtifacts,
      reviewedBy,
      lastWorkflowRunKey: normalizeText(entry.proof && entry.proof.lastWorkflowRunKey, 240),
    },
    commercialProof: sanitizeCommercialProof(entry.commercialProof),
    statusHistory: history,
  };
}

function appendWorkflowSprintLeadSnapshot(lead = {}, feedbackDir) {
  const sanitized = sanitizeWorkflowSprintLead(lead);
  const leadsPath = getWorkflowSprintLeadsPath(feedbackDir);
  fs.mkdirSync(path.dirname(leadsPath), { recursive: true });
  fs.appendFileSync(leadsPath, `${JSON.stringify(sanitized)}\n`, 'utf8');
  return sanitized;
}

function getWorkflowSprintLeadsPath(feedbackDir) {
  const baseDir = feedbackDir || getFeedbackPaths().FEEDBACK_DIR;
  return path.join(baseDir, WORKFLOW_SPRINT_LEADS_FILE);
}

function withWorkflowCommercialProofLock(feedbackDir, operation, {
  retryDelayMs = 10,
  maxAttempts = 400,
  staleAfterMs = 30_000,
} = {}) {
  const lockPath = `${getWorkflowSprintLeadsPath(feedbackDir)}.commercial.lock`;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
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
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, retryDelayMs);
    }
  }
  if (!acquired) {
    const err = new Error('Workflow commercial-proof update is busy; retry after the active update finishes.');
    err.statusCode = 503;
    throw err;
  }
  try {
    return operation();
  } finally {
    fs.rmSync(lockPath, { recursive: true, force: true });
  }
}

function getWorkflowSprintIntakeLimitsPath(feedbackDir) {
  const baseDir = feedbackDir || getFeedbackPaths().FEEDBACK_DIR;
  return path.join(baseDir, WORKFLOW_SPRINT_INTAKE_LIMITS_FILE);
}

function loadWorkflowSprintIntakeLimits(feedbackDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(getWorkflowSprintIntakeLimitsPath(feedbackDir), 'utf8'));
    return parsed && typeof parsed === 'object'
      ? parsed
      : { clients: {}, dedupe: {} };
  } catch {
    return { clients: {}, dedupe: {} };
  }
}

function saveWorkflowSprintIntakeLimits(state, feedbackDir) {
  const target = getWorkflowSprintIntakeLimitsPath(feedbackDir);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(state)}\n`, 'utf8');
  fs.renameSync(temp, target);
}

function withWorkflowSprintIntakeLimitLock(feedbackDir, operation) {
  const target = getWorkflowSprintIntakeLimitsPath(feedbackDir);
  const lockPath = `${target}.lock`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let acquired = false;
  for (let attempt = 0; attempt < 20 && !acquired; attempt += 1) {
    try {
      fs.mkdirSync(lockPath);
      acquired = true;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > 10 * 1000) {
          fs.rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  if (!acquired) return { allowed: false, reason: 'intake_limiter_busy', statusCode: 503 };
  try {
    return operation();
  } finally {
    fs.rmSync(lockPath, { recursive: true, force: true });
  }
}

function newestIntakeTimestamp(value) {
  const timestamps = Array.isArray(value) ? value : [value];
  return timestamps.reduce((newest, timestamp) => {
    const numeric = Number(timestamp);
    return Number.isFinite(numeric) ? Math.max(newest, numeric) : newest;
  }, 0);
}

function retainNewestIntakeEntries(record, requiredKey) {
  const entries = Object.entries(record);
  if (entries.length <= MAX_PERSISTED_INTAKE_KEYS) return record;
  entries.sort((left, right) => {
    if (left[0] === requiredKey) return -1;
    if (right[0] === requiredKey) return 1;
    return newestIntakeTimestamp(right[1]) - newestIntakeTimestamp(left[1]);
  });
  return Object.fromEntries(entries.slice(0, MAX_PERSISTED_INTAKE_KEYS));
}

function reserveWorkflowSprintIntake(payload = {}, {
  feedbackDir,
  rateLimitKey,
  now = Date.now(),
} = {}) {
  const validatedLead = buildWorkflowSprintLead(payload);
  return withWorkflowSprintIntakeLimitLock(feedbackDir, () => {
    const state = loadWorkflowSprintIntakeLimits(feedbackDir);
    const hourFloor = now - INTAKE_ALERT_WINDOW_MS;
    const duplicateFloor = now - DUPLICATE_INTAKE_WINDOW_MS;
    const clients = {};
    for (const [key, timestamps] of Object.entries(state.clients || {})) {
      const active = Array.isArray(timestamps)
        ? timestamps.filter((timestamp) => Number(timestamp) > hourFloor)
        : [];
      if (active.length) clients[key] = active;
    }
    const dedupe = {};
    for (const [key, timestamp] of Object.entries(state.dedupe || {})) {
      if (Number(timestamp) > duplicateFloor) dedupe[key] = Number(timestamp);
    }

    const clientKey = alertFingerprint(rateLimitKey || 'unknown-client');
    const duplicateKey = alertFingerprint([
      validatedLead.contact.email,
      validatedLead.qualification.workflow,
    ].join('|'));
    const clientEvents = clients[clientKey] || [];
    if (dedupe[duplicateKey]) {
      return { allowed: false, reason: 'duplicate_intake', statusCode: 429 };
    }
    if (clientEvents.length >= MAX_INTAKES_PER_CLIENT_HOUR) {
      return { allowed: false, reason: 'client_intake_rate_limited', statusCode: 429 };
    }

    clientEvents.push(now);
    clients[clientKey] = clientEvents;
    dedupe[duplicateKey] = now;
    saveWorkflowSprintIntakeLimits({
      updatedAt: new Date(now).toISOString(),
      clients: retainNewestIntakeEntries(clients, clientKey),
      dedupe: retainNewestIntakeEntries(dedupe, duplicateKey),
    }, feedbackDir);
    return { allowed: true };
  });
}

function buildWorkflowSprintLead(payload = {}) {
  const diagnosticIntake = isDiagnosticIntake(payload);
  const name = normalizeSafeText(payload.name, 160);
  const urgency = normalizeSafeText(payload.urgency, 1000);
  const email = normalizeEmail(payload.email);
  const workflow = normalizeSafeText(payload.workflow, 240);
  const owner = normalizeSafeText(payload.owner, 160);
  const blocker = normalizeSafeText(payload.blocker, 1000);
  const runtime = normalizeSafeText(payload.runtime, 160);

  if (!email) {
    const err = new Error('A valid email address is required.');
    err.statusCode = 400;
    throw err;
  }
  if (!workflow) {
    const err = new Error('Workflow is required.');
    err.statusCode = 400;
    throw err;
  }
  if (!diagnosticIntake && !owner) {
    const err = new Error('Workflow owner is required.');
    err.statusCode = 400;
    throw err;
  }
  if (!diagnosticIntake && !blocker) {
    const err = new Error('Repeated failure or rollout blocker is required.');
    err.statusCode = 400;
    throw err;
  }
  if (!diagnosticIntake && !runtime) {
    const err = new Error('Current agent or runtime is required.');
    err.statusCode = 400;
    throw err;
  }

  const submittedAt = normalizeText(payload.submittedAt, 64) || new Date().toISOString();

  return {
    leadId: `lead_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
    submittedAt,
    updatedAt: submittedAt,
    status: 'new',
    offer: diagnosticIntake ? 'workflow_hardening_diagnostic' : 'workflow_hardening_sprint',
    contact: {
      name,
      email,
      company: normalizeSafeText(payload.company, 160),
    },
    qualification: {
      workflow,
      owner,
      blocker,
      runtime,
      urgency,
      note: normalizeSafeText(payload.note, 1000),
    },
    qualificationReview: sanitizeQualificationReview(),
    attribution: {
      acquisitionId: normalizeSafeText(payload.acquisitionId, 160),
      visitorId: normalizeSafeText(payload.visitorId, 160),
      sessionId: normalizeSafeText(payload.sessionId, 160),
      traceId: normalizeSafeText(payload.traceId, 160),
      installId: normalizeSafeText(payload.installId, 160),
      source: normalizeSafeText(payload.source, 120),
      utmSource: normalizeSafeText(payload.utmSource, 120),
      utmMedium: normalizeSafeText(payload.utmMedium, 120),
      utmCampaign: normalizeSafeText(payload.utmCampaign, 160),
      utmContent: normalizeSafeText(payload.utmContent, 160),
      utmTerm: normalizeSafeText(payload.utmTerm, 160),
      creator: normalizeSafeText(payload.creator, 120),
      community: normalizeSafeText(payload.community, 120),
      postId: normalizeSafeText(payload.postId, 120),
      commentId: normalizeSafeText(payload.commentId, 120),
      campaignVariant: normalizeSafeText(payload.campaignVariant, 120),
      offerCode: normalizeSafeText(payload.offerCode, 120),
      ctaId: normalizeSafeText(payload.ctaId, 120),
      ctaPlacement: normalizeSafeText(payload.ctaPlacement, 120),
      planId: normalizeSafeText(payload.planId, 120),
      page: normalizeSafeText(payload.page, 160),
      landingPath: normalizeSafeText(payload.landingPath, 160),
      referrerHost: normalizeSafeText(payload.referrerHost, 255),
      referrer: normalizeSafeText(payload.referrer, 255),
    },
    workflowProgress: {
      qualifiedAt: null,
      namedPilotAt: null,
      proofBackedRunAt: null,
      paidTeamAt: null,
      lastRecurringPaymentAt: null,
    },
    proof: {
      artifacts: [],
      reviewedBy: null,
      lastWorkflowRunKey: null,
    },
    commercialProof: sanitizeCommercialProof(),
    statusHistory: [
      buildStatusHistoryEntry({
        fromStatus: null,
        toStatus: 'new',
        actor: normalizeText(payload.actor, 160) || 'website',
        note: normalizeSafeText(payload.note, 1000),
        timestamp: submittedAt,
      }),
    ],
  };
}

function validateSignedScope(scope = {}, { now = new Date().toISOString() } = {}) {
  const offer = OFFER_CATALOG[scope.offerId];
  if (!CONTRACTABLE_OFFER_IDS.includes(scope.offerId) || !offer) {
    return 'Signed scope must name a supported fixed-scope service offer.';
  }
  if (!scope.source || !scope.reference || !scope.signedBy || !scope.signedAt || !scope.digest) {
    return 'Signed scope requires source, reference, signer, signedAt, and SHA-256 digest.';
  }
  if (/^REPLACE_WITH_/i.test(scope.source) || /^REPLACE_WITH_/i.test(scope.reference)) {
    return 'Replace agreement evidence placeholders with an actual signed-scope reference.';
  }
  if (!SIGNED_SCOPE_DIGEST_PATTERN.test(scope.digest)) {
    return 'Signed scope digest must be sha256 followed by 64 lowercase hexadecimal characters.';
  }
  const signedAt = new Date(scope.signedAt);
  const current = new Date(now);
  if (Number.isNaN(signedAt.getTime()) || Number.isNaN(current.getTime()) ||
      signedAt.getTime() > current.getTime() + 5 * 60 * 1000) {
    return 'Signed scope signedAt must be a valid non-future ISO timestamp.';
  }
  if (scope.currency !== 'usd' || scope.billing !== offer.billing) {
    return `Signed scope must match the fixed ${scope.offerId} USD currency and billing cadence.`;
  }
  const creditedSprintBalance = OFFER_CATALOG.workflow_hardening_sprint.priceCents - DIAGNOSTIC_CREDIT_CENTS;
  if (scope.offerId === 'workflow_hardening_sprint') {
    const fullPrice = scope.amountCents === offer.priceCents && scope.creditCents === 0 && !scope.creditSalesLeadId;
    const creditedPrice = scope.amountCents === creditedSprintBalance &&
      scope.creditCents === DIAGNOSTIC_CREDIT_CENTS && Boolean(scope.creditSalesLeadId);
    if (!fullPrice && !creditedPrice) {
      return 'Signed Workflow Hardening Sprint scope must use the full catalog price or the documented diagnostic-credit balance with a credited paid sales lead.';
    }
  } else if (scope.amountCents !== offer.priceCents || scope.creditCents !== 0 || scope.creditSalesLeadId) {
    return `Signed scope must match the fixed ${scope.offerId} catalog price without an unrelated credit.`;
  }
  if (scope.offerId === 'workflow_hardening_sprint' && scope.workflowCount !== 1) {
    return 'Workflow Hardening Sprint scope must contain exactly one workflow.';
  }
  if (scope.offerId === 'workflow_reliability_operations' && scope.workflowCount !== 1) {
    return 'Workflow Reliability Operations scope must contain exactly one existing workflow.';
  }
  if (scope.offerId === 'enterprise_governance_pilot' &&
      (scope.workflowCount < 2 || scope.workflowCount > 3)) {
    return 'Enterprise Governance Pilot scope must contain two or three workflows.';
  }
  if (scope.offerId === 'enterprise_reliability_operations') {
    if (scope.workflowCount < 1 || scope.workflowCount > 3) {
      return 'Enterprise Reliability Operations scope must contain one to three existing pilot workflows.';
    }
    if (!scope.priorPilotReference || !SIGNED_SCOPE_DIGEST_PATTERN.test(scope.priorPilotDigest || '')) {
      return 'Enterprise Reliability Operations requires a completed-pilot reference and SHA-256 evidence digest.';
    }
  }
  return null;
}

function requireSignedScopeEvidence(payload = {}, lead = {}, {
  feedbackDir,
  now = new Date().toISOString(),
} = {}) {
  const offerId = normalizeText(payload.agreementOfferId, 120);
  const offer = OFFER_CATALOG[offerId];
  const scope = {
    source: normalizeText(payload.agreementSource, 160),
    reference: normalizeText(payload.agreementRef, 1000),
    signedBy: normalizeText(payload.agreementSignedBy, 320),
    signedAt: normalizeText(payload.agreementSignedAt, 64),
    digest: normalizeText(payload.agreementDigest, 160)?.toLowerCase() || null,
    offerId,
    amountCents: normalizePositiveInteger(payload.agreementAmountCents, 0),
    currency: 'usd',
    billing: offer?.billing || null,
    workflowCount: normalizePositiveInteger(payload.agreementWorkflowCount, 0),
    creditCents: normalizePositiveInteger(payload.agreementCreditCents, 0),
    creditSalesLeadId: normalizeText(payload.agreementCreditSalesLeadId, 160),
    priorPilotReference: normalizeText(payload.agreementPriorPilotRef, 1000),
    priorPilotDigest: normalizeText(payload.agreementPriorPilotDigest, 160)?.toLowerCase() || null,
  };
  const gap = validateSignedScope(scope, { now });
  if (gap) {
    const err = new Error(`named_pilot requires an offer-attributed accepted scope: ${gap}`);
    err.statusCode = 400;
    throw err;
  }
  if (lead.offer === 'workflow_hardening_diagnostic' && offerId === 'workflow_hardening_sprint') {
    const err = new Error('A diagnostic intake must first be converted to a separately tracked sprint sales lead before named_pilot.');
    err.statusCode = 400;
    throw err;
  }
  if (scope.offerId === 'enterprise_reliability_operations') {
    const pilot = verifyCompletedPilotReference(scope, lead, loadSalesLeads({ feedbackDir }), {
      workflowLeads: loadWorkflowSprintLeads(feedbackDir),
      now,
    });
    if (!pilot.verified) {
      const err = new Error(`named_pilot requires verified completed Enterprise pilot lineage: ${pilot.reason}`);
      err.statusCode = 400;
      throw err;
    }
  }
  if (scope.creditSalesLeadId) {
    const credit = evaluateDiagnosticCredit(scope, lead, loadSalesLeads({ feedbackDir }));
    if (!credit.verified) {
      const err = new Error(`named_pilot requires a verified diagnostic credit: ${credit.reason}`);
      err.statusCode = 400;
      throw err;
    }
    const duplicateCredit = loadWorkflowSprintLeadSnapshots(feedbackDir).find((entry) =>
      entry.leadId !== lead.leadId &&
      entry.commercialProof?.scope?.creditSalesLeadId === scope.creditSalesLeadId);
    if (duplicateCredit) {
      const err = new Error(`Diagnostic credit sales lead ${scope.creditSalesLeadId} is already assigned to another workflow scope.`);
      err.statusCode = 400;
      throw err;
    }
  }
  return scope;
}

function evaluateDiagnosticCredit(scope = {}, workflowLead = {}, salesLeads = []) {
  if (!scope.creditSalesLeadId && scope.creditCents === 0) {
    return { verified: true, salesLeadId: null, reference: null, digest: null };
  }
  if (scope.offerId !== 'workflow_hardening_sprint' || scope.creditCents !== DIAGNOSTIC_CREDIT_CENTS ||
      !scope.creditSalesLeadId) {
    return { verified: false, reason: 'Signed scope contains an unsupported diagnostic credit.' };
  }
  const creditLead = salesLeads.find((entry) => entry.leadId === scope.creditSalesLeadId);
  const creditProof = creditLead ? evaluateLeadEvidenceAtStage(creditLead, 'paid') : null;
  const workflowEmail = normalizeEmail(workflowLead.contact && workflowLead.contact.email);
  const creditEmail = normalizeEmail(creditLead && creditLead.contact && creditLead.contact.email);
  if (!creditLead || creditLead.stage !== 'paid' || !creditProof?.verified || !creditProof.evidence ||
      !workflowEmail || workflowEmail !== creditEmail ||
      creditLead.offer !== 'workflow_hardening_diagnostic' ||
      creditLead.revenue.currency !== 'usd' || creditLead.revenue.amountCents !== DIAGNOSTIC_CREDIT_CENTS) {
    return { verified: false, reason: 'Diagnostic credit does not reconcile to a same-buyer, provider-paid $499 diagnostic sales record.' };
  }
  return {
    verified: true,
    salesLeadId: creditLead.leadId,
    reference: creditProof.evidence.reference,
    digest: creditProof.evidence.digest,
  };
}

function validateRecurringBillingProof(payment = {}, scope = {}, { now = new Date().toISOString() } = {}) {
  if (!RECURRING_OFFER_IDS.has(scope.offerId)) {
    return { required: false, verified: true, active: false, reason: null };
  }
  const invoiceId = normalizeText(payment.invoiceId, 127);
  const periodStart = new Date(String(payment.billingPeriodStart || ''));
  const periodEnd = new Date(String(payment.billingPeriodEnd || ''));
  const paidAt = new Date(String(payment.paidAt || ''));
  const current = new Date(String(now || ''));
  if (!invoiceId || /^REPLACE_WITH_/i.test(invoiceId)) {
    return { required: true, verified: false, active: false, reason: 'Recurring service proof requires the provider-authenticated invoice ID.' };
  }
  if ([periodStart, periodEnd, paidAt, current].some((date) => Number.isNaN(date.getTime()))) {
    return { required: true, verified: false, active: false, reason: 'Recurring service proof requires valid payment and billing-period timestamps.' };
  }
  if (paidAt.getTime() > current.getTime()) {
    return { required: true, verified: false, active: false, reason: 'Provider payment timestamp cannot be later than the recurring-proof evaluation time.' };
  }
  const durationMs = periodEnd.getTime() - periodStart.getTime();
  if (durationMs < RECURRING_PERIOD_MIN_MS || durationMs > RECURRING_PERIOD_MAX_MS) {
    return { required: true, verified: false, active: false, reason: 'Recurring service billing period must be between 27 and 32 days.' };
  }
  if (paidAt.getTime() < periodStart.getTime() - RECURRING_PREPAY_MAX_MS ||
      paidAt.getTime() >= periodEnd.getTime()) {
    return { required: true, verified: false, active: false, reason: 'Provider payment must fall within the billing period or its seven-day prepayment window.' };
  }
  const state = current.getTime() < periodStart.getTime()
    ? 'scheduled'
    : current.getTime() < periodEnd.getTime() ? 'active' : 'expired';
  const active = state === 'active';
  return {
    required: true,
    verified: true,
    active,
    state,
    invoiceId,
    billingPeriodStart: periodStart.toISOString(),
    billingPeriodEnd: periodEnd.toISOString(),
    reason: active ? null : state === 'scheduled'
      ? 'The verified recurring invoice billing period has not started.'
      : 'The verified recurring invoice is outside its active billing period.',
  };
}

function buildCompletedPilotEvidence(pilotWorkflowLead = {}, salesLeads = [], {
  now = new Date().toISOString(),
} = {}) {
  const pilot = sanitizeWorkflowSprintLead(pilotWorkflowLead);
  if (pilot.offer !== 'enterprise_governance_pilot' ||
      pilot.commercialProof.scope.offerId !== 'enterprise_governance_pilot') {
    return {
      verified: false,
      reference: pilot.leadId,
      digest: null,
      evidence: null,
      reason: 'Referenced workflow is not an Enterprise Governance Pilot.',
    };
  }
  if (pilot.proof.artifacts.length === 0) {
    return {
      verified: false,
      reference: pilot.leadId,
      digest: null,
      evidence: null,
      reason: 'Referenced Enterprise Governance Pilot lacks a proof artifact.',
    };
  }
  const commercial = evaluatePaidTeamCommercialProof(pilot, salesLeads, {
    now,
    skipPriorPilotVerification: true,
  });
  if (!commercial.verified) {
    return {
      verified: false,
      reference: pilot.leadId,
      digest: null,
      evidence: null,
      reason: `Referenced Enterprise Governance Pilot is not provider-paid and proof-backed: ${commercial.reason}`,
    };
  }
  const buyerEmail = normalizeEmail(pilot.contact.email);
  const proofBackedTransition = pilot.statusHistory
    .filter((entry) => entry.toStatus === 'proof_backed_run')
    .at(-1);
  const paidTeamTransition = pilot.statusHistory
    .filter((entry) => entry.toStatus === 'paid_team')
    .at(-1);
  const proofBackedRunAt = pilot.workflowProgress.proofBackedRunAt || proofBackedTransition?.at || null;
  const paidTeamAt = pilot.workflowProgress.paidTeamAt || paidTeamTransition?.at || null;
  const providerPaidAt = pilot.commercialProof.payment.paidAt;
  const proofBackedDate = new Date(String(proofBackedRunAt || ''));
  const paidTeamDate = new Date(String(paidTeamAt || ''));
  const providerPaidDate = new Date(String(providerPaidAt || ''));
  const current = new Date(String(now || ''));
  if ([proofBackedDate, paidTeamDate, providerPaidDate, current]
    .some((date) => Number.isNaN(date.getTime())) ||
      proofBackedDate.getTime() > paidTeamDate.getTime() ||
      providerPaidDate.getTime() > paidTeamDate.getTime() ||
      paidTeamDate.getTime() > current.getTime()) {
    return {
      verified: false,
      reference: pilot.leadId,
      digest: null,
      evidence: null,
      reason: 'Referenced Enterprise Governance Pilot has inconsistent proof, payment, or completion timestamps.',
    };
  }
  const evidence = {
    schemaVersion: 1,
    pilotLeadId: pilot.leadId,
    buyerEmailHash: sha256Digest(buyerEmail),
    offerId: 'enterprise_governance_pilot',
    workflowCount: commercial.workflowCount,
    amountCents: commercial.amountCents,
    currency: commercial.currency,
    signedScopeDigest: commercial.signedScopeDigest,
    paymentDigest: commercial.paymentDigest,
    proofArtifactCount: pilot.proof.artifacts.length,
    proofArtifactDigests: [...new Set(pilot.proof.artifacts.map((artifact) => sha256Digest(artifact)))].sort(),
    proofBackedRunAt,
    providerPaidAt,
    paidTeamAt,
  };
  return {
    verified: true,
    reference: pilot.leadId,
    digest: sha256Digest(JSON.stringify(evidence)),
    evidence,
    reason: null,
  };
}

function verifyCompletedPilotReference(scope = {}, recurringWorkflowLead = {}, salesLeads = [], {
  workflowLeads = [],
  now = new Date().toISOString(),
} = {}) {
  if (scope.offerId !== 'enterprise_reliability_operations') {
    return { verified: true, required: false, reference: null, digest: null, reason: null };
  }
  const recurringLead = sanitizeWorkflowSprintLead(recurringWorkflowLead);
  const reference = normalizeText(scope.priorPilotReference, 1000);
  const expectedDigest = normalizeText(scope.priorPilotDigest, 160)?.toLowerCase() || null;
  if (!reference || !SIGNED_SCOPE_DIGEST_PATTERN.test(expectedDigest || '')) {
    return {
      verified: false,
      required: true,
      reference,
      digest: null,
      reason: 'Completed-pilot reference and SHA-256 evidence digest are required.',
    };
  }
  if (reference === recurringLead.leadId) {
    return {
      verified: false,
      required: true,
      reference,
      digest: null,
      reason: 'Enterprise recurring scope cannot cite itself as its completed pilot.',
    };
  }
  const pilot = workflowLeads
    .map((entry) => sanitizeWorkflowSprintLead(entry))
    .find((entry) => entry.leadId === reference);
  if (!pilot) {
    return {
      verified: false,
      required: true,
      reference,
      digest: null,
      reason: `Completed Enterprise pilot workflow ${reference} is missing.`,
    };
  }
  const recurringBuyer = normalizeEmail(recurringLead.contact.email);
  const pilotBuyer = normalizeEmail(pilot.contact.email);
  if (!recurringBuyer || recurringBuyer !== pilotBuyer) {
    return {
      verified: false,
      required: true,
      reference,
      digest: null,
      reason: 'Completed Enterprise pilot must belong to the same normalized buyer email.',
    };
  }
  const completedPilot = buildCompletedPilotEvidence(pilot, salesLeads, { now });
  if (!completedPilot.verified) {
    return { ...completedPilot, required: true };
  }
  if (scope.workflowCount > completedPilot.evidence.workflowCount) {
    return {
      verified: false,
      required: true,
      reference,
      digest: completedPilot.digest,
      reason: 'Enterprise recurring scope cannot cover more workflows than the completed pilot proved.',
    };
  }
  const pilotCompletedAt = new Date(String(completedPilot.evidence.paidTeamAt || ''));
  const recurringScopeSignedAt = new Date(String(scope.signedAt || ''));
  if (Number.isNaN(pilotCompletedAt.getTime()) || Number.isNaN(recurringScopeSignedAt.getTime()) ||
      pilotCompletedAt.getTime() > recurringScopeSignedAt.getTime()) {
    return {
      verified: false,
      required: true,
      reference,
      digest: completedPilot.digest,
      reason: 'Enterprise pilot must be completed before the recurring scope is signed.',
    };
  }
  if (expectedDigest !== completedPilot.digest) {
    return {
      verified: false,
      required: true,
      reference,
      digest: completedPilot.digest,
      reason: 'Completed Enterprise pilot evidence digest does not match the canonical paid pilot record.',
    };
  }
  return { ...completedPilot, required: true };
}

function requireVerifiedPaidSalesLead(payload = {}, feedbackDir, workflowLead = {}, scope = {}, {
  now = new Date().toISOString(),
} = {}) {
  const salesLeadId = normalizeText(payload.salesLeadId, 160);
  if (!salesLeadId) {
    const err = new Error('paid_team requires salesLeadId for a reconciled paid sales-pipeline record.');
    err.statusCode = 400;
    throw err;
  }
  const salesLeads = loadSalesLeads({ feedbackDir });
  const salesLead = salesLeads.find((entry) => entry.leadId === salesLeadId);
  if (!salesLead) {
    const err = new Error(`paid_team references unknown sales lead: ${salesLeadId}`);
    err.statusCode = 400;
    throw err;
  }
  const duplicatePayment = loadWorkflowSprintLeadSnapshots(feedbackDir).find((entry) =>
    entry.commercialProof?.payment?.salesLeadId === salesLeadId);
  if (duplicatePayment) {
    const destination = duplicatePayment.leadId === workflowLead.leadId
      ? 'a prior billing period for this workflow contract'
      : 'another workflow contract';
    const err = new Error(`Paid sales lead ${salesLeadId} is already assigned to ${destination}.`);
    err.statusCode = 400;
    throw err;
  }
  const paymentProof = evaluateLeadEvidenceAtStage(salesLead, 'paid');
  if (salesLead.stage !== 'paid' || !paymentProof.verified || salesLead.revenue.amountCents <= 0) {
    const err = new Error('paid_team requires a sales lead at paid with provider_payment evidence and a positive amountCents.');
    err.statusCode = 400;
    throw err;
  }
  const workflowEmail = normalizeEmail(workflowLead.contact && workflowLead.contact.email);
  const salesEmail = normalizeEmail(salesLead.contact && salesLead.contact.email);
  if (!workflowEmail || !salesEmail || workflowEmail !== salesEmail) {
    const err = new Error('paid_team requires the reconciled sales lead buyer email to match the workflow intake buyer.');
    err.statusCode = 400;
    throw err;
  }
  if (salesLead.offer !== scope.offerId) {
    const err = new Error('paid_team requires the reconciled sales lead offer to match the signed scope offer.');
    err.statusCode = 400;
    throw err;
  }
  if (salesLead.revenue.currency !== 'usd' || salesLead.revenue.amountCents !== scope.amountCents) {
    const err = new Error('paid_team requires the provider-paid amount and currency to exactly match the signed scope.');
    err.statusCode = 400;
    throw err;
  }
  const credit = evaluateDiagnosticCredit(scope, workflowLead, salesLeads);
  if (!credit.verified) {
    const err = new Error(`paid_team requires a verified diagnostic credit: ${credit.reason}`);
    err.statusCode = 400;
    throw err;
  }
  const payment = {
    source: paymentProof.evidence.source,
    reference: paymentProof.evidence.reference,
    provider: paymentProof.evidence.provider,
    digest: paymentProof.evidence.digest,
    verified: true,
    offerId: salesLead.offer,
    buyerEmailMatch: true,
    creditSalesLeadId: credit.salesLeadId,
    creditPaymentReference: credit.reference,
    creditPaymentDigest: credit.digest,
    salesLeadId,
    amountCents: salesLead.revenue.amountCents,
    currency: salesLead.revenue.currency,
    paidAt: salesLead.revenue.paidAt || paymentProof.evidenceAt,
  };
  if (RECURRING_OFFER_IDS.has(scope.offerId)) {
    payment.invoiceId = normalizeText(paymentProof.evidence.invoiceId, 127);
    const billingPeriodStart = new Date(String(payload.billingPeriodStart || ''));
    const billingPeriodEnd = new Date(String(payload.billingPeriodEnd || ''));
    payment.billingPeriodStart = Number.isNaN(billingPeriodStart.getTime()) ? null : billingPeriodStart.toISOString();
    payment.billingPeriodEnd = Number.isNaN(billingPeriodEnd.getTime()) ? null : billingPeriodEnd.toISOString();
    const recurringProof = validateRecurringBillingProof(payment, scope, { now });
    if (!recurringProof.verified) {
      const err = new Error(`paid_team recurring service proof failed: ${recurringProof.reason}`);
      err.statusCode = 400;
      throw err;
    }
  }
  return payment;
}

function evaluatePaidTeamCommercialProof(workflowLead = {}, salesLeads = [], {
  now = new Date().toISOString(),
  workflowLeads = [],
  skipPriorPilotVerification = false,
} = {}) {
  const lead = sanitizeWorkflowSprintLead(workflowLead);
  if (lead.status !== 'paid_team') {
    return { verified: false, leadId: lead.leadId, offerId: null, reason: 'Workflow lead is not at paid_team.' };
  }
  const historyStages = lead.statusHistory.map((entry) => entry.toStatus);
  if (!historyStages.includes('named_pilot') || !historyStages.includes('proof_backed_run') ||
      !historyStages.includes('paid_team')) {
    return { verified: false, leadId: lead.leadId, offerId: null, reason: 'Paid team lead lacks the signed-scope and proof-backed transition history.' };
  }
  if (!lead.proof.reviewedBy && lead.proof.artifacts.length === 0) {
    return { verified: false, leadId: lead.leadId, offerId: null, reason: 'Paid team lead lacks buyer review or proof artifacts.' };
  }
  if (!isEvidenceBasedQualificationReview(lead.qualificationReview)) {
    return { verified: false, leadId: lead.leadId, offerId: null, reason: 'Paid team lead lacks an evidence-based buyer qualification review.' };
  }
  const scope = lead.commercialProof.scope;
  const scopeGap = validateSignedScope(scope, { now });
  if (scopeGap) {
    return { verified: false, leadId: lead.leadId, offerId: scope.offerId, reason: scopeGap };
  }
  if (!skipPriorPilotVerification && scope.offerId === 'enterprise_reliability_operations') {
    const pilot = verifyCompletedPilotReference(scope, lead, salesLeads, { workflowLeads, now });
    if (!pilot.verified) {
      return { verified: false, leadId: lead.leadId, offerId: scope.offerId, reason: pilot.reason };
    }
  }
  const payment = lead.commercialProof.payment;
  const salesLead = salesLeads.find((entry) => entry.leadId === payment.salesLeadId);
  if (!salesLead) {
    return { verified: false, leadId: lead.leadId, offerId: scope.offerId, reason: 'Linked paid sales lead is missing.' };
  }
  const paymentProof = evaluateLeadEvidenceAtStage(salesLead, 'paid');
  const workflowEmail = normalizeEmail(lead.contact.email);
  const salesEmail = normalizeEmail(salesLead.contact && salesLead.contact.email);
  const credit = evaluateDiagnosticCredit(scope, lead, salesLeads);
  const recurringProof = validateRecurringBillingProof(payment, scope, { now });
  if (salesLead.stage !== 'paid' || !paymentProof.verified || !paymentProof.evidence ||
      !workflowEmail || workflowEmail !== salesEmail || salesLead.offer !== scope.offerId ||
      salesLead.revenue.currency !== 'usd' || salesLead.revenue.amountCents !== scope.amountCents ||
      payment.reference !== paymentProof.evidence.reference ||
      payment.source !== paymentProof.evidence.source ||
      payment.provider !== paymentProof.evidence.provider ||
      payment.digest !== paymentProof.evidence.digest || payment.verified !== true ||
      payment.offerId !== scope.offerId || payment.buyerEmailMatch !== true ||
      payment.amountCents !== scope.amountCents || payment.currency !== 'usd' || !credit.verified ||
      payment.creditSalesLeadId !== credit.salesLeadId ||
      payment.creditPaymentReference !== credit.reference || payment.creditPaymentDigest !== credit.digest ||
      !recurringProof.verified ||
      (recurringProof.required && payment.invoiceId !== paymentProof.evidence.invoiceId)) {
    return {
      verified: false,
      leadId: lead.leadId,
      offerId: scope.offerId,
      reason: 'Signed scope, buyer, offer, amount, and authenticated provider payment do not reconcile exactly.',
    };
  }
  return {
    verified: true,
    leadId: lead.leadId,
    salesLeadId: salesLead.leadId,
    offerId: scope.offerId,
    amountCents: scope.amountCents,
    currency: 'usd',
    billing: scope.billing,
    workflowCount: scope.workflowCount,
    recurring: RECURRING_OFFER_IDS.has(scope.offerId),
    activeRecurring: recurringProof.active,
    recurringState: recurringProof.state || null,
    recurringReason: recurringProof.reason,
    providerInvoiceId: recurringProof.invoiceId || null,
    billingPeriodStart: recurringProof.billingPeriodStart || null,
    billingPeriodEnd: recurringProof.billingPeriodEnd || null,
    enterprise: ENTERPRISE_OFFER_IDS.has(scope.offerId),
    signedScopeDigest: scope.digest,
    scopeEvidenceMode: SIGNED_SCOPE_EVIDENCE_MODE,
    paymentDigest: payment.digest,
    creditSalesLeadId: scope.creditSalesLeadId,
    reason: null,
  };
}

function auditWorkflowCommercialProof(workflowLeads = [], salesLeads = [], options = {}) {
  const paidTeamLeads = workflowLeads.filter((lead) => lead.status === 'paid_team');
  const preliminary = paidTeamLeads.map((lead) => evaluatePaidTeamCommercialProof(lead, salesLeads, {
    ...options,
    workflowLeads,
  }));
  const paymentUses = new Map();
  const creditUses = new Map();
  const proofSnapshots = Array.isArray(options.workflowSnapshots)
    ? options.workflowSnapshots.map((entry) => sanitizeWorkflowSprintLead(entry))
    : workflowLeads.map((entry) => sanitizeWorkflowSprintLead(entry));
  for (const snapshot of proofSnapshots) {
    const paymentId = snapshot.commercialProof?.payment?.salesLeadId;
    if (paymentId) {
      const uses = paymentUses.get(paymentId) || [];
      uses.push(snapshot.leadId);
      paymentUses.set(paymentId, uses);
    }
    const creditId = snapshot.commercialProof?.scope?.creditSalesLeadId;
    if (creditId) {
      const leadIds = creditUses.get(creditId) || new Set();
      leadIds.add(snapshot.leadId);
      creditUses.set(creditId, leadIds);
    }
  }
  const replayedPaymentIds = new Set([...paymentUses.entries()]
    .filter(([, leadIds]) => leadIds.length > 1)
    .map(([paymentId]) => paymentId));
  const replayedCreditIds = new Set([...creditUses.entries()]
    .filter(([, leadIds]) => leadIds.size > 1)
    .map(([creditId]) => creditId));
  const compromisedLeadIds = new Set();
  for (const paymentId of replayedPaymentIds) {
    for (const leadId of paymentUses.get(paymentId) || []) compromisedLeadIds.add(leadId);
  }
  for (const creditId of replayedCreditIds) {
    for (const leadId of creditUses.get(creditId) || []) compromisedLeadIds.add(leadId);
  }
  const results = preliminary.map((result) => {
    if (!result.verified) return result;
    const paymentLeadIds = paymentUses.get(result.salesLeadId) || [];
    if (new Set(paymentLeadIds).size > 1) {
      return { ...result, verified: false, reason: 'One paid sales record is assigned to multiple workflow contracts.' };
    }
    if (result.creditSalesLeadId && (creditUses.get(result.creditSalesLeadId)?.size || 0) > 1) {
      return { ...result, verified: false, reason: 'One diagnostic credit is assigned to multiple workflow contracts.' };
    }
    if (compromisedLeadIds.has(result.leadId)) {
      return { ...result, verified: false, reason: 'Historical payment or diagnostic-credit evidence is replayed across workflow contract snapshots.' };
    }
    return result;
  });
  const verified = results.filter((result) => result.verified);
  return {
    ok: results.every((result) => result.verified),
    scopeEvidenceMode: SIGNED_SCOPE_EVIDENCE_MODE,
    paidTeamCount: paidTeamLeads.length,
    verifiedPaidTeamCount: verified.length,
    unverifiedPaidTeamCount: results.length - verified.length,
    verifiedRevenueCents: verified.reduce((sum, result) => sum + result.amountCents, 0),
    verifiedRecurringCount: verified.filter((result) => result.activeRecurring).length,
    historicalRecurringCount: verified.filter((result) => result.recurringState === 'expired').length,
    scheduledRecurringCount: verified.filter((result) => result.recurringState === 'scheduled').length,
    verifiedRecurringRevenueCents: verified.filter((result) => result.activeRecurring)
      .reduce((sum, result) => sum + result.amountCents, 0),
    verifiedEnterpriseCount: verified.filter((result) => result.enterprise).length,
    replayedPaymentCount: replayedPaymentIds.size,
    replayedDiagnosticCreditCount: replayedCreditIds.size,
    byOffer: Object.fromEntries(CONTRACTABLE_OFFER_IDS.map((offerId) => [offerId,
      verified.filter((result) => result.offerId === offerId).length])),
    results,
  };
}

function appendWorkflowSprintLead(payload = {}, { feedbackDir } = {}) {
  const lead = buildWorkflowSprintLead(payload);
  return appendWorkflowSprintLeadSnapshot(lead, feedbackDir);
}

function resolveWorkflowSprintAlertRecipient(env = process.env) {
  return normalizeEmail(
    env.THUMBGATE_OPERATOR_ALERT_EMAIL
    || env.THUMBGATE_PRO_ACTIVATION_ALERT_EMAIL
    || env.THUMBGATE_SUPPORT_EMAIL
    || DEFAULT_OPERATOR_ALERT_EMAIL
  );
}

function renderWorkflowSprintLeadAlert(lead = {}) {
  const attribution = lead.attribution || {};
  const contact = lead.contact || {};
  const qualification = lead.qualification || {};
  const text = [
    'New ThumbGate workflow intake.',
    '',
    `Lead ID: ${lead.leadId || 'unknown'}`,
    `Plan: ${attribution.planId || 'unknown'}`,
    `Name: ${contact.name || 'not provided'}`,
    `Email: ${contact.email || 'not provided'}`,
    `Company: ${contact.company || 'not provided'}`,
    `Workflow: ${qualification.workflow || 'not provided'}`,
    `Owner: ${qualification.owner || 'not provided'}`,
    `Blocker: ${qualification.blocker || 'not provided'}`,
    `Runtime: ${qualification.runtime || 'not provided'}`,
    `Urgency: ${qualification.urgency || 'not provided'}`,
    `Source: ${attribution.utmSource || attribution.source || 'unknown'}`,
  ].join('\n');
  return {
    subject: `ThumbGate intake: ${contact.company || contact.email || lead.leadId || 'new lead'}`,
    text,
  };
}

function alertFingerprint(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function pruneAlertState(now) {
  for (const [key, timestamp] of intakeAlertDedupByKey) {
    if (now - timestamp >= INTAKE_ALERT_WINDOW_MS) intakeAlertDedupByKey.delete(key);
  }
  for (const [key, timestamps] of intakeAlertTimesByKey) {
    const active = timestamps.filter((timestamp) => now - timestamp < INTAKE_ALERT_WINDOW_MS);
    if (active.length) intakeAlertTimesByKey.set(key, active);
    else intakeAlertTimesByKey.delete(key);
  }
  while (intakeAlertTimesByKey.size > MAX_ALERT_RATE_KEYS) {
    intakeAlertTimesByKey.delete(intakeAlertTimesByKey.keys().next().value);
  }
}

function reserveIntakeAlert({ lead, rateLimitKey, now = Date.now() } = {}) {
  pruneAlertState(now);
  const dedupeKey = alertFingerprint([
    lead && lead.contact && lead.contact.email,
    lead && lead.qualification && lead.qualification.workflow,
  ].join('|'));
  if (intakeAlertDedupByKey.has(dedupeKey)) {
    return { allowed: false, reason: 'duplicate_intake_alert', dedupeKey };
  }

  const normalizedRateKey = normalizeText(rateLimitKey, 160);
  if (normalizedRateKey) {
    const key = alertFingerprint(normalizedRateKey);
    const timestamps = intakeAlertTimesByKey.get(key) || [];
    if (timestamps.length >= MAX_INTAKE_ALERTS_PER_WINDOW) {
      return { allowed: false, reason: 'intake_alert_rate_limited', dedupeKey };
    }
    timestamps.push(now);
    intakeAlertTimesByKey.set(key, timestamps);
  }
  return { allowed: true, dedupeKey };
}

async function notifyWorkflowSprintLead(lead = {}, {
  env = process.env,
  sendEmailImpl,
  rateLimitKey,
  now,
} = {}) {
  const to = resolveWorkflowSprintAlertRecipient(env);
  if (!to) return { sent: false, reason: 'missing_operator_alert_email' };
  const sender = sendEmailImpl || require('./mailer').sendEmail;
  if (typeof sender !== 'function') return { sent: false, reason: 'missing_mailer' };
  const reservation = reserveIntakeAlert({ lead, rateLimitKey, now });
  if (!reservation.allowed) return { sent: false, reason: reservation.reason };
  const message = renderWorkflowSprintLeadAlert(lead);
  try {
    const result = await sender({
      to,
      ...message,
      idempotencyKey: `intake-${reservation.dedupeKey}`,
    });
    if (result && result.sent === true) {
      intakeAlertDedupByKey.set(reservation.dedupeKey, Number.isFinite(now) ? now : Date.now());
    }
    return result;
  } catch (error) {
    return {
      sent: false,
      reason: 'exception',
      error: error && error.message ? error.message : String(error),
    };
  }
}

function loadWorkflowSprintLeadSnapshots(feedbackDir) {
  const leadsPath = getWorkflowSprintLeadsPath(feedbackDir);
  if (!fs.existsSync(leadsPath)) return [];
  const raw = fs.readFileSync(leadsPath, 'utf8').trim();
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return sanitizeWorkflowSprintLead(JSON.parse(line));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function loadWorkflowSprintLeads(feedbackDir) {
  const latestByLeadId = new Map();
  for (const snapshot of loadWorkflowSprintLeadSnapshots(feedbackDir)) {
    const existing = latestByLeadId.get(snapshot.leadId);
    if (!existing || String(snapshot.updatedAt || '') >= String(existing.updatedAt || '')) {
      latestByLeadId.set(snapshot.leadId, snapshot);
    }
  }
  return Array.from(latestByLeadId.values())
    .sort((a, b) => String(a.submittedAt || '').localeCompare(String(b.submittedAt || '')));
}

function getWorkflowSprintLeadById(leadId, feedbackDir) {
  const normalizedLeadId = normalizeText(leadId, 160);
  if (!normalizedLeadId) return null;
  return loadWorkflowSprintLeads(feedbackDir)
    .find((entry) => entry.leadId === normalizedLeadId) || null;
}

function resolveLeadTeamId(lead = {}, overrideTeamId = null) {
  const explicitTeamId = normalizeText(overrideTeamId, 160);
  if (explicitTeamId) return explicitTeamId;
  const companySlug = slugify(lead.contact && lead.contact.company, '');
  if (companySlug) return companySlug;
  const email = normalizeEmail(lead.contact && lead.contact.email);
  if (email && email.includes('@')) {
    return slugify(email.split('@')[1], 'workflow_sprint_team');
  }
  return slugify(lead.qualification && lead.qualification.owner, 'workflow_sprint_team');
}

function appendWorkflowRunForSprintTransition(lead, {
  status,
  reviewedBy,
  proofArtifacts,
  workflowId,
  teamId,
  timestamp,
  commercialProof,
} = {}, feedbackDir) {
  if (status !== 'named_pilot' && status !== 'proof_backed_run' && status !== 'paid_team') {
    return null;
  }
  const normalizedArtifacts = normalizeProofArtifacts(proofArtifacts);
  const normalizedReviewedBy = normalizeText(reviewedBy, 160);
  const workflowRun = appendWorkflowRun({
    timestamp: normalizeText(timestamp, 64) || new Date().toISOString(),
    workflowId: normalizeText(workflowId, 160) || slugify(lead.qualification.workflow, 'workflow_hardening_sprint'),
    workflowName: lead.qualification.workflow,
    owner: lead.qualification.owner,
    runtime: lead.qualification.runtime,
    status: status === 'named_pilot' ? 'in_progress' : 'passed',
    customerType: status === 'paid_team' ? 'paid_team' : 'named_pilot',
    teamId: resolveLeadTeamId(lead, teamId),
    reviewed: Boolean(normalizedReviewedBy || normalizedArtifacts.length > 0),
    reviewedBy: normalizedReviewedBy,
    proofBacked: status === 'proof_backed_run' || status === 'paid_team',
    proofArtifacts: normalizedArtifacts,
    source: `workflow_sprint:${status}`,
    metadata: {
      leadId: lead.leadId,
      pipelineStatus: status,
      offer: commercialProof && commercialProof.scope && commercialProof.scope.offerId
        ? commercialProof.scope.offerId
        : lead.offer,
      company: lead.contact && lead.contact.company ? lead.contact.company : null,
      salesLeadId: commercialProof && commercialProof.payment
        ? commercialProof.payment.salesLeadId
        : null,
      paymentEvidenceSource: commercialProof && commercialProof.payment
        ? commercialProof.payment.source
        : null,
    },
  }, feedbackDir);
  return {
    ...workflowRun,
    workflowRunKey: `${workflowRun.workflowId}@${workflowRun.timestamp}`,
  };
}

function advanceWorkflowSprintLeadUnlocked(payload = {}, { feedbackDir, now } = {}) {
  const leadId = normalizeText(payload.leadId, 160);
  const nextStatus = normalizeWorkflowSprintStatus(payload.status, null);
  const actor = normalizeText(payload.actor, 160) || 'admin';
  const note = normalizeText(payload.note, 1000);
  const reviewedBy = normalizeText(payload.reviewedBy, 160);
  const proofArtifacts = normalizeProofArtifacts(payload.proofArtifacts);
  const workflowId = normalizeText(payload.workflowId, 160);
  const teamId = normalizeText(payload.teamId, 160);
  const requestedTransitionAt = new Date(String(now || ''));
  const transitionAt = Number.isNaN(requestedTransitionAt.getTime())
    ? new Date().toISOString()
    : requestedTransitionAt.toISOString();

  if (!leadId) {
    const err = new Error('leadId is required.');
    err.statusCode = 400;
    throw err;
  }
  if (!nextStatus) {
    const err = new Error(`status must be one of: ${WORKFLOW_SPRINT_STATUS_FLOW.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }

  const currentLead = getWorkflowSprintLeadById(leadId, feedbackDir);
  if (!currentLead) {
    const err = new Error(`Unknown workflow sprint lead: ${leadId}`);
    err.statusCode = 404;
    throw err;
  }

  const requestedSalesLeadId = normalizeText(payload.salesLeadId, 160);
  const currentPaymentSalesLeadId = currentLead.commercialProof?.payment?.salesLeadId || null;
  const recurringRenewal = currentLead.status === 'paid_team' && nextStatus === 'paid_team' &&
    RECURRING_OFFER_IDS.has(currentLead.commercialProof?.scope?.offerId) &&
    requestedSalesLeadId && requestedSalesLeadId !== currentPaymentSalesLeadId;
  if (currentLead.status === nextStatus && !recurringRenewal) {
    if (nextStatus === 'paid_team' && requestedSalesLeadId && requestedSalesLeadId !== currentPaymentSalesLeadId) {
      const err = new Error('Only recurring service contracts can replace paid-team payment evidence with a new billing period.');
      err.statusCode = 400;
      throw err;
    }
    return {
      lead: currentLead,
      workflowRun: null,
      unchanged: true,
    };
  }

  const currentIndex = WORKFLOW_SPRINT_STATUS_FLOW.indexOf(currentLead.status);
  const nextIndex = WORKFLOW_SPRINT_STATUS_FLOW.indexOf(nextStatus);
  if (!recurringRenewal && nextIndex !== currentIndex + 1) {
    const err = new Error(`Invalid workflow sprint transition: ${currentLead.status} -> ${nextStatus}`);
    err.statusCode = 400;
    throw err;
  }
  if (nextStatus !== 'qualified' && currentIndex >= WORKFLOW_SPRINT_STATUS_FLOW.indexOf('qualified') &&
      !isEvidenceBasedQualificationReview(currentLead.qualificationReview)) {
    const err = new Error(`${nextStatus} requires an inherited evidence-based buyer qualification review.`);
    err.statusCode = 400;
    throw err;
  }
  if (nextStatus === 'proof_backed_run' && !reviewedBy && proofArtifacts.length === 0) {
    const err = new Error('proof_backed_run requires reviewedBy or proofArtifacts.');
    err.statusCode = 400;
    throw err;
  }

  const commercialProof = sanitizeCommercialProof(currentLead.commercialProof);
  const qualificationReview = nextStatus === 'qualified'
    ? requireQualificationReview(payload, currentLead, { now: transitionAt })
    : currentLead.qualificationReview;
  if (nextStatus === 'named_pilot') {
    commercialProof.scope = requireSignedScopeEvidence(payload, currentLead, {
      feedbackDir,
      now: transitionAt,
    });
  }
  if (nextStatus === 'paid_team') {
    if (!commercialProof.scope.source || !commercialProof.scope.reference || !commercialProof.scope.signedBy) {
      const err = new Error('paid_team requires inherited signed-scope evidence from named_pilot.');
      err.statusCode = 400;
      throw err;
    }
    const scopeGap = validateSignedScope(commercialProof.scope, { now: transitionAt });
    if (scopeGap) {
      const err = new Error(`paid_team requires re-verifiable signed-scope evidence: ${scopeGap}`);
      err.statusCode = 400;
      throw err;
    }
    if (commercialProof.scope.offerId === 'enterprise_reliability_operations') {
      const pilot = verifyCompletedPilotReference(
        commercialProof.scope,
        currentLead,
        loadSalesLeads({ feedbackDir }),
        { workflowLeads: loadWorkflowSprintLeads(feedbackDir), now: transitionAt },
      );
      if (!pilot.verified) {
        const err = new Error(`paid_team requires re-verifiable completed Enterprise pilot lineage: ${pilot.reason}`);
        err.statusCode = 400;
        throw err;
      }
    }
    commercialProof.payment = requireVerifiedPaidSalesLead(
      payload,
      feedbackDir,
      currentLead,
      commercialProof.scope,
      { now: transitionAt },
    );
  }

  const workflowProgress = {
    ...currentLead.workflowProgress,
  };
  if (nextStatus === 'qualified') workflowProgress.qualifiedAt = transitionAt;
  if (nextStatus === 'named_pilot') workflowProgress.namedPilotAt = transitionAt;
  if (nextStatus === 'proof_backed_run') workflowProgress.proofBackedRunAt = transitionAt;
  if (nextStatus === 'paid_team') {
    workflowProgress.paidTeamAt = workflowProgress.paidTeamAt || transitionAt;
    if (RECURRING_OFFER_IDS.has(commercialProof.scope.offerId)) {
      workflowProgress.lastRecurringPaymentAt = transitionAt;
    }
  }

  const effectiveProofArtifacts = proofArtifacts.length ? proofArtifacts : currentLead.proof.artifacts;
  const effectiveReviewedBy = reviewedBy || currentLead.proof.reviewedBy;
  const workflowRun = appendWorkflowRunForSprintTransition(currentLead, {
    status: nextStatus,
    reviewedBy: effectiveReviewedBy,
    proofArtifacts: effectiveProofArtifacts,
    workflowId,
    teamId,
    timestamp: transitionAt,
    commercialProof,
  }, feedbackDir);

  const updatedLead = appendWorkflowSprintLeadSnapshot({
    ...currentLead,
    updatedAt: transitionAt,
    status: nextStatus,
    offer: commercialProof.scope.offerId || currentLead.offer,
    workflowProgress,
    qualificationReview,
    proof: {
      artifacts: effectiveProofArtifacts,
      reviewedBy: effectiveReviewedBy,
      lastWorkflowRunKey: workflowRun ? workflowRun.workflowRunKey : currentLead.proof.lastWorkflowRunKey,
    },
    commercialProof,
    statusHistory: currentLead.statusHistory.concat(buildStatusHistoryEntry({
      fromStatus: currentLead.status,
      toStatus: nextStatus,
      actor,
      note: note || (recurringRenewal ? 'Recorded a new provider-paid recurring billing period.' : null),
      reviewedBy: effectiveReviewedBy,
      proofArtifacts: effectiveProofArtifacts,
      timestamp: transitionAt,
    })),
  }, feedbackDir);

  return {
    lead: updatedLead,
    workflowRun,
    unchanged: false,
  };
}

function advanceWorkflowSprintLead(payload = {}, { feedbackDir, now } = {}) {
  return withWorkflowCommercialProofLock(feedbackDir, () =>
    advanceWorkflowSprintLeadUnlocked(payload, { feedbackDir, now }));
}

module.exports = {
  CONTRACTABLE_OFFER_IDS,
  DIAGNOSTIC_CREDIT_CENTS,
  ENTERPRISE_OFFER_IDS,
  RECURRING_OFFER_IDS,
  RECURRING_PERIOD_MAX_MS,
  RECURRING_PERIOD_MIN_MS,
  RECURRING_PREPAY_MAX_MS,
  QUALIFICATION_ZERO_SPEND_STATUS,
  SIGNED_SCOPE_DIGEST_PATTERN,
  SIGNED_SCOPE_EVIDENCE_MODE,
  WORKFLOW_SPRINT_LEADS_FILE,
  WORKFLOW_SPRINT_STATUS_FLOW,
  auditWorkflowCommercialProof,
  buildCompletedPilotEvidence,
  buildWorkflowSprintLead,
  appendWorkflowSprintLead,
  appendWorkflowSprintLeadSnapshot,
  notifyWorkflowSprintLead,
  renderWorkflowSprintLeadAlert,
  resolveWorkflowSprintAlertRecipient,
  advanceWorkflowSprintLead,
  loadWorkflowSprintLeads,
  loadWorkflowSprintLeadSnapshots,
  getWorkflowSprintLeadById,
  getWorkflowSprintLeadsPath,
  getWorkflowSprintIntakeLimitsPath,
  reserveWorkflowSprintIntake,
  sanitizeWorkflowSprintLead,
  normalizeWorkflowSprintStatus,
  requireQualificationReview,
  requireSignedScopeEvidence,
  requireVerifiedPaidSalesLead,
  sanitizeCommercialProof,
  sanitizeQualificationReview,
  isEvidenceBasedQualificationReview,
  evaluatePaidTeamCommercialProof,
  evaluateDiagnosticCredit,
  validateSignedScope,
  validateRecurringBillingProof,
  verifyCompletedPilotReference,
  withWorkflowCommercialProofLock,
};
