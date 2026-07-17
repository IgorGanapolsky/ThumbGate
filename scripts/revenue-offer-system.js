#!/usr/bin/env node
'use strict';

const TARGET_HOURLY_GROSS_DOLLARS = 1000;
const TARGET_DAILY_GROSS_DOLLARS = TARGET_HOURLY_GROSS_DOLLARS * 24;
const TARGET_ANNUAL_GROSS_DOLLARS = TARGET_DAILY_GROSS_DOLLARS * 365;
const TARGET_MONTHLY_GROSS_DOLLARS = TARGET_ANNUAL_GROSS_DOLLARS / 12;
const INTAKE_WARM_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const INTAKE_FUTURE_SKEW_MS = 5 * 60 * 1000;

const OFFER_CATALOG = Object.freeze({
  workflow_hardening_diagnostic: Object.freeze({
    status: 'live_public',
    buyer: 'An accountable owner with a repeated AI-agent workflow failure.',
    outcome: 'A packet defining blocks, warnings, and approvals.',
    deliverables: Object.freeze([
      'One workflow and failure map.',
      'One block, warn, and human-review matrix.',
      'One verification checklist.',
      'One prioritized implementation recommendation.',
    ]),
    buyerEffort: 'A short intake, 60-minute review, and agreed non-secret evidence.',
    timeToValue: 'Within two business days after review and receipt of agreed materials.',
    priceCents: 49900,
    billing: 'one_time',
    publicCheckout: true,
    nextStep: '/diagnostic',
    proofToCountRevenue: 'Provider-confirmed payment for the diagnostic.',
    boundaries: Object.freeze([
      'No implementation.',
      'No legal or compliance certification.',
      'No savings or incident-prevention guarantee.',
    ]),
  }),
  workflow_hardening_sprint: Object.freeze({
    status: 'live_public_scope_first',
    buyer: 'A diagnostic-qualified workflow owner ready to implement the first gate set.',
    outcome: 'One agreed workflow has local gates and reviewable proof.',
    deliverables: Object.freeze([
      'Scoped local gate implementation for one workflow.',
      'Local regression and proof artifacts.',
      'Approval and rollback runbook.',
      'Review handoff.',
    ]),
    buyerEffort: 'Provide an owner, non-secret examples, scoped repository access, and review decisions.',
    timeToValue: 'Fixed in the signed scope before payment.',
    priceCents: 150000,
    billing: 'one_time',
    publicCheckout: false,
    nextStep: '/go/sprint',
    proofToCountRevenue: 'Provider-confirmed payment for the scoped sprint.',
    boundaries: Object.freeze([
      'One workflow only.',
      'No ongoing monitoring or on-call support.',
      'No uncontracted hosted-team capability.',
    ]),
  }),
  pro: Object.freeze({
    status: 'live_public',
    buyer: 'One operator who has already proved value in a local workflow.',
    outcome: 'Higher limits, personal recall, local dashboard visibility, and exports.',
    deliverables: Object.freeze([
      'Personal lesson recall and search.',
      'Personal local dashboard.',
      'Managed adapter maintenance.',
      'DPO and advanced exports.',
    ]),
    buyerEffort: 'Install and activate the individual local runtime.',
    timeToValue: 'After provider-confirmed checkout and local activation.',
    priceCents: 1900,
    annualPriceCents: 14900,
    billing: 'monthly_or_annual',
    publicCheckout: true,
    nextStep: '/checkout/pro',
    proofToCountRevenue: 'An active provider subscription tied to a ThumbGate Pro product.',
    boundaries: Object.freeze([
      'Individual operator only.',
      'No hosted team sync or hosted org dashboard.',
    ]),
  }),
  workflow_reliability_operations: Object.freeze({
    status: 'qualified_proposal_only',
    buyer: 'A proof-backed sprint owner who needs the same production workflow re-verified as it changes.',
    outcome: 'One existing governed workflow stays reviewable as its rules, tooling, and failure evidence change.',
    deliverables: Object.freeze([
      'One 45-minute monthly evidence review.',
      'Up to two small gate or regression updates inside the same workflow.',
      'One incident or near-miss review.',
      'One refreshed approval, rollback, and proof packet.',
    ]),
    buyerEffort: 'Provide sanitized evidence, name a decision owner, and attend the review.',
    timeToValue: 'First monthly review date is fixed in the signed scope.',
    priceCents: 300000,
    billing: 'monthly',
    publicCheckout: false,
    nextStep: '/#workflow-sprint-intake',
    proofToCountRevenue: 'Signed recurring scope plus an active provider subscription or paid recurring invoice.',
    boundaries: Object.freeze([
      'One existing workflow only.',
      'No new integration, 24/7 monitoring, incident-response SLA, or compliance certification.',
      'No hosted team sync or hosted org dashboard unless separately built, contracted, and verified.',
    ]),
  }),
  enterprise_governance_pilot: Object.freeze({
    status: 'qualified_proposal_only',
    buyer: 'A team with two or three consequential workflows, an owner, budget authority, and a 30-day decision window.',
    outcome: 'Up to three local workflows receive explicit approval boundaries, rollback paths, and reviewable proof.',
    deliverables: Object.freeze([
      'Cross-workflow risk and owner map for up to three workflows.',
      'Local gate implementation and regression proof for the signed scope.',
      'Approval, rollback, and evidence ownership runbooks.',
      'Final review and expansion recommendation.',
    ]),
    buyerEffort: 'Provide owners, non-secret evidence, in-scope repositories, and timely decisions.',
    timeToValue: 'Thirty-day delivery window begins after signed scope, payment, and receipt of agreed inputs.',
    priceCents: 1500000,
    billing: 'one_time',
    publicCheckout: false,
    nextStep: '/#workflow-sprint-intake',
    proofToCountRevenue: 'Signed pilot scope plus provider-confirmed payment; delivered work and customer outcome remain separate proof states.',
    boundaries: Object.freeze([
      'Maximum three local workflows.',
      'No promise of hosted team sync, hosted org dashboard, SSO, SIEM, data residency, or certification.',
      'Any unavailable shared capability requires a separate build decision and contract before it can be sold as delivered.',
    ]),
  }),
  enterprise_reliability_operations: Object.freeze({
    status: 'qualified_proposal_only',
    buyer: 'A completed pilot owner needing evidence review for up to three governed workflows.',
    outcome: 'The signed pilot workflows stay reviewable while their tools, policies, and failure evidence change.',
    deliverables: Object.freeze([
      'One monthly portfolio evidence review.',
      'Up to six small gate or regression updates across the same three workflows.',
      'Up to two incident or near-miss reviews.',
      'One monthly portfolio proof packet and rollout decision log.',
    ]),
    buyerEffort: 'Maintain named owners, provide sanitized evidence, and attend the portfolio review.',
    timeToValue: 'First monthly review date is fixed in the signed scope.',
    priceCents: 1000000,
    billing: 'monthly',
    publicCheckout: false,
    nextStep: '/#workflow-sprint-intake',
    proofToCountRevenue: 'Signed recurring scope plus an active provider subscription or paid recurring invoice.',
    boundaries: Object.freeze([
      'Maximum three existing pilot workflows.',
      'No 24/7 monitoring, incident-response SLA, compliance certification, or unlimited changes.',
      'No hosted team feature may be claimed unless separately built, contracted, and verified.',
    ]),
  }),
});

function normalizeText(value, maxLength = 1000) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizeInlineText(value, maxLength = 240) {
  const text = normalizeText(value, maxLength);
  return text ? text.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim() : null;
}

function isValidContactEmail(value) {
  const email = normalizeText(value, 320);
  return Boolean(email && /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{1,63}$/.test(email));
}

function positiveInteger(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function calculateTargetMath() {
  const unitsPerMonth = {};
  for (const [offerId, offer] of Object.entries(OFFER_CATALOG)) {
    unitsPerMonth[offerId] = Math.ceil((TARGET_MONTHLY_GROSS_DOLLARS * 100) / offer.priceCents);
  }
  return {
    targetHourlyGrossDollars: TARGET_HOURLY_GROSS_DOLLARS,
    targetDailyGrossDollars: TARGET_DAILY_GROSS_DOLLARS,
    targetMonthlyGrossDollars: TARGET_MONTHLY_GROSS_DOLLARS,
    targetAnnualGrossDollars: TARGET_ANNUAL_GROSS_DOLLARS,
    unitsPerMonth,
    disclaimer: 'Arithmetic requirements only. This is not a forecast and does not claim achieved revenue or delivery capacity.',
  };
}

function missingCoreQualification(input = {}) {
  const missing = [];
  if (!normalizeText(input.workflow, 240)) missing.push('workflow');
  if (!normalizeText(input.owner, 160)) missing.push('owner');
  if (!normalizeText(input.repeatedFailure, 1000)) missing.push('repeatedFailure');
  return missing;
}

function qualifyRevenueOffer(input = {}) {
  if (input.requiresBuyerPaymentToAccessLead === true || input.requiresRevenueShare === true) {
    return {
      decision: 'discarded_paid_requirement',
      offerId: null,
      missing: [],
      reason: 'The opportunity requires the seller to pay or accept a revenue-share obligation.',
    };
  }

  const missing = missingCoreQualification(input);
  if (missing.length) {
    return {
      decision: 'needs_diagnostic_intake',
      offerId: 'workflow_hardening_diagnostic',
      missing,
      reason: 'The workflow, accountable owner, and repeated failure are not all explicit yet.',
    };
  }

  if (input.requiresUnavailableHostedFeature === true) {
    return {
      decision: 'not_fit_unavailable_capability',
      offerId: null,
      missing: [],
      reason: 'The requested hosted or shared capability is not generally available and cannot be sold as delivered.',
    };
  }

  const workflowCount = positiveInteger(input.workflowCount, 1);
  const authorityConfirmed = input.authorityConfirmed === true;
  const budgetCents = positiveInteger(input.budgetCents, 0);
  const urgencyDays = positiveInteger(input.urgencyDays, 9999);
  const proofBackedSprint = input.proofBackedSprint === true;
  const completedEnterprisePilot = input.completedEnterprisePilot === true;

  if (
    completedEnterprisePilot
    && workflowCount <= 3
    && authorityConfirmed
    && urgencyDays <= 30
    && budgetCents >= OFFER_CATALOG.enterprise_reliability_operations.priceCents
  ) {
    return {
      decision: 'qualify_for_signed_proposal',
      offerId: 'enterprise_reliability_operations',
      missing: [],
      reason: 'Completed pilot proof, bounded workflow count, authority, timing, and recurring budget are explicit.',
    };
  }

  if (
    proofBackedSprint
    && workflowCount >= 2
    && workflowCount <= 3
    && authorityConfirmed
    && urgencyDays <= 30
    && budgetCents >= OFFER_CATALOG.enterprise_governance_pilot.priceCents
  ) {
    return {
      decision: 'qualify_for_signed_proposal',
      offerId: 'enterprise_governance_pilot',
      missing: [],
      reason: 'Proof, scope, authority, timing, and pilot budget are explicit for up to three workflows.',
    };
  }

  if (
    proofBackedSprint
    && workflowCount === 1
    && authorityConfirmed
    && urgencyDays <= 30
    && budgetCents >= OFFER_CATALOG.workflow_reliability_operations.priceCents
  ) {
    return {
      decision: 'qualify_for_signed_proposal',
      offerId: 'workflow_reliability_operations',
      missing: [],
      reason: 'The existing proof-backed workflow has an owner, authority, timing, and recurring budget.',
    };
  }

  if (input.readyToImplement === true) {
    return {
      decision: 'scope_sprint',
      offerId: 'workflow_hardening_sprint',
      missing: [],
      reason: 'One explicit workflow is ready for a fixed implementation scope.',
    };
  }

  return {
    decision: 'start_diagnostic',
    offerId: 'workflow_hardening_diagnostic',
    missing: [],
    reason: 'The failure is explicit, but implementation or expansion fit is not yet proved.',
  };
}

function hasText(value) {
  return Boolean(normalizeText(value));
}

function formatUsdCents(value) {
  const cents = Number(value);
  return Number.isInteger(cents) && cents >= 0
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
    : null;
}

function buildApprovalToken(value, fallback = 'LEAD') {
  const token = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return token.replace(/^_+|_+$/g, '').slice(0, 80) || fallback;
}

function resolvePublicOfferUrl(nextStep, publicOrigin = 'https://thumbgate.ai') {
  if (!nextStep || !String(nextStep).startsWith('/')) return null;
  try {
    const origin = new URL(publicOrigin);
    if (!['http:', 'https:'].includes(origin.protocol)) return null;
    return new URL(nextStep, origin).toString();
  } catch {
    return null;
  }
}

function buildIntakeChronology(submittedAt, now = new Date().toISOString()) {
  const submitted = new Date(String(submittedAt || ''));
  const current = new Date(String(now || ''));
  if (Number.isNaN(submitted.getTime()) || Number.isNaN(current.getTime())) {
    return {
      valid: false,
      freshness: 'invalid',
      ageHours: null,
      reason: 'The intake timestamp is missing or invalid.',
    };
  }

  const ageMs = current.getTime() - submitted.getTime();
  if (ageMs < -INTAKE_FUTURE_SKEW_MS) {
    return {
      valid: false,
      freshness: 'future_invalid',
      ageHours: Number((ageMs / (60 * 60 * 1000)).toFixed(2)),
      reason: 'The intake timestamp is more than five minutes in the future.',
    };
  }

  return {
    valid: true,
    freshness: ageMs <= 24 * 60 * 60 * 1000
      ? 'same_day'
      : ageMs <= INTAKE_WARM_WINDOW_MS ? 'warm' : 'stale',
    ageHours: Number((Math.max(0, ageMs) / (60 * 60 * 1000)).toFixed(2)),
    reason: ageMs > INTAKE_WARM_WINDOW_MS
      ? 'The intake is older than the 14-day warm-signal window and needs current-intent verification.'
      : null,
  };
}

function buildIntakeQualificationCard(lead = {}, {
  now = new Date().toISOString(),
  qualificationReviewVerified = false,
} = {}) {
  const contact = lead.contact && typeof lead.contact === 'object' ? lead.contact : {};
  const qualification = lead.qualification && typeof lead.qualification === 'object'
    ? lead.qualification
    : {};
  const review = lead.qualificationReview && typeof lead.qualificationReview === 'object'
    ? lead.qualificationReview
    : {};
  const proofArtifacts = Array.isArray(lead.proof?.artifacts) ? lead.proof.artifacts : [];
  const chronology = buildIntakeChronology(lead.submittedAt, now);
  const reviewVerified = qualificationReviewVerified === true;
  const diagnosticPath = lead.offer === 'workflow_hardening_diagnostic' ||
    (reviewVerified && review.recommendedOfferId === 'workflow_hardening_diagnostic');
  const knownFacts = {
    contactEmailProvided: hasText(contact.email),
    contactEmailValid: isValidContactEmail(contact.email),
    workflowProvided: hasText(qualification.workflow),
    ownerProvided: hasText(qualification.owner) || (reviewVerified && hasText(review.decisionAuthority)),
    repeatedFailureProvided: hasText(qualification.blocker) ||
      (reviewVerified && hasText(review.severityAndFrequency)),
    runtimeProvided: hasText(qualification.runtime),
    urgencyProvided: hasText(qualification.urgency),
    proofArtifactCount: proofArtifacts.length,
    qualificationEvidenceCount: reviewVerified && Array.isArray(review.evidenceReferences)
      ? review.evidenceReferences.length
      : 0,
    operatorQualified: ['qualified', 'named_pilot', 'proof_backed_run', 'paid_team'].includes(lead.status)
      && reviewVerified,
    sellerAccessCostStatus: 'proceed_zero_cost',
  };
  const coreMissing = [];
  if (!knownFacts.contactEmailProvided) coreMissing.push('contactEmail');
  if (!knownFacts.workflowProvided) coreMissing.push('workflow');
  if (!knownFacts.ownerProvided) coreMissing.push('owner');
  if (!knownFacts.repeatedFailureProvided) coreMissing.push('repeatedFailure');
  if (!diagnosticPath && !knownFacts.runtimeProvided) coreMissing.push('runtime');

  const qualificationUnknowns = [...coreMissing];
  if (!knownFacts.urgencyProvided && (!reviewVerified || !hasText(review.urgencyAndTrigger))) qualificationUnknowns.push('urgencyAndTrigger');
  if (!reviewVerified || !hasText(review.measurableImpact)) qualificationUnknowns.push('measurableCurrentImpact');
  if (!reviewVerified || !hasText(review.decisionAuthority)) qualificationUnknowns.push('decisionAuthority');
  if (!reviewVerified || !hasText(review.budgetMechanism)) qualificationUnknowns.push('budgetMechanism');
  if (!reviewVerified || review.priceUnderstandingConfirmed !== true) qualificationUnknowns.push('priceUnderstanding');
  if (!reviewVerified || !hasText(review.proofRequired)) qualificationUnknowns.push('proofRequiredToDecide');

  const score = Math.min(100,
    (knownFacts.contactEmailProvided ? 10 : 0)
    + (knownFacts.workflowProvided ? 20 : 0)
    + (knownFacts.ownerProvided ? 15 : 0)
    + (knownFacts.repeatedFailureProvided ? 20 : 0)
    + (knownFacts.runtimeProvided ? 10 : 0)
    + (knownFacts.urgencyProvided ? 10 : 0)
    + (knownFacts.operatorQualified ? 10 : 0)
    + (knownFacts.proofArtifactCount > 0 || knownFacts.qualificationEvidenceCount > 0 ? 5 : 0));

  const offerDecision = qualifyRevenueOffer({
    workflow: qualification.workflow,
    owner: qualification.owner || (reviewVerified ? review.decisionAuthority : null),
    repeatedFailure: qualification.blocker || (reviewVerified ? review.severityAndFrequency : null),
  });
  const requestedOfferId = OFFER_CATALOG[lead.offer] ? lead.offer : null;
  const reviewedOfferId = reviewVerified && OFFER_CATALOG[review.recommendedOfferId]
    ? review.recommendedOfferId
    : null;
  const recommendedOfferId = reviewedOfferId || (
    requestedOfferId === 'workflow_hardening_sprint' && coreMissing.length === 0
      ? requestedOfferId
      : offerDecision.offerId
  );
  const recommendedOffer = recommendedOfferId ? OFFER_CATALOG[recommendedOfferId] : null;
  const disqualifiers = [];
  let route = reviewVerified && ['diagnostic', 'close'].includes(review.route)
    ? review.route
    : 'diagnostic';
  let recommendedNextStep = 'Review the intake evidence and prepare only the few questions needed to remove material uncertainty.';

  if (!chronology.valid) {
    route = 'nurture';
    disqualifiers.push('invalid_intake_chronology');
    recommendedNextStep = 'Repair or verify the intake timestamp before treating it as current buyer intent.';
  } else if (chronology.freshness === 'stale') {
    route = 'nurture';
    recommendedNextStep = 'Verify current intent with a separately reviewed, low-pressure reactivation draft before offering checkout.';
  } else if (!knownFacts.contactEmailProvided) {
    route = 'disqualify';
    disqualifiers.push('no_contact_path');
    recommendedNextStep = 'Hold the record because there is no verified contact path.';
  } else if (!knownFacts.contactEmailValid) {
    route = 'disqualify';
    disqualifiers.push('invalid_contact_path');
    recommendedNextStep = 'Hold the record because the contact path is invalid.';
  } else if (coreMissing.length > 0) {
    route = 'nurture';
    recommendedNextStep = `Ask for the missing qualification evidence: ${coreMissing.join(', ')}.`;
  } else if (lead.status === 'qualified' && recommendedOfferId === 'workflow_hardening_diagnostic') {
    recommendedNextStep = 'Prepare a transparent $499 diagnostic offer and exact draft for action-time approval; do not send automatically.';
  } else if (lead.status === 'qualified' && recommendedOfferId === 'workflow_hardening_sprint') {
    recommendedNextStep = 'Prepare the fixed one-workflow sprint scope questions; send no checkout until scope is accepted.';
  } else {
    recommendedNextStep = 'Review the evidence, ask at most three material questions, and advance to qualified only when the operator verifies fit.';
  }

  const questionCatalog = {
    contactEmail: 'What verified contact path can be used for this buyer?',
    workflow: 'Which exact workflow should be reviewed?',
    owner: 'Who is accountable for this workflow and its approval decision?',
    repeatedFailure: 'What repeated failure or rollout blocker is occurring?',
    runtime: 'Which agent or runtime executes the workflow?',
    urgencyAndTrigger: 'What changed now, and when must a decision be made?',
    measurableCurrentImpact: 'What measurable impact does the repeated failure create today?',
    decisionAuthority: 'Who would approve the scope if there is a fit?',
    budgetMechanism: 'If there is a fit, is there an approved budget path for a fixed-scope engagement?',
    priceUnderstanding: 'Does the buyer understand the fixed price and scope boundaries?',
    proofRequiredToDecide: 'What proof does the buyer need before deciding?',
  };

  const freshnessWeight = chronology.freshness === 'same_day'
    ? 15
    : chronology.freshness === 'warm' ? 5 : chronology.freshness === 'stale' ? -20 : -30;
  const priorityScore = Math.max(0, Math.min(120, score + freshnessWeight));
  const checkoutEligible = chronology.valid && chronology.freshness !== 'stale'
    && coreMissing.length === 0
    && knownFacts.operatorQualified
    && review.priceUnderstandingConfirmed === true
    && recommendedOffer?.publicCheckout === true;

  return {
    status: 'evidence_based_operator_recommendation_not_buyer_intent_or_revenue',
    leadId: normalizeText(lead.leadId, 160),
    lifecycleStatus: normalizeText(lead.status, 64) || 'new',
    chronology,
    knownFacts,
    unknowns: qualificationUnknowns,
    fitScore: score,
    fitBand: score >= 80 ? 'strong_evidence_for_review' : score >= 55 ? 'partial_evidence' : 'incomplete_evidence',
    priorityScore,
    priorityBand: priorityScore >= 100 ? 'review_now' : priorityScore >= 70 ? 'review_next' : 'hold_or_nurture',
    route,
    offerDecision: offerDecision.decision,
    requestedOfferId,
    recommendedOffer: recommendedOffer ? {
      offerId: recommendedOfferId,
      status: recommendedOffer.status,
      priceCents: recommendedOffer.priceCents,
      billing: recommendedOffer.billing,
      nextStep: recommendedOffer.nextStep,
      proofToCountRevenue: recommendedOffer.proofToCountRevenue,
    } : null,
    evidence: {
      leadId: normalizeText(lead.leadId, 160),
      submittedAt: normalizeText(lead.submittedAt, 64),
      updatedAt: normalizeText(lead.updatedAt, 64),
      lifecycleStatus: normalizeText(lead.status, 64) || 'new',
      qualificationReviewEvidenceCount: knownFacts.qualificationEvidenceCount,
      qualificationReviewVerified: reviewVerified,
    },
    disqualifiers,
    questionsToAsk: qualificationUnknowns.slice(0, 3).map((key) => questionCatalog[key]),
    recommendedNextStep,
    approvalRequiredBeforeExternalAction: true,
    approvalPhrase: null,
    checkoutEligible,
    checkoutPath: checkoutEligible ? recommendedOffer.nextStep : null,
    externalActionAuthorized: false,
    revenueRecognized: false,
  };
}

function buildIntakeDiscoveryPacket(lead = {}, {
  now = new Date().toISOString(),
  qualificationReviewVerified = false,
} = {}) {
  const card = buildIntakeQualificationCard(lead, { now, qualificationReviewVerified });
  const contactEmail = normalizeText(lead.contact?.email, 320);
  const questions = card.questionsToAsk.filter(hasText).slice(0, 3);
  const blockers = [];

  if (card.lifecycleStatus !== 'new') blockers.push('lifecycle_not_new');
  if (!card.chronology.valid || card.chronology.freshness === 'stale') blockers.push('intake_not_current');
  if (!card.knownFacts.contactEmailProvided) blockers.push('contact_path_missing');
  else if (!card.knownFacts.contactEmailValid) blockers.push('contact_path_invalid');
  if (questions.length === 0) blockers.push('no_material_questions');
  if (card.route === 'disqualify' || card.disqualifiers.length > 0) blockers.push('disqualified');
  if (card.knownFacts.sellerAccessCostStatus !== 'proceed_zero_cost') blockers.push('zero_spend_unverified');

  const approvalReady = blockers.length === 0;
  const workflow = normalizeInlineText(lead.qualification?.workflow, 160) || 'workflow';
  const failure = normalizeInlineText(lead.qualification?.blocker, 500);
  const questionList = questions.map((question, index) => `${index + 1}. ${question}`).join('\n');
  const body = approvalReady ? [
    `Thanks for sharing the ${workflow} workflow.`,
    ...(failure ? [`You reported this repeated issue: ${failure}`] : []),
    'Before I recommend any next step, I want to make sure it fits. Could you clarify:',
    questionList,
    'If this is no longer active, reply "not now" and I will not follow up.',
    'No payment or commitment is requested in this message.',
  ].join('\n\n') : null;

  return {
    type: 'discovery_questions',
    status: approvalReady ? 'approval_ready_not_authorized' : 'hold_not_approval_ready',
    leadId: card.leadId,
    destination: approvalReady ? {
      channel: 'email',
      address: contactEmail.toLowerCase(),
    } : null,
    draft: approvalReady ? {
      subject: `Quick clarification on your ${workflow} intake`,
      body,
    } : null,
    approvalPhrase: approvalReady
      ? `APPROVE SEND THUMBGATE DISCOVERY QUESTIONS TO ${buildApprovalToken(card.leadId)}`
      : null,
    blockers: [...new Set(blockers)],
    evidence: {
      chronology: card.chronology,
      questionCount: questions.length,
      sellerAccessCostStatus: card.knownFacts.sellerAccessCostStatus,
    },
    verificationPlan: [
      'Record a platform or mail send receipt before marking contacted.',
      'Record a buyer reply separately from the send receipt.',
      'Check for an existing send receipt before any retry or resend.',
      'Do not offer checkout or recognize revenue until later evidence gates pass.',
    ],
    externalActionAuthorized: false,
    revenueRecognized: false,
  };
}

function buildIntakeClosePacket(lead = {}, {
  now = new Date().toISOString(),
  qualificationReviewVerified = false,
  publicOrigin = 'https://thumbgate.ai',
} = {}) {
  const review = lead.qualificationReview && typeof lead.qualificationReview === 'object'
    ? lead.qualificationReview
    : {};
  const card = buildIntakeQualificationCard(lead, { now, qualificationReviewVerified });
  const offerId = card.recommendedOffer?.offerId || null;
  const offer = offerId ? OFFER_CATALOG[offerId] : null;
  const blockers = [];
  if (qualificationReviewVerified !== true) blockers.push('qualification_review_unverified');
  if (!card.knownFacts.operatorQualified) blockers.push('lifecycle_not_evidence_qualified');
  if (!card.chronology.valid || card.chronology.freshness === 'stale') blockers.push('intake_not_current');
  if (!card.knownFacts.contactEmailProvided) blockers.push('contact_path_missing');
  else if (!card.knownFacts.contactEmailValid) blockers.push('contact_path_invalid');
  if (card.unknowns.length > 0) blockers.push('material_unknowns_remaining');
  if (review.priceUnderstandingConfirmed !== true) blockers.push('price_understanding_unconfirmed');
  if (!offer) blockers.push('offer_unavailable');
  if (!['diagnostic', 'close'].includes(card.route)) blockers.push('route_not_closeable');

  const approvalReady = blockers.length === 0;
  const workflow = normalizeText(lead.qualification?.workflow, 240) || 'the reviewed workflow';
  const failure = normalizeText(
    lead.qualification?.blocker || review.severityAndFrequency,
    1000,
  ) || 'the repeated failure documented in the review';
  const price = offer ? formatUsdCents(offer.priceCents) : null;
  const checkoutUrl = offer?.publicCheckout
    ? resolvePublicOfferUrl(offer.nextStep, publicOrigin)
    : null;
  if (offer?.publicCheckout && !checkoutUrl) blockers.push('checkout_url_unavailable');

  const finalApprovalReady = approvalReady && blockers.length === 0;
  const scopeFirst = offer ? offer.publicCheckout !== true : true;
  const deliverables = offer ? offer.deliverables.map((item) => `- ${item}`).join('\n') : '';
  const boundaries = offer ? offer.boundaries.map((item) => `- ${item}`).join('\n') : '';
  const nextStepCopy = scopeFirst
    ? `Before any payment request, please confirm the exact workflow, decision owner, and proof needed. If the scope is aligned, reply "scope review"; no payment link or invoice will be sent before written scope acceptance.`
    : `If you want to proceed, review the scope and secure checkout here: ${checkoutUrl}\n\nYou can reply with a scope question or say no thanks; no follow-up is required.`;
  const subject = offer ? `${offerId === 'workflow_hardening_diagnostic' ? 'Workflow Hardening Diagnostic' : 'ThumbGate scope'} — ${workflow}` : null;
  const body = offer ? [
    `Thanks for sharing the ${workflow} workflow. The reviewed issue is: ${failure}`,
    `The bounded next step is ${price} ${offerId.replaceAll('_', ' ')} (${offer.billing}).`,
    'Included:',
    deliverables,
    'Boundaries:',
    boundaries,
    nextStepCopy,
  ].join('\n\n') : null;

  return {
    status: finalApprovalReady ? 'approval_ready_not_authorized' : 'hold_not_approval_ready',
    leadId: card.leadId,
    destination: finalApprovalReady ? {
      channel: 'email',
      address: normalizeText(lead.contact?.email, 320),
    } : null,
    offer: offer ? {
      offerId,
      priceCents: offer.priceCents,
      price,
      billing: offer.billing,
      publicCheckout: offer.publicCheckout,
      checkoutUrl,
      scopeFirst,
    } : null,
    draft: finalApprovalReady ? { subject, body } : null,
    approvalPhrase: finalApprovalReady
      ? `APPROVE SEND THUMBGATE ${buildApprovalToken(offerId, 'OFFER')} OFFER TO ${buildApprovalToken(card.leadId)}`
      : null,
    blockers: [...new Set(blockers)],
    evidence: {
      chronology: card.chronology,
      qualificationReviewVerified: qualificationReviewVerified === true,
      qualificationEvidenceCount: card.knownFacts.qualificationEvidenceCount,
      reviewedAt: normalizeText(review.reviewedAt, 64),
      reviewedBy: normalizeText(review.reviewedBy, 160),
    },
    verificationPlan: [
      'Record a platform or mail send receipt before marking contacted.',
      'Record a buyer reply or written scope acceptance separately from the send.',
      ...(scopeFirst ? ['Record written scope acceptance before sending any payment request.'] : []),
      'Treat checkout started as intent, not revenue.',
      'Mark paid only after provider-confirmed payment is reconciled to this lead and offer.',
    ],
    externalActionAuthorized: false,
    revenueRecognized: false,
  };
}

function buildRevenueOfferSystem() {
  return {
    status: 'operating_model_not_traction_proof',
    offers: OFFER_CATALOG,
    targetMath: calculateTargetMath(),
    proofRule: 'Only provider-confirmed payments and currently active provider subscriptions count as revenue. Proposals, checkouts, and delivery are separate states.',
  };
}

if (require.main === module) { // NOSONAR
  process.stdout.write(`${JSON.stringify(buildRevenueOfferSystem(), null, 2)}\n`);
}

module.exports = {
  OFFER_CATALOG,
  INTAKE_FUTURE_SKEW_MS,
  INTAKE_WARM_WINDOW_MS,
  TARGET_ANNUAL_GROSS_DOLLARS,
  TARGET_DAILY_GROSS_DOLLARS,
  TARGET_HOURLY_GROSS_DOLLARS,
  TARGET_MONTHLY_GROSS_DOLLARS,
  buildIntakeChronology,
  buildIntakeClosePacket,
  buildIntakeDiscoveryPacket,
  buildIntakeQualificationCard,
  buildRevenueOfferSystem,
  calculateTargetMath,
  qualifyRevenueOffer,
};
