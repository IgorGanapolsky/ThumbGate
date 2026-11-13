/**
 * Tests for Autonomous Coding Agent Risk Scorecard (David Meerman Scott Play)
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateAgentRiskScorecard } = require('../scripts/agent-risk-scorecard');

test('AgentRiskScorecard - calculates high risk and financial exposure when no guardrails are present', () => {
  const result = calculateAgentRiskScorecard({
    activeAgents: 5,
    monthlyCiSpendUsd: 2000,
    databaseEngine: 'postgresql',
    hasDeterministicPreToolGate: false,
    hasLazyPrCanceller: false,
    hasMutationTesting: false
  });

  assert.ok(result.riskScore >= 70);
  assert.equal(result.riskTier, 'CRITICAL');
  assert.ok(result.predictedAnnualIncidentExposureUsd > 25000);
  assert.equal(result.criticalVulnerabilities.length, 3);
  assert.ok(result.remediationChecklist.some(r => r.includes('LazyPrCiManager')));
  assert.ok(result.remediationChecklist.some(r => r.includes('PreToolUse database')));
});

test('AgentRiskScorecard - drops risk score when deterministic gates are active', () => {
  const hardenedResult = calculateAgentRiskScorecard({
    activeAgents: 5,
    monthlyCiSpendUsd: 2000,
    databaseEngine: 'postgresql',
    hasDeterministicPreToolGate: true,
    hasLazyPrCanceller: true,
    hasMutationTesting: true
  });

  assert.ok(hardenedResult.riskScore <= 45);
  assert.equal(hardenedResult.riskTier, 'LOW');
  assert.equal(hardenedResult.predictedAnnualIncidentExposureUsd, 0);
  assert.equal(hardenedResult.criticalVulnerabilities.length, 0);
});
