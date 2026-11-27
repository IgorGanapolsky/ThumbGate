'use strict';

// PreSkillShellCommand hook (Claude Code 2.1.332). Shell commands a skill embeds
// (!`cmd`) run at load time and never fire PreToolUse (checked live 2026-11-27).
// Runs the gate-check engine on them. Warn-only by default (law 12), logged to
// <feedback dir>/skill-shell-gate-log.jsonl; THUMBGATE_SKILL_SHELL_GATE=enforce
// denies, =off skips. `{}` lets the command run; ask and updatedInput would also
// block it, so this hook never emits them.

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

  // Redact before anything is written or echoed: the reason can quote the command.
  const { redactText } = require('./secret-scanner');
  const reason = redactText(verdict.reason || 'matches a ThumbGate prevention rule');
  appendLog({
    ts: new Date().toISOString(), event: HOOK_EVENT, mode, action: mode === 'enforce' ? 'denied' : 'warned',
    command: redactText(command).slice(0, 500), skill: input.command_name || '', source: input.command_source || '',
    invokedBy: input.invoked_by || '', gateDecision: verdict.decision, reason: reason.slice(0, 500),
  }, options.logPath);

  if (mode === 'enforce') {
    return { hookSpecificOutput: { hookEventName: HOOK_EVENT, permissionDecision: 'deny', permissionDecisionReason: `ThumbGate: ${reason}` } };
  }
  return {
    systemMessage: `ThumbGate (warn-only) would block a shell command that ${skillLabel(input)} runs while loading: ${reason}. It ran anyway. Set THUMBGATE_SKILL_SHELL_GATE=enforce to block it.`,
  };
}

module.exports = { HOOK_EVENT, LOG_FILE, readVerdict, runSkillShellGate, skillShellMode, toPreToolUseInput };
