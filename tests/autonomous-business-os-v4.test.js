'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  SCHEMA_VERSION,
  OPERATING_CYCLE_STAGES,
  OBJECTIVE_PRIORITY_HIERARCHY,
  LEAD_LIFECYCLE_STATES,
  SPECIALIZED_BUSINESS_AGENTS,
  getBusinessGoalContract,
  diagnoseReflectionMonetizeZeroRevenue,
  discoverRealExternalLeadsFromDisk,
  reconcileFinancialWindows,
  rankCommercialOpportunities,
  evaluateComplexityGuillotine,
  executeAutonomousBusinessOsV4Run,
} = require('../scripts/autonomous-business-os-v4');

const {
  runReflectionMonetizeEngine,
} = require('../scripts/fast-money-engine');

test('Autonomous Business OS v4.0 — operating constitution constants and 9-agent + Captain organization', () => {
  assert.equal(SCHEMA_VERSION, '4.0');
  assert.deepEqual(OPERATING_CYCLE_STAGES, [
    'DISCOVER',
    'UNDERSTAND',
    'STRATEGIZE',
    'PRIORITIZE',
    'EXECUTE',
    'SELL',
    'FULFILL',
    'MEASURE',
    'RECOVER',
    'IMPROVE',
    'SCALE',
  ]);
  assert.equal(OBJECTIVE_PRIORITY_HIERARCHY.length, 9);
  assert.equal(OBJECTIVE_PRIORITY_HIERARCHY[0].id, 'protect_customers_data_security');
  assert.equal(LEAD_LIFECYCLE_STATES.includes('QUALIFIED'), true);
  assert.equal(LEAD_LIFECYCLE_STATES.includes('WON'), true);

  assert.equal(SPECIALIZED_BUSINESS_AGENTS.length, 10);
  const captain = SPECIALIZED_BUSINESS_AGENTS.find((a) => a.id === 'business_captain');
  assert.ok(captain);
  for (const agent of SPECIALIZED_BUSINESS_AGENTS) {
    assert.ok(agent.ownedOutcome.length > 10);
    assert.ok(agent.successMetric.length > 5);
    assert.ok(agent.fallbackStrategy.length > 10);
  }
});

test('Autonomous Business OS v4.0 — multi-business Goal Contract isolation', () => {
  const tgContract = getBusinessGoalContract('thumbgate');
  assert.equal(tgContract.businessId, 'thumbgate');
  assert.equal(tgContract.contractVersion, '4.0.0');
  assert.equal(tgContract.constraints.outboundAdSpendUsd, 0);
  assert.equal(tgContract.constraints.excludeOwnerAndTestCharges, true);

  const customContract = getBusinessGoalContract('dayglass', {
    revenueTargets: { dailyUsd: 100, weeklyUsd: 700, monthlyUsd: 3000, annualUsd: 36000 },
  });
  assert.equal(customContract.businessId, 'dayglass');
  assert.equal(customContract.revenueTargets.monthlyUsd, 3000);
});

test('Autonomous Business OS v4.0 — diagnoseReflectionMonetizeZeroRevenue identifies all 4 controllable root causes', () => {
  const diag = diagnoseReflectionMonetizeZeroRevenue({
    visitors30d: 3965,
    ctaClicks30d: 275,
    socialClicks30d: 0,
    checkoutStarts30d: 140,
    cancelViews30d: 41,
    paidConfirmations30d: 0,
  });

  assert.equal(diag.rootCauses.length, 4);
  const ids = diag.rootCauses.map((rc) => rc.id);
  assert.deepEqual(ids, [
    'RC1_PASSIVE_LOCAL_CLI_NO_OUTBOUND_DISPATCH',
    'RC2_ZERO_SOCIAL_CLICKS_AND_PROBE_DILUTION',
    'RC3_UNRECOVERABLE_STRIPE_CANCEL_BOUNCES',
    'RC4_HARDCODED_SYNTHETIC_CANDIDATE_EMAILS',
  ]);
  for (const rc of diag.rootCauses) {
    assert.equal(rc.evidenceStatus, 'VERIFIED');
    assert.ok(rc.correctiveIntervention.length > 20);
  }
});

test('Autonomous Business OS v4.0 — discoverRealExternalLeadsFromDisk extracts real buyers and filters synthetic/owner emails', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-v4-leads-'));
  try {
    const leadsFile = path.join(tmpDir, 'workflow-sprint-leads.jsonl');
    const rows = [
      JSON.stringify({ email: 'buyer@acme.com', timestamp: '2026-11-04T00:00:00Z' }),
      JSON.stringify({ email: 'iganapolsky@gmail.com', timestamp: '2026-11-04T00:01:00Z' }),
      JSON.stringify({ email: 'vp-eng@fintech-corp.io', timestamp: '2026-11-04T00:02:00Z' }),
      JSON.stringify({ customerEmail: 'staff.ai@cloudscale.dev', timestamp: '2026-11-04T00:03:00Z' }),
    ];
    fs.writeFileSync(leadsFile, `${rows.join('\n')}\n`, 'utf8');

    const discovered = discoverRealExternalLeadsFromDisk(tmpDir);
    assert.equal(discovered.length, 2);
    assert.deepEqual(
      discovered.map((d) => d.email),
      ['vp-eng@fintech-corp.io', 'staff.ai@cloudscale.dev']
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Autonomous Business OS v4.0 — 7d / 30d / 90d financial truth reconciliation & unit economics', () => {
  const finZero = reconcileFinancialWindows({
    settledRevenue7dUsd: 0,
    settledRevenue30dUsd: 0,
    settledRevenue90dUsd: 0,
  });
  assert.equal(finZero.windows['7d'].netSettledRevenueUsd, 0);
  assert.equal(finZero.windows['30d'].netSettledRevenueUsd, 0);
  assert.equal(finZero.windows['90d'].netSettledRevenueUsd, 0);
  assert.equal(finZero.windows['30d'].contributionMargin, null);

  const finPaid = reconcileFinancialWindows({
    settledRevenue30dUsd: 49,
  });
  assert.equal(finPaid.windows['30d'].grossCapturedRevenueUsd, 49);
  assert.equal(finPaid.windows['30d'].processorFeesUsd, 1.72);
  assert.equal(finPaid.windows['30d'].netSettledRevenueUsd, 47.28);
  assert.equal(finPaid.windows['30d'].contributionProfitUsd, 47.28);
  assert.equal(finPaid.windows['30d'].contributionMargin, 1);
});

test('Autonomous Business OS v4.0 — opportunity ranking and Complexity Guillotine', () => {
  const ranked = rankCommercialOpportunities([
    {
      opportunityId: 'low',
      expectedIncrementalProfit30dUsd: 50,
      evidenceConfidence: 0.5,
      urgency: 0.5,
      executionFeasibility: 0.5,
      costAndRiskScore: 2.0,
    },
    {
      opportunityId: 'high',
      expectedIncrementalProfit30dUsd: 500,
      evidenceConfidence: 0.9,
      urgency: 1.0,
      executionFeasibility: 0.9,
      costAndRiskScore: 0.5,
    },
  ]);
  assert.equal(ranked[0].opportunityId, 'high');
  assert.equal(ranked[0].rank, 1);
  assert.ok(ranked[0].priorityScore > ranked[1].priorityScore);

  const guillotine = evaluateComplexityGuillotine();
  assert.equal(guillotine.length, 3);
  assert.equal(guillotine[0].decision, 'GUILLOTINE_TO_DETERMINISTIC_CODE');
});

test('Autonomous Business OS v4.0 — executeAutonomousBusinessOsV4Run persists schema_version 4.0 run record & integrates with runReflectionMonetizeEngine', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-v4-run-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, 'workflow-sprint-leads.jsonl'),
      `${JSON.stringify({ email: 'cto@enterprise-ai.org', timestamp: '2026-11-04T12:00:00Z' })}\n`,
      'utf8'
    );

    const record = executeAutonomousBusinessOsV4Run({
      thumbgateDir: tmpDir,
      persist: true,
    });

    assert.equal(record.schema_version, '4.0');
    assert.equal(record.business_id, 'thumbgate');
    assert.equal(record.overall_status, 'VALIDATED');
    assert.equal(record.financial_performance.operating_profit, null);
    assert.equal(record.financial_performance.net_profit, null);
    assert.ok(fs.existsSync(path.join(tmpDir, 'business-os-v4-state.json')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'business-os-v4-run-record.json')));

    const monetizeReceipt = await runReflectionMonetizeEngine({
      runLiveSubprocesses: false,
      copyToClipboard: false,
      dispatchQueuePath: path.join(tmpDir, 'monetize-dispatch-queue.json'),
      outboundCashSpendUsd: 0,
    });
    assert.equal(monetizeReceipt.ok, true);
    assert.equal(monetizeReceipt.honestRevenueLedger.realExternalRecoverableLeadsCount, 1);
    assert.equal(monetizeReceipt.businessOsV4.schemaVersion, '4.0');
    assert.equal(monetizeReceipt.businessOsV4.rootCausesCount, 4);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
