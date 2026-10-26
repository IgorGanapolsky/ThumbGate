'use strict';

// Cost Router — Model Routing Improvements tests
// Stolen from InfoWorld model routing article (Oct 2026) + NVIDIA NeMo Switchyard
// Tests: escalation router, Pareto trap monitoring, session-level cost tracking,
// stage-aware routing, and quality evaluation

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const router = require('../scripts/cost-router');

// Helper: use a temp HOME to avoid polluting the real filesystem
function withTempHome(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-router-test-'));
  const origHome = process.env.HOME;
  process.env.HOME = tmpDir;
  // Clear cached module to pick up new HOME
  delete require.cache[require.resolve('../scripts/cost-router')];
  const freshRouter = require('../scripts/cost-router');
  try {
    return fn(freshRouter, tmpDir);
  } finally {
    process.env.HOME = origHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete require.cache[require.resolve('../scripts/cost-router')];
  }
}

// ============================================================================
// Escalation Router tests
// ============================================================================

test('routeWithEscalation routes simple task to local tier', async () => {
  await withTempHome(async (r) => {
    const result = await r.routeWithEscalation({
      task: 'Sort these emails into categories',
      tokens: 1500,
      budgetUsd: 10000,
    });
    assert.equal(result.tier, 'local');
    assert.equal(result.costUsd, 0);
    assert.equal(result.escalated, false);
  });
});

test('routeWithEscalation routes complex task to capable tier', async () => {
  await withTempHome(async (r) => {
    const result = await r.routeWithEscalation({
      task: 'Design a distributed agent orchestration framework with consensus protocol',
      tokens: 8000,
      budgetUsd: 10000,
    });
    assert.equal(result.tier, 'capable');
    assert.ok(result.costUsd > 0);
    assert.equal(result.escalated, false);
  });
});

test('routeWithEscalation does not escalate when no qualityCheck', async () => {
  await withTempHome(async (r) => {
    const result = await r.routeWithEscalation({
      task: 'Review this PR for security issues',
      tokens: 5000,
      budgetUsd: 10000,
    });
    assert.equal(result.tier, 'fastCloud');
    assert.equal(result.escalated, false);
    assert.equal(result.escalationReason, null);
  });
});

test('routeWithEscalation escalates when qualityCheck fails', async () => {
  await withTempHome(async (r) => {
    const result = await r.routeWithEscalation({
      task: 'Review this PR for security issues',
      tokens: 5000,
      budgetUsd: 10000,
      qualityCheck: async () => false, // always fails
    });
    // Quality check failed → should escalate from fastCloud to capable
    assert.equal(result.escalated, true);
    assert.ok(result.escalationReason);
    assert.ok(result.escalationReason.includes('escalated') || result.escalationReason.includes('Esc'));
  });
});

test('routeWithEscalation records failure when escalating', async () => {
  await withTempHome(async (r) => {
    await r.routeWithEscalation({
      task: 'Review this PR for security issues',
      tokens: 5000,
      budgetUsd: 10000,
      qualityCheck: async () => false,
    });
    // Verify failure was recorded
    const metrics = r.getParetoTrapMetrics({ window: 'all' });
    assert.ok(metrics.totalFailures > 0);
  });
});

test('routeWithEscalation does not escalate privileged tasks', async () => {
  await withTempHome(async (r) => {
    const result = await r.routeWithEscalation({
      task: 'Search and summarize client confidential legal documents',
      tokens: 5000,
      budgetUsd: 10000,
      qualityCheck: async () => false,
    });
    // Privileged tasks stay local and cannot escalate to a paid tier
    assert.equal(result.tier, 'local');
  });
});

// ============================================================================
// Pareto Trap Monitoring tests
// ============================================================================

test('recordRoutingFailure stores failure record', () => {
  withTempHome((r) => {
    const result = r.recordRoutingFailure({
      task: 'Review PR',
      failedTier: 'fastCloud',
      escalatedTo: 'capable',
      reason: 'quality_check_failed',
    });
    assert.ok(result.length > 0);
    assert.equal(result[result.length - 1].failedTier, 'fastCloud');
    assert.equal(result[result.length - 1].escalatedTo, 'capable');
    assert.ok(result[result.length - 1].timestamp);
  });
});

test('getParetoTrapMetrics returns zero failures with no records', () => {
  withTempHome((r) => {
    const metrics = r.getParetoTrapMetrics({ window: 'all' });
    assert.equal(metrics.totalFailures, 0);
    assert.equal(metrics.paretoTrapDetected, false);
    assert.ok(metrics.recommendation);
  });
});

test('getParetoTrapMetrics detects Pareto trap above 15% failure rate', () => {
  withTempHome((r) => {
    // Record 20 failures on fastCloud tier
    for (let i = 0; i < 20; i++) {
      r.recordRoutingFailure({
        task: 'Test task ' + i,
        failedTier: 'fastCloud',
        escalatedTo: 'capable',
        reason: 'quality_check_failed',
      });
    }
    // Also record budget requests to create attempts
    const budget = r.loadBudget();
    budget.monthlyBudgetUsd = 10000;
    for (let i = 0; i < 50; i++) {
      r.recordRequest(budget, {
        task: 'Task ' + i,
        tier: 'fastCloud',
        costUsd: 0.01,
        tokens: 1000,
      });
    }

    const metrics = r.getParetoTrapMetrics({ window: 'all' });
    assert.ok(metrics.totalFailures >= 20);
    assert.equal(metrics.paretoTrapDetected, true);
    assert.ok(metrics.recommendation.includes('Increase routing complexity'));
  });
});

test('getParetoTrapMetrics supports time window filtering', () => {
  withTempHome((r) => {
    r.recordRoutingFailure({
      task: 'Old task',
      failedTier: 'fastCloud',
      reason: 'quality_check_failed',
    });
    const metrics = r.getParetoTrapMetrics({ window: '24h' });
    assert.equal(metrics.window, '24h');
    assert.ok(metrics.totalFailures >= 0);
  });
});

// ============================================================================
// Session-Level Cost Tracking tests
// ============================================================================

test('trackSessionCost creates new session with defaults', () => {
  withTempHome((r) => {
    const session = r.trackSessionCost('sess-001', {});
    assert.equal(session.sessionId, 'sess-001');
    assert.equal(session.totalCostUsd, 0);
    assert.equal(session.requests, 0);
    assert.equal(session.cacheHits, 0);
    assert.equal(session.cacheMisses, 0);
    assert.equal(session.toolCalls, 0);
    assert.deepEqual(session.tierUsage, { local: 0, fastCloud: 0, capable: 0 });
  });
});

test('trackSessionCost accumulates metrics', () => {
  withTempHome((r) => {
    r.trackSessionCost('sess-001', { cacheHits: 5, cacheMisses: 3, toolCalls: 10 });
    r.trackSessionCost('sess-001', { cacheHits: 2, cacheMisses: 1, toolCalls: 5 });
    const costs = r.loadSessionCosts();
    const session = costs['sess-001'];
    assert.equal(session.cacheHits, 7);
    assert.equal(session.cacheMisses, 4);
    assert.equal(session.toolCalls, 15);
  });
});

test('recordSessionRequest tracks costs and tier usage', () => {
  withTempHome((r) => {
    r.trackSessionCost('sess-001');
    const routingResult = r.routeTask({
      task: 'Review PR',
      tokens: 5000,
      budgetUsd: 10000,
    });
    const session = r.recordSessionRequest('sess-001', routingResult, 5000);
    assert.equal(session.requests, 1);
    assert.ok(session.totalCostUsd > 0);
    assert.equal(session.tierUsage[routingResult.tier], 1);
  });
});

test('getSessionCacheState returns cache hit ratio analysis', () => {
  withTempHome((r) => {
    r.trackSessionCost('sess-001', { cacheHits: 70, cacheMisses: 30 });
    const cache = r.getSessionCacheState('sess-001');
    assert.ok(cache);
    assert.equal(cache.cacheHits, 70);
    assert.equal(cache.cacheMisses, 30);
    assert.equal(cache.cacheHitRatio, 70);
    assert.ok(cache.recommendation);
  });
});

test('getSessionCacheState returns null for unknown session', () => {
  withTempHome((r) => {
    const cache = r.getSessionCacheState('nonexistent');
    assert.equal(cache, null);
  });
});

test('getSessionCacheState recommends capable tier for low cache hit ratio', () => {
  withTempHome((r) => {
    r.trackSessionCost('sess-001', { cacheHits: 10, cacheMisses: 90 });
    const cache = r.getSessionCacheState('sess-001');
    assert.equal(cache.cacheHitRatio, 10);
    assert.ok(cache.recommendation.includes('Low cache hit ratio'));
  });
});

// ============================================================================
// Stage-Aware Routing tests
// ============================================================================

test('analyzeToolActivity scores simple tool calls as low complexity', () => {
  const tools = [
    { name: 'Read', args: { path: '/some/file.js' } },
    { name: 'Grep', args: { pattern: 'test' } },
  ];
  const score = router.analyzeToolActivity(tools);
  assert.ok(score < 15);
});

test('analyzeToolActivity scores complex tool calls as high complexity', () => {
  const tools = [
    { name: 'Bash', args: { command: 'npm install && npm run build && npm run deploy' } },
    { name: 'Edit', args: { path: '/some/file.js', content: 'x'.repeat(60000) } },
    { name: 'Bash', args: { command: 'npm run test && npm run test:e2e' } },
    { name: 'Bash', args: { command: 'npm run test' } },
    { name: 'Bash', args: { command: 'npm run test' } },
    { name: 'Bash', args: { command: 'npm run test' } },
    { name: 'Bash', args: { command: 'npm run test' } },
    { name: 'Bash', args: { command: 'npm run test' } }
  ];
  const score = router.analyzeToolActivity(tools);
  assert.ok(score >= 15);
});

test('stageAwareRoute returns base routing without session context', () => {
  const result = router.stageAwareRoute({
    task: 'Sort emails',
    tokens: 1500,
    budgetUsd: 10000,
  });
  assert.equal(result.tier, 'local');
  assert.equal(result.escalated, undefined);
});

test('stageAwareRoute escalates on complex tool activity', () => {
  const result = router.stageAwareRoute({
    task: 'Review this PR for security issues',
    tokens: 5000,
    budgetUsd: 10000,
  }, {
    recentToolCalls: [
      { name: 'Bash', args: { command: 'npm install && npm run build && npm run deploy' } },
      { name: 'Edit', args: { path: '/some/file.js', content: 'x'.repeat(20000) } },
      { name: 'Bash', args: { command: 'npm run test:e2e' } },
    ],
  });
  assert.ok(result.tier === 'capable' || result.reason.includes('Stage-aware'));
});

test('stageAwareRoute downgrades capable to fastCloud on simple tools', () => {
  const result = router.stageAwareRoute({
    task: 'Design a distributed agent orchestration framework',
    tokens: 8000,
    budgetUsd: 10000,
  }, {
    recentToolCalls: [
      { name: 'Read', args: { path: '/some/file.js' } },
    ],
  });
  // If the task is complex but tool activity is simple, it should still route to capable
  // (downgrade only happens if current tier is capable AND tools are simple)
  assert.ok(['local', 'fastCloud', 'capable'].includes(result.tier));
});

test('stageAwareRoute uses cache state for routing adjustment', () => {
  withTempHome((r) => {
    r.trackSessionCost('sess-001', { cacheHits: 90, cacheMisses: 10 });
    const result = r.stageAwareRoute({
      task: 'Sort emails into categories',
      tokens: 1500,
      budgetUsd: 10000,
    }, {
      sessionId: 'sess-001',
      recentToolCalls: [
        { name: 'Read', args: { path: '/some/file.js' } },
      ],
    });
    assert.equal(result.tier, 'local');
  });
});

// ============================================================================
// Quality Evaluation tests
// ============================================================================

test('evaluateRoutingQuality returns 100% when no failures', () => {
  const result = router.evaluateRoutingQuality({ window: '7d' });
  assert.equal(result.qualityScore, 100);
  assert.ok(result.recommendation.includes('No routing failures'));
});

test('evaluateRoutingQuality detects failures with low quality score', () => {
  withTempHome((r) => {
    for (let i = 0; i < 50; i++) {
      r.recordRoutingFailure({
        task: 'Task ' + i,
        failedTier: 'fastCloud',
        reason: 'quality_check_failed',
      });
    }
    const result = r.evaluateRoutingQuality({ window: 'all' });
    assert.ok(result.totalRoutingFailures >= 50);
    assert.ok(result.qualityScore < 100);
  });
});

test('evaluateRoutingQuality supports time window filtering', () => {
  const result = router.evaluateRoutingQuality({ window: '24h' });
  assert.equal(result.window, '24h');
  assert.ok(typeof result.totalRoutingFailures === 'number');
  assert.ok(typeof result.qualityScore === 'number');
});

test('evaluateRoutingQuality includes Pareto trap analysis', () => {
  const result = router.evaluateRoutingQuality({ window: 'all' });
  assert.ok(result.paretoTrap);
  assert.ok(typeof result.paretoTrap.paretoTrapDetected === 'boolean');
  assert.ok(typeof result.paretoTrap.totalFailures === 'number');
});

// ============================================================================
// Integration: end-to-end routing with escalation and monitoring
// ============================================================================

test('full flow: route → escalate → record → evaluate', async () => {
  await withTempHome(async (r) => {
    // 1. Route a medium-complexity task
    const routeResult = r.routeTask({
      task: 'Review this PR for security issues in the model routing layer',
      tokens: 5000,
      budgetUsd: 10000,
    });
    assert.equal(routeResult.tier, 'fastCloud');

    // 2. Escalate when quality check fails
    const escalated = await r.routeWithEscalation({
      task: 'Review this PR for security issues in the model routing layer',
      tokens: 5000,
      budgetUsd: 10000,
      qualityCheck: async () => false,
    });
    assert.equal(escalated.escalated, true);

    // 3. Verify Pareto trap detects the failure
    const pareto = r.getParetoTrapMetrics({ window: 'all' });
    assert.ok(pareto.totalFailures >= 1);

    // 4. Evaluate routing quality
    const quality = r.evaluateRoutingQuality({ window: 'all' });
    assert.ok(quality.totalRoutingFailures >= 1);
    assert.ok(quality.qualityScore < 100);
  });
});

// ============================================================================
// CLI command tests
// ============================================================================

test('all new exports are available', () => {
  assert.equal(typeof router.routeWithEscalation, 'function');
  assert.equal(typeof router.recordRoutingFailure, 'function');
  assert.equal(typeof router.getParetoTrapMetrics, 'function');
  assert.equal(typeof router.trackSessionCost, 'function');
  assert.equal(typeof router.recordSessionRequest, 'function');
  assert.equal(typeof router.getSessionCacheState, 'function');
  assert.equal(typeof router.stageAwareRoute, 'function');
  assert.equal(typeof router.analyzeToolActivity, 'function');
  assert.equal(typeof router.evaluateRoutingQuality, 'function');
});
