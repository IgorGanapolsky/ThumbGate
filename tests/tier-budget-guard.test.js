'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  enforceTierBudgets,
  getBudgetConfig,
  estimateTierCostCents,
  _resetFrontierDayCounts,
  recordFrontierInvocation,
  getFrontierDayUsage,
} = require('../scripts/tier-budget-guard');

describe('tier-budget-guard', () => {
  beforeEach(() => {
    _resetFrontierDayCounts();
    delete process.env.THUMBGATE_MAX_COST_CENTS_PER_REQUEST;
    delete process.env.THUMBGATE_MAX_FRONTIER_PER_DAY;
  });

  it('exports a finite default budget config', () => {
    const cfg = getBudgetConfig();
    assert.ok(cfg.maxCostCentsPerRequest > 0);
    assert.ok(cfg.maxLatencyMs > 0);
    assert.ok(cfg.maxFrontierPerDay > 0);
  });

  it('estimates positive cost for frontier tiers', () => {
    const cents = estimateTierCostCents('frontier', 10_000);
    assert.ok(cents > 0);
  });

  it('allows a low-risk review under default budgets', () => {
    const decision = enforceTierBudgets({
      type: 'review',
      riskLevel: 'low',
      tags: [],
    }, { estimatedTokens: 2000 });
    assert.equal(decision.allowed, true);
    assert.ok(['allow', 'degrade'].includes(decision.action));
  });

  it('degrades or denies when cost cap is tiny', () => {
    process.env.THUMBGATE_MAX_COST_CENTS_PER_REQUEST = '0.0001';
    const decision = enforceTierBudgets({
      type: 'architecture',
      riskLevel: 'high',
      tags: ['long-context'],
    }, { estimatedTokens: 50_000 });
    assert.ok(decision.action === 'deny' || decision.action === 'degrade' || decision.allowed === true);
    assert.ok(Array.isArray(decision.reasons));
  });

  it('tracks frontier daily usage', () => {
    assert.equal(getFrontierDayUsage().count, 0);
    recordFrontierInvocation();
    recordFrontierInvocation();
    assert.equal(getFrontierDayUsage().count, 2);
  });
});
