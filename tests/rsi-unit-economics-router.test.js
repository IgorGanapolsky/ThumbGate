'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  auditUnitEconomics,
  routeByGdpxEfficiency,
  evaluateAgentPlatformFailover,
  evaluateRsiWeightEditProposal,
  validateGeoContent,
  runDoctor,
} = require('../scripts/rsi-unit-economics-router.js');

describe('RSI Unit Economics & Governance Router', () => {
  it('correctly calculates true API cost and flags subsidized consumer plan vulnerability', () => {
    const audit = auditUnitEconomics({
      taskName: 'heavy_code_migration',
      modelId: 'claude-opus-5.5',
      inputTokens: 500_000,
      outputTokens: 50_000,
      executionHours: 2.0,
      planType: 'flat_consumer_subscription',
      monthlySubscriptionCost: 200.0,
      monthlyTasksRun: 200, // $1.00 flat per task
    });

    // Input: 500k * 15/M = $7.50, Output: 50k * 75/M = $3.75 -> $11.25 true API cost
    assert.strictEqual(audit.trueApiCostUsd, 11.25);
    assert.strictEqual(audit.humanLaborBenchmark.humanLaborCostUsd, 150.0);
    assert.strictEqual(audit.economics.netSavingsUsd, 138.75);
    assert.ok(audit.economics.roiMultiplier > 10);

    // Subsidy ratio: 11.25 / 1.0 = 11.25x -> flags vulnerability
    assert.strictEqual(audit.subsidyAnalysis.subsidizedPlanVulnerability, true);
    assert.match(audit.subsidyAnalysis.warning, /Workflow will break when vendor caps flat inference/i);
  });

  it('routes standard tasks to Gemini 4 Carbon saving ~$35/task on GDPX efficiency', () => {
    const routing = routeByGdpxEfficiency({
      taskType: 'general_coding',
      complexity: 'medium',
    });

    assert.strictEqual(routing.selectedModel, 'gemini-4-carbon');
    assert.strictEqual(routing.tier, 'carbon_workhorse');
    assert.strictEqual(routing.avgTaskCostUsd, 16.0);
    assert.strictEqual(routing.savingsVsOpusUsd, 35.0);
    assert.ok(routing.gdpxEfficiencyIndex > 3.0);
  });

  it('routes low-complexity extraction tasks to Fast Mini for 95% savings', () => {
    const routing = routeByGdpxEfficiency({
      taskType: 'extraction',
      complexity: 'low',
    });

    assert.strictEqual(routing.selectedModel, 'gpt-5.4-mini');
    assert.strictEqual(routing.tier, 'fast_mini');
    assert.strictEqual(routing.avgTaskCostUsd, 2.4);
    assert.ok(routing.savingsVsOpusUsd > 45);
  });

  it('reserves Opus 5.5 strictly for ultra-complex multi-repo architecture', () => {
    const routing = routeByGdpxEfficiency({
      taskType: 'system-architecture',
      complexity: 'ultra_architecture',
      requiresCrossRepoSynthesis: true,
    });

    assert.strictEqual(routing.selectedModel, 'claude-opus-5.5');
    assert.strictEqual(routing.tier, 'frontier_ultra');
    assert.strictEqual(routing.avgTaskCostUsd, 51.0);
  });

  it('triggers seamless failover when GrokBot hits rate limits (429)', () => {
    const failover = evaluateAgentPlatformFailover({
      currentPlatform: 'grok_bot',
      httpStatusCode: 429,
      rateLimitExceeded: true,
    });

    assert.strictEqual(failover.status, 'FAILOVER_TRIGGERED');
    assert.strictEqual(failover.failoverRequired, true);
    assert.strictEqual(failover.failoverTarget, 'hermes_agent');
    assert.strictEqual(failover.failoverModel, 'gemini-4-carbon');
  });

  it('enforces Anthropic S-1 governance on MIT direct weight editing', () => {
    // Attempting unverified autonomous self-modification must BLOCK
    const blocked = evaluateRsiWeightEditProposal({
      modelName: 'qwen-3.5-0.8b',
      editedParameterCount: 120_000,
      totalParameterCount: 800_000_000,
      hasHumanApproval: false,
      testsPassed: false,
    });
    assert.strictEqual(blocked.allowed, false);
    assert.strictEqual(blocked.verdict, 'BLOCK');
    assert.ok(blocked.violations.length >= 2);

    // Micro-edit with full test verifier + human approval must ALLOW
    const allowed = evaluateRsiWeightEditProposal({
      modelName: 'qwen-3.5-0.8b',
      editedParameterCount: 120_000,
      totalParameterCount: 800_000_000,
      hasHumanApproval: true,
      testsPassed: true,
      rollbackArtifactAvailable: true,
    });
    assert.strictEqual(allowed.allowed, true);
    assert.strictEqual(allowed.verdict, 'ALLOW');
    assert.strictEqual(allowed.mitMicroEditCompliant, true);
  });

  it('validates Generative Engine Optimization (GEO) structured content', () => {
    const geo = validateGeoContent(`
# ThumbGate AI Agent Firewall
> ThumbGate is an execution firewall and runtime kill switch for enterprise AI agents.

## What it solves
AI agents execute unverified terminal commands and hallucinate destructive operations.

\`\`\`bash
npm install -g thumbgate
thumbgate doctor
\`\`\`

Official Repository: https://github.com/IgorGanapolsky/ThumbGate
`);
    assert.strictEqual(geo.passed, true);
    assert.ok(geo.score >= 75);
    assert.ok(geo.signals.includes('has_clear_problem_solution_block'));
    assert.ok(geo.signals.includes('has_executable_snippets'));
  });

  it('executes doctor mode cleanly', () => {
    const doctor = runDoctor();
    assert.strictEqual(doctor.ok, true);
    assert.strictEqual(doctor.verdict, 'PASS');
  });
});
