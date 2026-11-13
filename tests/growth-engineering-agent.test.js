/**
 * Tests for Growth Engineering Agent Engine (Letterpress-1 Steal)
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GrowthEngineeringAgentEngine } = require('../src/growth-engineering-agent-engine');

test('GrowthEngineeringAgentEngine - evaluates high-value market signals and triggers growth PR generation', () => {
  const engine = new GrowthEngineeringAgentEngine({ tokenBudgetUsd: 5.0 });

  const signal = {
    signalType: 'COMPETITOR_ACQUISITION',
    entityName: 'Palo Alto Networks Clutch Security',
    rawSignalText: 'Palo Alto Networks in talks to acquire AI security agent credential startup for 500 million dollars',
    targetConversionOffer: '$499_SETUP_SPRINT'
  };

  const evalResult = engine.evaluateMarketSignal(signal);
  assert.equal(evalResult.shouldBuildPr, true);
  assert.ok(evalResult.opportunityScore >= 60);
  assert.equal(evalResult.recommendedAssetType, 'COMPETITIVE_COMPARISON_LANDING_PAGE');

  const pr = engine.generateSandboxedGrowthPr({ evaluation: evalResult });
  assert.ok(pr.prId.startsWith('growth_pr_'));
  assert.ok(pr.branch.includes('palo-alto-networks-clutch-security'));
  assert.ok(pr.assetPath.endsWith('.html'));
  assert.equal(pr.finOpsGuard.withinBudget, true);
  assert.equal(engine.generatedPrs.length, 1);
});

test('GrowthEngineeringAgentEngine - rejects low-signal noise without spending budget', () => {
  const engine = new GrowthEngineeringAgentEngine();

  const lowSignal = {
    signalType: 'COMPETITOR_ACQUISITION',
    entityName: 'Generic Minor Tool',
    rawSignalText: 'Minor bug fix released for calculator widget',
    targetConversionOffer: '$499_SETUP_SPRINT'
  };

  const evalResult = engine.evaluateMarketSignal(lowSignal);
  assert.equal(evalResult.shouldBuildPr, false);
  assert.throws(() => {
    engine.generateSandboxedGrowthPr({ evaluation: evalResult });
  }, /Cannot generate PR for rejected market signal/);
});
