'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  createRequestEnvelope,
  finalizeRequestEnvelope,
  summarizeRetrieval,
  estimateTokensFromText,
  estimateCostCents,
  ENVELOPE_VERSION,
} = require('../scripts/request-envelope');
const {
  assessRetrievalQualityTier,
  probeEmbeddingQuality,
} = require('../scripts/retrieval-quality-tier');
const {
  enforceTierBudgets,
  recordFrontierInvocation,
  _resetFrontierDayCounts,
  getBudgetConfig,
} = require('../scripts/tier-budget-guard');

describe('request envelope', () => {
  it('creates and finalizes with latency', () => {
    const env = createRequestEnvelope({ surface: 'test', startedAt: 1000 });
    assert.equal(env.envelopeVersion, ENVELOPE_VERSION);
    assert.ok(env.traceId);
    const done = finalizeRequestEnvelope(env, { endedAt: 1500, outcome: 'ok', model: 'x' });
    assert.equal(done.latencyMs, 500);
    assert.equal(done.model, 'x');
  });

  it('summarizes retrieval without bodies', () => {
    const s = summarizeRetrieval([
      { id: 'a', relevanceScore: 0.9, content: 'SECRET should not appear as field dump' },
    ], { strategy: 'hybrid', qualityTier: 'degraded' });
    assert.equal(s.count, 1);
    assert.equal(s.top[0].id, 'a');
    assert.equal(s.qualityTier, 'degraded');
    assert.equal(JSON.stringify(s).includes('SECRET'), false);
  });

  it('estimates tokens and cost', () => {
    assert.ok(estimateTokensFromText('abcd'.repeat(100)) >= 50);
    assert.ok(estimateCostCents({ inputTokens: 1_000_000, outputTokens: 0 }) >= 2);
  });
});

describe('retrieval quality tier', () => {
  it('marks feature-hash as degraded', () => {
    const q = assessRetrievalQualityTier({
      embeddingProfile: { id: 'feature-hash-v1', qualityTier: 'degraded' },
      embedderAvailable: true,
    });
    assert.equal(q.qualityTier, 'degraded');
    assert.equal(q.semanticClaimsAllowed, false);
  });

  it('marks stale index as degraded', () => {
    const now = Date.now();
    const q = assessRetrievalQualityTier({
      embeddingProfile: { id: 'gemini', qualityTier: 'production' },
      embedderAvailable: true,
      indexUpdatedAtMs: now - 30 * 24 * 60 * 60 * 1000,
      nowMs: now,
      maxIndexAgeMs: 7 * 24 * 60 * 60 * 1000,
    });
    assert.equal(q.qualityTier, 'degraded');
    assert.ok(q.degradedReasons.includes('index_stale'));
  });

  it('probe does not throw', () => {
    const q = probeEmbeddingQuality();
    assert.ok(['production', 'degraded', 'unavailable'].includes(q.qualityTier));
  });
});

describe('tier budget guard', () => {
  it('degrades frontier when daily cap exhausted', () => {
    _resetFrontierDayCounts();
    const cfg = getBudgetConfig({ maxFrontierPerDay: 1 });
    recordFrontierInvocation(1_700_000_000_000);
    // force day key by using fixed now and max 0
    for (let i = 0; i < 5; i += 1) recordFrontierInvocation();
    const decision = enforceTierBudgets(
      { type: 'architecture', tags: ['architecture'], riskLevel: 'high', reason: 'test' },
      {
        classification: { tier: 'frontier', reason: 'test', escalated: true },
        maxFrontierPerDay: 0,
        estimatedTokens: 1000,
      },
    );
    assert.ok(decision.tier === 'mini' || decision.action === 'degrade' || decision.action === 'deny');
    assert.ok(decision.reasons.length >= 1);
  });

  it('denies when cost still over cap at nano-equivalent paid tier', () => {
    const decision = enforceTierBudgets(
      { type: 'code-edit', reason: 'expensive' },
      {
        classification: { tier: 'frontier', reason: 'x', escalated: true },
        estimatedTokens: 50_000_000, // absurd → high cost
        maxCostCentsPerRequest: 0.0001,
      },
    );
    assert.equal(decision.allowed, false);
    assert.equal(decision.action, 'deny');
  });

  it('allows cheap mini within defaults', () => {
    _resetFrontierDayCounts();
    const decision = enforceTierBudgets(
      { type: 'code-edit', reason: 'normal' },
      {
        classification: { tier: 'mini', reason: 'code-edit', escalated: false },
        estimatedTokens: 2000,
      },
    );
    assert.equal(decision.allowed, true);
    assert.equal(decision.action, 'allow');
  });
});
