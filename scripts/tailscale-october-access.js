'use strict';

// October 2026 Tailscale newsletter, as a ThumbGate deny.
// An agent node does not face the open web, does not open Tailscale SSH,
// and does not leave a database password in the command. A temporary
// accept in a Tailscale policy file carries a name and an expiry so it
// can be removed without rewriting the rest of the file.

const GATE = 'tailscale-october-access';
const EDIT_TOOLS = new Set([
  'edit',
  'search_replace',
  'multiedit',
  'strreplace',
  'str_replace',
]);
const ACCEPT_RE = /"action"\s*:\s*"accept"/;
const NAMED_GRANT_RE = /"name"\s*:/;
const EXPIRY_RE = /"expiry"\s*:/;
const FUNNEL_RE = /\btailscale\s+funnel\b/i;
const DB_PASSWORD_RE = new RegExp([
  String.raw`\bPGPASSWORD\s*=\s*\S+`,
  String.raw`\bMYSQL_PWD\s*=\s*\S+`,
  String.raw`\b(?:DATABASE_URL|MONGO_URL)\s*=\s*\S+:\/\/[^\s:@]+:[^\s@]+@`,
  String.raw`--password(?:=|\s+)\S+`,
  String.raw`(?:postgres|postgresql|mysql|mariadb|mongodb(?:\+srv)?|rediss?):\/\/[^\s:@]+:[^\s@]+@`,
].join('|'), 'i');
const ATTACHED_MYSQL_PASSWORD_RE = /(?:^|\s)-p(?!\s)\S+/;

function deny(failureReason, message) {
  return {
    decision: 'deny',
    gate: GATE,
    severity: 'critical',
    failureReason,
    message,
  };
}

function stripShellComments(command) {
  return String(command || '').replace(/#[^\n]*/g, ' ');
}

function isPolicyPath(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  return /(?:^|\/)(?:acl|policy)\.hujson$/i.test(normalized)
    || /(?:^|\/)tailscale\/[^/]+\.(?:json|hujson)$/i.test(normalized);
}

function editedPath(source) {
  if (!source || typeof source !== 'object') return '';
  return source.file_path || source.path || source.filePath || '';
}

function editPairs(toolInput) {
  const file = editedPath(toolInput);
  const edits = Array.isArray(toolInput.edits) ? toolInput.edits : null;
  if (edits) {
    return edits.map((edit) => ({
      file: editedPath(edit) || file,
      oldText: edit.old_string || edit.oldString || '',
      newText: edit.new_string || edit.newString || '',
    }));
  }
  return [{
    file,
    oldText: toolInput.old_string || toolInput.oldString || '',
    newText: toolInput.new_string || toolInput.newString || '',
  }];
}

function grantDeny(pair) {
  if (!isPolicyPath(pair.file)) return null;
  const newText = String(pair.newText || '');
  if (!ACCEPT_RE.test(newText)) return null;
  if (NAMED_GRANT_RE.test(newText) && EXPIRY_RE.test(newText)) return null;
  return deny(
    'grant_not_removable',
    `Denied edit of ${pair.file}: an accept grant needs a name and an expiry so it can be removed without rewriting the rest of the file.`,
  );
}

function tailscaleSshEnabled(command) {
  if (/\btailscale\s+ssh\b/i.test(command)) return true;
  const match = command.match(/\btailscale\s+(?:up|set)\b[^\n;&|]*/i);
  if (!match) return false;
  const flags = match[0];
  if (/--ssh(?:=false|\s+false)\b/i.test(flags)) return false;
  return /--ssh\b/i.test(flags);
}

function shellCommand(view) {
  if (view && typeof view.command === 'string' && view.command.trim()) return view.command;
  const input = view && view.toolInput;
  if (!input || typeof input !== 'object') return '';
  if (typeof input.command === 'string') return input.command;
  if (typeof input.cmd === 'string') return input.cmd;
  return '';
}

function evaluateTailscaleOctoberAccess(view = {}) {
  const tool = String(view.toolName || '').toLowerCase();
  if (EDIT_TOOLS.has(tool)) {
    const toolInput = view.toolInput && typeof view.toolInput === 'object' ? view.toolInput : {};
    for (const pair of editPairs(toolInput)) {
      const result = grantDeny(pair);
      if (result) return result;
    }
  }
  const body = stripShellComments(shellCommand(view));
  if (!body.trim()) return null;
  if (FUNNEL_RE.test(body)) {
    return deny(
      'public_agent_node',
      'Denied tailscale funnel: an agent node does not face the open web.',
    );
  }
  if (tailscaleSshEnabled(body)) {
    return deny(
      'tailscale_ssh',
      'Denied Tailscale SSH: the agent does not open that session. A normal ssh binary is a different command.',
    );
  }
  const attachedMysqlPassword = /\b(?:mysql|mariadb)\b/i.test(body)
    && ATTACHED_MYSQL_PASSWORD_RE.test(body);
  if (DB_PASSWORD_RE.test(body) || attachedMysqlPassword) {
    return deny(
      'shared_db_password',
      'Denied database credential in the command: a password does not belong on the laptop. Use an identity that is not pasted into the shell.',
    );
  }
  return null;
}

module.exports = {
  GATE,
  evaluateTailscaleOctoberAccess,
};
