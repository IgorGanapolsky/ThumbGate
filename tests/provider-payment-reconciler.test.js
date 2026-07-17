const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  addSalesLead,
  loadSalesLeads,
  loadSalesLeadSnapshots,
  summarizeSalesPipeline,
} = require('../scripts/sales-pipeline');
const {
  isCliInvocation,
  parseArgs,
  reconcileProviderPayment,
  runCli,
} = require('../scripts/provider-payment-reconciler');
const { buildStripeIndividualPaymentEvidence } = require('../scripts/external-customer-audit');
const { digestBuyerEmail } = require('../scripts/provider-revenue-evidence');
const { OFFER_CATALOG } = require('../scripts/revenue-offer-system');

const PAYMENT_ID = '9AB12345CAPTURE';
const STRIPE_PAYMENT_ID = 'ch_thumbgate_verified';
const EVIDENCE_DIGEST = `sha256:${'a'.repeat(64)}`;
const REFRESHED_EVIDENCE_DIGEST = `sha256:${'b'.repeat(64)}`;
const BUYER_EMAIL = 'buyer@example.com';

function makeTempState() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-payment-reconcile-'));
  return path.join(tempDir, 'sales-pipeline.jsonl');
}

function addIntakeLead(statePath, leadId = 'qualified_buyer', offer = 'workflow_hardening_sprint') {
  return addSalesLead({
    leadId,
    source: 'direct',
    email: BUYER_EMAIL,
    stage: 'sprint_intake',
    offer,
    evidenceKind: 'intake_submission',
    evidenceSource: 'thumbgate_hosted',
    evidenceRef: `intake_${leadId}`,
  }, { statePath });
}

function verifiedPayment(overrides = {}) {
  return {
    provider: 'paypal',
    id: PAYMENT_ID,
    createdAt: '2026-07-16T12:00:00.000Z',
    status: 'partially_refunded',
    grossCents: 150000,
    refundedCents: 1000,
    netCents: 149000,
    currency: 'usd',
    customerId: 'sha256:private-customer-identifier',
    buyerEmailDigest: digestBuyerEmail(BUYER_EMAIL),
    customerClassification: 'external',
    ownerTest: false,
    productAttribution: { verified: true, product: 'thumbgate' },
    evidenceVerified: true,
    evidenceSource: 'provider_api_live:paypal-reconciliation:sha256:proof',
    evidenceDigest: EVIDENCE_DIGEST,
    invoiceId: 'thumbgate-invoice-2026-07',
    ...overrides,
  };
}

function auditWith(payments = [verifiedPayment()], overrides = {}) {
  return async () => ({
    provider: 'paypal',
    audited: true,
    generatedAt: '2026-07-16T13:00:00.000Z',
    individualPayments: payments,
    gap: 'Global revenue arithmetic remains incomplete.',
    ...overrides,
  });
}

function verifiedStripePayment(overrides = {}) {
  return verifiedPayment({
    provider: 'stripe',
    id: STRIPE_PAYMENT_ID,
    status: 'completed',
    grossCents: 150000,
    refundedCents: 0,
    netCents: 150000,
    evidenceSource: 'provider_api_live:stripe-checkout-product-reconciliation',
    evidenceDigest: `sha256:${'c'.repeat(64)}`,
    invoiceId: 'in_thumbgate_sprint_2026_07',
    offerIds: ['workflow_hardening_sprint'],
    ...overrides,
  });
}

function stripeAuditWith(payments = [verifiedStripePayment()], overrides = {}) {
  return async () => ({
    configured: true,
    generatedAt: '2026-07-16T13:00:00.000Z',
    productAttribution: {
      verified: true,
      thumbgate: {
        individualPayments: payments.filter((payment) => payment.netCents > 0),
        individualPaymentStates: payments,
      },
    },
    ...overrides,
  });
}

test('PayPal amount binding has one unique gross amount per supported payment identity', () => {
  const amounts = [
    OFFER_CATALOG.workflow_hardening_diagnostic.priceCents,
    OFFER_CATALOG.workflow_hardening_sprint.priceCents,
    OFFER_CATALOG.workflow_hardening_sprint.priceCents - OFFER_CATALOG.workflow_hardening_diagnostic.priceCents,
    OFFER_CATALOG.pro.priceCents,
    OFFER_CATALOG.pro.annualPriceCents,
    4900,
    OFFER_CATALOG.workflow_reliability_operations.priceCents,
    OFFER_CATALOG.enterprise_governance_pilot.priceCents,
    OFFER_CATALOG.enterprise_reliability_operations.priceCents,
  ];
  assert.equal(new Set(amounts).size, amounts.length);
});

test('reconciles an exact live PayPal payment into paid pipeline truth', async () => {
  const statePath = makeTempState();
  addIntakeLead(statePath);

  const receipt = await reconcileProviderPayment({
    leadId: 'qualified_buyer',
    paymentId: PAYMENT_ID,
  }, {
    statePath,
    auditPayPalLiveEvidence: auditWith(),
  });
  const lead = loadSalesLeads({ statePath })[0];
  const paymentEvidence = lead.history.at(-1).evidence;
  const summary = summarizeSalesPipeline([lead]);

  assert.deepEqual(receipt, {
    provider: 'paypal',
    paymentId: PAYMENT_ID,
    leadId: 'qualified_buyer',
    stage: 'paid',
    amountCents: 149000,
    currency: 'usd',
    offerId: 'workflow_hardening_sprint',
    evidenceDigest: EVIDENCE_DIGEST,
    unchanged: false,
    statePath,
  });
  assert.equal(lead.stage, 'paid');
  assert.equal(lead.revenue.amountCents, 149000);
  assert.equal(lead.revenue.paidAt, '2026-07-16T12:00:00.000Z');
  assert.deepEqual(paymentEvidence, {
    kind: 'provider_payment',
    provider: 'paypal',
    source: 'provider_api_live:paypal-reconciliation:sha256:proof',
    reference: PAYMENT_ID,
    verified: true,
    digest: EVIDENCE_DIGEST,
    invoiceId: 'thumbgate-invoice-2026-07',
    offerId: 'workflow_hardening_sprint',
    buyerDigest: digestBuyerEmail(BUYER_EMAIL),
  });
  assert.equal(summary.paid, 1);
  assert.equal(summary.bookedRevenueCents, 149000);
});

test('reconciles an exact live Stripe payment into the same provider-proof pipeline contract', async () => {
  const statePath = makeTempState();
  addIntakeLead(statePath, 'stripe_buyer');

  const receipt = await reconcileProviderPayment({
    leadId: 'stripe_buyer',
    paymentId: STRIPE_PAYMENT_ID,
    provider: 'stripe',
  }, {
    statePath,
    auditStripeLiveEvidence: stripeAuditWith(),
  });
  const lead = loadSalesLeads({ statePath })[0];
  const evidence = lead.history.at(-1).evidence;

  assert.equal(receipt.provider, 'stripe');
  assert.equal(receipt.stage, 'paid');
  assert.equal(receipt.amountCents, 150000);
  assert.equal(evidence.provider, 'stripe');
  assert.equal(evidence.reference, STRIPE_PAYMENT_ID);
  assert.equal(evidence.invoiceId, 'in_thumbgate_sprint_2026_07');
  assert.equal(evidence.offerId, 'workflow_hardening_sprint');
  assert.equal(evidence.verified, true);
});

test('Stripe refund re-verification lowers and then retires booked pipeline revenue', async () => {
  const statePath = makeTempState();
  addIntakeLead(statePath, 'stripe_refund_buyer');
  await reconcileProviderPayment({
    leadId: 'stripe_refund_buyer', paymentId: STRIPE_PAYMENT_ID, provider: 'stripe',
  }, { statePath, auditStripeLiveEvidence: stripeAuditWith() });

  await reconcileProviderPayment({
    leadId: 'stripe_refund_buyer', paymentId: STRIPE_PAYMENT_ID, provider: 'stripe',
  }, {
    statePath,
    auditStripeLiveEvidence: stripeAuditWith([verifiedStripePayment({
      status: 'partially_refunded',
      refundedCents: 50000,
      netCents: 100000,
      evidenceDigest: `sha256:${'d'.repeat(64)}`,
    })]),
  });
  const partial = loadSalesLeads({ statePath })[0];
  assert.equal(partial.stage, 'paid');
  assert.equal(partial.revenue.amountCents, 100000);

  await reconcileProviderPayment({
    leadId: 'stripe_refund_buyer', paymentId: STRIPE_PAYMENT_ID, provider: 'stripe',
  }, {
    statePath,
    auditStripeLiveEvidence: stripeAuditWith([verifiedStripePayment({
      status: 'refunded',
      refundedCents: 150000,
      netCents: 0,
      evidenceDigest: `sha256:${'e'.repeat(64)}`,
    })]),
  });
  const refunded = loadSalesLeads({ statePath })[0];
  assert.equal(refunded.stage, 'lost');
  assert.equal(refunded.revenue.amountCents, 0);
  assert.equal(refunded.history.at(-1).evidence.provider, 'stripe');
  assert.equal(refunded.history.at(-1).evidence.kind, 'provider_refund');
});

test('exact offer binding rejects a Pro payment for a sprint lead without mutating state', async () => {
  const statePath = makeTempState();
  addIntakeLead(statePath, 'mismatched_buyer');
  const before = fs.readFileSync(statePath, 'utf8');

  await assert.rejects(
    reconcileProviderPayment({
      leadId: 'mismatched_buyer', paymentId: STRIPE_PAYMENT_ID, provider: 'stripe',
    }, {
      statePath,
      auditStripeLiveEvidence: stripeAuditWith([verifiedStripePayment({
        grossCents: 1900,
        netCents: 1900,
        offerIds: ['pro_monthly'],
      })]),
    }),
    /is for pro_monthly, not workflow_hardening_sprint/
  );
  assert.equal(fs.readFileSync(statePath, 'utf8'), before);
});

test('Stripe reconciliation fails closed when exact catalog offer evidence is absent', async () => {
  const statePath = makeTempState();
  addIntakeLead(statePath, 'unbound_stripe_buyer');
  const before = fs.readFileSync(statePath, 'utf8');

  await assert.rejects(
    reconcileProviderPayment({
      leadId: 'unbound_stripe_buyer', paymentId: STRIPE_PAYMENT_ID, provider: 'stripe',
    }, {
      statePath,
      auditStripeLiveEvidence: stripeAuditWith([verifiedStripePayment({ offerIds: [] })]),
    }),
    /requires one catalog offer ID/
  );
  assert.equal(fs.readFileSync(statePath, 'utf8'), before);
});

test('Stripe reconciliation rejects a multi-offer payment even when one offer matches', async () => {
  const statePath = makeTempState();
  addIntakeLead(statePath, 'multi_offer_buyer');
  const before = fs.readFileSync(statePath, 'utf8');

  await assert.rejects(
    reconcileProviderPayment({
      leadId: 'multi_offer_buyer', paymentId: STRIPE_PAYMENT_ID, provider: 'stripe',
    }, {
      statePath,
      auditStripeLiveEvidence: stripeAuditWith([verifiedStripePayment({
        offerIds: ['workflow_hardening_sprint', 'pro_monthly'],
      })]),
    }),
    /requires one catalog offer ID/
  );
  assert.equal(fs.readFileSync(statePath, 'utf8'), before);
});

test('PayPal reconciliation binds immutable gross amount to the lead offer', async () => {
  const statePath = makeTempState();
  addIntakeLead(statePath, 'wrong_amount_buyer');
  const before = fs.readFileSync(statePath, 'utf8');

  await assert.rejects(
    reconcileProviderPayment({ leadId: 'wrong_amount_buyer', paymentId: PAYMENT_ID }, {
      statePath,
      auditPayPalLiveEvidence: auditWith([verifiedPayment({
        status: 'completed',
        grossCents: 49900,
        refundedCents: 0,
        netCents: 49900,
      })]),
    }),
    /is for workflow_hardening_diagnostic, not workflow_hardening_sprint/
  );
  assert.equal(fs.readFileSync(statePath, 'utf8'), before);
});

test('exact offer binding accepts the public Pro monthly Stripe identity for a self-serve lead', async () => {
  const statePath = makeTempState();
  addIntakeLead(statePath, 'pro_buyer', 'pro_self_serve');

  const receipt = await reconcileProviderPayment({
    leadId: 'pro_buyer', paymentId: STRIPE_PAYMENT_ID, provider: 'stripe',
  }, {
    statePath,
    auditStripeLiveEvidence: stripeAuditWith([verifiedStripePayment({
      grossCents: 1900,
      netCents: 1900,
      offerIds: ['pro_monthly'],
    })]),
  });
  const lead = loadSalesLeads({ statePath })[0];

  assert.equal(receipt.offerId, 'pro_monthly');
  assert.equal(receipt.amountCents, 1900);
  assert.equal(lead.history.at(-1).evidence.offerId, 'pro_monthly');
});

test('live Stripe individual-payment evidence carries currency through reconciliation', async () => {
  const statePath = makeTempState();
  addIntakeLead(statePath, 'live_stripe_buyer');
  const evidence = buildStripeIndividualPaymentEvidence([{
    id: STRIPE_PAYMENT_ID,
    created: Math.floor(new Date('2026-07-16T12:00:00.000Z').getTime() / 1000),
    amount: 150000,
    amount_refunded: 0,
    currency: 'usd',
    billing_details: { email: BUYER_EMAIL },
    payment_intent: 'pi_thumbgate_sprint',
  }], new Map([[STRIPE_PAYMENT_ID, {
    sessionIds: ['cs_thumbgate_sprint'],
    productIds: ['prod_thumbgate_sprint'],
    priceIds: ['price_thumbgate_sprint'],
    offerIds: ['workflow_hardening_sprint'],
  }]]), { now: '2026-07-16T13:00:00.000Z' });

  assert.equal(evidence.verified, true);
  assert.equal(evidence.states[0].currency, 'usd');
  const receipt = await reconcileProviderPayment({
    leadId: 'live_stripe_buyer', paymentId: STRIPE_PAYMENT_ID, provider: 'stripe',
  }, {
    statePath,
    auditStripeLiveEvidence: async () => ({
      configured: true,
      generatedAt: '2026-07-16T13:00:00.000Z',
      productAttribution: { verified: true, thumbgate: { individualPaymentStates: evidence.states } },
    }),
  });

  assert.equal(receipt.stage, 'paid');
  assert.equal(receipt.offerId, 'workflow_hardening_sprint');
});

test('exact offer binding accepts the legacy diagnostic lead alias at the current fixed price', async () => {
  const statePath = makeTempState();
  addIntakeLead(statePath, 'diagnostic_buyer', 'workflow_diagnostic');

  const receipt = await reconcileProviderPayment({ leadId: 'diagnostic_buyer', paymentId: PAYMENT_ID }, {
    statePath,
    auditPayPalLiveEvidence: auditWith([verifiedPayment({
      status: 'completed',
      grossCents: 49900,
      refundedCents: 0,
      netCents: 49900,
    })]),
  });

  assert.equal(receipt.offerId, 'workflow_hardening_diagnostic');
  assert.equal(receipt.amountCents, 49900);
});

test('unknown payment amounts and unregistered lead offers both fail closed', async (t) => {
  await t.test('unknown amount', async () => {
    const statePath = makeTempState();
    addIntakeLead(statePath, 'unknown_amount_buyer');
    const before = fs.readFileSync(statePath, 'utf8');
    await assert.rejects(
      reconcileProviderPayment({ leadId: 'unknown_amount_buyer', paymentId: PAYMENT_ID }, {
        statePath,
        auditPayPalLiveEvidence: auditWith([verifiedPayment({
          status: 'completed', grossCents: 12345, refundedCents: 0, netCents: 12345,
        })]),
      }),
      /amount has no exact ThumbGate offer/
    );
    assert.equal(fs.readFileSync(statePath, 'utf8'), before);
  });

  await t.test('unregistered lead offer', async () => {
    const statePath = makeTempState();
    addIntakeLead(statePath, 'custom_offer_buyer', 'partner_integration');
    const before = fs.readFileSync(statePath, 'utf8');
    await assert.rejects(
      reconcileProviderPayment({ leadId: 'custom_offer_buyer', paymentId: PAYMENT_ID }, {
        statePath,
        auditPayPalLiveEvidence: auditWith([verifiedPayment()]),
      }),
      /not partner_integration/
    );
    assert.equal(fs.readFileSync(statePath, 'utf8'), before);
  });
});

test('PayPal exact offer metadata must agree with the immutable gross amount', async () => {
  const statePath = makeTempState();
  addIntakeLead(statePath, 'paypal_offer_collision');
  const before = fs.readFileSync(statePath, 'utf8');

  await assert.rejects(
    reconcileProviderPayment({ leadId: 'paypal_offer_collision', paymentId: PAYMENT_ID }, {
      statePath,
      auditPayPalLiveEvidence: auditWith([verifiedPayment({ offerIds: ['pro_monthly'] })]),
    }),
    /offer disagrees with amount/
  );
  assert.equal(fs.readFileSync(statePath, 'utf8'), before);
});

test('a same-offer payment cannot be assigned to a different buyer lead', async () => {
  const statePath = makeTempState();
  addSalesLead({
    leadId: 'different_buyer',
    source: 'direct',
    email: 'different@example.com',
    offer: 'workflow_hardening_sprint',
    stage: 'sprint_intake',
    evidenceKind: 'intake_submission',
    evidenceSource: 'thumbgate_hosted',
    evidenceRef: 'intake_different_buyer',
  }, { statePath });
  const before = fs.readFileSync(statePath, 'utf8');

  await assert.rejects(
    reconcileProviderPayment({ leadId: 'different_buyer', paymentId: PAYMENT_ID }, {
      statePath,
      auditPayPalLiveEvidence: auditWith(),
    }),
    /buyer does not match lead different_buyer/
  );
  assert.equal(fs.readFileSync(statePath, 'utf8'), before);
});

test('duplicate reconciliation is idempotent after re-verifying the provider payment with a refreshed audit digest', async () => {
  const statePath = makeTempState();
  addIntakeLead(statePath);
  let auditCalls = 0;
  const audit = async () => {
    auditCalls += 1;
    return auditWith([
      verifiedPayment({
        evidenceDigest: auditCalls === 1 ? EVIDENCE_DIGEST : REFRESHED_EVIDENCE_DIGEST,
      }),
    ])();
  };

  await reconcileProviderPayment({ leadId: 'qualified_buyer', paymentId: PAYMENT_ID }, {
    statePath,
    auditPayPalLiveEvidence: audit,
  });
  const before = fs.readFileSync(statePath, 'utf8');
  const receipt = await reconcileProviderPayment({ leadId: 'qualified_buyer', paymentId: PAYMENT_ID }, {
    statePath,
    auditPayPalLiveEvidence: audit,
  });

  assert.equal(auditCalls, 2);
  assert.equal(receipt.unchanged, true);
  assert.equal(receipt.evidenceDigest, EVIDENCE_DIGEST);
  assert.equal(receipt.reverifiedEvidenceDigest, REFRESHED_EVIDENCE_DIGEST);
  assert.equal(loadSalesLeadSnapshots({ statePath }).length, 2);
  assert.equal(fs.readFileSync(statePath, 'utf8'), before);
});

test('re-reconciliation upgrades legacy paid evidence with buyer and offer binding', async () => {
  const statePath = makeTempState();
  addIntakeLead(statePath);
  await reconcileProviderPayment({ leadId: 'qualified_buyer', paymentId: PAYMENT_ID }, {
    statePath,
    auditPayPalLiveEvidence: auditWith(),
  });

  const snapshots = fs.readFileSync(statePath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const legacyPaid = snapshots.at(-1);
  delete legacyPaid.history.at(-1).evidence.offerId;
  delete legacyPaid.history.at(-1).evidence.buyerDigest;
  fs.writeFileSync(statePath, `${snapshots.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  assert.equal(summarizeSalesPipeline(loadSalesLeads({ statePath })).verifiedByStage.paid, 0);

  const receipt = await reconcileProviderPayment({ leadId: 'qualified_buyer', paymentId: PAYMENT_ID }, {
    statePath,
    auditPayPalLiveEvidence: auditWith([verifiedPayment({ evidenceDigest: REFRESHED_EVIDENCE_DIGEST })]),
  });
  const lead = loadSalesLeads({ statePath })[0];

  assert.equal(receipt.unchanged, false);
  assert.equal(lead.revenue.amountCents, 149000);
  assert.equal(lead.history.at(-1).evidence.offerId, 'workflow_hardening_sprint');
  assert.equal(lead.history.at(-1).evidence.buyerDigest, digestBuyerEmail(BUYER_EMAIL));
  assert.match(lead.history.at(-1).note, /binding added/i);
  assert.equal(summarizeSalesPipeline([lead]).verifiedByStage.paid, 1);
});

test('partial refunds update the booked amount after live re-verification', async () => {
  const statePath = makeTempState();
  addIntakeLead(statePath);
  await reconcileProviderPayment({ leadId: 'qualified_buyer', paymentId: PAYMENT_ID }, {
    statePath,
    auditPayPalLiveEvidence: auditWith(),
  });

  const receipt = await reconcileProviderPayment({ leadId: 'qualified_buyer', paymentId: PAYMENT_ID }, {
    statePath,
    auditPayPalLiveEvidence: auditWith([
      verifiedPayment({
        refundedCents: 50000,
        netCents: 100000,
        evidenceDigest: REFRESHED_EVIDENCE_DIGEST,
      }),
    ]),
  });
  const lead = loadSalesLeads({ statePath })[0];

  assert.equal(receipt.unchanged, false);
  assert.equal(receipt.amountCents, 100000);
  assert.equal(lead.stage, 'paid');
  assert.equal(lead.revenue.amountCents, 100000);
  assert.equal(lead.revenue.paidAt, '2026-07-16T12:00:00.000Z');
  assert.equal(lead.history.at(-1).at, '2026-07-16T13:00:00.000Z');
  assert.equal(lead.history.at(-1).evidence.digest, REFRESHED_EVIDENCE_DIGEST);
  assert.equal(summarizeSalesPipeline([lead]).bookedRevenueCents, 100000);
});

test('full refunds retire paid pipeline revenue and remain idempotent', async () => {
  const statePath = makeTempState();
  addIntakeLead(statePath);
  await reconcileProviderPayment({ leadId: 'qualified_buyer', paymentId: PAYMENT_ID }, {
    statePath,
    auditPayPalLiveEvidence: auditWith(),
  });
  const refundedPayment = verifiedPayment({
    status: 'refunded',
    refundedCents: 150000,
    netCents: 0,
    evidenceDigest: REFRESHED_EVIDENCE_DIGEST,
  });
  const refundedAudit = async () => ({
    provider: 'paypal',
    audited: true,
    generatedAt: '2026-07-16T14:00:00.000Z',
    individualPayments: [],
    individualPaymentStates: [refundedPayment],
    gap: 'Global revenue arithmetic remains incomplete.',
  });

  const receipt = await reconcileProviderPayment({ leadId: 'qualified_buyer', paymentId: PAYMENT_ID }, {
    statePath,
    auditPayPalLiveEvidence: refundedAudit,
  });
  const beforeRepeat = fs.readFileSync(statePath, 'utf8');
  const repeated = await reconcileProviderPayment({ leadId: 'qualified_buyer', paymentId: PAYMENT_ID }, {
    statePath,
    auditPayPalLiveEvidence: refundedAudit,
  });
  const lead = loadSalesLeads({ statePath })[0];
  const summary = summarizeSalesPipeline([lead]);

  assert.equal(receipt.stage, 'lost');
  assert.equal(receipt.amountCents, 0);
  assert.equal(receipt.unchanged, false);
  assert.equal(repeated.unchanged, true);
  assert.equal(fs.readFileSync(statePath, 'utf8'), beforeRepeat);
  assert.equal(lead.history.at(-1).evidence.kind, 'provider_refund');
  assert.equal(lead.history.at(-1).at, '2026-07-16T14:00:00.000Z');
  assert.equal(summary.paid, 0);
  assert.equal(summary.bookedRevenueCents, 0);
});

test('a fully refunded payment cannot create a new paid or lost record', async () => {
  const statePath = makeTempState();
  addIntakeLead(statePath);
  const before = fs.readFileSync(statePath, 'utf8');
  await assert.rejects(
    reconcileProviderPayment({ leadId: 'qualified_buyer', paymentId: PAYMENT_ID }, {
      statePath,
      auditPayPalLiveEvidence: async () => ({
        individualPaymentStates: [verifiedPayment({
          status: 'refunded',
          refundedCents: 150000,
          netCents: 0,
        })],
      }),
    }),
    /cannot create a new paid pipeline record/
  );
  assert.equal(fs.readFileSync(statePath, 'utf8'), before);
});

test('missing, unverified, malformed, zero-net, or unattributed payments fail closed', async (t) => {
  const cases = [
    ['missing', [], /did not verify payment/],
    ['unverified', [verifiedPayment({ evidenceVerified: false })], /malformed or lacks verified/],
    ['bad source', [verifiedPayment({ evidenceSource: 'paypal' })], /malformed or lacks verified/],
    ['bad digest', [verifiedPayment({ evidenceDigest: 'sha256:not-real' })], /malformed or lacks verified/],
    ['wrong currency', [verifiedPayment({ currency: 'eur' })], /malformed or lacks verified/],
    ['missing buyer binding', [verifiedPayment({ buyerEmailDigest: null })], /malformed or lacks verified/],
    ['zero net', [verifiedPayment({ netCents: 0 })], /malformed or lacks verified/],
    ['owner test', [verifiedPayment({ customerClassification: 'owner_test', ownerTest: true })], /malformed or lacks verified/],
    ['unattributed', [verifiedPayment({ productAttribution: { verified: false, product: 'thumbgate' } })], /malformed or lacks verified/],
    ['future dated', [verifiedPayment({ createdAt: '2026-07-16T13:05:00.001Z' })], /malformed or lacks verified/],
  ];

  for (const [name, payments, expected] of cases) {
    await t.test(name, async () => {
      const statePath = makeTempState();
      addIntakeLead(statePath);
      const before = fs.readFileSync(statePath, 'utf8');
      await assert.rejects(
        reconcileProviderPayment({ leadId: 'qualified_buyer', paymentId: PAYMENT_ID }, {
          statePath,
          auditPayPalLiveEvidence: auditWith(payments),
        }),
        expected
      );
      assert.equal(fs.readFileSync(statePath, 'utf8'), before);
    });
  }
});

test('provider audit gaps fail closed without mutating pipeline state', async () => {
  const statePath = makeTempState();
  addIntakeLead(statePath);
  const before = fs.readFileSync(statePath, 'utf8');

  await assert.rejects(
    reconcileProviderPayment({ leadId: 'qualified_buyer', paymentId: PAYMENT_ID }, {
      statePath,
      auditPayPalLiveEvidence: auditWith([], {
        audited: false,
        gap: 'PayPal direct audit is not configured.',
      }),
    }),
    /PayPal direct audit is not configured/
  );
  assert.equal(fs.readFileSync(statePath, 'utf8'), before);
});

test('the same live payment cannot be credited to two sales leads even when the live audit digest changes', async () => {
  const statePath = makeTempState();
  addIntakeLead(statePath, 'buyer_one');
  addIntakeLead(statePath, 'buyer_two');

  await reconcileProviderPayment({ leadId: 'buyer_one', paymentId: PAYMENT_ID }, {
    statePath,
    auditPayPalLiveEvidence: auditWith(),
  });
  const before = fs.readFileSync(statePath, 'utf8');
  await assert.rejects(
    reconcileProviderPayment({ leadId: 'buyer_two', paymentId: PAYMENT_ID }, {
      statePath,
      auditPayPalLiveEvidence: auditWith([
        verifiedPayment({ evidenceDigest: REFRESHED_EVIDENCE_DIGEST }),
      ]),
    }),
    /already attributed to another sales lead/
  );
  assert.equal(fs.readFileSync(statePath, 'utf8'), before);
});

test('concurrent reconciliation cannot credit one payment to two leads', async () => {
  const statePath = makeTempState();
  addIntakeLead(statePath, 'buyer_one');
  addIntakeLead(statePath, 'buyer_two');
  const results = await Promise.allSettled([
    reconcileProviderPayment({ leadId: 'buyer_one', paymentId: PAYMENT_ID }, {
      statePath,
      auditPayPalLiveEvidence: auditWith(),
    }),
    reconcileProviderPayment({ leadId: 'buyer_two', paymentId: PAYMENT_ID }, {
      statePath,
      auditPayPalLiveEvidence: auditWith(),
    }),
  ]);
  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter((result) => result.status === 'rejected');
  const summary = summarizeSalesPipeline(loadSalesLeads({ statePath }));

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason.message, /already attributed to another sales lead/);
  assert.equal(summary.paid, 1);
  assert.equal(summary.bookedRevenueCents, 149000);
  assert.equal(fs.existsSync(`${statePath}.reconcile.lock`), false);
});

test('force supports a direct self-serve buyer only after live provider verification', async () => {
  const statePath = makeTempState();
  addSalesLead({ leadId: 'direct_buyer', source: 'direct', email: BUYER_EMAIL }, { statePath });

  const receipt = await reconcileProviderPayment({
    leadId: 'direct_buyer',
    paymentId: PAYMENT_ID,
    force: true,
  }, {
    statePath,
    auditPayPalLiveEvidence: auditWith(),
  });
  const summary = summarizeSalesPipeline(loadSalesLeads({ statePath }));

  assert.equal(receipt.stage, 'paid');
  assert.equal(summary.contacted, 0);
  assert.equal(summary.replies, 0);
  assert.equal(summary.callsBooked, 0);
  assert.equal(summary.paid, 1);
});

test('CLI receipt exposes proof metadata but never payer identity', async () => {
  const statePath = makeTempState();
  addIntakeLead(statePath);

  assert.deepEqual(parseArgs(['--lead', 'qualified_buyer', '--payment=abc', '--force']), {
    lead: 'qualified_buyer',
    payment: 'abc',
    force: true,
  });
  const receipt = await runCli([
    '--state', statePath,
    '--lead', 'qualified_buyer',
    '--payment', PAYMENT_ID,
  ], {
    auditPayPalLiveEvidence: auditWith(),
  });
  const serialized = JSON.stringify(receipt);

  assert.equal(receipt.stage, 'paid');
  assert.doesNotMatch(serialized, /customerId|private-customer-identifier|payer|email/i);
});

test('unsupported providers and missing required arguments are rejected', async () => {
  const statePath = makeTempState();
  addIntakeLead(statePath);

  await assert.rejects(
    reconcileProviderPayment({ leadId: 'qualified_buyer', paymentId: PAYMENT_ID, provider: 'square' }, { statePath }),
    /provider must be one of: paypal, stripe/
  );
  await assert.rejects(reconcileProviderPayment({ paymentId: PAYMENT_ID }, { statePath }), /leadId is required/);
  await assert.rejects(reconcileProviderPayment({ leadId: 'qualified_buyer' }, { statePath }), /paymentId is required/);
});

test('CLI invocation detection resolves symlinked paths', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-reconciler-link-'));
  const symlinkPath = path.join(tempDir, 'provider-payment-reconciler-link.js');
  fs.symlinkSync(require.resolve('../scripts/provider-payment-reconciler'), symlinkPath);

  assert.equal(isCliInvocation(['node', symlinkPath]), true);
  assert.equal(isCliInvocation(['node', __filename]), false);
});
