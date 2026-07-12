'use strict';

/**
 * self-protection.js — guard the files that configure ThumbGate itself.
 *
 * Added 2026-07-08 after Andy Martin's review: in the shipped `gate-check`
 * path, editing ThumbGate's own hook wiring / gate config was ALLOWED by
 * default (warn-by-default posture only denies under strict enforcement), so
 * an agent could disable the firewall before continuing and the surfaced
 * verdict was a clean ALLOW.
 *
 * This module retains the path-classification API used by the dogfood hook and
 * third-party integrations. Enforcement itself lives in gates-engine.js so the
 * plugin hook and `thumbgate gate-check` cannot drift apart.
 *
 * Posture threads three constraints:
 *   * Andy's ask: don't let the agent quietly rewrite/disable the gate.
 *   * CEO warn-by-default (2026-06-04): ordinary operational gates stay advisory.
 *   * Self-lockout lesson (2026-07-07): every protected-file floor needs an
 *     audited, short-lived repair path.
 *
 * Self-protection is now an unconditional floor. Intentional repairs use the
 * audited, time-limited protected approval / break-glass path; environment
 * flags cannot disable it.
 */

const SELF_GOVERNANCE_PATH_PATTERNS = [
  /(?:^|\/)\.claude\/settings(?:\.local)?\.json$/i, // hook wiring / can disable ThumbGate
  /(?:^|\/)\.codex\/config\.toml$/i,
  /(?:^|\/)scripts\/hook-[^/]+\.(?:js|sh)$/i, // the hook scripts themselves
  /(?:^|\/)config\/gates\//i, // gate definitions
  /(?:^|\/)config\/budget\.json$/i,
  /(?:^|\/)config\/enforcement\.json$/i, // enforcement policy
  /(?:^|\/)config\/mcp-allowlists\.json$/i, // MCP policy surface
  /(?:^|\/)\.thumbgate\/config\.json$/i,
  /(?:^|\/)thumbgate\.json$/i,
];

const EDIT_LIKE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

/**
 * Returns the matched governance file path, or null. Accepts both camelCase
 * (`tool_name`/`tool_input`) and the already-normalized shapes callers use.
 */
function selfProtectionTarget(toolName, toolInput) {
  if (!EDIT_LIKE_TOOLS.has(toolName)) return null;
  const filePath = String((toolInput && (toolInput.file_path || toolInput.filePath)) || '');
  if (!filePath) return null;
  return SELF_GOVERNANCE_PATH_PATTERNS.some((re) => re.test(filePath)) ? filePath : null;
}

/**
 * Evaluate the self-protection posture for a tool call.
 * @returns {{action:'block', target:string, message:string}|null}
 */
function evaluateSelfProtection(toolName, toolInput) {
  const target = selfProtectionTarget(toolName, toolInput);
  if (!target) return null;
  const { runHardFloor } = require('./gates-engine');
  const output = runHardFloor({ tool_name: toolName, tool_input: toolInput });
  if (!output) return null;
  const parsed = JSON.parse(output);
  const message = parsed.hookSpecificOutput && parsed.hookSpecificOutput.permissionDecisionReason;
  return {
    action: 'block',
    target,
    message: message || `ThumbGate self-protection blocked ${toolName} to "${target}".`,
  };
}

module.exports = {
  SELF_GOVERNANCE_PATH_PATTERNS,
  selfProtectionTarget,
  evaluateSelfProtection,
};
