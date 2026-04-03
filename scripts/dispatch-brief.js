#!/usr/bin/env node
'use strict';

const { summarizePermissionTier } = require('./agent-readiness');
const { getOperationalDashboard } = require('./operational-dashboard');

const DISPATCH_TASK_DESCRIPTIONS = {
  recall: 'Recall prior mistakes and prevention rules before planning.',
  feedback_summary: 'Summarize recent wins, failures, and operator notes.',
  search_lessons: 'Search promoted lessons and inspect what corrective action the system linked to each one.',
  retrieve_lessons: 'Retrieve top-K relevant lessons for a given tool/action context (per-action guidance).',
  search_rlhf: 'Search raw RLHF feedback, ContextFS memory, and prevention rules.',
  feedback_stats: 'Inspect approval trends and failure domains.',
  diagnose_failure: 'Explain why a run failed or was blocked.',
  list_intents: 'List available workflow plans without executing them.',
  plan_intent: 'Plan a workflow with checkpoints and no execution.',
  context_provenance: 'Audit recent context and evidence decisions.',
  gate_stats: 'Review blocked and warned gate trends.',
  dashboard: 'Summarize health, proof, gates, and pipeline metrics.',
  get_business_metrics: 'Read revenue, conversion, and customer metrics.',
  describe_semantic_entity: 'Explain Customer, Revenue, or Funnel state.',
  enforcement_matrix: 'Full pipeline state: feedback counts, promotion rate, active gates, rejection ledger.',
  get_reliability_rules: 'Review active prevention rules and success patterns.',
  describe_reliability_entity: 'Alias for semantic entity definitions.',
};

const DISPATCH_BLOCKED_TASKS = [
  'Direct code edits or git writes from the primary checkout.',
  'Starting or completing handoffs from the remote session.',
  'Memory writes, context-pack writes, or gate satisfaction mutations.',
  'Admin-only billing or workflow mutation endpoints.',
];

const DISPATCH_PROMPTS = [
  'Summarize revenue, funnel, gates, and proof-backed workflow health for the last 7d.',
  'Explain the top blocked gate and the repeated mistake it is preventing.',
  'Plan the next workflow-hardening sprint for this repo without executing any changes.',
];

function buildDispatchBrief(data, options = {}) {
  const profileName = String(options.profile || 'dispatch').trim() || 'dispatch';
  const permissions = summarizePermissionTier(profileName);
  const analytics = data.analytics || {};
  const revenue = analytics.revenue || {};
  const funnel = analytics.funnel || {};
  const northStar = analytics.northStar || {};
  const gateStats = data.gateStats || {};
  const readiness = data.readiness || {};
  const operational = data.operational || {};

  const allowedTasks = permissions.allowedTools
    .map((toolName) => ({
      tool: toolName,
      description: DISPATCH_TASK_DESCRIPTIONS[toolName],
    }))
    .filter((entry) => entry.description);

  return {
    generatedAt: new Date().toISOString(),
    source: options.source || operational.source || 'local',
    fallbackReason: options.fallbackReason || operational.fallbackReason || null,
    profile: permissions.profile,
    tier: permissions.tier,
    writeCapable: permissions.writeCapable,
    readiness: {
      overallStatus: readiness.overallStatus || 'unknown',
      runtimeMode: readiness.runtime && readiness.runtime.mode ? readiness.runtime.mode : 'unknown',
      bootstrapReady: Boolean(readiness.bootstrap && readiness.bootstrap.ready),
    },
    metrics: {
      bookedRevenueUsd: Number(((Number(revenue.bookedRevenueCents || 0)) / 100).toFixed(2)),
      paidOrders: revenue.paidOrders || 0,
      uniqueLeads: funnel.uniqueLeads || 0,
      visitors: funnel.visitors || 0,
      checkoutStarts: funnel.checkoutStarts || 0,
      weeklyProofBackedWorkflowRuns: northStar.weeklyActiveProofBackedWorkflowRuns || 0,
      weeklyTeamsRunningProofBackedWorkflows: northStar.weeklyTeamsRunningProofBackedWorkflows || 0,
      activeGates: gateStats.totalGates || 0,
      blockedActions: gateStats.blocked || 0,
      warnedActions: gateStats.warned || 0,
      topBlockedGate: gateStats.topBlocked
        ? {
          id: gateStats.topBlocked,
          count: gateStats.topBlockedCount || 0,
        }
        : null,
    },
    allowedTasks,
    blockedTasks: DISPATCH_BLOCKED_TASKS,
    promptTemplates: DISPATCH_PROMPTS,
  };
}

function formatDispatchBrief(brief) {
  const lines = [];
  lines.push('Dispatch Ops Brief');
  lines.push('─'.repeat(40));
  lines.push(`Source                : ${brief.source}${brief.fallbackReason ? ` (${brief.fallbackReason})` : ''}`);
  lines.push(`Profile               : ${brief.profile} (${brief.tier})`);
  lines.push(`Readiness             : ${brief.readiness.overallStatus}`);
  lines.push(`Runtime               : ${brief.readiness.runtimeMode}`);
  lines.push(`Bootstrap             : ${brief.readiness.bootstrapReady ? 'ready' : 'missing context'}`);
  lines.push('');
  lines.push('Key Metrics');
  lines.push(`  Booked revenue      : $${brief.metrics.bookedRevenueUsd.toFixed(2)}`);
  lines.push(`  Paid orders         : ${brief.metrics.paidOrders}`);
  lines.push(`  Unique leads        : ${brief.metrics.uniqueLeads}`);
  lines.push(`  Visitors            : ${brief.metrics.visitors}`);
  lines.push(`  Checkout starts     : ${brief.metrics.checkoutStarts}`);
  lines.push(`  Weekly proof runs   : ${brief.metrics.weeklyProofBackedWorkflowRuns}`);
  lines.push(`  Weekly teams        : ${brief.metrics.weeklyTeamsRunningProofBackedWorkflows}`);
  lines.push(`  Active gates        : ${brief.metrics.activeGates}`);
  lines.push(`  Blocked actions     : ${brief.metrics.blockedActions}`);
  lines.push(`  Warned actions      : ${brief.metrics.warnedActions}`);
  if (brief.metrics.topBlockedGate) {
    lines.push(`  Top blocked gate    : ${brief.metrics.topBlockedGate.id} (${brief.metrics.topBlockedGate.count}x)`);
  }
  lines.push('');
  lines.push('Safe Remote Tasks');
  brief.allowedTasks.forEach((entry) => {
    lines.push(`- ${entry.tool}: ${entry.description}`);
  });
  lines.push('');
  lines.push('Do Not Do From Dispatch');
  brief.blockedTasks.forEach((task) => {
    lines.push(`- ${task}`);
  });
  lines.push('');
  lines.push('Prompt Templates');
  brief.promptTemplates.forEach((prompt) => {
    lines.push(`- ${prompt}`);
  });
  return `${lines.join('\n')}\n`;
}

async function getDispatchBrief(options = {}) {
  const profile = String(options.profile || 'dispatch').trim() || 'dispatch';
  const { source, data, fallbackReason } = await getOperationalDashboard(options);
  return buildDispatchBrief(data, { profile, source, fallbackReason });
}

module.exports = {
  DISPATCH_BLOCKED_TASKS,
  DISPATCH_PROMPTS,
  buildDispatchBrief,
  formatDispatchBrief,
  getDispatchBrief,
};

if (require.main === module) {
  getDispatchBrief()
    .then((brief) => {
      process.stdout.write(formatDispatchBrief(brief));
    })
    .catch((err) => {
      console.error(err && err.message ? err.message : err);
      process.exit(1);
    });
}
