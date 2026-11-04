'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateBusinessGoalContract,
  validateAgentRoles,
  computeUnitEconomicsWindow,
  diagnoseTargetGapAndRankInterventions,
  runControlledEndToEndLifecycleTest,
  evaluateComplexityGuillotine,
  runBusinessOsV4Doctor,
} = require('../scripts/business-os-v4');

test('validateBusinessGoalContract enforces all 13 required dimensions and cross-business isolation', () => {
  const doctor = runBusinessOsV4Doctor();
  assert.equal(doctor.verdict, 'PASS');
  assert.equal(doctor.contracts.thumbgate.valid, true);
  assert.equal(doctor.contracts.realestate.valid, true);
  assert.equal(doctor.contracts.isolated, true);

  const contaminated = validateBusinessGoalContract({
    business_id: 'thumbgate',
    business: { name: 'ThumbGate Florida Tax Deed Parcel Service' },
    customer: {},
    offer: {},
    revenue_target: {},
    profit_target: {},
    customer_target: {},
    acquisition: {},
    conversion: {},
    fulfillment: {},
    retention: {},
    constraints: {
      outbound_cash_spend_usd: 50,
      forbidden_topics: ['tax_deed'],
    },
    authority: {},
    measurement: {},
  });
  assert.equal(contaminated.valid, false);
  assert.ok(contaminated.crossBusinessViolations.includes('forbidden_topic_present:tax_deed'));
  assert.ok(contaminated.crossBusinessViolations.includes('outbound_cash_spend_exceeds_zero_mandate'));
});

test('validateAgentRoles verifies all 10 specialized v4.0 roles declare outcome, action, metric, and fallback', () => {
  const doctor = runBusinessOsV4Doctor();
  assert.equal(doctor.agentRoles.valid, true);
  assert.equal(doctor.agentRoles.roleCount, 10);
  assert.deepEqual(doctor.agentRoles.invalidRoles, []);
});

test('computeUnitEconomicsWindow calculates net settled revenue, contribution profit, and margin per 1k tokens', () => {
  const econ = computeUnitEconomicsWindow({
    window: '30d',
    settledReceiptsUsd: 548,
    refundsUsd: 0,
    chargebacksUsd: 0,
    adjustmentsUsd: 0,
    variableCostsUsd: 18.5,
    verifiedCustomerOutcomes: 2,
    attributableTokens: 250000,
  });
  assert.equal(econ.netSettledRevenueUsd, 548);
  assert.equal(econ.contributionProfitUsd, 529.5);
  assert.equal(econ.contributionMargin, 0.9662);
  assert.equal(econ.costPerSuccessfulCustomerOutcomeUsd, 9.25);
  assert.equal(econ.marginPer1kTokensUsd, 2.118);
});

test('diagnoseTargetGapAndRankInterventions identifies checkout_to_payment_conversion bottleneck when checkoutStarts > 0 and paidOrders == 0', () => {
  const diag = diagnoseTargetGapAndRankInterventions(
    { revenue_target: { monthly_usd: 3000 } },
    {
      settledExternalRevenue30dUsd: 0,
      pageViewsToday: 575,
      checkoutStartsToday: 32,
      paidOrdersToday: 0,
      unreconciledPaidEvents: 0,
    }
  );
  assert.equal(diag.behindTarget, true);
  assert.equal(diag.revenueGapUsd, 3000);
  assert.equal(diag.primaryBottleneck, 'checkout_to_payment_conversion');
  assert.ok(diag.rankedInterventions.length >= 3);
  assert.ok(diag.rankedInterventions[0].score >= diag.rankedInterventions[1].score);
});

test('runControlledEndToEndLifecycleTest enforces truthful revenue accounting until paymentVerified is true', () => {
  const offeredOnly = runControlledEndToEndLifecycleTest({
    leadId: 'lead_test_1',
    estimatedDealValueUsd: 499,
    outreachReceipt: '<msg@mx.google.com>',
    paymentVerified: false,
    fulfillmentVerified: false,
  });
  assert.equal(offeredOnly.currentState, 'OFFERED');
  assert.equal(offeredOnly.honestRevenueClaimedUsd, 0);

  const wonAndPaid = runControlledEndToEndLifecycleTest({
    leadId: 'lead_test_2',
    estimatedDealValueUsd: 499,
    outreachReceipt: '<msg2@mx.google.com>',
    paymentVerified: true,
    fulfillmentVerified: true,
  });
  assert.equal(wonAndPaid.currentState, 'WON');
  assert.equal(wonAndPaid.honestRevenueClaimedUsd, 499);
});

test('evaluateComplexityGuillotine preserves safety controls and guillotines negative-ROI bloat', () => {
  const decisions = evaluateComplexityGuillotine([
    { id: 'pretooluse_hmac_diode', incrementalValueUsd: 0, costUsd: 5, isSecurityOrSafetyControl: true },
    { id: 'unbounded_32b_llm_polling_loop', incrementalValueUsd: 10, costUsd: 150, isSecurityOrSafetyControl: false },
  ]);
  assert.equal(decisions[0].decision, 'KEEP');
  assert.equal(decisions[1].decision, 'GUILLOTINE_DOWNGRADE_TO_DETERMINISTIC');
});
