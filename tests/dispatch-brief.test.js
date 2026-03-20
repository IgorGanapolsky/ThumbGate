const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDispatchBrief,
  formatDispatchBrief,
} = require('../scripts/dispatch-brief');

test('buildDispatchBrief produces a dispatch-safe remote ops snapshot', () => {
  const brief = buildDispatchBrief({
    operational: {
      source: 'local',
      fallbackReason: 'Hosted operational dashboard is not configured.',
    },
    analytics: {
      revenue: {
        bookedRevenueCents: 4900,
        paidOrders: 1,
      },
      funnel: {
        uniqueLeads: 3,
        visitors: 12,
        checkoutStarts: 2,
      },
      northStar: {
        weeklyActiveProofBackedWorkflowRuns: 2,
        weeklyTeamsRunningProofBackedWorkflows: 1,
      },
    },
    gateStats: {
      totalGates: 5,
      blocked: 7,
      warned: 2,
      topBlocked: 'push-without-thread-check',
      topBlockedCount: 4,
    },
    readiness: {
      overallStatus: 'ready',
      runtime: {
        mode: 'container',
      },
      bootstrap: {
        ready: true,
      },
    },
  });

  assert.equal(brief.profile, 'dispatch');
  assert.equal(brief.tier, 'dispatch');
  assert.equal(brief.writeCapable, false);
  assert.equal(brief.metrics.bookedRevenueUsd, 49);
  assert.equal(brief.metrics.paidOrders, 1);
  assert.equal(brief.metrics.activeGates, 5);
  assert.equal(brief.metrics.topBlockedGate.id, 'push-without-thread-check');
  assert.ok(brief.allowedTasks.some((task) => task.tool === 'dashboard'));
  assert.ok(!brief.allowedTasks.some((task) => task.tool === 'start_handoff'));
  assert.ok(brief.blockedTasks.some((task) => /handoffs/i.test(task)));
});

test('formatDispatchBrief renders prompt-ready output', () => {
  const output = formatDispatchBrief({
    source: 'local',
    fallbackReason: null,
    profile: 'dispatch',
    tier: 'dispatch',
    readiness: {
      overallStatus: 'ready',
      runtimeMode: 'container',
      bootstrapReady: true,
    },
    metrics: {
      bookedRevenueUsd: 49,
      paidOrders: 1,
      uniqueLeads: 3,
      visitors: 12,
      checkoutStarts: 2,
      weeklyProofBackedWorkflowRuns: 2,
      weeklyTeamsRunningProofBackedWorkflows: 1,
      activeGates: 5,
      blockedActions: 7,
      warnedActions: 2,
      topBlockedGate: {
        id: 'push-without-thread-check',
        count: 4,
      },
    },
    allowedTasks: [
      {
        tool: 'dashboard',
        description: 'Summarize health, proof, gates, and pipeline metrics.',
      },
    ],
    blockedTasks: [
      'Starting or completing handoffs from the remote session.',
    ],
    promptTemplates: [
      'Summarize revenue, funnel, gates, and proof-backed workflow health for the last 7d.',
    ],
  });

  assert.match(output, /Dispatch Ops Brief/);
  assert.match(output, /Profile\s+: dispatch \(dispatch\)/);
  assert.match(output, /Booked revenue\s+: \$49\.00/);
  assert.match(output, /dashboard: Summarize health, proof, gates, and pipeline metrics\./);
  assert.match(output, /Do Not Do From Dispatch/);
  assert.match(output, /Prompt Templates/);
});
