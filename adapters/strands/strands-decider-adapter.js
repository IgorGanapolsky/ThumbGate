'use strict';

/**
 * Strands Decider Adapter — AWS Strands Labs & Strands Decider Format Steal
 *
 * Implements ultra-fast, deterministic pre-action tool decision routing:
 * - Sub-25ms CPU-local execution budget
 * - Constrained categorical decision space: [ALLOW, REVIEW, BLOCK, ESCALATE]
 * - Context-aware security diodes & side-effect analysis
 * - Idempotent decision receipts
 */

const { performance } = require('node:perf_hooks');

const DECISION_ALLOW = 'ALLOW';
const DECISION_REVIEW = 'REVIEW';
const DECISION_BLOCK = 'BLOCK';
const DECISION_ESCALATE = 'ESCALATE';

const ALLOWED_DECISIONS = new Set([
  DECISION_ALLOW,
  DECISION_REVIEW,
  DECISION_BLOCK,
  DECISION_ESCALATE
]);

const CRITICAL_BLOCK_PATTERNS = [
  /git\s+push\s+.*(?:--force|-f).*main/i,
  /gh\s+pr\s+merge.*--admin/i,
  /gh\s+pr\s+review.*--approve/i,
  /rm\s+-rf\s+\/(?:\s|$|\*)/i,
  /chmod\s+-R\s+777\s+\//i,
  /dd\s+if=\/dev\/zero/i
];

const HIGH_RISK_REVIEW_PATTERNS = [
  /git\s+clean\s+-[a-zA-Z]*f/i,
  /git\s+reset\s+--hard/i,
  /git\s+checkout\s+-f/i,
  /npm\s+publish/i,
  /pkill\s+-9/i
];

const READ_ONLY_TOOLS = new Set([
  'view_file',
  'read_url_content',
  'search_web',
  'list_resources',
  'read_resource'
]);

/**
 * Evaluates a tool call payload through the Strands Decider routing matrix.
 *
 * @param {Object} invocation - The tool invocation descriptor
 * @param {string} invocation.toolName - Name of the tool
 * @param {Object} invocation.args - Arguments passed to the tool
 * @param {Object} [invocation.context] - Session or caller context
 * @returns {Object} Structured decision receipt
 */
function decide(invocation = {}) {
  const start = performance.now();
  const toolName = String(invocation.toolName || '').trim();
  const args = invocation.args || {};
  const command = String(args.CommandLine || args.command || '').trim();

  // 1. Read-only tools without side effects -> Instant ALLOW (<1ms)
  if (READ_ONLY_TOOLS.has(toolName)) {
    const elapsed = performance.now() - start;
    return {
      decision: DECISION_ALLOW,
      reason: 'SAFE_READ_ONLY_TOOL',
      toolName,
      confidence: 1.0,
      latencyMs: Number(elapsed.toFixed(3)),
      budgetCompliant: elapsed < 25.0
    };
  }

  // 2. Command analysis for Bash / shell executions
  if (command) {
    for (const pattern of CRITICAL_BLOCK_PATTERNS) {
      if (pattern.test(command)) {
        const elapsed = performance.now() - start;
        return {
          decision: DECISION_BLOCK,
          reason: 'CRITICAL_SECURITY_INTERDICTION',
          pattern: pattern.source,
          command,
          confidence: 1.0,
          latencyMs: Number(elapsed.toFixed(3)),
          budgetCompliant: elapsed < 25.0
        };
      }
    }

    for (const pattern of HIGH_RISK_REVIEW_PATTERNS) {
      if (pattern.test(command)) {
        const elapsed = performance.now() - start;
        return {
          decision: DECISION_REVIEW,
          reason: 'HIGH_RISK_MUTATING_ACTION',
          pattern: pattern.source,
          command,
          confidence: 0.95,
          latencyMs: Number(elapsed.toFixed(3)),
          budgetCompliant: elapsed < 25.0
        };
      }
    }
  }

  // 3. Sensitive file modifications
  const targetFile = String(args.TargetFile || args.path || '').trim();
  if (targetFile) {
    const sensitiveFilePatterns = [
      /\.env(?:\..+)?$/,
      /id_rsa|id_ed25519/,
      /branch-ruleset\.json$/,
      /main-branch-ruleset\.json$/
    ];

    for (const pat of sensitiveFilePatterns) {
      if (pat.test(targetFile)) {
        const elapsed = performance.now() - start;
        return {
          decision: DECISION_ESCALATE,
          reason: 'GOVERNANCE_CONFIG_PROTECTED',
          targetFile,
          confidence: 0.99,
          latencyMs: Number(elapsed.toFixed(3)),
          budgetCompliant: elapsed < 25.0
        };
      }
    }
  }

  // 4. Default safe mutation
  const elapsed = performance.now() - start;
  return {
    decision: DECISION_ALLOW,
    reason: 'ACTION_POLICY_CLEAR',
    toolName,
    confidence: 0.9,
    latencyMs: Number(elapsed.toFixed(3)),
    budgetCompliant: elapsed < 25.0
  };
}

module.exports = {
  decide,
  DECISION_ALLOW,
  DECISION_REVIEW,
  DECISION_BLOCK,
  DECISION_ESCALATE,
  ALLOWED_DECISIONS
};
