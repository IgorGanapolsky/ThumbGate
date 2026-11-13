'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  GDPX_EFFICIENCY_BENCHMARKS,
  auditUnitEconomicsAtTrueApiCost,
  routeTaskByGdpxEfficiency,
  evaluateConsumerPersonalAgentTopFunnel,
  evaluateMitDirectWeightEditingAndHitlRsi,
  compileGenerativeEngineOptimizationGeoCapsule,
  evaluateAiLurchesTowardsRsiSteal,
} = require('../src/cloud-token-firewall');

const {
  evaluateAiLurchesTowardsRsiSteal: fastMoneyRsiSteal,
} = require('../scripts/fast-money-engine');

test('Audit Unit Economics: measures true subsidy gap and flags human labor ROI', () => {
  // Case 1: Getting $14,000 worth of API compute on a $200/mo consumer flat-rate plan
  const heavilySubsidized = auditUnitEconomicsAtTrueApiCost({
    monthlyPlanUsd: 200,
    reportedApiUsageUsd: 14000,
    humanLaborHourlyRateUsd: 85,
    taskHoursSaved: 320,
    agentTaskCount: 200,
  });

  assert.equal(heavilySubsidized.ok, true);
  assert.equal(heavilySubsidized.subsidyGap.subsidyAmountUsd, 13800);
  assert.equal(heavilySubsidized.subsidyGap.isHeavilySubsidized, true);
  assert.equal(heavilySubsidized.taskEconomics.costPerTaskSubsidized, 1.0);
  assert.equal(heavilySubsidized.taskEconomics.costPerTaskTrueApi, 70.0);
  assert.equal(heavilySubsidized.humanLaborComparison.humanLaborReplacementValueUsd, 27200); // 85 * 320
  assert.equal(heavilySubsidized.humanLaborComparison.netRoiUnderTrueApiUsd, 13200); // 27200 - 14000
  assert.equal(heavilySubsidized.humanLaborComparison.survivesEndOfTheSubsidyEra, true);

  // Case 2: Workflow that dies when flat-rate subsidies end (low human replacement value)
  const nonViableWorkflow = auditUnitEconomicsAtTrueApiCost({
    monthlyPlanUsd: 200,
    reportedApiUsageUsd: 14000,
    humanLaborHourlyRateUsd: 30,
    taskHoursSaved: 100, // Only $3,000 value
    agentTaskCount: 200,
  });

  assert.equal(nonViableWorkflow.humanLaborComparison.survivesEndOfTheSubsidyEra, false);
  assert.ok(nonViableWorkflow.strategicRecommendation.includes('ALERT'));
});

test('SemiAnalysis GDPX Router: selects cost-efficient models saving over 68% vs Opus 5.5', () => {
  assert.ok(GDPX_EFFICIENCY_BENCHMARKS.length >= 6);

  // High complexity within $20 budget, preferredProvider 'Google': should route to Gemini 4 Carbon ($16) instead of Opus 5.5 ($51)
  const routeGoogle = routeTaskByGdpxEfficiency({
    taskComplexity: 'high',
    targetBudgetUsd: 20.0,
    allowLocalMlx: false,
    preferredProvider: 'Google',
  });

  assert.equal(routeGoogle.ok, true);
  assert.equal(routeGoogle.selectedModel.modelId, 'gemini-4-carbon');
  assert.equal(routeGoogle.selectedModel.costPerTaskUsd, 16.0);
  assert.equal(routeGoogle.savingsVsFrontierOpus.dollarSavingsPerTaskUsd, 35.0);
  assert.ok(routeGoogle.savingsVsFrontierOpus.percentageSavings > 68.0);

  // High complexity with Poolside: routes to Laguna S 2.1 ($8.50, >83% savings)
  const routePoolside = routeTaskByGdpxEfficiency({
    taskComplexity: 'high',
    targetBudgetUsd: 20.0,
    allowLocalMlx: false,
  });
  assert.equal(routePoolside.selectedModel.modelId, 'laguna-s-2-1');
  assert.ok(routePoolside.savingsVsFrontierOpus.percentageSavings > 80.0);

  // Medium complexity with local MLX allowed: should pick Laguna XS 2.1 ($0.00 marginal cost)
  const routeLocal = routeTaskByGdpxEfficiency({
    taskComplexity: 'medium',
    targetBudgetUsd: 10.0,
    allowLocalMlx: true,
  });

  assert.equal(routeLocal.selectedModel.modelId, 'laguna-xs-2-1-mlx');
  assert.equal(routeLocal.selectedModel.costPerTaskUsd, 0.0);
  assert.equal(routeLocal.savingsVsFrontierOpus.percentageSavings, 100.0);
});

test('Consumer Personal Agents as Top-of-Funnel: Meta Muse SMB connector monetization', () => {
  const topFunnel = evaluateConsumerPersonalAgentTopFunnel({
    freeConsumerAgentsCount: 10000,
    b2bConnectorConversionPct: 0.024, // 240 converted SMBs
    monthlyArpuUsd: 49.0,
    smbConnectors: ['quickbooks', 'stripe', 'canva'],
  });

  assert.equal(topFunnel.ok, true);
  assert.equal(topFunnel.convertedB2bSubscribers, 240);
  assert.equal(topFunnel.monthlyRecurringRevenueUsd, 11760); // 240 * 49
  assert.equal(topFunnel.annualRecurringRevenueUsd, 141120); // 11760 * 12
  assert.ok(topFunnel.infrastructureCosts.grossMarginPct > 80.0);
  assert.deepEqual(topFunnel.activeSmbConnectors, ['quickbooks', 'stripe', 'canva']);
});

test('MIT Direct Weight Editing & Anthropic HITL Governance: enforces human approval on RSI', () => {
  // Without human approval: must fail closed with HOLD
  const unapprovedRsi = evaluateMitDirectWeightEditingAndHitlRsi({
    targetModel: 'Qwen-3.5-0.8B',
    frontierInspector: 'GPT-6 Astra',
    totalModelParams: 800000000,
    fractionEdited: 0.00016, // 0.016%
    humanInTheLoopApproved: false,
  });

  assert.equal(unapprovedRsi.ok, true);
  assert.equal(unapprovedRsi.gateVerdict, 'HOLD');
  assert.equal(unapprovedRsi.mitWeightEditingSpecs.paramsEditedCount, 128000);
  assert.equal(unapprovedRsi.mitWeightEditingSpecs.requiresBackpropagation, false);
  assert.equal(unapprovedRsi.mitWeightEditingSpecs.requiresRlTraining, false);
  assert.equal(unapprovedRsi.anthropicHitlGovernance.governanceStatus, 'BLOCKED_BY_SAFETY_GATE');

  // With explicit human approval: PASS
  const approvedRsi = evaluateMitDirectWeightEditingAndHitlRsi({
    targetModel: 'Qwen-3.5-0.8B',
    frontierInspector: 'GPT-6 Astra',
    humanInTheLoopApproved: true,
    approverEmail: 'igor@thumbgate.ai',
  });

  assert.equal(approvedRsi.gateVerdict, 'PASS');
  assert.equal(approvedRsi.anthropicHitlGovernance.governanceStatus, 'AUTHORIZED_RSI_PATCH');
});

test('Generative Engine Optimization (GEO): generates structured capsule for zero-click AI citations', () => {
  const geo = compileGenerativeEngineOptimizationGeoCapsule({
    brand: 'ThumbGate',
  });

  assert.equal(geo.ok, true);
  assert.equal(geo.zeroClickCitationOptimized, true);
  assert.equal(geo.jsonLd['@type'], 'SoftwareApplication');
  assert.ok(geo.markdownSummary.includes('npx thumbgate@latest init'));
  assert.ok(geo.markdownSummary.includes('0.041 ms'));
});

test('Comprehensive AI Lurches Towards RSI Steal Evaluator: orchestrates all 3 pillars', () => {
  const comprehensive = evaluateAiLurchesTowardsRsiSteal({
    humanInTheLoopApproved: true,
    approverEmail: 'igor@thumbgate.ai',
  });

  assert.equal(comprehensive.ok, true);
  assert.equal(comprehensive.sourceUrl, 'https://music.youtube.com/watch?v=Es59icF3nZg');
  assert.ok(comprehensive.threeStrategicPillars.pillar1_model_and_agent_economics);
  assert.ok(comprehensive.threeStrategicPillars.pillar2_model_optimization_and_rsi);
  assert.ok(comprehensive.threeStrategicPillars.pillar3_enterprise_adoption_and_geo);
});

test('Fast Money Engine re-export: exposes evaluateAiLurchesTowardsRsiSteal faithfully', () => {
  assert.equal(typeof fastMoneyRsiSteal, 'function');
  const res = fastMoneyRsiSteal({ humanInTheLoopApproved: true, approverEmail: 'igor@thumbgate.ai' });
  assert.equal(res.ok, true);
  assert.ok(res.threeStrategicPillars);
});
