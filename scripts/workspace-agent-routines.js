#!/usr/bin/env node
'use strict';

const ROUTINE_TYPES = Object.freeze({
  security_audit: {
    schedule: 'daily',
    trigger: 'schedule',
    approval: 'pull_request_required',
    checks: ['npm test', 'npm run test:coverage', 'npm run self-heal:check'],
  },
  post_merge_hygiene: {
    schedule: 'after_pr_merge',
    trigger: 'webhook',
    approval: 'pull_request_required',
    checks: ['npm run self-heal:check', 'npm run prove:automation'],
  },
  data_table_refresh: {
    schedule: 'daily',
    trigger: 'schedule',
    approval: 'human_approval_for_schema_changes',
    checks: ['npm run test:data-pipeline', 'npm run self-heal:check'],
  },
  portfolio_research: {
    schedule: 'hourly_market_window',
    trigger: 'schedule',
    approval: 'always_ask_before_trade_or_publish',
    checks: ['risk_limit_check', 'source_reconciliation', 'decision_journal_append'],
  },
});

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeConnector(connector) {
  if (typeof connector === 'string') {
    return {
      name: connector,
      mode: 'read',
      auth: 'user_or_service_account',
      approval: 'always_ask_for_write',
    };
  }
  return {
    name: normalizeText(connector?.name) || 'custom',
    mode: normalizeText(connector?.mode) || 'read',
    auth: normalizeText(connector?.auth) || 'user_or_service_account',
    approval: normalizeText(connector?.approval) || 'always_ask_for_write',
  };
}

function buildWorkspaceAgentRoutine(input = {}) {
  const type = normalizeText(input.type) || 'post_merge_hygiene';
  const defaults = ROUTINE_TYPES[type] || ROUTINE_TYPES.post_merge_hygiene;
  const name = normalizeText(input.name) || `ThumbGate ${type.replaceAll('_', ' ')}`;
  const connectors = Array.isArray(input.connectors) ? input.connectors.map(normalizeConnector) : [];
  const checks = Array.isArray(input.checks) && input.checks.length > 0 ? input.checks : defaults.checks;
  const routine = {
    name,
    type,
    repository: normalizeText(input.repository) || 'IgorGanapolsky/ThumbGate',
    trigger: normalizeText(input.trigger) || defaults.trigger,
    schedule: normalizeText(input.schedule) || defaults.schedule,
    modelPolicy: normalizeText(input.modelPolicy) || 'use_best_available_for_audit_then_small_model_for_summaries',
    connectors,
    permissionMode: normalizeText(input.permissionMode) || 'least_privilege',
    approvalPolicy: normalizeText(input.approvalPolicy) || defaults.approval,
    branchPolicy: 'feature_branch_only',
    checks,
    evidenceRequired: [
      'branch_name',
      'commit_sha',
      'test_output',
      'decision_journal_entry',
      'pull_request_url_or_no_change_reason',
    ],
    blockedActions: [
      'direct_main_write',
      'secret_persistence',
      'credentialed_write_without_approval',
      'schema_migration_without_approval',
      'trade_or_portfolio_action_without_risk_limits',
    ],
  };

  return {
    routine,
    prompt: [
      `Run ${routine.name} for ${routine.repository}.`,
      'Use ThumbGate before every risky tool action.',
      'Create a feature branch for any code change.',
      `Run checks: ${routine.checks.join(', ')}.`,
      'Append evidence to the decision journal.',
      'Open a pull request only when changes and proof exist.',
      'Stop and report blockers instead of bypassing checks.',
    ].join(' '),
  };
}

function buildWorkspaceAgentDirectory(input = {}) {
  const repository = normalizeText(input.repository) || 'IgorGanapolsky/ThumbGate';
  return {
    generatedAt: normalizeText(input.generatedAt) || new Date().toISOString(),
    directory: [
      buildWorkspaceAgentRoutine({ type: 'security_audit', repository }).routine,
      buildWorkspaceAgentRoutine({ type: 'post_merge_hygiene', repository }).routine,
      buildWorkspaceAgentRoutine({ type: 'data_table_refresh', repository }).routine,
      buildWorkspaceAgentRoutine({ type: 'portfolio_research', repository }).routine,
    ],
  };
}

module.exports = {
  ROUTINE_TYPES,
  buildWorkspaceAgentDirectory,
  buildWorkspaceAgentRoutine,
};
