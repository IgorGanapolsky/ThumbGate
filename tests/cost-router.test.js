'use strict';

// Cost Router tests (AIOS FORMAT steal from advisoraipartners.com/aios)
// Pattern: 3-tier routing (local → fast cloud → capable) with budget metering
// and privileged-work-stays-local enforcement.

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const router = require('../scripts/cost-router');

test('routeTask routes simple tasks to local tier', () => {
  const result = router.routeTask({
    task: 'Sort these emails into categories',
    tokens: 1500,
    budgetUsd: 10000,
  });
  assert.equal(result.tier, 'local');
  assert.equal(result.costUsd, 0);
  assert.equal(result.privileged, false);
});

test('routeTask routes complex tasks to capable tier', () => {
  const result = router.routeTask({
    task: 'Design a system architecture for a distributed agent orchestration framework',
    tokens: 8000,
    budgetUsd: 10000,
  });
  assert.equal(result.tier, 'capable');
  assert.ok(result.costUsd > 0);
  assert.equal(result.reason.includes('Complex task'), true);
});

test('routeTask routes medium tasks to fastCloud tier', () => {
  const result = router.routeTask({
    task: 'Review this PR diff for security issues',
    tokens: 5000,
    budgetUsd: 10000,
  });
  assert.equal(result.tier, 'fastCloud');
  assert.ok(result.costUsd > 0);
});

test('routeTask forces local for privileged work', () => {
  const result = router.routeTask({
    task: 'Search and summarize client confidential legal documents',
    tokens: 5000,
    budgetUsd: 10000,
  });
  assert.equal(result.tier, 'local');
  assert.equal(result.privileged, true);
  assert.equal(result.reason.includes('Privileged work'), true);
});

test('routeTask downgrades to local when budget exceeded', () => {
  const result = router.routeTask({
    task: 'Design a complex distributed architecture',
    tokens: 8000,
    budgetUsd: 0.01, // tiny budget
  });
  assert.equal(result.tier, 'local');
  assert.equal(result.exceedsBudget, true);
  assert.ok(result.reason.includes('Budget exceeded'));
});

test('routeTask respects custom budget override', () => {
  const result = router.routeTask({
    task: 'Sort emails',
    tokens: 1500,
    budgetUsd: 10000, // won't trigger unless local downgrade
  });
  // Simple task stays local regardless
  assert.equal(result.tier, 'local');
});

test('classifyComplexity classifies simple tasks as low', () => {
  const result = router.classifyComplexity('sort and classify emails', 1000);
  assert.equal(result, 'low');
});

test('classifyComplexity classifies complex tasks as high', () => {
  const result = router.classifyComplexity('Design a protocol for multi-agent consensus', 8000);
  assert.equal(result, 'high');
});

test('classifyComplexity classifies medium tasks correctly', () => {
  const result = router.classifyComplexity('Review this PR diff for regressions', 5000);
  assert.equal(result, 'medium');
});

test('isPrivileged detects privileged content patterns', () => {
  assert.equal(router.isPrivileged('Review client confidential legal contract'), true);
  assert.equal(router.isPrivileged('Summarize medical patient records'), true);
  assert.equal(router.isPrivileged('Sort these emails into folders'), false);
  assert.equal(router.isPrivileged('Count the lines in this file'), false);
});

test('auditTask scores repetitive tasks', () => {
  const result = router.auditTask({
    title: 'Manual PR review checklist',
    minutes: 45,
    cost: 50,
    complexity: 3, // easy to automate
    frequency: 'daily',
  });
  assert.ok(result.priorityScore > 25);
  assert.equal(result.recommendation, 'automate_now');
  assert.ok(result.annualTimeWasteMinutes > 0);
});

test('auditTask scores low-priority tasks as keep_manual', () => {
  const result = router.auditTask({
    title: 'One-time config update',
    minutes: 5,
    cost: 0,
    complexity: 8, // hard to automate
    frequency: 'monthly',
  });
  assert.equal(result.recommendation, 'keep_manual');
});

test('TIER_DEFS has three tiers with correct properties', () => {
  assert.ok(router.TIER_DEFS.local);
  assert.ok(router.TIER_DEFS.fastCloud);
  assert.ok(router.TIER_DEFS.capable);

  assert.equal(router.TIER_DEFS.local.costPerMillionTokens, 0.0);
  assert.equal(router.TIER_DEFS.local.leavesMachine, false);
  assert.equal(router.TIER_DEFS.capable.leavesMachine, true);
  assert.ok(router.TIER_DEFS.fastCloud.costPerMillionTokens > 0);
});

test('loadBudget creates default budget when no file exists', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-budget-test-'));
  try {
    const origHome = process.env.HOME;
    process.env.HOME = tmpDir;
    // Clear cached budget
    delete require.cache[require.resolve('../scripts/cost-router')];

    const budget = router.loadBudget();
    assert.equal(budget.monthlyBudgetUsd, 0);
    assert.equal(budget.spentThisMonth, 0);
    assert.deepEqual(budget.requests, []);

    process.env.HOME = origHome;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('getSlippingDashboard returns structured dashboard', () => {
  const dash = router.getSlippingDashboard();
  assert.ok(dash.timestamp);
  assert.ok(Array.isArray(dash.sections));
  assert.ok(dash.sections.find((s) => s.name === 'who-needs-you'));
  assert.ok(dash.sections.find((s) => s.name === 'what-is-slipping'));
  assert.ok(dash.sections.find((s) => s.name === 'overnight-activity'));
});
