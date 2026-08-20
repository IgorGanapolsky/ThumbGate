'use strict';

/**
 * ThumbGate WriteGuard — Fine-Grained Pre-Action MCP Governance Engine
 *
 * Inspired by Cloudflare WriteGuard & ThumbGate Reliability Gateway:
 * - Intercepts incoming MCP tool calls without upstream server modification
 * - Classifies tool risk tiers (read, write, privileged_write, admin)
 * - Evaluates request context against deterministic safety policies
 * - Scrubs sensitive tokens/secrets from audit payloads
 * - Emits structured attribution receipts with user, client, session, and duration metadata
 */

const crypto = require('crypto');

const RISK_TIERS = {
  READ: 'read',
  WRITE: 'write',
  PRIVILEGED_WRITE: 'privileged_write',
  ADMIN: 'admin',
};

const DEFAULT_READ_TOOLS = new Set([
  'view_file',
  'read_file',
  'list_dir',
  'find_by_name',
  'grep_search',
  'read_resource',
  'list_resources',
  'search_web',
  'read_url_content',
  'get_scope_state',
  'get_branch_governance',
  'get_action_receipts',
  'get_task_outcomes',
  'get_business_metrics',
  'estimate_uncertainty',
  'recall',
  'feedback_summary',
  'search_lessons',
  'retrieve_lessons',
  'dashboard',
]);

const DEFAULT_WRITE_TOOLS = new Set([
  'write_to_file',
  'replace_file_content',
  'edit_file',
  'generate_image',
  'capture_feedback',
  'capture_memory_feedback',
  'record_action_receipt',
  'record_task_outcome',
  'track_action',
]);

const DEFAULT_PRIVILEGED_TOOLS = new Set([
  'run_command',
  'execute_command',
  'bash',
  'manage_task',
  'kill',
  'create_purchase_requisition',
  'settle_purchase_requisition',
  'browser_run_code_unsafe',
  'browser_evaluate',
]);

const DEFAULT_ADMIN_TOOLS = new Set([
  'set_branch_governance',
  'approve_protected_action',
  'register_claim_gate',
  'define_subagent',
  'manage_subagents',
  'satisfy_gate',
]);

const DANGEROUS_COMMAND_PATTERNS = [
  /rm\s+-rf\s+[\/~]/i,
  /drop\s+table/i,
  /drop\s+database/i,
  /truncate\s+table/i,
  /git\s+push\s+.*--force/i,
  /git\s+reset\s+--hard/i,
  /chmod\s+777/i,
  /mkfs/i,
  />\s*\/dev\/sd[a-z]/i,
  /:()\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/i, // fork bomb
];

const SENSITIVE_KEY_PATTERNS = [
  /api[_-]?key/i,
  /auth[_-]?token/i,
  /access[_-]?token/i,
  /bearer/i,
  /password/i,
  /passwd/i,
  /secret/i,
  /private[_-]?key/i,
  /credentials/i,
  /stripe[_-]?key/i,
  /github[_-]?pat/i,
];

/**
 * Classifies an MCP tool into a risk tier.
 * @param {string} toolName
 * @param {Object} [customPolicies]
 * @returns {'read'|'write'|'privileged_write'|'admin'}
 */
function classifyMcpTool(toolName, customPolicies = {}) {
  if (!toolName || typeof toolName !== 'string') return RISK_TIERS.READ;
  const name = toolName.trim();

  if (customPolicies[name] && customPolicies[name].tier) {
    return customPolicies[name].tier;
  }

  if (DEFAULT_ADMIN_TOOLS.has(name)) return RISK_TIERS.ADMIN;
  if (DEFAULT_PRIVILEGED_TOOLS.has(name)) return RISK_TIERS.PRIVILEGED_WRITE;
  if (DEFAULT_WRITE_TOOLS.has(name)) return RISK_TIERS.WRITE;
  if (DEFAULT_READ_TOOLS.has(name)) return RISK_TIERS.READ;

  // Heuristic fallbacks for custom/MCP servers
  if (/^(delete|drop|destroy|purge|remove|kill|admin|grant|revoke)/i.test(name)) {
    return RISK_TIERS.PRIVILEGED_WRITE;
  }
  if (/^(create|write|update|set|put|post|patch|insert|modify|send)/i.test(name)) {
    return RISK_TIERS.WRITE;
  }

  return RISK_TIERS.READ;
}

/**
 * Recursively scrubs secret keys and values from parameter objects.
 * @param {*} value
 * @returns {*}
 */
function scrubSensitiveData(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    // Check for inline bearer tokens or private key markers
    if (/bearer\s+[a-zA-Z0-9_\-\.]{20,}/i.test(value)) {
      return value.replace(/bearer\s+[a-zA-Z0-9_\-\.]{20,}/gi, 'Bearer [REDACTED]');
    }
    if (/-----BEGIN\s+(RSA|OPENSSH|PRIVATE)\s+KEY-----/i.test(value)) {
      return '[REDACTED_PRIVATE_KEY]';
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(scrubSensitiveData);
  }

  if (typeof value === 'object') {
    const scrubbed = {};
    for (const [k, v] of Object.entries(value)) {
      const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(k));
      if (isSensitive) {
        scrubbed[k] = '[REDACTED]';
      } else {
        scrubbed[k] = scrubSensitiveData(v);
      }
    }
    return scrubbed;
  }

  return value;
}

/**
 * Inspects parameters for dangerous destructive operations.
 * @param {string} toolName
 * @param {Object} parameters
 * @returns {Array<string>} list of violation reasons
 */
function scanForDestructivePatterns(toolName, parameters) {
  const violations = [];
  if (!parameters || typeof parameters !== 'object') return violations;

  const serialized = JSON.stringify(parameters);
  for (const pat of DANGEROUS_COMMAND_PATTERNS) {
    if (pat.test(serialized)) {
      violations.push(`Dangerous destructive pattern detected matching ${pat.toString()}`);
    }
  }

  return violations;
}

/**
 * Evaluates an incoming MCP call and produces an attribution receipt.
 * @param {Object} callRequest
 * @param {string} callRequest.server
 * @param {string} callRequest.tool
 * @param {Object} callRequest.parameters
 * @param {Object} [callRequest.context]
 * @param {Object} [options]
 * @returns {Object} evaluation receipt
 */
function evaluateMcpCall(callRequest, options = {}) {
  const startTime = Date.now();
  const server = callRequest.server || 'default';
  const tool = callRequest.tool || 'unknown';
  const parameters = callRequest.parameters || {};
  const context = callRequest.context || {};
  const customPolicies = options.customPolicies || {};

  const riskTier = classifyMcpTool(tool, customPolicies);
  const violations = scanForDestructivePatterns(tool, parameters);

  let decision = 'allowed';
  const reasons = [...violations];

  // Evaluate tier restrictions
  if (violations.length > 0) {
    decision = 'blocked';
  } else if (riskTier === RISK_TIERS.ADMIN && !options.allowAdmin) {
    decision = 'escalated';
    reasons.push(`Tool ${tool} is in admin tier and requires explicit operator approval`);
  } else if (riskTier === RISK_TIERS.PRIVILEGED_WRITE && options.requireReviewForPrivileged) {
    decision = 'escalated';
    reasons.push(`Tool ${tool} is in privileged_write tier and requires human review`);
  }

  const durationMs = Math.max(0, Date.now() - startTime);
  const eventId = `wg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  const receipt = {
    eventId,
    timestamp: new Date().toISOString(),
    server,
    tool,
    riskTier,
    decision,
    user: context.user || 'operator',
    client: context.client || 'mcp-client',
    sessionId: context.sessionId || 'default-session',
    durationMs,
    reasons,
    parameters: scrubSensitiveData(parameters),
  };

  return receipt;
}

/**
 * Exports a Cloudflare WriteGuard compatible JSON policy schema.
 * @param {Array<string>} toolNames
 * @param {Object} [overrides]
 * @returns {Object}
 */
function exportCloudflareWriteGuardPolicy(toolNames = [], overrides = {}) {
  const policies = {};

  for (const name of toolNames) {
    const tier = classifyMcpTool(name, overrides);
    policies[name] = {
      riskTier: tier,
      action: tier === RISK_TIERS.ADMIN ? 'escalate' : tier === RISK_TIERS.PRIVILEGED_WRITE ? 'guard' : 'allow',
      audit: true,
      redactSecrets: true,
      maxExecutionMs: tier === RISK_TIERS.READ ? 2000 : 10000,
    };
  }

  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    engine: 'ThumbGate-WriteGuard',
    defaultAction: 'allow',
    policies,
  };
}

module.exports = {
  RISK_TIERS,
  classifyMcpTool,
  scrubSensitiveData,
  scanForDestructivePatterns,
  evaluateMcpCall,
  exportCloudflareWriteGuardPolicy,
};
