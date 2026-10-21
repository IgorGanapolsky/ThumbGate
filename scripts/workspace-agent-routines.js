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

const SOURCE_URL = 'https://claude.com/resources/articles/introducing-routines-in-claude-code';
const DOCS_URL = 'https://code.claude.com/docs/en/routines';
const GATE_ID = 'claude-routines-governance-diode';

const CLAUDE_ROUTINE_ARCHETYPES = Object.freeze({
  backlog_maintenance: {
    schedule: '7 2 * * 1-5',
    triggers: ['schedule'],
    approval: 'pull_request_required',
    checks: ['npm test', 'npm run self-heal:check'],
  },
  alert_triage: {
    schedule: null,
    triggers: ['api'],
    approval: 'draft_pr_only_no_auto_merge',
    checks: ['npm test', 'node scripts/perf-budget-check.js --json'],
  },
  bespoke_code_review: {
    schedule: null,
    triggers: ['github'],
    githubEvent: 'pull_request.opened',
    approval: 'read_and_comment_only',
    checks: ['npm test', 'npm run self-heal:check'],
  },
  deploy_verification: {
    schedule: null,
    triggers: ['api'],
    approval: 'smoke_check_and_go_nogo_only',
    checks: ['node scripts/perf-budget-check.js --json', 'npm run prove:automation'],
  },
  docs_drift: {
    schedule: '7 3 * * 1',
    triggers: ['schedule'],
    approval: 'pull_request_required',
    checks: ['npm run mintlify:knowledge', 'npm test'],
  },
  library_port: {
    schedule: null,
    triggers: ['github'],
    githubEvent: 'pull_request.closed',
    approval: 'pull_request_required',
    checks: ['npm test', 'npm run prove:adapters'],
  },
});

const ROUTINE_PLAN_DAILY_CAPS = Object.freeze({
  pro: 5,
  max: 15,
  team: 25,
  enterprise: 25,
});

const ROUTINE_HOURLY_CAPS = Object.freeze({
  accountScheduledPerHour: 100,
  accountApiPerHour: 100,
  accountRunNowPerHour: 100,
  perTaskApiRunNowOneOffPerHour: 30,
});

const FORBIDDEN_WRITE_CONNECTORS_RE = /^(?:gmail|apple[\s_-]*mail|mail\.app|linkedin|x(?:\.com)?|twitter|resend)(?:\b|$)/i;
const APPROVAL_BYPASS_PAYLOAD_RE = /(?:\b(?:ignore\s+(?:all\s+)?previous\s+instructions|approve_protected_action|bypass\s+branch\s+protection|act\s+as\s+human\s+approval)\b|(?:^|\s)--admin\b)/i;

const RAIL_MAP = Object.freeze([
  {
    claudeRoutineFeature: 'Three trigger modes (Schedule, API /fire bearer endpoint, GitHub PR/Release webhooks) combinable on one routine',
    thumbgateRail: 'scripts/workspace-agent-routines.js (validateRoutineSchedule + evaluateGitHubRoutineTrigger)',
  },
  {
    claudeRoutineFeature: '<routine-fire-payload> wrapper treats dynamic API/Run-now text as untrusted data unless saved prompt opts in',
    thumbgateRail: 'wrapRoutineFirePayload + evaluateFirePayloadAdmission (escapes tag breakouts; blocks approval spoofing)',
  },
  {
    claudeRoutineFeature: 'Fired prompt attests only prior storage — never live user input, approval, or consent during the run',
    thumbgateRail: 'canActAsHumanApproval=false invariant; PreToolUse and branch-protection gates remain strictly enforced',
  },
  {
    claudeRoutineFeature: 'Minimum 1-hour cron interval, :07 off-hour jitter recommendation, and one-off auto-disable on completion',
    thumbgateRail: 'validateRoutineSchedule (rejects sub-hourly cron <60m, flags :00 herd collisions, transitions one_off -> completed)',
  },
  {
    claudeRoutineFeature: 'GitHub PR filter operators with full-string matches_regex (.*hotfix.* vs hotfix) and claude/ branch prefix',
    thumbgateRail: 'evaluateGitHubRoutineTrigger (8 PR fields, 6 operators, anchored full-value regex)',
  },
  {
    claudeRoutineFeature: 'All connected MCP connectors included by default; unused write connectors must be stripped before unattended runs',
    thumbgateRail: 'auditRoutineConnectors (strips unreferenced connectors; blocks outbound email/social write connectors)',
  },
  {
    claudeRoutineFeature: 'Green run status only means session exited without infra crash — check transcript for 403 host_not_allowed or tool errors',
    thumbgateRail: 'auditRoutineRunOutcome (fails closed on x-deny-reason: host_not_allowed, missing tools, or unverified test output)',
  },
]);

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
  const baseDirectory = [
    buildWorkspaceAgentRoutine({ type: 'security_audit', repository }).routine,
    buildWorkspaceAgentRoutine({ type: 'post_merge_hygiene', repository }).routine,
    buildWorkspaceAgentRoutine({ type: 'data_table_refresh', repository }).routine,
    buildWorkspaceAgentRoutine({ type: 'portfolio_research', repository }).routine,
  ];
  if (input.includeClaudeRoutines) {
    for (const [type, spec] of Object.entries(CLAUDE_ROUTINE_ARCHETYPES)) {
      baseDirectory.push(
        buildWorkspaceAgentRoutine({
          type,
          repository,
          trigger: spec.triggers.join('+'),
          schedule: spec.schedule || 'event_or_api_only',
          approvalPolicy: spec.approval,
          checks: spec.checks,
        }).routine
      );
    }
  }
  return {
    generatedAt: normalizeText(input.generatedAt) || new Date().toISOString(),
    directory: baseDirectory,
  };
}

/**
 * Wrap untrusted API `/fire` or `Run now` text in `<routine-fire-payload>`,
 * neutralizing tag-breakout attempts.
 */
function wrapRoutineFirePayload(rawText) {
  const text = normalizeText(rawText);
  const escaped = text
    .replace(/<\s*\/\s*routine-fire-payload\s*>/gi, '&lt;/routine-fire-payload&gt;')
    .replace(/<\s*routine-fire-payload[^>]*>/gi, '&lt;routine-fire-payload&gt;');
  return `<routine-fire-payload untrusted="true">\n${escaped}\n</routine-fire-payload>`;
}

/**
 * Evaluate whether an incoming `/fire` payload is safe and whether the routine's
 * saved prompt explicitly opts in to acting on `<routine-fire-payload>`.
 */
function evaluateFirePayloadAdmission({ prompt = '', fireText = '' } = {}) {
  const normalizedPrompt = normalizeText(prompt);
  const normalizedFireText = normalizeText(fireText);
  const promptOptsIn = /routine-fire-payload/i.test(normalizedPrompt);
  const spoofAttempt = APPROVAL_BYPASS_PAYLOAD_RE.test(normalizedFireText);
  const tagBreakAttempt = /<\s*\/?\s*routine-fire-payload/i.test(normalizedFireText);

  return {
    allowed: !spoofAttempt,
    canActAsHumanApproval: false,
    promptOptsIn,
    payloadHandling: !normalizedFireText
      ? 'none'
      : (spoofAttempt ? 'blocked_injection_or_approval_spoof' : (promptOptsIn ? 'untrusted_opt_in_context' : 'inert_unreferenced_context')),
    tagBreakEscaped: tagBreakAttempt,
    wrappedPayload: normalizedFireText ? wrapRoutineFirePayload(normalizedFireText) : null,
  };
}

/**
 * Validate routine schedule cadence (minimum 1h interval, :07 off-hour jitter,
 * one-off completion state, and null nextRunAt for API/GitHub-only tasks).
 */
function validateRoutineSchedule({
  triggers = ['schedule'],
  cron = '',
  oneOffTimestamp = null,
  oneOffExecuted = false,
} = {}) {
  const triggerList = Array.isArray(triggers) ? triggers : [triggers];
  const hasSchedule = triggerList.includes('schedule');
  if (!hasSchedule) {
    return {
      valid: true,
      hasSchedule: false,
      nextRunAt: null,
      status: 'active_event_or_api_only',
      warnings: [],
    };
  }

  if (oneOffTimestamp) {
    return {
      valid: true,
      hasSchedule: true,
      mode: 'one_off',
      enabled: !oneOffExecuted,
      status: oneOffExecuted ? 'completed' : 'scheduled_once',
      nextRunAt: oneOffExecuted ? null : oneOffTimestamp,
      warnings: [],
    };
  }

  const expr = normalizeText(cron);
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) {
    return {
      valid: false,
      reason: 'invalid_cron_expression',
      nextRunAt: null,
      warnings: [],
    };
  }

  const [minuteField, hourField] = parts;
  // Only a single fixed minute (0-59) guarantees at most one run per hour.
  if (!/^\d{1,2}$/.test(minuteField)) {
    return {
      valid: false,
      reason: 'minimum_interval_is_one_hour',
      nextRunAt: null,
      warnings: [],
    };
  }
  if (Number(minuteField) > 59) {
    return {
      valid: false,
      reason: 'invalid_cron_expression',
      nextRunAt: null,
      warnings: [],
    };
  }
  const warnings = [];
  if (minuteField === '0' || minuteField === '00') {
    warnings.push({
      id: 'top_of_hour_contention',
      message: 'Runs scheduled at :00 can start several minutes late under cloud queue contention; prefer an offset like :07.',
      recommendedCron: ['7', hourField, ...parts.slice(2)].join(' '),
    });
  }

  return {
    valid: true,
    hasSchedule: true,
    mode: 'recurring',
    enabled: true,
    status: 'scheduled_recurring',
    warnings,
  };
}

/**
 * Evaluate hourly and plan-tier daily rate limits for routine execution.
 */
function evaluateRoutineRateLimits({
  planTier = 'pro',
  dailyRunsUsed = 0,
  taskApiOrRunNowThisHour = 0,
  accountScheduledThisHour = 0,
  accountApiThisHour = 0,
  overageCreditsEnabled = false,
} = {}) {
  const tier = normalizeText(planTier).toLowerCase() || 'pro';
  const dailyCap = ROUTINE_PLAN_DAILY_CAPS[tier] || ROUTINE_PLAN_DAILY_CAPS.pro;
  const blockers = [];

  if (taskApiOrRunNowThisHour >= ROUTINE_HOURLY_CAPS.perTaskApiRunNowOneOffPerHour) {
    blockers.push('per_task_hourly_limit_exceeded_30');
  }
  if (accountScheduledThisHour >= ROUTINE_HOURLY_CAPS.accountScheduledPerHour) {
    blockers.push('account_scheduled_hourly_limit_exceeded_100');
  }
  if (accountApiThisHour >= ROUTINE_HOURLY_CAPS.accountApiPerHour) {
    blockers.push('account_api_hourly_limit_exceeded_100');
  }
  if (dailyRunsUsed >= dailyCap && !overageCreditsEnabled) {
    blockers.push(`daily_plan_cap_exceeded_${tier}_${dailyCap}`);
  }

  return {
    allowed: blockers.length === 0,
    planTier: tier,
    dailyCap,
    dailyRunsUsed,
    overageCreditsEnabled: Boolean(overageCreditsEnabled),
    blockers,
  };
}

function matchFilterCondition(fieldValue, operator, expected) {
  const op = normalizeText(operator).toLowerCase();
  if (Array.isArray(fieldValue)) {
    const list = fieldValue.map((v) => String(v));
    if (op === 'contains' || op === 'equals') return list.includes(String(expected));
    if (op === 'is_one_of') {
      const targets = Array.isArray(expected) ? expected.map(String) : [String(expected)];
      return list.some((item) => targets.includes(item));
    }
    if (op === 'is_not_one_of') {
      const targets = Array.isArray(expected) ? expected.map(String) : [String(expected)];
      return !list.some((item) => targets.includes(item));
    }
  }

  if (typeof fieldValue === 'boolean') {
    const boolExpected = expected === true || String(expected).toLowerCase() === 'true';
    return op === 'equals' ? fieldValue === boolExpected : false;
  }

  const actual = String(fieldValue ?? '');
  const target = String(expected ?? '');
  switch (op) {
    case 'equals':
      return actual === target;
    case 'contains':
      return actual.includes(target);
    case 'starts_with':
      return actual.startsWith(target);
    case 'is_one_of': {
      const set = Array.isArray(expected) ? expected.map(String) : target.split(',').map((s) => s.trim());
      return set.includes(actual);
    }
    case 'is_not_one_of': {
      const set = Array.isArray(expected) ? expected.map(String) : target.split(',').map((s) => s.trim());
      return !set.includes(actual);
    }
    case 'matches_regex': {
      // Claude Code Routines invariant: matches_regex tests the ENTIRE field value, not a substring.
      try {
        const anchored = new RegExp(`^(?:${target})$`);
        return anchored.test(actual);
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

/**
 * Evaluate a GitHub routine webhook trigger and its PR filters.
 * Every filter condition must match; each matched event spawns an independent
 * session on a `claude/`-prefixed branch starting from the PR head commit.
 */
function evaluateGitHubRoutineTrigger(trigger = {}, event = {}) {
  const subscribedCategory = normalizeText(trigger.category || 'pull_request');
  const subscribedAction = normalizeText(trigger.action || '*');
  const eventCategory = normalizeText(event.category || 'pull_request');
  const eventAction = normalizeText(event.action || 'opened');

  if (!['pull_request', 'release'].includes(subscribedCategory)) {
    return { matched: false, reason: 'unsupported_event_category' };
  }
  if (subscribedCategory !== eventCategory) {
    return { matched: false, reason: 'category_mismatch' };
  }
  if (subscribedAction !== '*' && subscribedAction !== eventAction) {
    return { matched: false, reason: 'action_mismatch' };
  }

  const filters = Array.isArray(trigger.filters) ? trigger.filters : [];
  const pr = event.pullRequest || event.pr || {};
  const failedFilters = [];

  for (const f of filters) {
    const field = normalizeText(f.field).toLowerCase();
    const value = pr[field];
    if (!matchFilterCondition(value, f.operator, f.value)) {
      failedFilters.push(field);
    }
  }

  if (failedFilters.length > 0) {
    return { matched: false, reason: 'filter_mismatch', failedFilters };
  }

  const branchSlug = normalizeText(trigger.branchSlug || pr.head_branch || 'routine-work')
    .replace(/^claude\//, '')
    .replace(/[^a-zA-Z0-9._/-]/g, '-');

  return {
    matched: true,
    isolatedSessionPerEvent: true,
    checkoutStartRef: eventCategory === 'pull_request' && pr.head_sha ? pr.head_sha : 'DEFAULT_BRANCH',
    pushBranch: `claude/${branchSlug}`,
  };
}

/**
 * Audit MCP connectors attached to a routine. Because Claude Code includes all
 * connected MCP servers by default and executes writes unattended, strip
 * unreferenced connectors and block outbound messaging/email write connectors.
 */
function auditRoutineConnectors({ connectors = [], prompt = '' } = {}) {
  const normalizedPrompt = normalizeText(prompt).toLowerCase();
  const normalized = (Array.isArray(connectors) ? connectors : []).map(normalizeConnector);
  const blockedWriteConnectors = [];
  const unusedDefaultConnectors = [];
  const keptConnectors = [];

  for (const conn of normalized) {
    if (conn.mode === 'write' && FORBIDDEN_WRITE_CONNECTORS_RE.test(conn.name)) {
      blockedWriteConnectors.push(conn.name);
      continue;
    }
    if (!normalizedPrompt.includes(conn.name.toLowerCase())) {
      unusedDefaultConnectors.push(conn.name);
      continue;
    }
    keptConnectors.push(conn);
  }

  return {
    ok: blockedWriteConnectors.length === 0 && unusedDefaultConnectors.length === 0,
    blockedWriteConnectors,
    unusedDefaultConnectors,
    keptConnectors,
  };
}

/**
 * Verify that a routine run outcome is judged by transcript + verifier proof,
 * never by a bare green session exit indicator.
 */
function auditRoutineRunOutcome({
  sessionStatus = 'green',
  transcript = '',
  testsPassed = false,
} = {}) {
  const text = normalizeText(transcript);
  const hostNotAllowed = /x-deny-reason:\s*host_not_allowed|\b403\b.*host_not_allowed/i.test(text);
  const missingConnectorTool = /missing\s+connector\s+tool|tool\s+not\s+found|mcp\s+error/i.test(text);
  const verifiedSuccess = sessionStatus === 'green' && !hostNotAllowed && !missingConnectorTool && Boolean(testsPassed);

  return {
    sessionStatus,
    verifiedSuccess,
    hostNotAllowed,
    missingConnectorTool,
    testsPassed: Boolean(testsPassed),
    reason: verifiedSuccess
      ? 'verified_by_transcript_and_tests'
      : (hostNotAllowed
        ? 'network_egress_blocked_host_not_allowed'
        : (missingConnectorTool ? 'missing_connector_tool_in_transcript' : 'green_session_exit_without_test_proof')),
  };
}

function buildClaudeRoutinesHonestyReport(options = {}) {
  const findings = [];
  const mapOnly = options.mapOnly === true || /^(1|true|yes|on)$/i.test(String(options['map-only'] || ''));

  if (typeof options.claim === 'string' && options.claim.trim()) {
    const claim = options.claim.trim();
    if (/\bgreen\s+status\s+means\s+the\s+work\s+succeeded\b/i.test(claim)) {
      findings.push({
        id: 'green-exit-is-not-task-success',
        severity: 'fail',
        gateId: GATE_ID,
        message: 'A green routine session status only means no infra crash; inspect the transcript and verifier output.',
      });
    }
    if (/\bfire\s+payload\s+approves\b|\btrigger\s+acts\s+as\s+human\s+approval\b/i.test(claim)) {
      findings.push({
        id: 'trigger-is-not-human-consent',
        severity: 'fail',
        gateId: GATE_ID,
        message: 'A routine trigger or <routine-fire-payload> attests only prior prompt storage, never live human approval.',
      });
    }
  }

  return {
    ok: findings.length === 0,
    status: findings.length === 0 ? 'ready' : 'fail',
    sourceUrl: SOURCE_URL,
    docsUrl: DOCS_URL,
    gateId: GATE_ID,
    railMap: RAIL_MAP,
    ...(mapOnly
      ? {}
      : {
          archetypes: Object.keys(CLAUDE_ROUTINE_ARCHETYPES),
          planDailyCaps: ROUTINE_PLAN_DAILY_CAPS,
          hourlyCaps: ROUTINE_HOURLY_CAPS,
        }),
    findings,
  };
}

function formatClaudeRoutinesHonestyReport(report) {
  const lines = [
    `Claude Code Routines Governance Honesty (${report.status.toUpperCase()})`,
    `Source: ${report.sourceUrl}`,
    `Docs: ${report.docsUrl}`,
    '',
    'Transferred Architectural Rails:',
  ];
  for (const row of report.railMap) {
    lines.push(`  - ${row.claudeRoutineFeature}`);
    lines.push(`    -> ${row.thumbgateRail}`);
  }
  if (report.findings.length > 0) {
    lines.push('');
    lines.push('Findings:');
    for (const f of report.findings) {
      lines.push(`  - [${f.id}] ${f.message}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function runCli(argv = process.argv.slice(2)) {
  const args = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [k, ...rest] = arg.slice(2).split('=');
    args[k] = rest.length ? rest.join('=') : true;
  }
  const report = buildClaudeRoutinesHonestyReport(args);
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    process.stdout.write(formatClaudeRoutinesHonestyReport(report));
  }
  if ((args.strict && report.status !== 'ready') || report.status === 'fail') {
    process.exitCode = 1;
    return 1;
  }
  return 0;
}

if (require.main === module) {
  runCli();
}

module.exports = {
  SOURCE_URL,
  DOCS_URL,
  GATE_ID,
  RAIL_MAP,
  ROUTINE_TYPES,
  CLAUDE_ROUTINE_ARCHETYPES,
  ROUTINE_PLAN_DAILY_CAPS,
  ROUTINE_HOURLY_CAPS,
  buildWorkspaceAgentDirectory,
  buildWorkspaceAgentRoutine,
  wrapRoutineFirePayload,
  evaluateFirePayloadAdmission,
  validateRoutineSchedule,
  evaluateRoutineRateLimits,
  evaluateGitHubRoutineTrigger,
  auditRoutineConnectors,
  auditRoutineRunOutcome,
  buildClaudeRoutinesHonestyReport,
  formatClaudeRoutinesHonestyReport,
  runCli,
};
