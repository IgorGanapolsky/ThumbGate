'use strict';

// PreSkillShellCommand hook (Claude Code 2.1.332, 2026-11-24).
//
// A skill or slash command can embed shell commands (!`cmd`) that Claude Code runs
// while the skill loads, before the model sees it. Those commands never fire
// PreToolUse, so `thumbgate gate-check` never saw them: a skill from a plugin or an
// MCP server could run a command a thumbs-down had already blocked. Checked live on
// 2026-11-27 with Claude Code 2.1.332: a skill's `echo` fired only
// PreSkillShellCommand, and a deny from that hook kept it from running.
//
// This hook runs the same gate-check engine on the command. Per law 12 (new gates
// ship warn-only first) it only warns by default: the skill's command still runs,
// Claude Code shows the warning, and the hit is logged to
// <feedback dir>/skill-shell-gate-log.jsonl so false positives can be counted.
//   THUMBGATE_SKILL_SHELL_GATE=enforce  deny the command (Claude Code skips it)
//   THUMBGATE_SKILL_SHELL_GATE=off      do nothing
//
// Output contract (from Claude Code 2.1.332): `{}` means no decision and the
// command runs. permissionDecision deny/ask/defer and any updatedInput all keep it
// from running, so this hook never emits ask or updatedInput.

const fs = require('fs');
const path = require('path');

const HOOK_EVENT = 'PreSkillShellCommand';
const LOG_FILE = 'skill-shell-gate-log.jsonl';

function skillShellMode(env = process.env) {
  const value = String(env.THUMBGATE_SKILL_SHELL_GATE || '').trim().toLowerCase();
  if (value === 'enforce' || value === 'deny' || value === 'block') return 'enforce';
  if (value === 'off' || value === '0' || value === 'false') return 'off';
  return 'warn';
}

function skillCommandText(input) {
  const toolInput = (input && (input.tool_input || input.toolInput)) || {};
  return typeof toolInput.command === 'string' ? toolInput.command : '';
}

// The PreToolUse-shaped event the gate engine already understands.
function toPreToolUseInput(input) {
  return {
    ...input,
    hook_event_name: 'PreToolUse',
    tool_name: input.tool_name || 'Bash',
    tool_input: { command: skillCommandText(input) },
    skill_shell: {
      command_name: input.command_name || '',
      command_source: input.command_source || '',
      invoked_by: input.invoked_by || '',
    },
  };
}

function readVerdict(outputText) {
  let parsed;
  try {
    parsed = typeof outputText === 'string' ? JSON.parse(outputText) : outputText;
  } catch {
    return { blocked: false, reason: '' };
  }
  if (!parsed || typeof parsed !== 'object') return { blocked: false, reason: '' };
  const specific = parsed.hookSpecificOutput || {};
  const decision = specific.permissionDecision || (parsed.decision === 'block' ? 'deny' : '');
  const blocked = decision === 'deny' || decision === 'ask';
  const reason = String(specific.permissionDecisionReason || parsed.reason || '').trim();
  return { blocked, decision, reason };
}

function defaultLogPath() {
  const { resolveFeedbackDir } = require('./feedback-paths');
  return path.join(resolveFeedbackDir(), LOG_FILE);
}

function appendLog(entry, logPath) {
  try {
    const file = logPath || defaultLogPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(entry) + '\n');
  } catch {
    // Logging is best-effort; it must never change the verdict.
  }
}

function skillLabel(input) {
  const name = String(input.command_name || '').trim();
  return name ? `/${name}` : 'a skill';
}

async function runSkillShellGate(input = {}, options = {}) {
  const env = options.env || process.env;
  const mode = skillShellMode(env);
  if (mode === 'off') return {};
  const command = skillCommandText(input);
  if (!command.trim()) return {};

  let verdict;
  try {
    const evaluate = options.evaluate || require('./gate-check-core').evaluateGateCheck;
    verdict = readVerdict(await evaluate(toPreToolUseInput(input), { env }));
  } catch {
    // A broken check must not break every skill load. Warn-only surface: fail open.
    return {};
  }
  if (!verdict.blocked) return {};

  const reason = verdict.reason || 'matches a ThumbGate prevention rule';
  appendLog({
    ts: new Date().toISOString(),
    event: HOOK_EVENT,
    mode,
    action: mode === 'enforce' ? 'denied' : 'warned',
    command: command.slice(0, 500),
    skill: input.command_name || '',
    source: input.command_source || '',
    invokedBy: input.invoked_by || '',
    gateDecision: verdict.decision,
    reason: reason.slice(0, 500),
  }, options.logPath);

  if (mode === 'enforce') {
    return {
      hookSpecificOutput: {
        hookEventName: HOOK_EVENT,
        permissionDecision: 'deny',
        permissionDecisionReason: `ThumbGate: ${reason}`,
      },
    };
  }
  return {
    systemMessage: `ThumbGate (warn-only) would block a shell command that ${skillLabel(input)} runs while loading: ${reason}. It ran anyway. Set THUMBGATE_SKILL_SHELL_GATE=enforce to block it.`,
  };
}

module.exports = {
  HOOK_EVENT,
  LOG_FILE,
  readVerdict,
  runSkillShellGate,
  skillShellMode,
  toPreToolUseInput,
};
