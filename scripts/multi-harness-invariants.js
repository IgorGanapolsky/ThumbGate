'use strict';

/**
 * Multi-Harness Invariant Engine — FineEnvs Multi-Harness RL Format Steal
 *
 * Implements cross-harness normalization, invariant enforcement, and transfer scoring:
 * - Normalizes tool invocations across Claude Code, Antigravity, Strands, OpenHands, and Kimi/Terminus
 * - Catches catastrophic format failure and harness drift before execution
 * - Generates cross-harness invariant reward signals for RL/DPO training
 * - Sub-1ms CPU evaluation
 */

const { performance } = require('node:perf_hooks');

const HARNESS_CLAUDE_CODE = 'claude_code';
const HARNESS_ANTIGRAVITY = 'antigravity';
const HARNESS_STRANDS = 'strands';
const HARNESS_OPENHANDS = 'openhands';
const HARNESS_TERMINUS = 'terminus';

const SUPPORTED_HARNESSES = new Set([
  HARNESS_CLAUDE_CODE,
  HARNESS_ANTIGRAVITY,
  HARNESS_STRANDS,
  HARNESS_OPENHANDS,
  HARNESS_TERMINUS
]);

/**
 * Normalizes an arbitrary harness tool call into a Canonical Action Quadruplet.
 *
 * @param {string} harness - Name of the harness (claude_code, antigravity, strands, openhands, terminus)
 * @param {string} toolName - Tool name in the source harness
 * @param {Object} args - Arguments passed by the model
 * @returns {Object} Canonical Action descriptor
 */
function normalizeToCanonicalAction(harness, toolName, args = {}) {
  const normHarness = String(harness || 'unknown').toLowerCase();
  const normTool = String(toolName || '').trim();

  // 1. Antigravity Mapping
  if (normHarness === HARNESS_ANTIGRAVITY) {
    if (normTool === 'run_command') {
      return {
        harness: normHarness,
        domain: 'shell',
        operation: 'exec',
        target: String(args.CommandLine || '').trim(),
        payload: { cwd: args.Cwd, waitMs: args.WaitMsBeforeAsync }
      };
    }
    if (normTool === 'view_file') {
      return {
        harness: normHarness,
        domain: 'filesystem',
        operation: 'read',
        target: String(args.AbsolutePath || '').trim(),
        payload: { startLine: args.StartLine, endLine: args.EndLine }
      };
    }
    if (normTool === 'write_to_file' || normTool === 'replace_file_content') {
      return {
        harness: normHarness,
        domain: 'filesystem',
        operation: 'write',
        target: String(args.TargetFile || '').trim(),
        payload: { content: args.CodeContent || args.ReplacementContent }
      };
    }
    if (normTool === 'read_url_content') {
      return {
        harness: normHarness,
        domain: 'network',
        operation: 'read',
        target: String(args.Url || '').trim(),
        payload: {}
      };
    }
  }

  // 2. Claude Code Mapping
  if (normHarness === HARNESS_CLAUDE_CODE) {
    if (normTool === 'Bash') {
      return {
        harness: normHarness,
        domain: 'shell',
        operation: 'exec',
        target: String(args.command || '').trim(),
        payload: {}
      };
    }
    if (normTool === 'View' || normTool === 'Read') {
      return {
        harness: normHarness,
        domain: 'filesystem',
        operation: 'read',
        target: String(args.path || args.file_path || '').trim(),
        payload: {}
      };
    }
    if (normTool === 'Edit' || normTool === 'Write') {
      return {
        harness: normHarness,
        domain: 'filesystem',
        operation: 'write',
        target: String(args.path || args.file_path || '').trim(),
        payload: { content: args.content }
      };
    }
  }

  // 3. Strands Mapping
  if (normHarness === HARNESS_STRANDS) {
    if (normTool === 'shell' || normTool === 'strands_shell') {
      return {
        harness: normHarness,
        domain: 'shell',
        operation: 'exec',
        target: String(args.cmd || args.command || '').trim(),
        payload: {}
      };
    }
    if (normTool === 'fs_read' || normTool === 'read') {
      return {
        harness: normHarness,
        domain: 'filesystem',
        operation: 'read',
        target: String(args.path || '').trim(),
        payload: {}
      };
    }
    if (normTool === 'fs_write' || normTool === 'write') {
      return {
        harness: normHarness,
        domain: 'filesystem',
        operation: 'write',
        target: String(args.path || '').trim(),
        payload: { content: args.data || args.content }
      };
    }
  }

  // 4. OpenHands Mapping
  if (normHarness === HARNESS_OPENHANDS) {
    if (normTool === 'execute_bash') {
      return {
        harness: normHarness,
        domain: 'shell',
        operation: 'exec',
        target: String(args.cmd || '').trim(),
        payload: {}
      };
    }
    if (normTool === 'file_editor') {
      const op = args.command === 'view' ? 'read' : 'write';
      return {
        harness: normHarness,
        domain: 'filesystem',
        operation: op,
        target: String(args.path || args.file_path || '').trim(),
        payload: { content: args.file_text }
      };
    }
  }

  // Default fallback
  return {
    harness: normHarness,
    domain: 'generic',
    operation: 'call',
    target: normTool,
    payload: args
  };
}

/**
 * Validates whether a model's action satisfies Cross-Harness Invariants.
 *
 * @param {Object} canonical - Output of normalizeToCanonicalAction
 * @param {Object} [constraints] - Policy constraints (e.g. allowedPaths, forbiddenCommands)
 * @returns {Object} Invariant evaluation result
 */
function evaluateCrossHarnessInvariants(canonical, constraints = {}) {
  const start = performance.now();
  const issues = [];

  // Check 1: Empty or malformed target
  if (!canonical.target || typeof canonical.target !== 'string') {
    issues.push({
      rule: 'INVARIANT_EMPTY_TARGET',
      severity: 'FATAL',
      message: 'Tool call target is empty or not a string'
    });
  }

  // Check 2: Command injection in shell calls
  if (canonical.domain === 'shell') {
    const dangerousPatterns = [
      /rm\s+-rf\s+\//,
      /git\s+push\s+.*(?:--force|-f).*main/,
      /gh\s+pr\s+merge.*--admin/,
      /chmod\s+-R\s+777/
    ];
    for (const pat of dangerousPatterns) {
      if (pat.test(canonical.target)) {
        issues.push({
          rule: 'INVARIANT_SECURITY_POLICY_VIOLATION',
          severity: 'FATAL',
          pattern: pat.source,
          message: `Forbidden shell command detected: ${canonical.target}`
        });
      }
    }
  }

  // Check 3: Path traversal in filesystem calls
  if (canonical.domain === 'filesystem') {
    if (canonical.target.includes('../../../') || canonical.target.startsWith('/etc/') || canonical.target.startsWith('/root/')) {
      issues.push({
        rule: 'INVARIANT_PATH_TRAVERSAL',
        severity: 'FATAL',
        message: `Forbidden filesystem escape path: ${canonical.target}`
      });
    }
  }

  applyOpenHandsFactoryConstraints(issues, constraints);

  const passed = issues.length === 0;
  const elapsed = performance.now() - start;

  return {
    valid: passed,
    status: passed ? 'PASS' : 'FAIL',
    issues,
    canonical,
    latencyMs: Number(elapsed.toFixed(3))
  };
}

/**
 * Calculates the Cross-Harness Transfer Score and RL Invariant Reward.
 * Stolen from FineEnvs multi-harness RL trajectory scoring.
 *
 * @param {Array<Object>} trajectory - Array of tool invocations across harnesses
 * @returns {Object} Transfer Scorecard
 */
function calculateTransferScorecard(trajectory = []) {
  if (!Array.isArray(trajectory) || trajectory.length === 0) {
    return {
      totalActions: 0,
      formatSuccessRate: 1.0,
      invariantPassRate: 1.0,
      transferReward: 1.0,
      harnessesObserved: []
    };
  }

  let validFormats = 0;
  let passedInvariants = 0;
  const harnessesSeen = new Set();

  for (const item of trajectory) {
    const harness = item.harness || 'unknown';
    harnessesSeen.add(harness);

    const canonical = normalizeToCanonicalAction(harness, item.toolName, item.args);
    if (canonical.domain !== 'generic') {
      validFormats++;
    }

    const evalResult = evaluateCrossHarnessInvariants(canonical);
    if (evalResult.valid) {
      passedInvariants++;
    }
  }

  const total = trajectory.length;
  const formatSuccessRate = Number((validFormats / total).toFixed(4));
  const invariantPassRate = Number((passedInvariants / total).toFixed(4));

  // Multi-harness diversity bonus: reward models that successfully generalize across multiple harnesses
  const harnessCount = harnessesSeen.size;
  const diversityMultiplier = Math.min(1.0, 0.7 + (harnessCount * 0.1));
  const transferReward = Number(((formatSuccessRate * 0.4 + invariantPassRate * 0.6) * diversityMultiplier).toFixed(4));

  return {
    totalActions: total,
    harnessesObserved: Array.from(harnessesSeen),
    formatSuccessRate,
    invariantPassRate,
    diversityMultiplier,
    transferReward // 0.0 to 1.0 (RL training signal)
  };
}

const OPENHANDS_FACTORY_ROLES = new Set(['triage', 'developer', 'reviewer', 'watchdog']);
const OPENHANDS_BLOCKING_HOOK_EVENTS = new Set(['pre_tool_use', 'user_prompt_submit', 'stop']);

function factoryPermissionNames(step) {
  const names = new Set();
  const raw = step.permissions || step.scopes;
  if (Array.isArray(raw)) {
    for (const item of raw) names.add(String(item));
  } else if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw)) {
      if (value === true) names.add(String(key));
    }
  }
  return names;
}

function factoryRecordsVendorDemo(step) {
  return step.measuredOnTheirDemo === true
    || step.demoMergeCount != null
    || step.mergedPullRequestCount != null;
}

function watchdogMergeProofHolds(step) {
  const actorId = step.actorId == null ? '' : String(step.actorId);
  const authorId = step.authorId == null ? '' : String(step.authorId);
  const reviewedSha = step.reviewedSha == null ? '' : String(step.reviewedSha);
  const headSha = step.headSha == null ? '' : String(step.headSha);
  return actorId !== ''
    && authorId !== ''
    && actorId !== authorId
    && reviewedSha !== ''
    && reviewedSha === headSha
    && step.testsPassed === true
    && step.reviewPassed === true;
}

function pushFactoryIssue(issues, rule, message) {
  issues.push({ rule, severity: 'FATAL', message });
}

function watchdogReusesDeveloperToken(step) {
  return Boolean(step.tokenId) && step.tokenId === step.developerTokenId;
}

function watchdogMergeAttempt(step, role) {
  if (role !== 'watchdog') return false;
  return step.action === 'merge' || step.canMerge === true || step.merging === true;
}

function collectRoleShapeIssues(step, role) {
  const issues = [];
  const canPush = step.canPush === true || factoryPermissionNames(step).has('contents:write');
  if (!OPENHANDS_FACTORY_ROLES.has(role)) {
    pushFactoryIssue(issues, 'OPENHANDS_UNKNOWN_ROLE', 'Factory role must be triage, developer, reviewer, or watchdog');
  }
  if (role === 'reviewer' && canPush) {
    pushFactoryIssue(issues, 'OPENHANDS_REVIEWER_CANNOT_PUSH', 'Reviewer cannot push code');
  }
  if (role === 'developer' && (step.canMerge === true || step.action === 'merge')) {
    pushFactoryIssue(issues, 'OPENHANDS_DEVELOPER_CANNOT_MERGE', 'Developer cannot merge');
  }
  if (role === 'watchdog' && step.startsAgent === true) {
    pushFactoryIssue(issues, 'OPENHANDS_WATCHDOG_STARTS_NO_AGENT', 'Watchdog starts no agent');
  }
  if (role === 'watchdog' && watchdogReusesDeveloperToken(step)) {
    pushFactoryIssue(issues, 'OPENHANDS_WATCHDOG_REUSES_AUTHOR_TOKEN', 'Watchdog must not reuse the developer token');
  }
  return issues;
}

function collectMergeIssues(step, role) {
  const issues = [];
  if (step.action === 'merge' && role !== 'watchdog') {
    pushFactoryIssue(issues, 'OPENHANDS_ONLY_WATCHDOG_MERGES', 'Only the watchdog may merge');
  } else if (step.canMerge === true && role !== 'watchdog' && role !== 'developer') {
    pushFactoryIssue(issues, 'OPENHANDS_ONLY_WATCHDOG_MERGES', 'Only the watchdog may merge');
  }
  if (watchdogMergeAttempt(step, role) && !watchdogMergeProofHolds(step)) {
    pushFactoryIssue(issues, 'OPENHANDS_WATCHDOG_MERGE_REFUSED', 'Watchdog merge needs a different actor, the reviewed head, passing tests, and a passing review');
  }
  return issues;
}

/**
 * Decides whether one OpenHands software-factory step is allowed.
 * Reviewer cannot push. Developer cannot merge. Watchdog starts no agent
 * and merges only a different actor's exact reviewed head after tests and review pass.
 *
 * @param {Object} step
 * @returns {Object}
 */
function evaluateOpenHandsFactoryStep(step = {}) {
  const source = step || {};
  const role = String(source.role || source.factoryRole || '').trim().toLowerCase();
  const issues = collectRoleShapeIssues(source, role).concat(collectMergeIssues(source, role));
  const spend = Number(source.outboundSpendUsd);
  if (Number.isFinite(spend) && spend > 0) {
    issues.push({
      rule: 'OPENHANDS_OUTBOUND_SPEND',
      severity: 'FATAL',
      message: 'Factory step spends outbound cash'
    });
  }
  if (factoryRecordsVendorDemo(source)) {
    issues.push({
      rule: 'OPENHANDS_VENDOR_DEMO_NOT_MEASUREMENT',
      severity: 'FATAL',
      message: 'A vendor demo count is not a ThumbGate measurement'
    });
  }
  return {
    allowed: issues.length === 0,
    role: OPENHANDS_FACTORY_ROLES.has(role) ? role : null,
    issues,
    measuredOnTheirDemo: false
  };
}

function factoryConstraintKeysPresent(constraints) {
  if (!constraints || typeof constraints !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(constraints, 'factoryRole')
    || Object.prototype.hasOwnProperty.call(constraints, 'reviewedSha')
    || Object.prototype.hasOwnProperty.call(constraints, 'headSha');
}

function applyOpenHandsFactoryConstraints(issues, constraints) {
  if (!factoryConstraintKeysPresent(constraints)) return;
  const verdict = evaluateOpenHandsFactoryStep({
    role: constraints.factoryRole,
    canPush: constraints.canPush,
    canMerge: constraints.canMerge,
    startsAgent: constraints.startsAgent,
    permissions: constraints.permissions,
    action: constraints.action,
    merging: constraints.merging,
    actorId: constraints.actorId,
    authorId: constraints.authorId,
    reviewedSha: constraints.reviewedSha,
    headSha: constraints.headSha,
    testsPassed: constraints.testsPassed,
    reviewPassed: constraints.reviewPassed,
    outboundSpendUsd: constraints.outboundSpendUsd,
    tokenId: constraints.tokenId,
    developerTokenId: constraints.developerTokenId,
    measuredOnTheirDemo: constraints.measuredOnTheirDemo,
    demoMergeCount: constraints.demoMergeCount,
    mergedPullRequestCount: constraints.mergedPullRequestCount
  });
  if (!verdict.allowed) {
    for (const issue of verdict.issues) issues.push(issue);
  }
}

function normalizeHookEvent(name) {
  return String(name || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

/**
 * Interprets one OpenHands lifecycle hook result.
 * PascalCase and snake_case event names match. A background hook never blocks.
 * PostToolUse, SessionStart, and SessionEnd never block. Stop stays denied
 * until checksPassed is true. A JSON decision overrides the exit code.
 *
 * @param {Object} hook
 * @returns {Object}
 */
function interpretOpenHandsHookResult(hook = {}) {
  const source = hook || {};
  const event = normalizeHookEvent(source.event || source.hookEvent || source.hook_event_name);
  const exitCode = Number(source.exitCode ?? source.exit_code ?? 0);
  const decision = String(source.decision || '').trim().toLowerCase();
  const asyncHook = source.async === true;
  const checksPassed = source.checksPassed === true || source.checks_passed === true;
  const reasons = [];
  const eventCanBlock = OPENHANDS_BLOCKING_HOOK_EVENTS.has(event);
  let blocked = false;

  if (asyncHook) {
    if (decision === 'deny' || exitCode === 2) reasons.push('async_hook_cannot_block');
  } else if (!eventCanBlock) {
    if (decision === 'deny' || exitCode === 2) reasons.push('event_cannot_block');
  } else if (event === 'stop' && !checksPassed) {
    blocked = true;
    reasons.push('stop_without_checks_passed');
  } else if (decision === 'deny') {
    blocked = true;
    reasons.push('decision_deny');
  } else if (decision === 'allow') {
    blocked = false;
  } else if (exitCode === 2) {
    blocked = true;
    reasons.push('exit_2');
  }

  return {
    event,
    blocked,
    proceeds: blocked === false,
    reasons,
    asyncHook,
    canBlock: eventCanBlock && asyncHook === false
  };
}

module.exports = {
  HARNESS_CLAUDE_CODE,
  HARNESS_ANTIGRAVITY,
  HARNESS_STRANDS,
  HARNESS_OPENHANDS,
  HARNESS_TERMINUS,
  SUPPORTED_HARNESSES,
  normalizeToCanonicalAction,
  evaluateCrossHarnessInvariants,
  calculateTransferScorecard,
  evaluateOpenHandsFactoryStep,
  interpretOpenHandsHookResult
};
