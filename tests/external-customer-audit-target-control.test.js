'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCompletedPilotEvidence } = require('../scripts/workflow-sprint-intake');
const { digestBuyerEmail } = require('../scripts/provider-revenue-evidence');

const {
  RELEASE_APPROVAL,
  TARGET_30_DAY_GROSS_CENTS,
  TARGET_DAILY_GROSS_CENTS,
  buildRevenueTargetControl,
  inspectProductionDeployment,
  parseArgs,
  renderMarkdown,
  shasMatch,
} = require('../scripts/revenue-target-control');

function revenueAudit({
  configured = true,
  productVerified = true,
  windowVerified = true,
  todayGross = 0,
  todayNet = todayGross,
  trailing30Gross = 0,
  trailing30Net = trailing30Gross,
  lifetimeNet = trailing30Net,
  mrr = 0,
  subscriptions = 0,
  customers = lifetimeNet > 0 ? 1 : 0,
  dailyGross = Object.fromEntries(Array.from({ length: 30 }, (_, index) => {
    const date = new Date('2026-06-16T00:00:00.000Z');
    date.setUTCDate(date.getUTCDate() + index);
    return [date.toISOString().slice(0, 10), 0];
  })),
  dailyNet = dailyGross,
} = {}) {
  if (!configured) return { configured: false, gap: 'Stripe unavailable.' };
  return {
    configured: true,
    productAttribution: {
      verified: productVerified,
      gap: productVerified ? null : 'Product reconciliation failed.',
      thumbgate: {
        uniquePayingCustomerCount: customers,
        netRevenueCents: lifetimeNet,
        activeSubscriptionCount: subscriptions,
        mrrCents: mrr,
        revenueWindows: {
          verified: windowVerified,
          gap: windowVerified ? null : 'Created timestamps missing.',
          basis: 'test charge cohort',
          timeZone: 'America/New_York',
          todayLocalDate: '2026-07-15',
          trailing30DayStartLocalDate: '2026-06-16',
          todayGrossRevenueCents: todayGross,
          todayNetRevenueCents: todayNet,
          trailing30DayGrossRevenueCents: trailing30Gross,
          trailing30DayNetRevenueCents: trailing30Net,
          dailyGrossRevenueCents: dailyGross,
          dailyNetRevenueCents: dailyNet,
        },
      },
    },
  };
}

const deployed = {
  inspected: true,
  healthy: true,
  expectedSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  deployedSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  expectedRevisionDeployed: true,
  gap: null,
};

function providerRevenue({ dailyAmount = 0 } = {}) {
  const daily = Object.fromEntries(Array.from({ length: 30 }, (_, index) => {
    const date = new Date('2026-06-16T00:00:00.000Z');
    date.setUTCDate(date.getUTCDate() + index);
    return [date.toISOString().slice(0, 10), dailyAmount];
  }));
  return {
    verified: true,
    currency: 'usd',
    timeZone: 'America/New_York',
    todayLocalDate: '2026-07-15',
    trailing30DayStartLocalDate: '2026-06-16',
    todayGrossRevenueCents: dailyAmount,
    todayNetRevenueCents: dailyAmount,
    trailing30DayGrossRevenueCents: dailyAmount * 30,
    trailing30DayNetRevenueCents: dailyAmount * 30,
    dailyGrossRevenueCents: daily,
    dailyNetRevenueCents: daily,
    externalMrrCents: 0,
    activeExternalSubscriptions: 0,
    externalPayingCustomerIdentities: dailyAmount > 0 ? 1 : 0,
  };
}

const completeProviderCoverage = Object.fromEntries([
  ['paypal', 'paypal-fixture'],
  ['merchantOfRecord', 'mor-fixture'],
  ['githubMarketplace', 'marketplace-fixture'],
].map(([provider, evidenceSource]) => [provider, {
  audited: true,
  evidenceVerified: true,
  evidenceSource,
  revenue: providerRevenue(),
}]));

function verifiedPayPalIndividualPayment(overrides = {}) {
  return {
    provider: 'paypal',
    id: 'PAYMENT-1:T0007:2026-07-15T14:00:00Z',
    createdAt: '2026-07-15T14:00:00.000Z',
    localDate: '2026-07-15',
    timeZone: 'America/New_York',
    grossCents: 49900,
    refundedCents: 0,
    netCents: 49900,
    customerId: 'paypal_0123456789abcdef01234567',
    customerClassification: 'external',
    ownerTest: false,
    productAttribution: { verified: true, product: 'thumbgate' },
    evidenceVerified: true,
    evidenceSource: 'provider_api_live:paypal-debug-ids:debug-1',
    evidenceDigest: `sha256:${'a'.repeat(64)}`,
    ...overrides,
  };
}

function buildControl(input = {}) {
  return buildRevenueTargetControl({
    providerCoverage: completeProviderCoverage,
    generatedAt: '2026-07-15T16:00:00.000Z',
    ...input,
  });
}

function verifiedEnterprisePilotContract() {
  const buyerEmail = 'buyer@example.com';
  const paymentDigest = `sha256:${'e'.repeat(64)}`;
  const paymentEvidence = {
    kind: 'provider_payment',
    provider: 'paypal',
    source: 'provider_api_live:test-enterprise-pilot',
    reference: 'capture_enterprise_pilot_1',
    verified: true,
    digest: paymentDigest,
    offerId: 'enterprise_governance_pilot',
    buyerDigest: digestBuyerEmail(buyerEmail),
  };
  const salesLead = {
    leadId: 'sales_enterprise_pilot_1',
    createdAt: '2026-07-14T10:00:00.000Z',
    updatedAt: '2026-07-14T10:00:00.000Z',
    stage: 'paid',
    source: 'direct',
    channel: 'direct',
    offer: 'enterprise_governance_pilot',
    contact: { email: buyerEmail },
    account: {},
    qualification: {},
    outbound: {},
    revenue: { amountCents: 1500000, currency: 'usd', paidAt: '2026-07-14T10:00:00.000Z' },
    attribution: {},
    history: [{
      fromStage: 'sprint_intake',
      toStage: 'paid',
      at: '2026-07-14T10:00:00.000Z',
      evidence: paymentEvidence,
    }],
  };
  const workflowLead = {
    leadId: 'workflow_enterprise_pilot_1',
    submittedAt: '2026-07-14T07:00:00.000Z',
    updatedAt: '2026-07-14T10:01:00.000Z',
    status: 'paid_team',
    offer: 'enterprise_governance_pilot',
    contact: { email: buyerEmail },
    qualification: { workflow: 'Three governed workflows', owner: 'Platform lead' },
    qualificationReview: {
      evidenceBased: true,
      reviewedAt: '2026-07-14T07:30:00.000Z',
      reviewedBy: 'ops@example.com',
      route: 'close',
      decision: 'qualify_for_signed_proposal',
      recommendedOfferId: 'enterprise_governance_pilot',
      severityAndFrequency: 'The governed workflow failure repeated during initial proof.',
      measurableImpact: 'Repeated review and repair work is documented.',
      urgencyAndTrigger: 'The buyer needs a bounded governance pilot now.',
      decisionAuthority: 'The named platform lead can approve the pilot.',
      budgetMechanism: 'The fixed pilot price is covered by the signed scope.',
      offerFit: 'Three workflows fit the bounded Enterprise Governance Pilot.',
      proofRequired: 'Provider payment and proof-backed workflow evidence are required.',
      nextStep: 'Run and reconcile the signed governance pilot.',
      evidenceReferences: ['intake:target-control-enterprise-pilot'],
      zeroSpendStatus: 'proceed_zero_cost',
    },
    attribution: {},
    workflowProgress: {
      qualifiedAt: '2026-07-14T07:30:00.000Z',
      namedPilotAt: '2026-07-14T08:00:00.000Z',
      proofBackedRunAt: '2026-07-14T09:00:00.000Z',
      paidTeamAt: '2026-07-14T10:01:00.000Z',
    },
    proof: { artifacts: ['proof/enterprise-governance-pilot.json'], reviewedBy: null },
    commercialProof: {
      scope: {
        source: 'docusign',
        reference: 'envelope_enterprise_pilot_1',
        signedBy: buyerEmail,
        signedAt: '2026-07-14T08:00:00.000Z',
        digest: `sha256:${'f'.repeat(64)}`,
        offerId: 'enterprise_governance_pilot',
        amountCents: 1500000,
        currency: 'usd',
        billing: 'one_time',
        workflowCount: 3,
      },
      payment: {
        source: paymentEvidence.source,
        reference: paymentEvidence.reference,
        provider: paymentEvidence.provider,
        digest: paymentDigest,
        verified: true,
        offerId: 'enterprise_governance_pilot',
        buyerEmailMatch: true,
        salesLeadId: salesLead.leadId,
        amountCents: 1500000,
        currency: 'usd',
        paidAt: '2026-07-14T10:00:00.000Z',
      },
    },
    statusHistory: [
      { toStatus: 'new', at: '2026-07-14T07:00:00.000Z' },
      { fromStatus: 'new', toStatus: 'qualified', at: '2026-07-14T07:30:00.000Z' },
      { fromStatus: 'qualified', toStatus: 'named_pilot', at: '2026-07-14T08:00:00.000Z' },
      { fromStatus: 'named_pilot', toStatus: 'proof_backed_run', at: '2026-07-14T09:00:00.000Z' },
      { fromStatus: 'proof_backed_run', toStatus: 'paid_team', at: '2026-07-14T10:01:00.000Z' },
    ],
  };
  const evidence = buildCompletedPilotEvidence(workflowLead, [salesLead], {
    now: '2026-07-15T16:00:00.000Z',
  });
  assert.equal(evidence.verified, true);
  return { salesLead, workflowLead, evidence };
}

function verifiedExpansionContract({
  offerId = 'enterprise_reliability_operations',
  amountCents = 1000000,
  billing = 'monthly',
  workflowCount = 3,
} = {}) {
  const buyerEmail = 'buyer@example.com';
  const pilot = offerId === 'enterprise_reliability_operations'
    ? verifiedEnterprisePilotContract()
    : null;
  const scopeDigest = `sha256:${'b'.repeat(64)}`;
  const paymentDigest = `sha256:${'c'.repeat(64)}`;
  const paymentEvidence = {
    kind: 'provider_payment',
    provider: 'paypal',
    source: 'provider_api_live:test-expansion',
    reference: 'capture_expansion_1',
    verified: true,
    digest: paymentDigest,
    invoiceId: 'thumbgate-expansion-2026-07',
    offerId,
    buyerDigest: digestBuyerEmail(buyerEmail),
  };
  const salesLead = {
    leadId: 'sales_expansion_1',
    createdAt: '2026-07-15T12:00:00.000Z',
    updatedAt: '2026-07-15T12:00:00.000Z',
    stage: 'paid',
    source: 'direct',
    channel: 'direct',
    offer: offerId,
    contact: { email: buyerEmail },
    account: {},
    qualification: {},
    outbound: {},
    revenue: { amountCents, currency: 'usd', paidAt: '2026-07-15T12:00:00.000Z' },
    attribution: {},
    history: [{
      fromStage: 'sprint_intake',
      toStage: 'paid',
      at: '2026-07-15T12:00:00.000Z',
      evidence: paymentEvidence,
    }],
  };
  const workflowLead = {
    leadId: 'workflow_expansion_1',
    submittedAt: '2026-07-14T12:00:00.000Z',
    updatedAt: '2026-07-15T12:00:00.000Z',
    status: 'paid_team',
    offer: offerId,
    contact: { email: buyerEmail },
    qualification: { workflow: 'Three governed workflows', owner: 'Platform lead' },
    qualificationReview: {
      evidenceBased: true,
      reviewedAt: '2026-07-14T13:00:00.000Z',
      reviewedBy: 'ops@example.com',
      route: 'close',
      decision: 'qualify_for_signed_proposal',
      recommendedOfferId: offerId,
      severityAndFrequency: 'The governed workflow failure repeated during the pilot.',
      measurableImpact: 'Repeated review and repair work is documented.',
      urgencyAndTrigger: 'The buyer needs the next governed billing period now.',
      decisionAuthority: 'The named platform lead can approve the recurring scope.',
      budgetMechanism: 'The fixed recurring price is covered by the signed scope.',
      offerFit: 'The completed pilot fits the bounded recurring operations offer.',
      proofRequired: 'Provider payment and proof-backed workflow evidence are required.',
      nextStep: 'Reconcile the signed recurring scope with provider payment.',
      evidenceReferences: ['intake:target-control-expansion'],
      zeroSpendStatus: 'proceed_zero_cost',
    },
    attribution: {},
    workflowProgress: {},
    proof: { artifacts: ['proof/enterprise.json'], reviewedBy: null },
    commercialProof: {
      scope: {
        source: 'docusign',
        reference: 'envelope_expansion_1',
        signedBy: buyerEmail,
        signedAt: '2026-07-15T11:00:00.000Z',
        digest: scopeDigest,
        offerId,
        amountCents,
        currency: 'usd',
        billing,
        workflowCount,
        ...(pilot ? {
          priorPilotReference: pilot.evidence.reference,
          priorPilotDigest: pilot.evidence.digest,
        } : {}),
      },
      payment: {
        source: paymentEvidence.source,
        reference: paymentEvidence.reference,
        provider: paymentEvidence.provider,
        digest: paymentDigest,
        verified: true,
        offerId,
        buyerEmailMatch: true,
        salesLeadId: salesLead.leadId,
        amountCents,
        currency: 'usd',
        paidAt: '2026-07-15T12:00:00.000Z',
        invoiceId: 'thumbgate-expansion-2026-07',
        billingPeriodStart: '2026-07-15T00:00:00.000Z',
        billingPeriodEnd: '2026-08-14T00:00:00.000Z',
      },
    },
    statusHistory: [
      { toStatus: 'new', at: '2026-07-14T12:00:00.000Z' },
      { fromStatus: 'new', toStatus: 'qualified', at: '2026-07-14T13:00:00.000Z' },
      { fromStatus: 'qualified', toStatus: 'named_pilot', at: '2026-07-14T14:00:00.000Z' },
      { fromStatus: 'named_pilot', toStatus: 'proof_backed_run', at: '2026-07-15T10:00:00.000Z' },
      { fromStatus: 'proof_backed_run', toStatus: 'paid_team', at: '2026-07-15T12:00:00.000Z' },
    ],
  };
  return {
    salesLead,
    workflowLead,
    salesLeads: pilot ? [pilot.salesLead, salesLead] : [salesLead],
    workflowLeads: pilot ? [pilot.workflowLead, workflowLead] : [workflowLead],
  };
}

test('parseArgs supports deterministic live-audit inputs', () => {
  assert.deepEqual(parseArgs([
    '--json',
    '--strict',
    '--pipeline-path=/tmp/pipeline.jsonl',
    '--production-origin=https://example.com',
    '--expected-sha=abcdef1',
    '--mor-provider=PayPal',
    '--timezone=America/New_York',
    '--now=2026-07-15T12:00:00.000Z',
    '--timeout-ms=4321',
  ], {}), {
    json: true,
    strict: true,
    pipelinePath: '/tmp/pipeline.jsonl',
    feedbackDir: null,
    providerEvidencePaths: {
      paypal: null,
      merchantOfRecord: null,
      githubMarketplace: null,
    },
    providerApiEnabled: true,
    githubMarketplaceCsvPath: null,
    githubMarketplaceAppName: null,
    githubMarketplaceOwnerAccountIds: [],
    githubMarketplaceOwnerIdentifiersReviewed: false,
    githubMarketplaceCsvScope: null,
    githubWebhookLedgerPath: null,
    morProvider: 'PayPal',
    productionOrigin: 'https://example.com',
    expectedSha: 'abcdef1',
    now: '2026-07-15T12:00:00.000Z',
    timeZone: 'America/New_York',
    timeoutMs: 4321,
  });
});

test('SHA comparison accepts full-to-short matches but rejects missing or unrelated evidence', () => {
  assert.equal(shasMatch('abcdef1234567890', 'abcdef1'), true);
  assert.equal(shasMatch('abcdef1', 'abcdef1234567890'), true);
  assert.equal(shasMatch('abcdef1', '1234567'), false);
  assert.equal(shasMatch('', 'abcdef1'), false);
});

test('missing Stripe evidence fails closed and never turns unknown revenue into zero-dollar proof', () => {
  const control = buildControl({
    externalCustomerAudit: revenueAudit({ configured: false }),
    deployment: deployed,
  });
  assert.equal(control.status, 'evidence_incomplete');
  assert.equal(control.actual.todayGrossRevenueCents, null);
  assert.equal(control.actual.trailing30DayGrossRevenueCents, null);
  assert.equal(control.milestones.firstExternalPayment.achieved, false);
  assert.match(control.claim, /not verified/i);
});

test('account-wide or unreconciled money cannot become ThumbGate target proof', () => {
  const audit = revenueAudit({ productVerified: false });
  audit.charges = { external: { netCents: 900000000 } };
  const control = buildControl({ externalCustomerAudit: audit, deployment: deployed });
  assert.equal(control.status, 'evidence_incomplete');
  assert.equal(control.actual.lifetimeNetRevenueCents, null);
  assert.equal(control.milestones.thirtyConsecutiveTargetDays.achieved, false);
});

test('offer arithmetic and a deployed control do not fabricate traction', () => {
  const control = buildControl({
    externalCustomerAudit: revenueAudit(),
    deployment: deployed,
  });
  assert.equal(control.status, 'not_achieved');
  assert.equal(control.offerSystem.status, 'operating_model_not_traction_proof');
  assert.equal(control.offerSystem.offerCount, 6);
  assert.equal(control.milestones.firstExternalPayment.achieved, false);
  assert.equal(control.milestones.targetWithCurrentControlDeployed.achieved, false);
});

test('lifetime traction stays separate from same-day and recurring milestones', () => {
  const control = buildControl({
    externalCustomerAudit: revenueAudit({ lifetimeNet: 49900, customers: 1 }),
    deployment: deployed,
  });
  assert.equal(control.status, 'traction_below_target');
  assert.equal(control.milestones.firstExternalPayment.achieved, true);
  assert.equal(control.milestones.sameDayExternalPayment.achieved, false);
  assert.equal(control.milestones.externalRecurringRevenue.achieved, false);
});

test('same-day payments and active MRR are independently proven milestones', () => {
  const dailyGross = providerRevenue().dailyGrossRevenueCents;
  dailyGross['2026-07-15'] = 49900;
  const control = buildControl({
    externalCustomerAudit: revenueAudit({
      todayGross: 49900,
      todayNet: 49900,
      trailing30Gross: 49900,
      trailing30Net: 49900,
      lifetimeNet: 49900,
      mrr: 1900,
      subscriptions: 1,
      customers: 1,
      dailyGross,
    }),
    deployment: deployed,
  });
  assert.equal(control.milestones.firstExternalPayment.achieved, true);
  assert.equal(control.milestones.sameDayExternalPayment.achieved, true);
  assert.equal(control.milestones.externalRecurringRevenue.achieved, true);
  assert.equal(control.milestones.productizedRecurringRevenue.achieved, false);
  assert.equal(control.milestones.enterpriseRevenue.achieved, false);
  assert.equal(control.milestones.thirtyConsecutiveTargetDays.achieved, false);
});

test('generic Pro MRR cannot masquerade as productized recurring or Enterprise contract revenue', () => {
  const control = buildControl({
    externalCustomerAudit: revenueAudit({
      lifetimeNet: 1900,
      customers: 1,
      mrr: 1900,
      subscriptions: 1,
    }),
    deployment: deployed,
  });
  assert.equal(control.milestones.externalRecurringRevenue.achieved, true);
  assert.equal(control.milestones.productizedRecurringRevenue.achieved, false);
  assert.equal(control.milestones.enterpriseRevenue.achieved, false);
  assert.equal(control.evidence.expansionCommercialProof.verifiedPaidTeamCount, 0);
  assert.equal(control.nextAction, 'QUALIFY THE FIRST PAID CUSTOMER FOR A FIXED-SCOPE RECURRING OPERATIONS PROPOSAL');
});

test('productized recurring and Enterprise milestones require reconciled signed scope and exact paid sales evidence', () => {
  const { salesLeads, workflowLead, workflowLeads } = verifiedExpansionContract();
  const control = buildControl({
    externalCustomerAudit: revenueAudit(),
    salesLeads,
    workflowSprintLeads: workflowLeads,
    deployment: deployed,
  });
  assert.equal(control.milestones.productizedRecurringRevenue.achieved, true);
  assert.equal(control.milestones.productizedRecurringRevenue.verifiedContractCount, 1);
  assert.equal(control.milestones.enterpriseRevenue.achieved, true);
  assert.equal(control.milestones.enterpriseRevenue.verifiedContractCount, 2);
  assert.equal(control.evidence.expansionCommercialProof.ok, true);
  assert.equal(control.evidence.expansionCommercialProof.byOffer.enterprise_reliability_operations, 1);

  const tampered = structuredClone(workflowLead);
  tampered.commercialProof.payment.amountCents = 1900;
  const rejected = buildControl({
    externalCustomerAudit: revenueAudit(),
    salesLeads,
    workflowSprintLeads: [workflowLeads[0], tampered],
    deployment: deployed,
  });
  assert.equal(rejected.milestones.productizedRecurringRevenue.achieved, false);
  assert.equal(rejected.milestones.enterpriseRevenue.achieved, true);
  assert.equal(rejected.milestones.enterpriseRevenue.verifiedContractCount, 1);
  assert.equal(rejected.evidence.expansionCommercialProof.ok, false);
});

test('an expired recurring invoice remains historical evidence but cannot satisfy the current recurring milestone', () => {
  const { salesLead, salesLeads, workflowLead, workflowLeads } = verifiedExpansionContract();
  salesLead.revenue.paidAt = '2026-06-15T12:00:00.000Z';
  workflowLead.commercialProof.payment.paidAt = '2026-06-15T12:00:00.000Z';
  workflowLead.commercialProof.payment.billingPeriodStart = '2026-06-15T00:00:00.000Z';
  workflowLead.commercialProof.payment.billingPeriodEnd = '2026-07-15T00:00:00.000Z';
  const control = buildControl({
    externalCustomerAudit: revenueAudit({ lifetimeNet: 1000000, customers: 1 }),
    salesLeads,
    workflowSprintLeads: workflowLeads,
    deployment: deployed,
  });

  assert.equal(control.evidence.expansionCommercialProof.ok, true);
  assert.equal(control.evidence.expansionCommercialProof.verifiedPaidTeamCount, 2);
  assert.equal(control.evidence.expansionCommercialProof.verifiedRecurringCount, 0);
  assert.equal(control.evidence.expansionCommercialProof.historicalRecurringCount, 1);
  assert.equal(control.milestones.productizedRecurringRevenue.achieved, false);
  assert.equal(control.milestones.productizedRecurringRevenue.verifiedRevenueCents, 0);
  assert.equal(control.milestones.productizedRecurringRevenue.historicalContractCount, 1);
  assert.equal(control.nextAction, 'QUALIFY THE FIRST PAID CUSTOMER FOR A FIXED-SCOPE RECURRING OPERATIONS PROPOSAL');
});

test('a verified prepayment remains scheduled and cannot satisfy the current recurring milestone early', () => {
  const { salesLead, salesLeads, workflowLead, workflowLeads } = verifiedExpansionContract();
  salesLead.revenue.paidAt = '2026-07-14T12:00:00.000Z';
  workflowLead.commercialProof.payment.paidAt = '2026-07-14T12:00:00.000Z';
  workflowLead.commercialProof.payment.billingPeriodStart = '2026-07-16T00:00:00.000Z';
  workflowLead.commercialProof.payment.billingPeriodEnd = '2026-08-15T00:00:00.000Z';
  const control = buildControl({
    externalCustomerAudit: revenueAudit({ lifetimeNet: 1000000, customers: 1 }),
    salesLeads,
    workflowSprintLeads: workflowLeads,
    deployment: deployed,
  });

  assert.equal(control.evidence.expansionCommercialProof.ok, true);
  assert.equal(control.evidence.expansionCommercialProof.verifiedRecurringCount, 0);
  assert.equal(control.evidence.expansionCommercialProof.historicalRecurringCount, 0);
  assert.equal(control.evidence.expansionCommercialProof.scheduledRecurringCount, 1);
  assert.equal(control.milestones.productizedRecurringRevenue.achieved, false);
  assert.equal(control.milestones.productizedRecurringRevenue.scheduledContractCount, 1);
  assert.equal(control.milestones.productizedRecurringRevenue.historicalContractCount, 0);
});

test('verified workflow operations revenue advances the next action to Enterprise qualification', () => {
  const { salesLeads, workflowLeads } = verifiedExpansionContract({
    offerId: 'workflow_reliability_operations',
    amountCents: 300000,
    billing: 'monthly',
    workflowCount: 1,
  });
  const control = buildControl({
    externalCustomerAudit: revenueAudit({ lifetimeNet: 300000, customers: 1 }),
    salesLeads,
    workflowSprintLeads: workflowLeads,
    deployment: deployed,
  });
  assert.equal(control.milestones.productizedRecurringRevenue.achieved, true);
  assert.equal(control.milestones.enterpriseRevenue.achieved, false);
  assert.equal(control.nextAction, 'QUALIFY ONE PROOF-BACKED BUYER FOR THE FIXED-SCOPE ENTERPRISE GOVERNANCE PILOT');
});

test('a 30-day aggregate spike is insufficient when any day misses the daily target', () => {
  const dailyGross = Object.fromEntries(Array.from({ length: 30 }, (_, index) => {
    const date = new Date('2026-06-16T00:00:00.000Z');
    date.setUTCDate(date.getUTCDate() + index);
    return [date.toISOString().slice(0, 10), index === 0 ? 0 : TARGET_DAILY_GROSS_CENTS * 2];
  }));
  const aggregate = Object.values(dailyGross).reduce((sum, value) => sum + value, 0);
  const control = buildControl({
    externalCustomerAudit: revenueAudit({
      todayGross: dailyGross['2026-07-15'],
      todayNet: dailyGross['2026-07-15'],
      trailing30Gross: aggregate,
      trailing30Net: aggregate,
      lifetimeNet: aggregate,
      customers: 30,
      dailyGross,
    }),
    deployment: deployed,
  });
  assert.equal(control.actual.daysMeetingDailyTarget, 29);
  assert.equal(control.milestones.thirtyConsecutiveTargetDays.achieved, false);
  assert.equal(control.status, 'traction_below_target');
});

test('meeting all revenue thresholds still cannot claim the current control is shipped on an old production SHA', () => {
  const dailyGross = Object.fromEntries(Array.from({ length: 30 }, (_, index) => {
    const date = new Date('2026-06-16T00:00:00.000Z');
    date.setUTCDate(date.getUTCDate() + index);
    return [date.toISOString().slice(0, 10), TARGET_DAILY_GROSS_CENTS];
  }));
  const control = buildControl({
    externalCustomerAudit: revenueAudit({
      todayGross: TARGET_DAILY_GROSS_CENTS,
      todayNet: TARGET_DAILY_GROSS_CENTS,
      trailing30Gross: TARGET_30_DAY_GROSS_CENTS,
      trailing30Net: TARGET_30_DAY_GROSS_CENTS,
      lifetimeNet: TARGET_30_DAY_GROSS_CENTS,
      customers: 30,
      dailyGross,
    }),
    deployment: { ...deployed, deployedSha: 'bbbbbbb', expectedRevisionDeployed: false },
  });
  assert.equal(control.milestones.thirtyConsecutiveTargetDays.achieved, true);
  assert.equal(control.milestones.targetWithCurrentControlDeployed.achieved, false);
  assert.equal(control.nextAction, RELEASE_APPROVAL);
});

test('success requires 30 complete target days, attributed evidence, and matching production code', () => {
  const dailyGross = Object.fromEntries(Array.from({ length: 30 }, (_, index) => {
    const date = new Date('2026-06-16T00:00:00.000Z');
    date.setUTCDate(date.getUTCDate() + index);
    return [date.toISOString().slice(0, 10), TARGET_DAILY_GROSS_CENTS];
  }));
  const control = buildControl({
    externalCustomerAudit: revenueAudit({
      todayGross: TARGET_DAILY_GROSS_CENTS,
      todayNet: TARGET_DAILY_GROSS_CENTS,
      trailing30Gross: TARGET_30_DAY_GROSS_CENTS,
      trailing30Net: TARGET_30_DAY_GROSS_CENTS,
      lifetimeNet: TARGET_30_DAY_GROSS_CENTS,
      mrr: 100000,
      subscriptions: 1,
      customers: 30,
      dailyGross,
    }),
    deployment: deployed,
  });
  assert.equal(control.actual.daysMeetingDailyTarget, 30);
  assert.equal(control.actual.daysMeetingDailyNetTarget, 30);
  assert.equal(control.actual.trailing30AverageHourlyGrossCents, 100000);
  assert.equal(control.status, 'target_achieved_verified');
  assert.equal(control.milestones.targetWithCurrentControlDeployed.achieved, true);
  assert.match(control.claim, /is verified/i);
});

test('a forged or unreconciled daily series cannot pass the target control', () => {
  const dailyGross = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [
    `wrong-${index}`,
    TARGET_DAILY_GROSS_CENTS,
]));
  const control = buildControl({
    externalCustomerAudit: revenueAudit({
      todayGross: TARGET_DAILY_GROSS_CENTS,
      todayNet: 0,
      trailing30Gross: TARGET_30_DAY_GROSS_CENTS,
      trailing30Net: TARGET_30_DAY_GROSS_CENTS,
      lifetimeNet: TARGET_30_DAY_GROSS_CENTS,
      customers: 30,
      dailyGross,
    }),
    deployment: deployed,
  });
  assert.equal(control.evidence.dailySeriesReconciled, false);
  assert.equal(control.actual.daysMeetingDailyTarget, null);
  assert.equal(control.milestones.thirtyConsecutiveTargetDays.achieved, false);
});

test('gross and net daily maps must both contain the exact expected 30 calendar dates', () => {
  const dailyGross = Object.fromEntries(Array.from({ length: 30 }, (_, index) => {
    const date = new Date('2026-06-16T00:00:00.000Z');
    date.setUTCDate(date.getUTCDate() + index);
    return [date.toISOString().slice(0, 10), TARGET_DAILY_GROSS_CENTS];
  }));
  const dailyNet = { ...dailyGross, 'forged-extra-date': TARGET_DAILY_GROSS_CENTS };
  const control = buildControl({
    externalCustomerAudit: revenueAudit({
      trailing30Gross: TARGET_30_DAY_GROSS_CENTS,
      trailing30Net: TARGET_30_DAY_GROSS_CENTS,
      lifetimeNet: TARGET_30_DAY_GROSS_CENTS,
      customers: 30,
      dailyGross,
      dailyNet,
    }),
    deployment: deployed,
  });
  assert.equal(control.evidence.dailySeriesReconciled, false);
  assert.equal(control.milestones.thirtyConsecutiveTargetDays.achieved, false);
});

test('fully refunded revenue cannot satisfy the money target even when gross clears it', () => {
  const dailyGross = Object.fromEntries(Array.from({ length: 30 }, (_, index) => {
    const date = new Date('2026-06-16T00:00:00.000Z');
    date.setUTCDate(date.getUTCDate() + index);
    return [date.toISOString().slice(0, 10), TARGET_DAILY_GROSS_CENTS];
  }));
  const dailyNet = Object.fromEntries(Object.keys(dailyGross).map((date) => [date, 0]));
  const control = buildControl({
    externalCustomerAudit: revenueAudit({
      todayGross: TARGET_DAILY_GROSS_CENTS,
      todayNet: 0,
      trailing30Gross: TARGET_30_DAY_GROSS_CENTS,
      trailing30Net: 0,
      lifetimeNet: 0,
      customers: 0,
      dailyGross,
      dailyNet,
    }),
    deployment: deployed,
  });
  assert.equal(control.actual.daysMeetingDailyTarget, 30);
  assert.equal(control.actual.daysMeetingDailyNetTarget, 0);
  assert.equal(control.milestones.thirtyConsecutiveTargetDays.achieved, false);
});

test('Stripe success alone cannot become global arithmetic while documented rails remain unaudited', () => {
  const dailyGross = Object.fromEntries(Array.from({ length: 30 }, (_, index) => {
    const date = new Date('2026-06-16T00:00:00.000Z');
    date.setUTCDate(date.getUTCDate() + index);
    return [date.toISOString().slice(0, 10), TARGET_DAILY_GROSS_CENTS];
  }));
  const control = buildRevenueTargetControl({
    externalCustomerAudit: revenueAudit({
      todayGross: TARGET_DAILY_GROSS_CENTS,
      todayNet: TARGET_DAILY_GROSS_CENTS,
      trailing30Gross: TARGET_30_DAY_GROSS_CENTS,
      trailing30Net: TARGET_30_DAY_GROSS_CENTS,
      lifetimeNet: TARGET_30_DAY_GROSS_CENTS,
      customers: 30,
      dailyGross,
    }),
    deployment: deployed,
  });
  assert.equal(control.actual.trailing30DayGrossRevenueCents, null);
  assert.equal(control.milestones.thirtyConsecutiveTargetDays.achieved, false);
  assert.equal(control.evidence.providerCoverage.completeForGlobalClaim, false);
  assert.equal(control.evidence.providerCoverage.providers.stripe.audited, true);
  assert.equal(control.evidence.providerCoverage.providers.paypal.audited, false);
  assert.equal(control.status, 'evidence_incomplete');
  assert.equal(control.milestones.targetWithCurrentControlDeployed.achieved, false);
});

test('global arithmetic sums all provider slices instead of relabeling Stripe-only dollars', () => {
  const perProvider = TARGET_DAILY_GROSS_CENTS / 4;
  const providerCoverage = Object.fromEntries([
    ['paypal', 'paypal-fixture'],
    ['merchantOfRecord', 'mor-fixture'],
    ['githubMarketplace', 'marketplace-fixture'],
  ].map(([provider, evidenceSource]) => [provider, {
    audited: true,
    evidenceVerified: true,
    evidenceSource,
    revenue: providerRevenue({ dailyAmount: perProvider }),
  }]));
  const stripeDaily = providerRevenue({ dailyAmount: perProvider });
  const control = buildRevenueTargetControl({
    externalCustomerAudit: revenueAudit({
      todayGross: perProvider,
      todayNet: perProvider,
      trailing30Gross: perProvider * 30,
      trailing30Net: perProvider * 30,
      lifetimeNet: perProvider * 30,
      customers: 1,
      dailyGross: stripeDaily.dailyGrossRevenueCents,
      dailyNet: stripeDaily.dailyNetRevenueCents,
    }),
    providerCoverage,
    deployment: deployed,
  });
  assert.equal(control.actual.scope, 'all_documented_providers_reconciled');
  assert.equal(control.actual.todayGrossRevenueCents, TARGET_DAILY_GROSS_CENTS);
  assert.equal(control.actual.trailing30DayGrossRevenueCents, TARGET_30_DAY_GROSS_CENTS);
  assert.equal(control.status, 'target_achieved_verified');
});

test('PayPal configured as Merchant of Record covers both roles but is aggregated exactly once', () => {
  const paypalRevenue = providerRevenue({ dailyAmount: 1000 });
  const providerCoverage = {
    paypal: {
      audited: true,
      evidenceVerified: true,
      evidenceSource: 'paypal-provider-export',
      revenue: paypalRevenue,
    },
    githubMarketplace: completeProviderCoverage.githubMarketplace,
  };
  const control = buildRevenueTargetControl({
    externalCustomerAudit: revenueAudit(),
    providerCoverage,
    morProvider: 'PayPal',
    deployment: deployed,
  });
  assert.equal(control.evidence.providerCoverage.completeForGlobalClaim, true);
  assert.equal(control.evidence.providerCoverage.providers.merchantOfRecord.status, 'covered_by_paypal_processor');
  assert.equal(control.evidence.providerCoverage.providers.merchantOfRecord.aggregateRevenue, false);
  assert.equal(control.actual.todayGrossRevenueCents, 1000);
  assert.equal(control.actual.trailing30DayGrossRevenueCents, 30000);
});

test('a positive live PayPal transaction proves payment milestones without fabricating a complete provider slice', () => {
  const control = buildRevenueTargetControl({
    externalCustomerAudit: revenueAudit(),
    providerCoverage: {
      paypal: {
        audited: false,
        evidenceVerified: false,
        status: 'provider_api_collected_but_incomplete',
        evidenceSource: 'provider_api_live:paypal-debug-ids:debug-1',
        revenue: null,
        individualPayments: [verifiedPayPalIndividualPayment()],
      },
      githubMarketplace: completeProviderCoverage.githubMarketplace,
    },
    morProvider: 'PayPal',
    deployment: deployed,
    generatedAt: '2026-07-15T16:00:00.000Z',
  });
  assert.equal(control.status, 'evidence_incomplete');
  assert.equal(control.actual.todayGrossRevenueCents, null);
  assert.equal(control.milestones.firstExternalPayment.achieved, true);
  assert.equal(control.milestones.firstExternalPayment.verifiedIndividualPaymentCount, 1);
  assert.equal(control.milestones.sameDayExternalPayment.achieved, true);
  assert.equal(control.evidence.providerCoverage.completeForGlobalClaim, false);
  assert.equal(control.nextAction, 'CONFIGURE OR REFRESH READ-ONLY PROVIDER REVENUE EVIDENCE');
});

test('malformed or owner-test individual payment assertions cannot satisfy a money milestone', () => {
  const control = buildRevenueTargetControl({
    externalCustomerAudit: revenueAudit(),
    providerCoverage: {
      paypal: {
        individualPayments: [verifiedPayPalIndividualPayment({ ownerTest: true })],
      },
    },
    deployment: deployed,
    generatedAt: '2026-07-15T16:00:00.000Z',
  });
  assert.equal(control.milestones.firstExternalPayment.achieved, false);
  assert.equal(control.evidence.providerCoverage.providers.paypal.individualPayments.length, 0);
  assert.match(control.evidence.providerCoverage.providers.paypal.individualPaymentGap, /malformed or unverified/i);
});

test('individually valid provider slices with different dates still fail global aggregation', () => {
  const misaligned = providerRevenue();
  misaligned.timeZone = 'UTC';
  const providerCoverage = {
    ...completeProviderCoverage,
    paypal: { ...completeProviderCoverage.paypal, revenue: misaligned },
  };
  const control = buildRevenueTargetControl({
    externalCustomerAudit: revenueAudit(),
    providerCoverage,
    deployment: deployed,
  });
  assert.equal(control.evidence.providerCoverage.completeForGlobalClaim, true);
  assert.equal(control.actual.scope, 'global_revenue_unverified');
  assert.equal(control.status, 'evidence_incomplete');
  assert.match(control.gaps.join('\n'), /do not align/i);
});

test('bare provider audit booleans cannot substitute for verified evidence sources', () => {
  const control = buildRevenueTargetControl({
    externalCustomerAudit: revenueAudit(),
    providerCoverage: {
      stripe: { audited: true },
      paypal: { audited: true },
      merchantOfRecord: { audited: true },
      githubMarketplace: { audited: true },
    },
    deployment: deployed,
  });
  assert.equal(control.evidence.providerCoverage.completeForGlobalClaim, false);
  assert.equal(control.evidence.providerCoverage.providers.paypal.audited, false);
  assert.match(control.evidence.providerCoverage.providers.paypal.gap, /verified evidence source/i);
});

test('production inspection proves health and build SHA from JSON rather than HTTP status alone', async () => {
  const expectedSha = 'abcdef1234567890abcdef1234567890abcdef12';
  const matched = await inspectProductionDeployment({
    productionOrigin: 'https://example.com',
    expectedSha,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ status: 'ok', buildSha: expectedSha }),
    }),
  });
  assert.equal(matched.healthy, true);
  assert.equal(matched.expectedRevisionDeployed, true);

  const noSha = await inspectProductionDeployment({
    productionOrigin: 'https://example.com',
    expectedSha,
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{"status":"ok"}' }),
  });
  assert.equal(noSha.healthy, true);
  assert.equal(noSha.expectedRevisionDeployed, false);
  assert.match(noSha.gap, /buildSha/);

  const unhealthy = await inspectProductionDeployment({
    productionOrigin: 'https://example.com',
    expectedSha,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ status: 'degraded', buildSha: expectedSha }),
    }),
  });
  assert.equal(unhealthy.healthy, false);
  assert.equal(unhealthy.expectedRevisionDeployed, false);
});

test('a caller cannot mark an unhealthy deployment as shipped with a matching flag alone', () => {
  const control = buildControl({
    externalCustomerAudit: revenueAudit(),
    deployment: { ...deployed, healthy: false, expectedRevisionDeployed: true },
  });
  assert.equal(control.milestones.targetWithCurrentControlDeployed.achieved, false);
  assert.equal(control.nextAction, RELEASE_APPROVAL);
});

test('Markdown output leads with the fail-closed verdict and one next action', () => {
  const control = buildControl({
    externalCustomerAudit: revenueAudit(),
    deployment: { ...deployed, expectedRevisionDeployed: false },
  });
  const markdown = renderMarkdown(control);
  assert.match(markdown, /Status: not_achieved/);
  assert.match(markdown, /Verdict: The \$1,000\/hour target is not verified/);
  assert.match(markdown, new RegExp(RELEASE_APPROVAL));
});
