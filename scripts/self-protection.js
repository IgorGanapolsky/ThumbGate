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
 * This module is the single source of truth for "is this edit touching the
 * firewall's own kill-switches", used by BOTH the shipped `npx thumbgate
 * gate-check` entrypoint and this repo's dogfood PreToolUse hook.
 *
 * Posture threads three constraints:
 *   * Andy's ask: don't let the agent quietly rewrite/disable the gate.
 *   * CEO warn-by-default (2026-06-04): never hard-block legitimate work.
 *   * Self-lockout lesson (2026-07-07): a PreToolUse hook must NEVER deny the
 *     tools needed to repair its own config, or the agent is bricked.
 *
 * Resolution:
 *   default                         -> WARN (surfaced + logged, never silent)
 *   THUMBGATE_STRICT_ENFORCEMENT=1  -> BLOCK
 *   THUMBGATE_ALLOW_SELF_EDIT=1     -> full opt-out (preserves the repair path)
 */

const SELF_GOVERNANCE_PATH_PATTERNS = [
  /(?:^|\/)\.claude\/settings(?:\.local)?\.json$/i, // hook wiring / can disable ThumbGate
  /(?:^|\/)\.codex\/config\.toml$/i,
  /(?:^|\/)scripts\/hook-[^/]+\.(?:js|sh)$/i, // the hook scripts themselves
  /(?:^|\/)config\/gates\//i, // gate definitions
  /(?:^|\/)config\/enforcement\.json$/i, // enforcement policy
  /(?:^|\/)config\/mcp-allowlists\.json$/i, // MCP policy surface
];

const EDIT_LIKE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

function isTrueEnv(value) {
  if (value === undefined || value === null) return false;
  const v = String(value).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

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
 * @returns {{action:'block'|'warn', target:string, message:string}|null}
 */
function evaluateSelfProtection(toolName, toolInput, env = process.env) {
  const target = selfProtectionTarget(toolName, toolInput);
  if (!target) return null;
  // Escape hatch: an operator repairing the gate opts out explicitly. Honors the
  // self-lockout lesson — the repair path is never denied.
  if (isTrueEnv(env.THUMBGATE_ALLOW_SELF_EDIT)) return null;
  if (isTrueEnv(env.THUMBGATE_STRICT_ENFORCEMENT)) {
    return {
      action: 'block',
      target,
      message:
        `ThumbGate self-protection: blocked ${toolName} to its own governance file "${target}". `
        + `Editing the firewall's own hook wiring / gate config while strict enforcement is on is denied. `
        + `Set THUMBGATE_ALLOW_SELF_EDIT=1 to make an intentional repair.`,
    };
  }
  return {
    action: 'warn',
    target,
    message:
      `⚠️ ThumbGate self-protection: this ${toolName} targets a governance file that configures the firewall itself `
      + `("${target}"). It is being ALLOWED and LOGGED (warn-by-default). An agent editing this could weaken or disable `
      + `its own guardrails — confirm this is intentional. Set THUMBGATE_STRICT_ENFORCEMENT=1 to hard-block such edits.`,
  };
}

module.exports = {
  SELF_GOVERNANCE_PATH_PATTERNS,
  selfProtectionTarget,
  evaluateSelfProtection,
};
