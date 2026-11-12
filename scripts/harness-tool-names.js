'use strict';

/**
 * Harness tool names -> canonical gate-engine names.
 *
 * Policy gates match Claude Code's vocabulary (Bash, Write, Edit, MultiEdit). Other
 * harnesses use their own: Cline's .clinerules instructs the agent to gate-check
 * `execute_command`, `write_to_file`, `replace_in_file` and `browser_action`.
 * Forwarding those through unchanged meant every gate silently missed — a strict
 * `gate_check` on `{tool_name: "execute_command", command: "rm -rf /"}` returned ALLOW,
 * which is precisely the scenario the adapter advertises as protected.
 *
 * Argument keys differ too: Cline writes use `path`, Claude Code uses `file_path`.
 */

const TOOL_NAME_MAP = new Map(Object.entries({
  // Cline / Roo Code
  execute_command: 'Bash',
  write_to_file: 'Write',
  replace_in_file: 'Edit',
  apply_diff: 'Edit',
  insert_content: 'Edit',
  search_and_replace: 'Edit',
  // OpenCode / Codex / Windows / generic MCP
  bash: 'Bash',
  shell: 'Bash',
  shell_command: 'Bash',
  exec_command: 'Bash',
  local_shell: 'Bash',
  'container.exec': 'Bash',
  powershell: 'Bash',
  pwsh: 'Bash',
  terminal: 'Bash',
  run_command: 'Bash',
  edit_file: 'Edit',
  write_file: 'Write',
  create_file: 'Write',
  str_replace_editor: 'Edit',
  // Cursor
  run_terminal_cmd: 'Bash',
}));

const ARG_KEY_MAP = new Map(Object.entries({
  path: 'file_path',
  filePath: 'file_path',
  target_file: 'file_path',
  cmd: 'command',
  shell_command: 'command',
  diff: 'new_string',
}));

function canonicalizeToolName(toolName) {
  const raw = String(toolName || '').trim();
  if (!raw) return raw;
  return TOOL_NAME_MAP.get(raw) || TOOL_NAME_MAP.get(raw.toLowerCase()) || raw;
}

function formatCommandArgvToken(item) {
  const text = String(item ?? '');
  if (!text) return '""';
  if (!/[\s"'|&;<>()`\\]/.test(text)) return text;
  return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function normalizeCommandValue(value) {
  if (!Array.isArray(value)) return value;
  return value.map((item) => formatCommandArgvToken(item)).join(' ');
}

function canonicalizeToolInput(toolInput) {
  if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) return toolInput || {};
  const out = {};
  for (const [key, value] of Object.entries(toolInput)) {
    const canonicalKey = ARG_KEY_MAP.get(key) || key;
    if (key !== canonicalKey && (value === undefined || toolInput[canonicalKey] !== undefined)) continue;
    if (out[canonicalKey] !== undefined) continue;
    out[canonicalKey] = canonicalKey === 'command' ? normalizeCommandValue(value) : value;
  }
  return out;
}

function canonicalizeToolCall(toolName, toolInput) {
  return {
    toolName: canonicalizeToolName(toolName),
    toolInput: canonicalizeToolInput(toolInput),
  };
}

module.exports = {
  canonicalizeToolCall,
  canonicalizeToolName,
  canonicalizeToolInput,
  normalizeCommandValue,
  TOOL_NAME_MAP,
  ARG_KEY_MAP,
};
