'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OFFER_CATALOG,
  buildIntakeChronology,
  buildIntakeClosePacket,
  buildIntakeDiscoveryPacket,
  buildIntakeQualificationCard,
  buildRevenueOfferSystem,
  calculateTargetMath,
  qualifyRevenueOffer,
} = require('../scripts/revenue-offer-system');

function intake(overrides = {}) {
  return {
    leadId: 'lead_example_1234',
    submittedAt: '2026-07-16T10:00:00.000Z',
    updatedAt: '2026-07-16T10:00:00.000Z',
    status: 'new',
    offer: 'workflow_hardening_sprint',
    contact: { email: 'buyer@example.com' },
    qualification: {
      workflow: 'Customer email approval flow',
      owner: 'Operations lead',
      blocker: 'An unapproved draft can be sent after a retry.',
      runtime: 'n8n',
      urgency: 'The failure happened again this week.',
    },
    proof: { artifacts: [] },
    ...overrides,
  };
}

test('every offer is a complete, bounded offer card', () => {
  for (const [offerId, offer] of Object.entries(OFFER_CATALOG)) {
    assert.ok(offer.buyer, `${offerId} needs a buyer`);
    assert.ok(offer.outcome, `${offerId} needs an outcome`);
    assert.ok(offer.deliverables.length > 0, `${offerId} needs deliverables`);
    assert.ok(offer.buyerEffort, `${offerId} needs buyer effort`);
    assert.ok(offer.timeToValue, `${offerId} needs time to value`);
    assert.ok(offer.priceCents > 0, `${offerId} needs a positive price`);
    assert.ok(offer.nextStep.startsWith('/'), `${offerId} needs a first-party next step`);
    assert.ok(offer.proofToCountRevenue, `${offerId} needs a revenue proof rule`);
    assert.ok(offer.boundaries.length > 0, `${offerId} needs boundaries`);
  }
});

test('proposal-only recurring and Enterprise offers never expose public checkout', () => {
  const proposalOnly = Object.values(OFFER_CATALOG)
    .filter((offer) => offer.status === 'qualified_proposal_only');

  assert.equal(proposalOnly.length, 3);
  for (const offer of proposalOnly) {
    assert.equal(offer.publicCheckout, false);
    assert.equal(offer.nextStep, '/#workflow-sprint-intake');
    assert.match(offer.proofToCountRevenue, /signed/i);
  }
});

test('recurring operations offers are fixed-scope and exclude unsupported promises', () => {
  const workflowOps = OFFER_CATALOG.workflow_reliability_operations;
  assert.equal(workflowOps.priceCents, 300000);
  assert.equal(workflowOps.billing, 'monthly');
  assert.match(workflowOps.buyer, /proof-backed sprint/i);
  assert.ok(workflowOps.boundaries.some((item) => /No new integration, 24\/7 monitoring/i.test(item)));
  assert.ok(workflowOps.boundaries.some((item) => /No hosted team sync or hosted org dashboard/i.test(item)));

  const enterpriseOps = OFFER_CATALOG.enterprise_reliability_operations;
  assert.equal(enterpriseOps.priceCents, 1000000);
  assert.equal(enterpriseOps.billing, 'monthly');
  assert.ok(enterpriseOps.boundaries.some((item) => /Maximum three existing pilot workflows/i.test(item)));
});

test('Enterprise pilot is productized without pretending unavailable hosted features exist', () => {
  const pilot = OFFER_CATALOG.enterprise_governance_pilot;
  assert.equal(pilot.priceCents, 1500000);
  assert.equal(pilot.billing, 'one_time');
  assert.match(pilot.timeToValue, /Thirty-day delivery window/i);
  assert.ok(pilot.boundaries.some((item) => /No promise of hosted team sync/i.test(item)));
  assert.match(pilot.proofToCountRevenue, /provider-confirmed payment/i);
});

test('target math is arithmetic, not an achieved-revenue claim', () => {
  const math = calculateTargetMath();
  assert.equal(math.targetHourlyGrossDollars, 1000);
  assert.equal(math.targetDailyGrossDollars, 24000);
  assert.equal(math.targetAnnualGrossDollars, 8760000);
  assert.equal(math.targetMonthlyGrossDollars, 730000);
  assert.equal(math.unitsPerMonth.workflow_reliability_operations, 244);
  assert.equal(math.unitsPerMonth.enterprise_governance_pilot, 49);
  assert.equal(math.unitsPerMonth.enterprise_reliability_operations, 73);
  assert.match(math.disclaimer, /not a forecast/i);
  assert.match(math.disclaimer, /does not claim achieved revenue/i);
});

test('missing workflow evidence routes to diagnostic intake instead of a close', () => {
  const result = qualifyRevenueOffer({ owner: 'Platform lead' });
  assert.equal(result.decision, 'needs_diagnostic_intake');
  assert.equal(result.offerId, 'workflow_hardening_diagnostic');
  assert.deepEqual(result.missing.sort(), ['repeatedFailure', 'workflow']);
});

test('pay-to-play opportunities are discarded before offer qualification', () => {
  const result = qualifyRevenueOffer({
    workflow: 'Deploy approvals',
    owner: 'Platform lead',
    repeatedFailure: 'Agents bypass approval.',
    requiresBuyerPaymentToAccessLead: true,
  });
  assert.equal(result.decision, 'discarded_paid_requirement');
  assert.equal(result.offerId, null);
});

test('revenue-share opportunities are discarded before offer qualification', () => {
  const result = qualifyRevenueOffer({
    workflow: 'Deploy approvals',
    owner: 'Platform lead',
    repeatedFailure: 'Agents bypass approval.',
    requiresRevenueShare: true,
  });
  assert.equal(result.decision, 'discarded_paid_requirement');
});

test('unavailable hosted requirements are disqualified rather than promised', () => {
  const result = qualifyRevenueOffer({
    workflow: 'Shared hosted lesson sync',
    owner: 'Security lead',
    repeatedFailure: 'Teams diverge across repositories.',
    requiresUnavailableHostedFeature: true,
  });
  assert.equal(result.decision, 'not_fit_unavailable_capability');
  assert.equal(result.offerId, null);
});

test('one proof-backed workflow with authority and budget qualifies for monthly operations', () => {
  const result = qualifyRevenueOffer({
    workflow: 'Production deploy approvals',
    owner: 'Platform lead',
    repeatedFailure: 'Agents repeat unapproved deploys.',
    workflowCount: 1,
    proofBackedSprint: true,
    authorityConfirmed: true,
    urgencyDays: 14,
    budgetCents: 300000,
  });
  assert.equal(result.decision, 'qualify_for_signed_proposal');
  assert.equal(result.offerId, 'workflow_reliability_operations');
});

test('a recurring proposal does not qualify without authority, timing, and full price fit', () => {
  const result = qualifyRevenueOffer({
    workflow: 'Production deploy approvals',
    owner: 'Platform lead',
    repeatedFailure: 'Agents repeat unapproved deploys.',
    workflowCount: 1,
    proofBackedSprint: true,
    authorityConfirmed: false,
    urgencyDays: 90,
    budgetCents: 299999,
  });
  assert.equal(result.decision, 'start_diagnostic');
  assert.equal(result.offerId, 'workflow_hardening_diagnostic');
});

test('two or three proof-backed workflows can qualify for the fixed Enterprise pilot', () => {
  for (const workflowCount of [2, 3]) {
    const result = qualifyRevenueOffer({
      workflow: 'Agent approval portfolio',
      owner: 'Security director',
      repeatedFailure: 'Approval gaps recur across critical repositories.',
      workflowCount,
      proofBackedSprint: true,
      authorityConfirmed: true,
      urgencyDays: 30,
      budgetCents: 1500000,
    });
    assert.equal(result.offerId, 'enterprise_governance_pilot');
  }
});

test('Enterprise pilot qualification rejects unbounded workflow counts', () => {
  const result = qualifyRevenueOffer({
    workflow: 'Agent approval portfolio',
    owner: 'Security director',
    repeatedFailure: 'Approval gaps recur across critical repositories.',
    workflowCount: 4,
    proofBackedSprint: true,
    authorityConfirmed: true,
    urgencyDays: 30,
    budgetCents: 1500000,
  });
  assert.notEqual(result.offerId, 'enterprise_governance_pilot');
});

test('completed pilot proof is required for Enterprise recurring operations', () => {
  const base = {
    workflow: 'Agent approval portfolio',
    owner: 'Security director',
    repeatedFailure: 'Rules drift across critical repositories.',
    workflowCount: 3,
    proofBackedSprint: true,
    authorityConfirmed: true,
    urgencyDays: 14,
    budgetCents: 1000000,
  };
  assert.notEqual(
    qualifyRevenueOffer(base).offerId,
    'enterprise_reliability_operations'
  );
  assert.equal(
    qualifyRevenueOffer({ ...base, completedEnterprisePilot: true }).offerId,
    'enterprise_reliability_operations'
  );
});

test('implementation-ready single workflow routes to the fixed sprint', () => {
  const result = qualifyRevenueOffer({
    workflow: 'PR review hardening',
    owner: 'Platform lead',
    repeatedFailure: 'Review evidence is skipped.',
    readyToImplement: true,
  });
  assert.equal(result.decision, 'scope_sprint');
  assert.equal(result.offerId, 'workflow_hardening_sprint');
});

test('system snapshot separates operating model from traction proof', () => {
  const snapshot = buildRevenueOfferSystem();
  assert.equal(snapshot.status, 'operating_model_not_traction_proof');
  assert.match(snapshot.proofRule, /provider-confirmed payments/i);
  assert.match(snapshot.proofRule, /currently active provider subscriptions/i);
  assert.match(snapshot.proofRule, /Proposals, checkouts, and delivery are separate states/i);
});

test('intake chronology distinguishes same-day, warm, stale, and invalid future signals', () => {
  assert.equal(buildIntakeChronology('2026-07-16T10:00:00.000Z', '2026-07-16T12:00:00.000Z').freshness, 'same_day');
  assert.equal(buildIntakeChronology('2026-07-15T12:00:00.000Z', '2026-07-16T12:00:00.000Z').freshness, 'same_day');
  assert.equal(buildIntakeChronology('2026-07-15T11:59:59.999Z', '2026-07-16T12:00:00.000Z').freshness, 'warm');
  assert.equal(buildIntakeChronology('2026-07-10T10:00:00.000Z', '2026-07-16T12:00:00.000Z').freshness, 'warm');
  assert.equal(buildIntakeChronology('2026-07-02T12:00:00.000Z', '2026-07-16T12:00:00.000Z').freshness, 'warm');
  assert.equal(buildIntakeChronology('2026-07-02T11:59:59.999Z', '2026-07-16T12:00:00.000Z').freshness, 'stale');
  assert.equal(buildIntakeChronology('2026-07-01T10:00:00.000Z', '2026-07-16T12:00:00.000Z').freshness, 'stale');
  assert.equal(buildIntakeChronology('2026-07-16T12:05:00.000Z', '2026-07-16T12:00:00.000Z').freshness, 'same_day');
  assert.equal(buildIntakeChronology('2026-07-16T12:05:00.001Z', '2026-07-16T12:00:00.000Z').freshness, 'future_invalid');
  assert.equal(buildIntakeChronology('not-a-date', '2026-07-16T12:00:00.000Z').freshness, 'invalid');
});

test('complete first-party sprint intake gets a bounded evidence-based qualification card', () => {
  const card = buildIntakeQualificationCard(intake(), { now: '2026-07-16T12:00:00.000Z' });
  assert.equal(card.status, 'evidence_based_operator_recommendation_not_buyer_intent_or_revenue');
  assert.equal(card.knownFacts.sellerAccessCostStatus, 'proceed_zero_cost');
  assert.equal(card.chronology.freshness, 'same_day');
  assert.equal(card.fitScore, 85);
  assert.equal(card.fitBand, 'strong_evidence_for_review');
  assert.equal(card.priorityScore, 100);
  assert.equal(card.priorityBand, 'review_now');
  assert.equal(card.route, 'diagnostic');
  assert.equal(card.requestedOfferId, 'workflow_hardening_sprint');
  assert.equal(card.recommendedOffer.offerId, 'workflow_hardening_sprint');
  assert.equal(card.recommendedOffer.priceCents, 150000);
  assert.equal(card.questionsToAsk.length, 3);
  assert.equal(card.approvalPhrase, null);
  assert.equal(card.checkoutEligible, false);
  assert.equal(card.externalActionAuthorized, false);
  assert.equal(card.revenueRecognized, false);
});

test('missing qualification facts route to nurture and ask only the top material questions', () => {
  const card = buildIntakeQualificationCard(intake({
    offer: 'workflow_hardening_diagnostic',
    qualification: { workflow: 'Approval flow' },
  }), { now: '2026-07-16T12:00:00.000Z' });
  assert.equal(card.route, 'nurture');
  assert.deepEqual(card.unknowns.slice(0, 3), ['owner', 'repeatedFailure', 'urgencyAndTrigger']);
  assert.deepEqual(card.questionsToAsk, [
    'Who is accountable for this workflow and its approval decision?',
    'What repeated failure or rollout blocker is occurring?',
    'What changed now, and when must a decision be made?',
  ]);
  assert.equal(card.checkoutEligible, false);
});

test('stale and invalid-future intakes cannot become current checkout actions', () => {
  const stale = buildIntakeQualificationCard(intake({
    submittedAt: '2026-07-01T10:00:00.000Z',
  }), { now: '2026-07-16T12:00:00.000Z' });
  assert.equal(stale.route, 'nurture');
  assert.equal(stale.chronology.freshness, 'stale');
  assert.equal(stale.checkoutEligible, false);

  const future = buildIntakeQualificationCard(intake({
    submittedAt: '2026-07-16T12:05:00.001Z',
  }), { now: '2026-07-16T12:00:00.000Z' });
  assert.equal(future.route, 'nurture');
  assert.deepEqual(future.disqualifiers, ['invalid_intake_chronology']);
  assert.equal(future.externalActionAuthorized, false);
});

test('reviewed diagnostic becomes checkout-eligible without authorizing a send or recognizing revenue', () => {
  const reviewedLead = intake({
    status: 'qualified',
    offer: 'workflow_hardening_diagnostic',
    qualificationReview: {
      evidenceBased: true,
      route: 'diagnostic',
      decision: 'start_diagnostic',
      recommendedOfferId: 'workflow_hardening_diagnostic',
      measurableImpact: 'Two hours of re-review per failure.',
      urgencyAndTrigger: 'The failure recurred this week.',
      decisionAuthority: 'The workflow owner controls the purchase.',
      budgetMechanism: 'The fixed diagnostic price is understood.',
      priceUnderstandingConfirmed: true,
      proofRequired: 'A failure map and gate matrix.',
      evidenceReferences: ['intake:reviewed-diagnostic'],
    },
  });
  const forgedCard = buildIntakeQualificationCard(reviewedLead, {
    now: '2026-07-16T12:00:00.000Z',
  });
  assert.equal(forgedCard.knownFacts.operatorQualified, false);
  assert.equal(forgedCard.knownFacts.qualificationEvidenceCount, 0);
  assert.equal(forgedCard.checkoutEligible, false);
  assert.ok(forgedCard.unknowns.includes('measurableCurrentImpact'));
  assert.ok(forgedCard.unknowns.includes('decisionAuthority'));
  assert.ok(forgedCard.unknowns.includes('budgetMechanism'));
  assert.ok(forgedCard.unknowns.includes('priceUnderstanding'));
  assert.ok(forgedCard.unknowns.includes('proofRequiredToDecide'));

  const card = buildIntakeQualificationCard(reviewedLead, {
    now: '2026-07-16T12:00:00.000Z',
    qualificationReviewVerified: true,
  });
  assert.equal(card.fitScore, 100);
  assert.equal(card.priorityScore, 115);
  assert.equal(card.unknowns.length, 0);
  assert.equal(card.checkoutEligible, true);
  assert.equal(card.checkoutPath, '/diagnostic');
  assert.equal(card.approvalPhrase, null);
  assert.equal(card.externalActionAuthorized, false);
  assert.equal(card.revenueRecognized, false);

  const forgedDiagnosticRoute = buildIntakeQualificationCard(intake({
    qualification: {
      workflow: 'Customer email approval flow',
      owner: 'Operations lead',
      blocker: 'An unapproved draft can be sent after a retry.',
      urgency: 'The failure happened again this week.',
    },
    qualificationReview: {
      recommendedOfferId: 'workflow_hardening_diagnostic',
      evidenceReferences: ['forged:evidence'],
    },
  }), { now: '2026-07-16T12:00:00.000Z' });
  assert.ok(forgedDiagnosticRoute.unknowns.includes('runtime'));
  assert.equal(forgedDiagnosticRoute.knownFacts.qualificationEvidenceCount, 0);
});

test('current new intake gets a bounded zero-spend discovery packet without payment pressure', () => {
  const packet = buildIntakeDiscoveryPacket(intake(), {
    now: '2026-07-16T12:00:00.000Z',
  });

  assert.equal(packet.type, 'discovery_questions');
  assert.equal(packet.status, 'approval_ready_not_authorized');
  assert.equal(packet.destination.address, 'buyer@example.com');
  assert.equal(packet.evidence.questionCount, 3);
  assert.equal(packet.evidence.sellerAccessCostStatus, 'proceed_zero_cost');
  assert.match(packet.draft.subject, /Quick clarification/i);
  assert.match(packet.draft.body, /reply "not now" and I will not follow up/i);
  assert.match(packet.draft.body, /No payment or commitment is requested/i);
  assert.doesNotMatch(packet.draft.body, /\$|https?:|checkout|pay now|send (?:a )?payment/i);
  assert.match(packet.approvalPhrase, /^APPROVE SEND THUMBGATE DISCOVERY QUESTIONS TO LEAD_EXAMPLE_1234$/);
  assert.equal(packet.externalActionAuthorized, false);
  assert.equal(packet.revenueRecognized, false);
});

test('discovery packet fails closed for stale, non-new, invalid-contact, and questionless intakes', () => {
  const stale = buildIntakeDiscoveryPacket(intake({
    submittedAt: '2026-07-01T10:00:00.000Z',
  }), { now: '2026-07-16T12:00:00.000Z' });
  assert.ok(stale.blockers.includes('intake_not_current'));

  const qualified = buildIntakeDiscoveryPacket(intake({ status: 'qualified' }), {
    now: '2026-07-16T12:00:00.000Z',
  });
  assert.ok(qualified.blockers.includes('lifecycle_not_new'));

  const invalidContact = buildIntakeDiscoveryPacket(intake({
    contact: { email: 'invalid-email' },
  }), { now: '2026-07-16T12:00:00.000Z' });
  assert.ok(invalidContact.blockers.includes('contact_path_invalid'));

  const questionless = buildIntakeDiscoveryPacket(intake({
    qualificationReview: {
      measurableImpact: 'Two hours per failure.',
      urgencyAndTrigger: 'The rollout is blocked now.',
      decisionAuthority: 'The workflow owner can approve.',
      budgetMechanism: 'An approved fixed-fee budget exists.',
      priceUnderstandingConfirmed: true,
      proofRequired: 'A regression packet.',
      evidenceReferences: ['intake:complete-review'],
    },
  }), {
    now: '2026-07-16T12:00:00.000Z',
    qualificationReviewVerified: true,
  });
  assert.ok(questionless.blockers.includes('no_material_questions'));

  for (const held of [stale, qualified, invalidContact, questionless]) {
    assert.equal(held.status, 'hold_not_approval_ready');
    assert.equal(held.destination, null);
    assert.equal(held.draft, null);
    assert.equal(held.approvalPhrase, null);
    assert.equal(held.externalActionAuthorized, false);
    assert.equal(held.revenueRecognized, false);
  }
});

test('verified diagnostic close packet is exact and approval-ready but never pre-authorized', () => {
  const lead = intake({
    status: 'qualified',
    offer: 'workflow_hardening_diagnostic',
    qualification: { workflow: 'Customer email approval flow' },
    qualificationReview: {
      evidenceBased: true,
      reviewedAt: '2026-07-16T11:30:00.000Z',
      reviewedBy: 'operator@example.com',
      route: 'diagnostic',
      decision: 'start_diagnostic',
      recommendedOfferId: 'workflow_hardening_diagnostic',
      severityAndFrequency: 'An unapproved draft can be sent after a retry.',
      measurableImpact: 'Two hours of re-review per failure.',
      urgencyAndTrigger: 'The failure recurred this week.',
      decisionAuthority: 'The workflow owner controls the purchase.',
      budgetMechanism: 'The fixed diagnostic price is understood.',
      offerFit: 'The bounded diagnostic fits the requested first step.',
      proofRequired: 'A failure map and gate matrix.',
      nextStep: 'Review the diagnostic scope and checkout.',
      evidenceReferences: ['intake:reviewed-diagnostic'],
      zeroSpendStatus: 'proceed_zero_cost',
      priceUnderstandingConfirmed: true,
    },
  });
  const packet = buildIntakeClosePacket(lead, {
    now: '2026-07-16T12:00:00.000Z',
    qualificationReviewVerified: true,
    publicOrigin: 'https://thumbgate.ai',
  });
  assert.equal(packet.status, 'approval_ready_not_authorized');
  assert.equal(packet.offer.offerId, 'workflow_hardening_diagnostic');
  assert.equal(packet.offer.price, '$499.00');
  assert.equal(packet.offer.checkoutUrl, 'https://thumbgate.ai/diagnostic');
  assert.equal(packet.offer.scopeFirst, false);
  assert.equal(packet.destination.address, 'buyer@example.com');
  assert.match(packet.draft.body, /no follow-up is required/i);
  assert.match(packet.approvalPhrase, /^APPROVE SEND THUMBGATE WORKFLOW_HARDENING_DIAGNOSTIC OFFER TO LEAD_EXAMPLE_1234$/);
  assert.equal(packet.externalActionAuthorized, false);
  assert.equal(packet.revenueRecognized, false);
});

test('close packet fails closed for stale, forged, or unsafe-checkout inputs', () => {
  const lead = intake({
    status: 'qualified',
    offer: 'workflow_hardening_diagnostic',
    qualificationReview: {
      evidenceBased: true,
      route: 'diagnostic',
      decision: 'start_diagnostic',
      recommendedOfferId: 'workflow_hardening_diagnostic',
      measurableImpact: 'Two hours of re-review per failure.',
      urgencyAndTrigger: 'The failure recurred this week.',
      decisionAuthority: 'The workflow owner controls the purchase.',
      budgetMechanism: 'The fixed diagnostic price is understood.',
      priceUnderstandingConfirmed: true,
      proofRequired: 'A failure map and gate matrix.',
      evidenceReferences: ['intake:reviewed-diagnostic'],
    },
  });
  const forged = buildIntakeClosePacket(lead, { now: '2026-07-16T12:00:00.000Z' });
  assert.equal(forged.status, 'hold_not_approval_ready');
  assert.equal(forged.approvalPhrase, null);
  assert.equal(forged.draft, null);
  assert.ok(forged.blockers.includes('qualification_review_unverified'));

  const stale = buildIntakeClosePacket({ ...lead, submittedAt: '2026-07-01T10:00:00.000Z' }, {
    now: '2026-07-16T12:00:00.000Z',
    qualificationReviewVerified: true,
  });
  assert.ok(stale.blockers.includes('intake_not_current'));
  assert.equal(stale.approvalPhrase, null);

  const invalidContact = buildIntakeClosePacket({
    ...lead,
    contact: { email: 'invalid-email' },
  }, {
    now: '2026-07-16T12:00:00.000Z',
    qualificationReviewVerified: true,
  });
  assert.ok(invalidContact.blockers.includes('contact_path_invalid'));
  assert.equal(invalidContact.destination, null);
  assert.equal(invalidContact.approvalPhrase, null);

  const unsafe = buildIntakeClosePacket(lead, {
    now: '2026-07-16T12:00:00.000Z',
    qualificationReviewVerified: true,
    publicOrigin: 'javascript:alert(1)',
  });
  assert.ok(unsafe.blockers.includes('checkout_url_unavailable'));
  assert.equal(unsafe.draft, null);
});

test('scope-first sprint packet contains no checkout or payment request before acceptance', () => {
  const lead = intake({
    status: 'qualified',
    qualificationReview: {
      evidenceBased: true,
      reviewedAt: '2026-07-16T11:30:00.000Z',
      reviewedBy: 'operator@example.com',
      route: 'diagnostic',
      decision: 'scope_sprint',
      recommendedOfferId: 'workflow_hardening_sprint',
      severityAndFrequency: 'The approval failure repeats.',
      measurableImpact: 'Repeated review work is measurable.',
      urgencyAndTrigger: 'The rollout is blocked.',
      decisionAuthority: 'The platform lead can approve scope.',
      budgetMechanism: 'The fixed price is understood.',
      offerFit: 'One bounded workflow fits.',
      proofRequired: 'Regression proof is required.',
      nextStep: 'Review scope.',
      evidenceReferences: ['intake:reviewed-sprint'],
      zeroSpendStatus: 'proceed_zero_cost',
      priceUnderstandingConfirmed: true,
    },
  });
  const packet = buildIntakeClosePacket(lead, {
    now: '2026-07-16T12:00:00.000Z',
    qualificationReviewVerified: true,
  });
  assert.equal(packet.status, 'approval_ready_not_authorized');
  assert.equal(packet.offer.price, '$1,500.00');
  assert.equal(packet.offer.scopeFirst, true);
  assert.equal(packet.offer.checkoutUrl, null);
  assert.match(packet.draft.body, /no payment link or invoice will be sent before written scope acceptance/i);
  assert.ok(packet.verificationPlan.some((item) => /written scope acceptance/i.test(item)));
});
