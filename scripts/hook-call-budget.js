#!/usr/bin/env node
'use strict';

/**
 * Opt-in Claude Code call-budget gate (PreToolUse + Stop).
 *
 * Counts tool calls per Claude Code session. Once a session passes a call
 * threshold (default 300) and invokes a mechanical tool (Bash/shell, browser
 * runs, chat/transcript search), denies ONCE with a single-line message:
 *   "This session is large; hand mechanical work to a Sonnet subagent or side session."
 *
 * On Stop, emits a single line with the session's call count.
 *
 * See docs/claude-call-budget-gate.md to enable in ~/.claude/settings.json.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_CALL_BUDGET_THRESHOLD = 300;
const CALL_BUDGET_DENY_MESSAGE =
  'This session is large; hand mechanical work to a Sonnet subagent or side session.';

const DELEGATION_TOOL_RE = /^(?:Agent|Task|TodoWrite|AskUserQuestion)$/i;
const SHELL_TOOL_RE = /^(?:Bash|sh|exec|run_command|run_terminal_cmd|terminal)$/i;
const BROWSER_TOOL_RE =
  /(?:^|[_.-])(?:browser|playwright|puppeteer|cdp|chrome|web_?fetch|computer_(?:click|type|hotkey|screenshot))(?:[_.-]|$)/i;
const CHAT_SEARCH_TOOL_RE =
  /(?:chat.*search|search.*chat|search_audio|search_screen|transcript|live_inbox|slack.*search|teams.*search|messages.*search|history.*search|search.*history|session.*search)/i;

function isDisabledByEnv(env = process.env) {
  const raw = String(env.THUMBGATE_CALL_BUDGET_GATE || '').trim().toLowerCase();
  return raw === '0' || raw === 'false' || raw === 'off' || raw === 'no';
}

function resolveThreshold(argv = process.argv.slice(2), env = process.env) {
  for (const arg of argv) {
    const match = /^--threshold=(\d+)$/.exec(String(arg || '').trim());
    if (match) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  const envVal = Number(env.THUMBGATE_CALL_BUDGET_THRESHOLD);
  if (Number.isFinite(envVal) && envVal > 0) return envVal;
  return DEFAULT_CALL_BUDGET_THRESHOLD;
}

function resolveStateDir(env = process.env) {
  const custom = String(env.THUMBGATE_CALL_BUDGET_DIR || '').trim();
  return custom || path.join(os.tmpdir(), 'thumbgate-call-budget');
}

function sanitizeSessionId(rawSessionId) {
  const cleaned = String(rawSessionId || 'default')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 120);
  return cleaned || 'default';
}

function isMechanicalTool(toolName, env = process.env) {
  const name = String(toolName || '').trim();
  if (!name || DELEGATION_TOOL_RE.test(name)) return false;
  const customRe = String(env.THUMBGATE_CALL_BUDGET_MECHANICAL_RE || '').trim();
  if (customRe) {
    try {
      if (new RegExp(customRe, 'i').test(name)) return true;
    } catch {
      // Ignore malformed custom regex; fall back to built-in matchers.
    }
  }
  return SHELL_TOOL_RE.test(name) || BROWSER_TOOL_RE.test(name) || CHAT_SEARCH_TOOL_RE.test(name);
}

function loadSessionState(statePath, sessionId) {
  try {
    if (fs.existsSync(statePath)) {
      const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        return {
          sessionId,
          totalCalls: Number(parsed.totalCalls) || 0,
          mechanicalCalls: Number(parsed.mechanicalCalls) || 0,
          deniedOnce: Boolean(parsed.deniedOnce),
          lastToolUseId: parsed.lastToolUseId || null,
          updatedAt: parsed.updatedAt || null,
        };
      }
    }
  } catch {
    // Corrupt state resets cleanly; never deadlock the session.
  }
  return {
    sessionId,
    totalCalls: 0,
    mechanicalCalls: 0,
    deniedOnce: false,
    lastToolUseId: null,
    updatedAt: null,
  };
}

function saveSessionState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const tmpPath = `${statePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state), 'utf8');
  fs.renameSync(tmpPath, statePath);
}

function evaluateCallBudgetPreToolUse(input = {}, options = {}) {
  const env = options.env || process.env;
  if (isDisabledByEnv(env)) return { decision: 'allow' };

  const threshold = Number.isFinite(options.threshold) && options.threshold > 0
    ? options.threshold
    : resolveThreshold(options.argv || [], env);
  const stateDir = options.stateDir || resolveStateDir(env);
  const sessionId = sanitizeSessionId(input.session_id || input.sessionId || env.CLAUDE_SESSION_ID || 'default');
  const statePath = path.join(stateDir, `${sessionId}.json`);
  const state = loadSessionState(statePath, sessionId);

  const toolName = String(input.tool_name || input.toolName || '');
  const toolUseId = input.tool_use_id ? String(input.tool_use_id) : null;
  const mechanical = isMechanicalTool(toolName, env);

  if (!toolUseId || state.lastToolUseId !== toolUseId) {
    state.totalCalls += 1;
    if (mechanical) state.mechanicalCalls += 1;
    state.lastToolUseId = toolUseId;
    state.updatedAt = new Date().toISOString();
  }

  let shouldDeny = false;
  if (state.totalCalls > threshold && mechanical && !state.deniedOnce) {
    state.deniedOnce = true;
    shouldDeny = true;
  }

  try {
    saveSessionState(statePath, state);
  } catch {
    // Fail-open on filesystem error.
  }

  if (shouldDeny) {
    return {
      decision: 'block',
      reason: CALL_BUDGET_DENY_MESSAGE,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: CALL_BUDGET_DENY_MESSAGE,
      },
      state,
    };
  }

  return { decision: 'allow', state };
}

function formatStopCallCountLine(input = {}, options = {}) {
  const env = options.env || process.env;
  if (isDisabledByEnv(env)) return '';
  const stateDir = options.stateDir || resolveStateDir(env);
  const sessionId = sanitizeSessionId(input.session_id || input.sessionId || env.CLAUDE_SESSION_ID || 'default');
  const statePath = path.join(stateDir, `${sessionId}.json`);
  const state = loadSessionState(statePath, sessionId);
  return `Session ${sessionId} call count: ${state.totalCalls} tool calls (${state.mechanicalCalls} mechanical).`;
}

function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw || !raw.trim()) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function runCli(argv = process.argv.slice(2), env = process.env) {
  const input = readStdinJson();
  const isStop = argv.includes('--stop') || String(input.hook_event_name || '') === 'Stop';

  if (isStop) {
    const line = formatStopCallCountLine(input, { argv, env });
    if (line) {
      process.stdout.write(`${JSON.stringify({ systemMessage: line })}\n`);
    }
    return;
  }

  const verdict = evaluateCallBudgetPreToolUse(input, { argv, env });
  if (verdict.decision === 'block') {
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: verdict.reason,
      hookSpecificOutput: verdict.hookSpecificOutput,
    }));
    return;
  }
  process.stdout.write('{}');
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  try {
    runCli();
  } catch {
    process.stdout.write('{}');
  }
}

module.exports = {
  DEFAULT_CALL_BUDGET_THRESHOLD,
  CALL_BUDGET_DENY_MESSAGE,
  isMechanicalTool,
  evaluateCallBudgetPreToolUse,
  formatStopCallCountLine,
  resolveThreshold,
  resolveStateDir,
  sanitizeSessionId,
  runCli,
};
