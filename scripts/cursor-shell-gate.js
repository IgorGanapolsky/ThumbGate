'use strict';

/**
 * Cursor `beforeShellExecution` hook adapter.
 *
 * Cursor sends `{"command":"..."}` on stdin and reads `{"permission":"allow"|"deny"}`.
 * ThumbGate `gate-check` speaks Claude Code PreToolUse JSON (`hookSpecificOutput.permissionDecision`).
 * This script maps between the two contracts without enabling THUMBGATE_STRICT_ENFORCEMENT.
 * If the gate itself errors (bad input, engine failure) it answers deny: it fails closed.
 */

const fs = require('fs');
const path = require('path');

const PKG_ROOT = path.resolve(__dirname, '..');

function cursorPayloadToPreToolUse(payload = {}) {
  const command = payload.command
    ?? payload.tool_input?.command
    ?? payload.toolInput?.command
    ?? '';
  return {
    tool_name: 'Bash',
    tool_input: { command: String(command) },
    cwd: payload.cwd || process.cwd(),
    thumbgate_host: 'cursor',
    // Cursor's conversation id lets a later thumbs-down find the command it is about.
    ...(payload.conversation_id || payload.session_id ? { session_id: String(payload.conversation_id || payload.session_id) } : {}),
  };
}

function preToolUseVerdictToCursor(verdictText) {
  let parsed = {};
  try {
    parsed = JSON.parse(verdictText || '{}');
  } catch {
    parsed = {};
  }
  const hso = parsed.hookSpecificOutput || {};
  const decision = hso.permissionDecision || parsed.decision || 'allow';
  if (decision === 'deny' || decision === 'block') {
    const reason = String(
      hso.permissionDecisionReason || parsed.reason || 'Blocked by ThumbGate prevention rule.',
    ).trim();
    return {
      permission: 'deny',
      user_message: reason,
      agent_message: reason,
    };
  }
  const out = { permission: 'allow' };
  const advisory = String(hso.additionalContext || hso.systemReminder || '').trim();
  if (decision === 'warn' && advisory) {
    out.user_message = advisory;
    out.agent_message = advisory;
  }
  return out;
}

async function runCursorShellGate(stdinText) {
  const payload = stdinText.trim() ? JSON.parse(stdinText) : {};
  const { runAsync } = require(path.join(PKG_ROOT, 'scripts', 'gates-engine'));
  const verdict = await runAsync(cursorPayloadToPreToolUse(payload));
  return preToolUseVerdictToCursor(verdict);
}

async function main() {
  const stdinText = fs.readFileSync(0, 'utf8');
  try {
    const result = await runCursorShellGate(stdinText);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(0);
  } catch (err) {
    // Fail closed (AGENT-3667): a gate that could not decide must not let the command run.
    process.stderr.write(`cursor-shell-gate error: ${err.message}\n`);
    const reason = `ThumbGate could not check this command (${err.message}), so it was blocked. Retry; if it keeps failing run: npx thumbgate doctor`;
    process.stdout.write(`${JSON.stringify({ permission: 'deny', user_message: reason, agent_message: reason })}\n`);
    process.exit(0);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  cursorPayloadToPreToolUse,
  preToolUseVerdictToCursor,
  runCursorShellGate,
};