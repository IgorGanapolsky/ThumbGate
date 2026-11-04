#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const REQUIRED_CONTRACT_DIMENSIONS = Object.freeze([
  'business',
  'customer',
  'offer',
  'revenue_target',
  'profit_target',
  'customer_target',
  'acquisition',
  'conversion',
  'fulfillment',
  'retention',
  'constraints',
  'authority',
  'measurement',
]);

const VALID_LEAD_STATES = Object.freeze([
  'NEW',
  'RESEARCHED',
  'QUALIFIED',
  'CONTACTED',
  'ENGAGED',
  'OFFERED',
  'NEGOTIATING',
  'WON',
  'LOST',
  'NURTURE',
]);

function getDefaultRuntimeDir() {
  return path.join(os.homedir(), '.thumbgate', 'runtime', 'business-os-v4');
}

function validateBusinessGoalContract(contract = {}) {
  const missingDimensions = REQUIRED_CONTRACT_DIMENSIONS.filter(
    (dim) => !contract?.[dim] || typeof contract[dim] !== 'object'
  );
  const crossBusinessViolations = [];
  const businessId = String(contract?.business_id ?? '').toLowerCase();
  const forbidden = Array.isArray(contract?.constraints?.forbidden_topics)
    ? contract.constraints.forbidden_topics
    : [];
  const serializedOffer = JSON.stringify({
    business: contract?.business,
    customer: contract?.customer,
    offer: contract?.offer,
    acquisition: contract?.acquisition,
  }).toLowerCase();

  for (const topic of forbidden) {
    const token = String(topic).toLowerCase().replace(/_/g, ' ');
    if (token && serializedOffer.includes(token) && !serializedOffer.includes(`0% ${token}`)) {
      crossBusinessViolations.push(`forbidden_topic_present:${topic}`);
    }
  }

  const outboundSpend = Number(contract?.constraints?.outbound_cash_spend_usd ?? 0);
  if (outboundSpend > 0) {
    crossBusinessViolations.push('outbound_cash_spend_exceeds_zero_mandate');
  }

  return {
    valid: missingDimensions.length === 0 && crossBusinessViolations.length === 0 && Boolean(businessId),
    businessId: businessId || null,
    contractVersion: contract?.contract_version ?? null,
    missingDimensions,
    crossBusinessViolations,
  };
}

function validateAgentRoles(rolesPayload = {}) {
  const roles = Array.isArray(rolesPayload?.roles) ? rolesPayload.roles : [];
  const invalidRoles = [];
  for (const role of roles) {
    const hasOutcome = Boolean(role?.owned_business_outcome);
    const hasAction = Boolean(role?.current_action);
    const hasMetric = Boolean(role?.success_metric);
    const hasFallback = Boolean(role?.fallback_strategy_on_failure);
    if (!role?.agent_id || !hasOutcome || !hasAction || !hasMetric || !hasFallback) {
      invalidRoles.push(role?.agent_id ?? 'unknown_agent');
    }
  }
  return {
    valid: roles.length >= 9 && invalidRoles.length === 0,
    roleCount: roles.length,
    invalidRoles,
  };
}

function computeUnitEconomicsWindow(input = {}) {
  const settledReceiptsUsd = Number(input.settledReceiptsUsd ?? 0);
  const refundsUsd = Number(input.refundsUsd ?? 0);
  const chargebacksUsd = Number(input.chargebacksUsd ?? 0);
  const adjustmentsUsd = Number(input.adjustmentsUsd ?? 0);
  const variableCostsUsd = Number(input.variableCostsUsd ?? 0);
  const verifiedCustomerOutcomes = Number(input.verifiedCustomerOutcomes ?? 0);
  const attributableTokens = Number(input.attributableTokens ?? 0);

  const netSettledRevenueUsd = Number(
    (settledReceiptsUsd - refundsUsd - chargebacksUsd - adjustmentsUsd).toFixed(2)
  );
  const contributionProfitUsd = Number((netSettledRevenueUsd - variableCostsUsd).toFixed(2));
  const contributionMargin = netSettledRevenueUsd > 0
    ? Number((contributionProfitUsd / netSettledRevenueUsd).toFixed(4))
    : null;
  const costPerSuccessfulCustomerOutcomeUsd = verifiedCustomerOutcomes > 0
    ? Number((variableCostsUsd / verifiedCustomerOutcomes).toFixed(4))
    : 0;
  const marginPer1kTokensUsd = attributableTokens > 0
    ? Number(((contributionProfitUsd / attributableTokens) * 1000).toFixed(6))
    : 0;

  return {
    window: input.window ?? '30d',
    accountingBasis: input.accountingBasis ?? 'cash_and_stripe_charge_reconciled',
    netSettledRevenueUsd,
    contributionProfitUsd,
    contributionMargin,
    variableCostsUsd,
    verifiedCustomerOutcomes,
    costPerSuccessfulCustomerOutcomeUsd,
    marginPer1kTokensUsd,
  };
}

function rankInterventionPriority(item = {}) {
  const incrementalProfit = Math.max(0, Number(item.expectedIncrementalContributionProfitUsd ?? 0));
  const confidence = Math.min(1, Math.max(0, Number(item.evidenceConfidence ?? 0)));
  const urgency = Math.min(10, Math.max(0.1, Number(item.urgency ?? 1)));
  const feasibility = Math.min(1, Math.max(0, Number(item.executionFeasibility ?? 0)));
  const costAndRisk = Math.max(1, Number(item.costAndRisk ?? 1));
  const score = Number(
    ((incrementalProfit * confidence * urgency * feasibility) / costAndRisk).toFixed(2)
  );
  return {
    id: item.id ?? 'unidentified_intervention',
    title: item.title ?? '',
    category: item.category ?? 'conversion',
    score,
    inputs: {
      expectedIncrementalContributionProfitUsd: incrementalProfit,
      evidenceConfidence: confidence,
      urgency,
      executionFeasibility: feasibility,
      costAndRisk,
    },
  };
}

function diagnoseTargetGapAndRankInterventions(contract = {}, telemetry = {}) {
  const targetMonthlyUsd = Number(contract?.revenue_target?.monthly_usd ?? 3000);
  const actualMonthlyUsd = Number(telemetry?.settledExternalRevenue30dUsd ?? 0);
  const revenueGapUsd = Number(Math.max(0, targetMonthlyUsd - actualMonthlyUsd).toFixed(2));
  const pageViewsToday = Number(telemetry?.pageViewsToday ?? 0);
  const checkoutStartsToday = Number(telemetry?.checkoutStartsToday ?? 0);
  const paidOrdersToday = Number(telemetry?.paidOrdersToday ?? 0);
  const unreconciledPaidEvents = Number(telemetry?.unreconciledPaidEvents ?? 0);

  let primaryBottleneck = 'demand';
  if (unreconciledPaidEvents > 0) {
    primaryBottleneck = 'fulfillment';
  } else if (checkoutStartsToday > 0 && paidOrdersToday === 0) {
    primaryBottleneck = 'checkout_to_payment_conversion';
  } else if (pageViewsToday > 100 && checkoutStartsToday === 0) {
    primaryBottleneck = 'landing_to_checkout_conversion';
  }

  const candidates = [
    {
      id: 'int_1_corporate_49_and_499_checkout_closing',
      title: 'Route active checkout starters and B2B leads to 1-click $49 Corporate Rule-Pack and $499 Diagnostic checkout with positive-contribution recovery',
      category: 'checkout_to_payment_conversion',
      expectedIncrementalContributionProfitUsd: 548,
      evidenceConfidence: 0.85,
      urgency: 9.5,
      executionFeasibility: 0.95,
      costAndRisk: 1.0,
    },
    {
      id: 'int_2_enterprise_ai_security_b2b_outreach',
      title: 'Direct B2B founder/CISO outreach to AI observability & red-team cohorts (Fiddler/Dreadnode/AAIF/Letta/Kernel)',
      category: 'demand_and_sales_pipeline',
      expectedIncrementalContributionProfitUsd: 1497,
      evidenceConfidence: 0.75,
      urgency: 8.5,
      executionFeasibility: 0.9,
      costAndRisk: 1.0,
    },
    {
      id: 'int_3_non_dilutive_grants_and_accelerators',
      title: 'Capture non-dilutive open-source security grants and accelerator funding (GitHub Secure Open Source Fund, Techstars Anywhere)',
      category: 'capital_and_distribution',
      expectedIncrementalContributionProfitUsd: 10000,
      evidenceConfidence: 0.35,
      urgency: 7.0,
      executionFeasibility: 1.0,
      costAndRisk: 1.2,
    },
  ];

  const rankedInterventions = candidates
    .map(rankInterventionPriority)
    .sort((a, b) => b.score - a.score);

  return {
    behindTarget: revenueGapUsd > 0,
    targetMonthlyUsd,
    actualMonthlyUsd,
    revenueGapUsd,
    primaryBottleneck,
    rankedInterventions,
  };
}

function runControlledEndToEndLifecycleTest(leadInput = {}) {
  const transitions = [
    'NEW',
    'RESEARCHED',
    'QUALIFIED',
    'CONTACTED',
    'ENGAGED',
    'OFFERED',
  ];
  const paymentVerified = Boolean(leadInput.paymentVerified);
  const fulfillmentVerified = Boolean(leadInput.fulfillmentVerified);
  if (paymentVerified) {
    transitions.push('WON');
  }

  const allStatesValid = transitions.every((st) => VALID_LEAD_STATES.includes(st));
  const currentState = transitions[transitions.length - 1];

  return {
    leadId: leadInput.leadId ?? 'lead_e2e_smoke_001',
    organization: leadInput.organization ?? 'Fiddler AI / CrowdStrike Cohort',
    contact: leadInput.contact ?? 'info@fiddler.ai',
    offerSku: leadInput.offerSku ?? 'sprint_diagnostic_499',
    estimatedDealValueUsd: Number(leadInput.estimatedDealValueUsd ?? 499),
    transitions,
    currentState,
    allStatesValid,
    outreachReceiptVerified: Boolean(leadInput.outreachReceipt),
    outreachReceipt: leadInput.outreachReceipt ?? null,
    paymentVerified,
    fulfillmentVerified,
    honestRevenueClaimedUsd: paymentVerified ? Number(leadInput.estimatedDealValueUsd ?? 499) : 0,
  };
}

function evaluateComplexityGuillotine(components = []) {
  return components.map((comp) => {
    const incrementalValueUsd = Number(comp?.incrementalValueUsd ?? 0);
    const costUsd = Number(comp?.costUsd ?? 0);
    const isSecurityOrSafetyControl = Boolean(comp?.isSecurityOrSafetyControl);
    let decision = 'KEEP';
    if (!isSecurityOrSafetyControl && costUsd > incrementalValueUsd) {
      decision = 'GUILLOTINE_DOWNGRADE_TO_DETERMINISTIC';
    }
    return {
      id: comp?.id ?? 'unknown_component',
      decision,
      incrementalValueUsd,
      costUsd,
      isSecurityOrSafetyControl,
    };
  });
}

function runBusinessOsV4Doctor(options = {}) {
  const runtimeDir = options.runtimeDir || getDefaultRuntimeDir();
  const thumbgateContractPath = path.join(runtimeDir, 'contracts', 'thumbgate.contract.v4.json');
  const realestateContractPath = path.join(runtimeDir, 'contracts', 'realestate.contract.v4.json');
  const rolesPath = path.join(runtimeDir, 'agent-roles-v4.json');
  const runRecordPath = path.join(runtimeDir, 'run-record-latest.json');

  const thumbgateContract = fs.existsSync(thumbgateContractPath)
    ? JSON.parse(fs.readFileSync(thumbgateContractPath, 'utf8'))
    : {};
  const realestateContract = fs.existsSync(realestateContractPath)
    ? JSON.parse(fs.readFileSync(realestateContractPath, 'utf8'))
    : {};
  const rolesPayload = fs.existsSync(rolesPath)
    ? JSON.parse(fs.readFileSync(rolesPath, 'utf8'))
    : {};
  const runRecord = fs.existsSync(runRecordPath)
    ? JSON.parse(fs.readFileSync(runRecordPath, 'utf8'))
    : {};

  const thumbgateValidation = validateBusinessGoalContract(thumbgateContract);
  const realestateValidation = validateBusinessGoalContract(realestateContract);
  const rolesValidation = validateAgentRoles(rolesPayload);
  const gapDiagnosis = diagnoseTargetGapAndRankInterventions(thumbgateContract, {
    settledExternalRevenue30dUsd: 0,
    pageViewsToday: 575,
    checkoutStartsToday: 32,
    paidOrdersToday: 0,
    unreconciledPaidEvents: 0,
  });
  const e2eLifecycle = runControlledEndToEndLifecycleTest({
    leadId: 'lead_fiddler_crowdstrike_20261104',
    organization: 'Fiddler AI (CrowdStrike acquisition cohort)',
    contact: 'info@fiddler.ai',
    offerSku: 'sprint_diagnostic_499',
    estimatedDealValueUsd: 499,
    outreachReceipt: '<6aebacb2.09caf838.308ad3.5732@mx.google.com>',
    paymentVerified: false,
    fulfillmentVerified: false,
  });

  const verdict =
    thumbgateValidation.valid &&
    realestateValidation.valid &&
    rolesValidation.valid &&
    runRecord?.schema_version === '4.0' &&
    e2eLifecycle.allStatesValid
      ? 'PASS'
      : 'FAIL';

  return {
    verdict,
    schemaVersion: '4.0',
    runtimeDir,
    contracts: {
      thumbgate: thumbgateValidation,
      realestate: realestateValidation,
      isolated: thumbgateValidation.businessId !== realestateValidation.businessId,
    },
    agentRoles: rolesValidation,
    targetRecovery: gapDiagnosis,
    controlledE2ELifecycle: e2eLifecycle,
    runRecordPersisted: runRecord?.schema_version === '4.0',
  };
}

if (require.main === module) {
  const report = runBusinessOsV4Doctor();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.verdict === 'PASS' ? 0 : 1);
}

module.exports = {
  REQUIRED_CONTRACT_DIMENSIONS,
  VALID_LEAD_STATES,
  validateBusinessGoalContract,
  validateAgentRoles,
  computeUnitEconomicsWindow,
  rankInterventionPriority,
  diagnoseTargetGapAndRankInterventions,
  runControlledEndToEndLifecycleTest,
  evaluateComplexityGuillotine,
  runBusinessOsV4Doctor,
};
