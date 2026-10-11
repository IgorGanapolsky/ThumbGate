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

module.exports = {
  HARNESS_CLAUDE_CODE,
  HARNESS_ANTIGRAVITY,
  HARNESS_STRANDS,
  HARNESS_OPENHANDS,
  HARNESS_TERMINUS,
  SUPPORTED_HARNESSES,
  normalizeToCanonicalAction,
  evaluateCrossHarnessInvariants,
  calculateTransferScorecard
};
