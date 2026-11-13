/**
 * Tests for Greg Isenberg AI-Proof Business Moat Engine
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AiProofMoatEngine,
  DEFENSIVE_MOAT_CATEGORIES
} = require('../scripts/ai-proof-moat-engine');

test('AiProofMoatEngine - flags pure single-category outcome agency as vulnerable to cloning', () => {
  const engine = new AiProofMoatEngine();

  // Evaluate an unstacked outcome offer
  const evaluation = engine.evaluateOfferDefensibility({
    name: 'Generic AI Code Review Service',
    categories: [DEFENSIVE_MOAT_CATEGORIES.STACKED_AUTOMATED_OUTCOME],
    targetPriceUsd: 199
  });

  assert.equal(evaluation.defensibilityTier, 'VULNERABLE_TO_CLONING');
  assert.equal(evaluation.isCompliant, false);
  assert.ok(evaluation.recommendations.some(r => r.includes('Stack at least two')));
});

test('AiProofMoatEngine - approves stacked multi-moat architecture (Permission + Data + Community)', () => {
  const engine = new AiProofMoatEngine();

  // Register foundational moats
  engine.registerEnterprisePartnership({
    name: 'NVIDIA Inception',
    ecosystem: 'NVIDIA AI / Crusoe Cloud',
    benefits: ['$10,000 Crusoe Inference Credits', 'DLI Training Access']
  });

  engine.registerMoat(DEFENSIVE_MOAT_CATEGORIES.CURATED_PROPRIETARY_DATA, {
    dataset: 'ThumbGate PreToolUse Failure Trace Corpus'
  });

  engine.registerMoat(DEFENSIVE_MOAT_CATEGORIES.COMMUNITY_AND_EVENTS, {
    community: 'Skool ai-realestate101 + Live Engineering Masterclass'
  });

  // Evaluate the $499 Managed Gate with stacked moats
  const evaluation = engine.evaluateOfferDefensibility({
    name: 'ThumbGate $499 Managed AI Agent Workflow Gate',
    categories: [
      DEFENSIVE_MOAT_CATEGORIES.PERMISSION_REGULATORY,
      DEFENSIVE_MOAT_CATEGORIES.CURATED_PROPRIETARY_DATA,
      DEFENSIVE_MOAT_CATEGORIES.COMMUNITY_AND_EVENTS
    ],
    targetPriceUsd: 499
  });

  assert.equal(evaluation.isCompliant, true);
  assert.equal(evaluation.defensibilityTier, 'DEFENSIBLE');
  assert.equal(evaluation.moatCount, 3);
});

test('AiProofMoatEngine - micro-niche trend monitor ingests signals with first-mover window', () => {
  const engine = new AiProofMoatEngine();

  const alert = engine.ingestTrendSignal({
    niche: 'Autonomous Agent Git PR CI Tsunami',
    growthVelocity: 'SURGING',
    firstMoverWindowDays: 14,
    actionablePlay: 'Ship Lazy PR CI manager with superseding cancellation'
  });

  assert.equal(alert.niche, 'Autonomous Agent Git PR CI Tsunami');
  assert.equal(alert.growthVelocity, 'SURGING');
  assert.equal(alert.firstMoverWindowDays, 14);
});
