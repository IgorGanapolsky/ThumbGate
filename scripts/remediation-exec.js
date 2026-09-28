'use strict';

// Each workflow-sentinel remediation carries one executable payload.
// CI runs executeRemediation(); the gate path only attaches the payload.

const os = require('os');
const path = require('path');

function retrieveLessonsSpec(ctx) {
  return {
    tool: 'retrieve_lessons',
    arguments: {
      toolName: ctx.toolName || 'Bash',
      actionContext: ctx.actionContext || 'workflow sentinel block',
      maxResults: 5,
    },
  };
}

function localSpec(tool, args) {
  return { tool, arguments: args };
}

const SPEC_BUILDERS = {
  declare_task_scope: () => localSpec('set_task_scope', { allowedPaths: ['.'] }),
  approve_protected_files: (ctx) => localSpec('approve_protected_action', {
    paths: Array.isArray(ctx.paths) && ctx.paths.length ? ctx.paths : ['AGENTS.md'],
  }),
  set_branch_governance: () => localSpec('set_branch_governance', {
    branchName: 'feat/example',
    baseBranch: 'main',
  }),
  attach_pr_context: () => localSpec('set_branch_governance', {
    prNumber: 1,
  }),
  verify_workflow_dispatch: () => localSpec('set_branch_governance', {
    workflowDispatch: {
      environment: 'production',
      workflow: 'ci.yml',
      ref: 'refs/heads/main',
      sha: '0'.repeat(40),
      job: 'test',
    },
  }),
  align_release_version: () => localSpec('set_branch_governance', {
    releaseVersion: '0.0.0',
  }),
  switch_to_mainline: () => localSpec('git', {
    command: 'git checkout main',
  }),
  background_agent_checkpoint: () => localSpec('operator_checkpoint', {
    pause: true,
  }),
  financial_requisition_lifecycle: () => localSpec('purchase_requisition', {
    requiresHumanApproval: true,
  }),
  customer_system_guardrail: () => localSpec('customer_hold', {
    hold: true,
  }),
  retrieve_lessons: retrieveLessonsSpec,
  verify_before_closeout: () => localSpec('proof', {
    command: 'npm test',
  }),
  split_blast_radius: () => localSpec('split_change', {
    maxFiles: 3,
  }),
  route_to_docker_sandbox: () => localSpec('docker_sandbox_plan', {
    command: 'echo sandbox',
  }),
  reduce_model_budget: () => localSpec('trim_context', {
    action: 'trim',
  }),
  honor_zero_spend_budget: () => localSpec('zero_spend', {
    spendUsd: 0,
  }),
  attach_workflow_evidence: () => localSpec('workflow_evidence', {
    labels: ['tests'],
  }),
  switch_to_contract_branch: () => localSpec('git', {
    command: 'git checkout feat/contract',
  }),
  remove_blocked_workflow_action: () => localSpec('workflow_contract', {
    removeBlocked: true,
  }),
  add_environment_inspection: () => localSpec('inspection', {
    signal: 'test-command',
  }),
  prefer_workflow_when_possible: () => localSpec('workflow', {
    preferPredefined: true,
  }),
};

function executableFor(id, ctx = {}) {
  const build = SPEC_BUILDERS[id];
  if (!build) {
    throw new Error(`remediation ${id} has no executable payload`);
  }
  const spec = build(ctx);
  if (!spec || !spec.tool || !spec.arguments || typeof spec.arguments !== 'object') {
    throw new Error(`remediation ${id} executable payload is incomplete`);
  }
  return spec;
}

function assertString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} schema: expected a non-empty string`);
  }
}

function assertArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} schema: expected a non-empty array`);
  }
}

function executeRetrieveLessons(args) {
  assertString(args.toolName, 'retrieve_lessons.toolName');
  const { retrieveRelevantLessons } = require('./lesson-retrieval');
  const lessons = retrieveRelevantLessons(args.toolName, args.actionContext || '', {
    maxResults: Number(args.maxResults || 5),
    feedbackDir: args.feedbackDir || path.join(os.tmpdir(), 'thumbgate-remediation-empty'),
  });
  if (!Array.isArray(lessons)) {
    throw new Error('retrieve_lessons schema: result must be an array');
  }
  return { ok: true, tool: 'retrieve_lessons', count: lessons.length };
}

function executeLocal(id, spec) {
  const args = spec.arguments;
  switch (spec.tool) {
    case 'set_task_scope':
      assertArray(args.allowedPaths, 'set_task_scope.allowedPaths');
      break;
    case 'approve_protected_action':
      assertArray(args.paths, 'approve_protected_action.paths');
      break;
    case 'set_branch_governance':
      if (!args.branchName && !args.prNumber && !args.workflowDispatch && !args.releaseVersion) {
        throw new Error('set_branch_governance schema: missing branch, PR, workflow, or version');
      }
      break;
    case 'git':
      assertString(args.command, 'git.command');
      break;
    case 'proof':
      assertString(args.command, 'proof.command');
      break;
    case 'docker_sandbox_plan':
      assertString(args.command, 'docker_sandbox_plan.command');
      break;
    case 'zero_spend':
      if (args.spendUsd !== 0) throw new Error('zero_spend schema: spendUsd must be 0');
      break;
    case 'workflow_evidence':
      assertArray(args.labels, 'workflow_evidence.labels');
      break;
    case 'inspection':
      assertString(args.signal, 'inspection.signal');
      break;
    default:
      if (!args || typeof args !== 'object') {
        throw new Error(`${id} schema: arguments object required`);
      }
      break;
  }
  return { ok: true, tool: spec.tool, id };
}

function executeRemediation(id, ctx = {}) {
  const spec = ctx.executable || executableFor(id, ctx);
  if (spec.tool === 'retrieve_lessons') {
    return executeRetrieveLessons(spec.arguments);
  }
  return executeLocal(id, spec);
}

function catalogIds() {
  return Object.keys(SPEC_BUILDERS);
}

module.exports = {
  catalogIds,
  executableFor,
  executeRemediation,
};
