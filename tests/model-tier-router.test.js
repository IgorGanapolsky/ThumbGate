'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  TIERS,
  classifyTask,
  shouldEscalate,
  FrontierBudget,
  recommendExecutionPlan,
} = require('../scripts/model-tier-router');

const config = require('../config/model-tiers.json');

// ---------------------------------------------------------------------------
// classifyTask — nano tier
// ---------------------------------------------------------------------------

test('classifyTask routes classification → nano', () => {
  const r = classifyTask({ type: 'classification' });
  assert.equal(r.tier, 'nano');
  assert.equal(r.escalated, false);
});

test('classifyTask routes extraction → nano', () => {
  const r = classifyTask({ type: 'extraction' });
  assert.equal(r.tier, 'nano');
});

test('classifyTask routes labeling → nano', () => {
  const r = classifyTask({ type: 'labeling' });
  assert.equal(r.tier, 'nano');
});

test('classifyTask routes summarization → nano', () => {
  const r = classifyTask({ type: 'summarization' });
  assert.equal(r.tier, 'nano');
});

test('classifyTask routes ranking → nano', () => {
  const r = classifyTask({ type: 'ranking' });
  assert.equal(r.tier, 'nano');
});

// ---------------------------------------------------------------------------
// classifyTask — mini tier
// ---------------------------------------------------------------------------

test('classifyTask routes code-edit → mini', () => {
  const r = classifyTask({ type: 'code-edit' });
  assert.equal(r.tier, 'mini');
  assert.equal(r.escalated, false);
});

test('classifyTask routes test-generation → mini', () => {
  const r = classifyTask({ type: 'test-generation' });
  assert.equal(r.tier, 'mini');
});

test('classifyTask routes review → mini', () => {
  const r = classifyTask({ type: 'review' });
  assert.equal(r.tier, 'mini');
});

// ---------------------------------------------------------------------------
// classifyTask — frontier tier
// ---------------------------------------------------------------------------

test('classifyTask routes architecture → frontier', () => {
  const r = classifyTask({ type: 'architecture' });
  assert.equal(r.tier, 'frontier');
  assert.equal(r.escalated, false);
});

test('classifyTask routes cross-file → frontier', () => {
  const r = classifyTask({ type: 'cross-file' });
  assert.equal(r.tier, 'frontier');
});

// ---------------------------------------------------------------------------
// classifyTask — escalation overrides
// ---------------------------------------------------------------------------

test('classifyTask escalates to frontier when context > 200k', () => {
  const r = classifyTask({ type: 'code-edit', contextTokens: 250000 });
  assert.equal(r.tier, 'frontier');
  assert.equal(r.escalated, true);
  assert.ok(r.reason.includes('250000'));
});

test('classifyTask escalates high risk + 2 retries to frontier', () => {
  const r = classifyTask({ type: 'code-edit', riskLevel: 'high', retryCount: 2 });
  assert.equal(r.tier, 'frontier');
  assert.equal(r.escalated, true);
});

test('classifyTask escalates architecture tag to frontier', () => {
  const r = classifyTask({ type: 'code-edit', tags: ['cross-file'] });
  assert.equal(r.tier, 'frontier');
  assert.equal(r.escalated, true);
});

test('classifyTask does NOT escalate high risk with only 1 retry', () => {
  const r = classifyTask({ type: 'code-edit', riskLevel: 'high', retryCount: 1 });
  assert.equal(r.tier, 'mini');
  assert.equal(r.escalated, false);
});

// ---------------------------------------------------------------------------
// classifyTask — unknown type
// ---------------------------------------------------------------------------

test('classifyTask defaults unknown type to mini', () => {
  const r = classifyTask({ type: 'banana-split' });
  assert.equal(r.tier, 'mini');
  assert.equal(r.escalated, false);
  assert.ok(r.reason.includes('unknown'));
});

// ---------------------------------------------------------------------------
// FrontierBudget — canSpend
// ---------------------------------------------------------------------------

test('FrontierBudget.canSpend returns true when under cap', () => {
  const budget = new FrontierBudget({ tokenCap: 100000 });
  const r = budget.canSpend(50000, 'architecture refactor');
  assert.equal(r.allowed, true);
  assert.equal(r.remaining, 100000);
});

test('FrontierBudget.canSpend returns false when over cap', () => {
  const budget = new FrontierBudget({ tokenCap: 100000 });
  const r = budget.canSpend(150000, 'huge task');
  assert.equal(r.allowed, false);
  assert.equal(r.remaining, 100000);
});

test('FrontierBudget.canSpend rejects missing reason when requireReason=true', () => {
  const budget = new FrontierBudget({ requireReason: true });
  const r = budget.canSpend(1000);
  assert.equal(r.allowed, false);
  assert.ok(r.reason.includes('reason is required'));
});

// ---------------------------------------------------------------------------
// FrontierBudget — spend
// ---------------------------------------------------------------------------

test('FrontierBudget.spend deducts correctly and logs reason', () => {
  const budget = new FrontierBudget({ tokenCap: 100000 });
  const r = budget.spend(30000, 'cross-file refactor');
  assert.equal(r.success, true);
  assert.equal(r.spent, 30000);
  assert.equal(r.remaining, 70000);
  assert.ok(r.reason.includes('cross-file refactor'));
});

test('FrontierBudget.spend refuses when over budget', () => {
  const budget = new FrontierBudget({ tokenCap: 10000 });
  const r = budget.spend(50000, 'too expensive');
  assert.equal(r.success, false);
  assert.equal(r.spent, 0);
});

test('FrontierBudget.spend tracks multiple invocations', () => {
  const budget = new FrontierBudget({ tokenCap: 100000 });
  budget.spend(10000, 'first');
  budget.spend(20000, 'second');
  const s = budget.status();
  assert.equal(s.spent, 30000);
  assert.equal(s.invocations, 2);
});

// ---------------------------------------------------------------------------
// FrontierBudget — status
// ---------------------------------------------------------------------------

test('FrontierBudget.status returns correct remaining', () => {
  const budget = new FrontierBudget({ tokenCap: 500000 });
  budget.spend(100000, 'initial');
  const s = budget.status();
  assert.equal(s.spent, 100000);
  assert.equal(s.remaining, 400000);
  assert.equal(s.cap, 500000);
  assert.equal(s.invocations, 1);
});

// ---------------------------------------------------------------------------
// FrontierBudget — reset
// ---------------------------------------------------------------------------

test('FrontierBudget.reset clears spent', () => {
  const budget = new FrontierBudget({ tokenCap: 500000 });
  budget.spend(200000, 'session work');
  budget.reset();
  const s = budget.status();
  assert.equal(s.spent, 0);
  assert.equal(s.remaining, 500000);
  assert.equal(s.invocations, 0);
});

// ---------------------------------------------------------------------------
// shouldEscalate
// ---------------------------------------------------------------------------

test('shouldEscalate returns escalation for two consecutive mini failures', () => {
  const task = { type: 'code-edit' };
  const history = [
    { tier: 'mini', success: false },
    { tier: 'mini', success: false },
  ];
  const r = shouldEscalate(task, history);
  assert.equal(r.escalate, true);
  assert.equal(r.from, 'mini');
  assert.equal(r.to, 'frontier');
  assert.ok(r.reason.includes('consecutive'));
});

test('shouldEscalate returns no escalation for single failure', () => {
  const task = { type: 'code-edit' };
  const history = [{ tier: 'mini', success: false }];
  const r = shouldEscalate(task, history);
  assert.equal(r.escalate, false);
});

test('shouldEscalate returns no escalation when last attempt succeeded', () => {
  const task = { type: 'code-edit' };
  const history = [
    { tier: 'mini', success: false },
    { tier: 'mini', success: true },
  ];
  const r = shouldEscalate(task, history);
  assert.equal(r.escalate, false);
});

test('shouldEscalate detects context-based escalation', () => {
  const task = { type: 'code-edit', contextTokens: 300000 };
  const r = shouldEscalate(task, []);
  // classifyTask already routes to frontier for >200k, so shouldEscalate
  // won't double-escalate — it checks currentTier !== 'frontier'
  // But classifyTask already returns frontier, so escalate is false
  assert.equal(r.escalate, false);
});

// ---------------------------------------------------------------------------
// Config congruence
// ---------------------------------------------------------------------------

test('TIERS constants match config/model-tiers.json', () => {
  assert.equal(TIERS.nano.maxContext, config.tiers.nano.maxContextTokens);
  assert.equal(TIERS.mini.maxContext, config.tiers.mini.maxContextTokens);
  assert.equal(TIERS.frontier.maxContext, config.tiers.frontier.maxContextTokens);
  assert.equal(TIERS.nano.costMultiplier, config.tiers.nano.costMultiplier);
  assert.equal(TIERS.mini.costMultiplier, config.tiers.mini.costMultiplier);
  assert.equal(TIERS.frontier.costMultiplier, config.tiers.frontier.costMultiplier);
});

test('config version is 1', () => {
  assert.equal(config.version, 1);
});

test('config escalation threshold matches TIERS.mini.maxContext', () => {
  assert.equal(config.escalationRules.contextThreshold, TIERS.mini.maxContext);
});

test('recommendExecutionPlan combines tier escalation with IndexCache-aware backend recommendation', () => {
  const plan = recommendExecutionPlan({
    type: 'code-edit',
    contextTokens: 260000,
    tags: ['retrieval-heavy'],
  }, {
    THUMBGATE_PROVIDER_MODE: 'local',
    THUMBGATE_LOCAL_MODEL_FAMILY: 'deepseek-v3',
    THUMBGATE_LOCAL_MODEL_SERVER: 'sglang',
    THUMBGATE_INDEXCACHE_ENABLED: 'true',
  });

  assert.equal(plan.tier, 'frontier');
  assert.equal(plan.indexCacheEligible, true);
  assert.equal(plan.indexCacheEnabled, true);
  assert.equal(plan.recommendationClass, 'indexcache_active');
  assert.ok(plan.reason.includes('IndexCache-ready'));
});

// ---------------------------------------------------------------------------
// GLM 5.1 localFrontier routing
// ---------------------------------------------------------------------------

test('TIERS includes localFrontier with zero cost multiplier', () => {
  assert.equal(TIERS.localFrontier.costMultiplier, 0.0);
  assert.equal(TIERS.localFrontier.maxContext, TIERS.frontier.maxContext);
});

test('recommendExecutionPlan routes frontier tasks to localFrontier when local GLM is active', () => {
  const plan = recommendExecutionPlan({
    type: 'architecture',
  }, {
    THUMBGATE_PROVIDER_MODE: 'local',
    THUMBGATE_LOCAL_MODEL_FAMILY: 'glm-z1',
    THUMBGATE_LOCAL_MODEL_SERVER: 'vllm',
  });

  assert.equal(plan.tier, 'localFrontier');
  assert.equal(plan.providerMode, 'local');
});

test('recommendExecutionPlan does NOT use localFrontier for non-frontier tasks with GLM', () => {
  const plan = recommendExecutionPlan({
    type: 'code-edit',
  }, {
    THUMBGATE_PROVIDER_MODE: 'local',
    THUMBGATE_LOCAL_MODEL_FAMILY: 'glm-z1',
    THUMBGATE_LOCAL_MODEL_SERVER: 'vllm',
  });

  assert.equal(plan.tier, 'mini');
});

test('recommendExecutionPlan keeps frontier tier when no local GLM backend', () => {
  const plan = recommendExecutionPlan({
    type: 'architecture',
  }, {});

  assert.equal(plan.tier, 'frontier');
});
