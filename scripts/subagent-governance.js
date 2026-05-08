#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { appendJsonl, readJsonl } = require('./fs-utils');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_ROLE_TEMPLATE_PATH = path.join(PROJECT_ROOT, 'config', 'subagent-role-templates.json');
const DEFAULT_LEDGER_NAME = 'subagent-runs.jsonl';
const DEFAULT_FEEDBACK_DIR = path.join(PROJECT_ROOT, '.thumbgate');

function loadRoleTemplates(options = {}) {
  const filePath = options.filePath || DEFAULT_ROLE_TEMPLATE_PATH;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function listRoleTemplates(options = {}) {
  return Object.keys(loadRoleTemplates(options).roles || {}).sort();
}

function getRoleTemplate(roleName, options = {}) {
  const templates = loadRoleTemplates(options);
  const role = templates.roles && templates.roles[roleName];
  if (!role) {
    throw new Error(`Unknown subagent role: ${roleName}`);
  }
  return role;
}

function normalizeWriteScope(scope) {
  return [...new Set((Array.isArray(scope) ? scope : [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean))]
    .sort();
}

function scopesOverlap(left, right) {
  if (!left || !right) return false;
  const a = left.replace(/\/+$/, '');
  const b = right.replace(/\/+$/, '');
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function findWriteScopeConflicts(activeRuns, candidateScope) {
  const candidate = normalizeWriteScope(candidateScope);
  if (candidate.length === 0) return [];

  return (Array.isArray(activeRuns) ? activeRuns : [])
    .filter((run) => ['planned', 'running', 'in_progress'].includes(run.status || 'running'))
    .flatMap((run) => {
      const activeScope = normalizeWriteScope(run.writeScope);
      return candidate
        .filter((candidateEntry) => activeScope.some((activeEntry) => scopesOverlap(activeEntry, candidateEntry)))
        .map((conflictingPath) => ({
          runId: run.runId || run.id || 'unknown',
          role: run.role || 'unknown',
          conflictingPath,
        }));
    });
}

function evaluateSubagentRunPlan(plan = {}, options = {}) {
  const templates = loadRoleTemplates(options);
  const gates = templates.lifecycleGates || {};
  const blockers = [];
  const warnings = [];
  const role = templates.roles && templates.roles[plan.role];

  if (!role) {
    blockers.push(`Unknown subagent role: ${plan.role || '(missing)'}`);
  }

  const owner = String(plan.owner || '').trim();
  const task = String(plan.task || '').trim();
  if (gates.requireOwner !== false && !owner) blockers.push('Subagent run requires an owner.');
  if (gates.requireTask !== false && !task) blockers.push('Subagent run requires a task.');

  const maxRuntime = role && Number.isFinite(role.maxRuntimeMinutes)
    ? role.maxRuntimeMinutes
    : (gates.defaultMaxRuntimeMinutes || 45);
  const estimatedRuntime = Number(plan.estimatedRuntimeMinutes || 0);
  if (estimatedRuntime > maxRuntime) {
    blockers.push(`Estimated runtime ${estimatedRuntime}m exceeds ${maxRuntime}m for ${plan.role}.`);
  }

  const normalizedWriteScope = normalizeWriteScope(plan.writeScope || (role && role.writeScope));
  const conflicts = gates.requireDisjointWriteScopes === false
    ? []
    : findWriteScopeConflicts(plan.activeRuns, normalizedWriteScope);
  for (const conflict of conflicts) {
    blockers.push(`Write scope conflicts with ${conflict.runId} (${conflict.role}) at ${conflict.conflictingPath}.`);
  }

  const wantsAgentMessaging = Boolean(plan.agentToAgentMessaging);
  if (wantsAgentMessaging && !(role && role.allowAgentMessaging)) {
    blockers.push('Agent-to-agent messaging is blocked for this role.');
  }

  const evidence = new Set(Array.isArray(plan.expectedEvidence) ? plan.expectedEvidence : []);
  const missingEvidence = (role && Array.isArray(role.requiredEvidence) ? role.requiredEvidence : [])
    .filter((item) => !evidence.has(item));
  if (missingEvidence.length > 0) {
    warnings.push(`Expected evidence should include: ${missingEvidence.join(', ')}.`);
  }

  const normalizedPlan = {
    runId: plan.runId || `subagent-${Date.now()}`,
    role: plan.role,
    task,
    owner,
    pattern: plan.pattern || (role && role.pattern) || 'inline_tool_subagent',
    mcpProfile: plan.mcpProfile || (role && role.mcpProfile) || 'default',
    writeScope: normalizedWriteScope,
    expectedEvidence: [...evidence].sort(),
    estimatedRuntimeMinutes: estimatedRuntime || null,
    externalActions: plan.externalActions || (role && role.externalActions) || 'none',
  };

  return {
    allowed: blockers.length === 0,
    status: blockers.length === 0 ? 'approved' : 'blocked',
    blockers,
    warnings,
    roleTemplate: role || null,
    normalizedPlan,
  };
}

function buildPrSheriffFanout(prNumber, options = {}) {
  const pr = String(prNumber || '').replace(/^#/, '').trim();
  if (!pr) throw new Error('PR number is required.');
  const owner = options.owner || 'pr-sheriff';
  const plans = [
    ['pr_ci_checker', `Inspect required checks, pending jobs, and failing logs for PR #${pr}.`],
    ['pr_review_checker', `Inspect review decision, requested changes, and unresolved threads for PR #${pr}.`],
    ['pr_diff_summarizer', `Summarize changed files, blast radius, and merge risk for PR #${pr}.`],
    ['pr_branch_hygiene', `Check branch age, merge base freshness, and orphaned worktrees for PR #${pr}.`],
  ].map(([role, task], index) => evaluateSubagentRunPlan({
    runId: `pr-${pr}-${role}`,
    role,
    task,
    owner,
    expectedEvidence: getRoleTemplate(role, options).requiredEvidence,
    estimatedRuntimeMinutes: 15 + index,
  }, options).normalizedPlan);

  return {
    prNumber: pr,
    pattern: 'fan_out_with_wait',
    waitPolicy: 'wait_for_all_terminal',
    maxConcurrentRuns: Math.min(plans.length, loadRoleTemplates(options).lifecycleGates.maxConcurrentRuns || plans.length),
    plans,
  };
}

function resolveLedgerPath(options = {}) {
  if (options.ledgerPath) return options.ledgerPath;
  return path.join(options.feedbackDir || DEFAULT_FEEDBACK_DIR, DEFAULT_LEDGER_NAME);
}

function appendSubagentRunLedger(entry, options = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    ...entry,
  };
  appendJsonl(resolveLedgerPath(options), payload);
  return payload;
}

function loadSubagentRunLedger(options = {}) {
  return readJsonl(resolveLedgerPath(options), { maxLines: options.maxLines || 500, tail: true });
}

function summarizeSubagentLedger(entries = [], options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const staleAfterMinutes = options.staleAfterMinutes || 60;
  const byRole = {};
  const byStatus = {};
  const staleRuns = [];

  for (const entry of entries) {
    const role = entry.role || 'unknown';
    const status = entry.status || 'unknown';
    byRole[role] = (byRole[role] || 0) + 1;
    byStatus[status] = (byStatus[status] || 0) + 1;
    if (['running', 'in_progress'].includes(status) && entry.timestamp) {
      const ageMinutes = (now - new Date(entry.timestamp)) / 60000;
      if (ageMinutes > staleAfterMinutes) {
        staleRuns.push({
          runId: entry.runId || entry.id || 'unknown',
          role,
          ageMinutes: Math.round(ageMinutes),
        });
      }
    }
  }

  return {
    totalRuns: entries.length,
    byRole,
    byStatus,
    staleRuns,
  };
}

function parseCliArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command };
  for (let i = 0; i < rest.length; i += 1) {
    const value = rest[i];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    args[key] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
  }
  return args;
}

function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.command === 'roles') {
    console.log(JSON.stringify(listRoleTemplates(), null, 2));
    return;
  }
  if (args.command === 'pr-sheriff') {
    console.log(JSON.stringify(buildPrSheriffFanout(args.pr || args._), null, 2));
    return;
  }
  if (args.command === 'evaluate') {
    const plan = JSON.parse(args.json || '{}');
    const result = evaluateSubagentRunPlan(plan);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.allowed ? 0 : 1);
  }
  if (args.command === 'ledger') {
    const entries = loadSubagentRunLedger({ feedbackDir: args['feedback-dir'] });
    console.log(JSON.stringify(summarizeSubagentLedger(entries), null, 2));
    return;
  }
  console.log('Usage: node scripts/subagent-governance.js roles|pr-sheriff --pr 123|evaluate --json {...}|ledger');
}

module.exports = {
  DEFAULT_ROLE_TEMPLATE_PATH,
  DEFAULT_LEDGER_NAME,
  loadRoleTemplates,
  listRoleTemplates,
  getRoleTemplate,
  normalizeWriteScope,
  findWriteScopeConflicts,
  evaluateSubagentRunPlan,
  buildPrSheriffFanout,
  appendSubagentRunLedger,
  loadSubagentRunLedger,
  summarizeSubagentLedger,
};

if (require.main === module) {
  main();
}
