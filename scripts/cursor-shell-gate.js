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

// Cursor runs plugin hooks from the plugin's install directory, so process.cwd() is not the project. The project is
// workspace_roots[0]; without it a thumbs-down and the next gate check read different feedback directories.
function cursorProjectDir(payload = {}) {
  if (payload.cwd) return payload.cwd;
  if (Array.isArray(payload.workspace_roots) && payload.workspace_roots[0]) return String(payload.workspace_roots[0]);
  return process.cwd();
}

function cursorPayloadToPreToolUse(payload = {}) {
  const command = payload.command
    ?? payload.tool_input?.command
    ?? payload.toolInput?.command
    ?? '';
  return {
    tool_name: 'Bash',
    tool_input: { command: String(command) },
    cwd: cursorProjectDir(payload),
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

function parseJsonObject(value) {
  if (value && typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Cursor beforeMCPExecution {tool_name, tool_input (JSON string), mcp_server_name} -> Claude PreToolUse shape. */
function cursorMcpPayloadToPreToolUse(payload = {}) {
  const server = String(payload.mcp_server_name || payload.server || '').replace(/[^A-Za-z0-9_-]+/g, '_');
  const tool = String(payload.tool_name || '');
  return {
    tool_name: server ? `mcp__${server}__${tool}` : tool,
    tool_input: parseJsonObject(payload.tool_input),
    cwd: cursorProjectDir(payload),
    thumbgate_host: 'cursor',
    ...(payload.conversation_id ? { session_id: String(payload.conversation_id) } : {}),
  };
}

async function runCursorMcpGate(stdinText) {
  const payload = stdinText.trim() ? JSON.parse(stdinText) : {};
  const { runAsync } = require(path.join(PKG_ROOT, 'scripts', 'gates-engine'));
  const verdict = await runAsync(cursorMcpPayloadToPreToolUse(payload));
  return preToolUseVerdictToCursor(verdict);
}

// ---------------------------------------------------------------------------
// Cursor claim gate: afterShellExecution / afterMCPExecution / afterAgentResponse record the turn, `stop` decides.
// Cursor's stop hook cannot refuse to stop; it can submit a follow-up message, which forces the next run through
// the gate. loop_count > 0 means the follow-up already ran once, so it never loops.
// ---------------------------------------------------------------------------

const TURN_FILE = 'cursor-turns.json';
const MAX_CALLS = 60;

function turnLedgerPath(payload) {
  const { resolveFeedbackDir } = require(path.join(PKG_ROOT, 'scripts', 'feedback-paths'));
  return path.join(resolveFeedbackDir({ cwd: cursorProjectDir(payload) }), TURN_FILE);
}

function readLedger(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { return {}; }
}

function currentTurn(ledger, payload) {
  const id = String(payload.conversation_id || 'default');
  const gen = String(payload.generation_id || '');
  let turn = ledger[id];
  if (!turn || (gen && turn.generationId && turn.generationId !== gen)) {
    turn = { generationId: gen, text: [], calls: [], at: Date.now() };
    ledger[id] = turn;
  }
  if (gen) turn.generationId = gen;
  return turn;
}

/** Record one Cursor after-hook event (shell call, MCP call or the agent's reply text) into the turn ledger. */
function recordCursorEvent(payload = {}) {
  const event = String(payload.hook_event_name || '');
  const file = turnLedgerPath(payload);
  const ledger = readLedger(file);
  const turn = currentTurn(ledger, payload);
  if (event === 'afterAgentResponse' || typeof payload.text === 'string') {
    if (payload.text) turn.text.push(String(payload.text).slice(0, 20000));
  } else if (payload.command) {
    turn.calls.push({ name: 'Bash', summary: String(payload.command).slice(0, 400) });
  } else if (payload.tool_name) {
    const input = parseJsonObject(payload.tool_input);
    turn.calls.push({ name: `mcp__${payload.mcp_server_name || 'mcp'}__${payload.tool_name}`, summary: String(input.url || input.command || input.path || payload.tool_name).slice(0, 400) });
  }
  turn.calls = turn.calls.slice(-MAX_CALLS);
  for (const [key, value] of Object.entries(ledger)) if (Date.now() - (value.at || 0) > 24 * 60 * 60 * 1000) delete ledger[key];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(ledger)}\n`, 'utf8');
  return turn;
}

/** Cursor stop hook: run the claim gate on this turn. Returns {} or {followup_message}. */
function runCursorStop(payload = {}) {
  if (process.env.THUMBGATE_CLAIM_GATE === '0') return {};
  if (Number(payload.loop_count || 0) > 0) return {}; // the follow-up already ran once
  const file = turnLedgerPath(payload);
  const ledger = readLedger(file);
  const turn = ledger[String(payload.conversation_id || 'default')];
  const claimGate = require(path.join(PKG_ROOT, 'scripts', 'claim-gate-stop'));
  let text = turn ? turn.text.join('\n') : '';
  let calls = turn ? turn.calls : [];
  if (!text && payload.transcript_path && fs.existsSync(payload.transcript_path)) {
    try {
      const turns = claimGate.collectTurns(fs.readFileSync(payload.transcript_path, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean));
      const last = turns[turns.length - 1];
      if (last) { text = last.text.join('\n'); calls = last.calls; }
    } catch { /* fall through with no text */ }
  }
  if (!text.trim()) return {};
  const { resolveFeedbackDir } = require(path.join(PKG_ROOT, 'scripts', 'feedback-paths'));
  const verdict = claimGate.evaluateDraft(text, {
    toolNames: calls.map((c) => c.name),
    toolCalls: calls,
    feedbackDir: resolveFeedbackDir({ cwd: cursorProjectDir(payload) }),
  });
  if (!verdict.block) return {};
  return { followup_message: `${verdict.reason}\n\nThis message was sent by ThumbGate, not by the person.` };
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
  cursorProjectDir,
  cursorMcpPayloadToPreToolUse,
  runCursorMcpGate,
  recordCursorEvent,
  runCursorStop,
  cursorPayloadToPreToolUse,
  preToolUseVerdictToCursor,
  runCursorShellGate,
};