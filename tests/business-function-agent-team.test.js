'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const {
  BUSINESS_FUNCTIONS,
  BUSINESS_FUNCTION_HANDOFF_EDGES,
  rankBusinessFunctionAgents,
  evaluateBusinessFunctionHandoff,
} = require('../scripts/agent-operations-planner');

function baseline(overrides = {}) {
  return {
    value: 12,
    unit: 'qualified_leads_per_month',
    measuredAt: '2026-08-01T00:00:00.000Z',
    source: 'crm-report-2026-08',
    ...overrides,
  };
}

function candidate(overrides = {}) {
  return {
    agentId: 'lead-pilot',
    functionId: 'lead_generation',
    objective: 'Increase qualified demo requests',
    primaryKpi: 'qualified_demo_requests',
    inputSource: 'consented inbound CRM records',
    baseline: baseline(),
    estimatedMonthlyValueUsd: 3000,
    recurringMonthlyCostUsd: 200,
    implementationCostUsd: 2000,
    implementationHours: 20,
    confidence: 0.5,
    risk: 'medium',
    evidence: ['campaign-replay-2026-07'],
    ...overrides,
  };
}

function objectSchema(properties) {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
  };
}

function validHandoff(overrides = {}) {
  return {
    workflowId: 'workflow-lead-to-sales-1',
    correlationId: 'prospect-42',
    fromFunction: 'lead_generation',
    toFunction: 'sales_conversion',
    objective: 'Book a qualified discovery call',
    primaryKpi: 'qualified_calls_booked',
    expectedOutcome: 'Qualified prospect accepted by sales',
    inputSchema: objectSchema({ prospectId: { type: 'string' } }),
    outputSchema: objectSchema({ qualificationStatus: { type: 'string' } }),
    dataScopes: ['crm:prospects:qualified'],
    containsPersonalData: true,
    consent: {
      verified: true,
      source: 'web-form-checkbox-v2',
      recordedAt: '2026-08-24T12:00:00.000Z',
    },
    qualificationEvidence: ['scorecard:prospect-42'],
    requestedActions: ['prepare discovery call brief'],
    budget: { estimatedCostUsd: 0.25, maxCostUsd: 1 },
    slaMinutes: 30,
    idempotencyKey: 'lead-to-sales:prospect-42:v1',
    requiredEvidence: ['qualification score', 'consent receipt'],
    ...overrides,
  };
}

test('catalog pins the six business functions and bounded default handoff graph', () => {
  assert.equal(BUSINESS_FUNCTIONS.length, 6);
  assert.deepEqual(
    BUSINESS_FUNCTIONS.map((entry) => entry.id),
    [
      'lead_generation',
      'content_creation',
      'product_validation',
      'marketing',
      'sales_conversion',
      'operations',
    ],
  );
  assert.ok(BUSINESS_FUNCTION_HANDOFF_EDGES.some((edge) => (
    edge.from === 'lead_generation' && edge.to === 'sales_conversion'
  )));
});

test('ranking returns insufficient evidence instead of inventing an ROI winner', () => {
  const report = rankBusinessFunctionAgents([
    candidate({ evidence: [], baseline: null }),
  ]);

  assert.equal(report.status, 'insufficient_evidence');
  assert.equal(report.recommendedPilot, null);
  assert.equal(report.evidenceCompleteCount, 0);
  assert.equal(report.candidates[0].rank, null);
  assert.ok(report.candidates[0].issues.includes('missing_measured_baseline'));
  assert.ok(report.candidates[0].issues.includes('missing_evidence'));
});

test('ranking uses transparent caller-supplied payback estimates', () => {
  const report = rankBusinessFunctionAgents([
    candidate(),
    candidate({
      agentId: 'operations-pilot',
      functionId: 'operations',
      objective: 'Reduce onboarding administration',
      primaryKpi: 'onboarding_hours',
      inputSource: 'completed onboarding tickets',
      baseline: baseline({ value: 40, unit: 'hours_per_month', source: 'ticket-audit-2026-08' }),
      estimatedMonthlyValueUsd: 1800,
      recurringMonthlyCostUsd: 100,
      implementationCostUsd: 850,
      implementationHours: 12,
      confidence: 0.75,
      risk: 'low',
      evidence: ['ticket-replay-2026-08'],
    }),
  ]);

  assert.equal(report.status, 'ranked_estimates');
  assert.equal(report.recommendedPilot, 'operations-pilot');
  assert.equal(report.candidates[0].estimates.expectedMonthlyNetValueUsd, 1250);
  assert.equal(report.candidates[0].estimates.paybackMonths, 0.68);
  assert.equal(report.methodology.estimated, true);
  assert.match(report.methodology.warning, /not achieved revenue/i);
  assert.equal(report.source.claimsVerifiedByThumbGate, false);
});

test('lead generation to sales fails closed without consent and qualification evidence', () => {
  const result = evaluateBusinessFunctionHandoff(validHandoff({
    consent: null,
    qualificationEvidence: [],
  }));

  assert.equal(result.decision, 'deny');
  assert.ok(result.issues.includes('personal_data_requires_verified_consent'));
  assert.ok(result.issues.includes('lead_to_sales_requires_qualification_evidence'));
  assert.ok(result.issues.includes('lead_to_sales_requires_verified_consent'));
  assert.equal(result.outcomeReceiptTemplate, null);
});

test('handoff requires explicit data classification and schema-required field integrity', () => {
  const result = evaluateBusinessFunctionHandoff(validHandoff({
    containsPersonalData: undefined,
    inputSchema: {
      type: 'object',
      properties: { prospectId: { type: 'string' } },
      required: ['missingField'],
    },
  }));

  assert.equal(result.decision, 'deny');
  assert.ok(result.issues.includes('missing_data_classification'));
  assert.ok(result.issues.includes('invalid_input_schema'));
});

test('handoff rejects undeclared edges, missing contracts, and cost overruns', () => {
  const result = evaluateBusinessFunctionHandoff(validHandoff({
    fromFunction: 'content_creation',
    toFunction: 'sales_conversion',
    correlationId: '',
    inputSchema: null,
    budget: { estimatedCostUsd: 10, maxCostUsd: 1 },
  }));

  assert.equal(result.decision, 'deny');
  assert.ok(result.issues.includes('undeclared_handoff_edge'));
  assert.ok(result.issues.includes('missing_correlation_id'));
  assert.ok(result.issues.includes('invalid_input_schema'));
  assert.ok(result.issues.includes('handoff_over_budget'));
});

test('external sales actions require an approval receipt', () => {
  const blocked = evaluateBusinessFunctionHandoff(validHandoff({
    requestedActions: ['send personalized sales email'],
  }));
  const allowed = evaluateBusinessFunctionHandoff(validHandoff({
    requestedActions: ['send personalized sales email'],
    approval: { status: 'approved', approvalId: 'approval-42' },
  }));

  assert.equal(blocked.decision, 'deny');
  assert.ok(blocked.issues.includes('external_action_requires_approval_receipt'));
  assert.equal(allowed.decision, 'allow');
});

test('complete handoff returns a deliberately unrecordable outcome template', () => {
  const result = evaluateBusinessFunctionHandoff(validHandoff());

  assert.equal(result.decision, 'allow');
  assert.deepEqual(result.issues, []);
  assert.equal(result.contract.contractVersion, 'business-function-handoff-v1');
  assert.equal(result.outcomeReceiptTemplate.recordable, false);
  assert.equal(result.outcomeReceiptTemplate.verificationState, 'not_run');
  assert.equal(result.outcomeReceiptTemplate.taskOutcome.status, null);
  assert.equal(result.outcomeReceiptTemplate.taskOutcome.businessOutcome, null);
  assert.equal(result.outcomeReceiptTemplate.taskOutcome.metadata.estimateOnly, true);
});

test('business-team CLI exposes the packaged planner without inventing a pilot', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/agent-operations-planner.js', 'business-team', '--json'],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
  const report = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(report.name, 'thumbgate-business-function-agent-team');
  assert.equal(report.catalog.functions.length, 6);
  assert.equal(report.ranking.status, 'insufficient_evidence');
  assert.equal(report.ranking.recommendedPilot, null);
});
