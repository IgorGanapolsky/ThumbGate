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

const WRAPPERS = new Set(['sudo', 'command', 'exec', 'nohup', 'nice', 'time', 'env']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ash']);
const FLAG_TAKES_VALUE = new Set([
  '-u', '-g', '-h', '-p', '-C', '-T', '-D', '-n',
  '--user', '--group', '--host', '--prompt', '--chdir', '--role', '--adjustment',
]);

function commentStartsHere(out) {
  if (!out) return true;
  return /[\s;|&()<>]/.test(out[out.length - 1]);
}

function stripShellComments(command) {
  const src = String(command || '');
  let out = '';
  let quote = '';
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      out += ch;
      if (ch === '\\' && quote === '"' && i + 1 < src.length) {
        out += src[i + 1];
        i += 1;
        continue;
      }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '\\' && i + 1 < src.length) {
      out += ch + src[i + 1];
      i += 1;
      continue;
    }
    if (ch === '\'' || ch === '"') {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '#' && commentStartsHere(out)) {
      while (i < src.length && src[i] !== '\n') i += 1;
      out += ' ';
      i -= 1;
      continue;
    }
    out += ch;
  }
  return out;
}

function simpleCommands(command) {
  const parts = [];
  let buf = '';
  let quote = '';
  const push = () => {
    if (buf.trim()) parts.push(buf.trim());
    buf = '';
  };
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      buf += ch;
      if (ch === '\\' && quote === '"' && i + 1 < command.length) {
        buf += command[i + 1];
        i += 1;
        continue;
      }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '\\' && i + 1 < command.length) {
      buf += ch + command[i + 1];
      i += 1;
      continue;
    }
    if (ch === '\'' || ch === '"') {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === '\n' || ch === ';' || ch === '|' || ch === '&') {
      push();
      continue;
    }
    buf += ch;
  }
  push();
  return parts;
}

function shellWords(segment) {
  const words = [];
  let buf = '';
  let quote = '';
  const push = () => {
    if (buf.length) words.push(buf);
    buf = '';
  };
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i];
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < segment.length) {
        buf += segment[i + 1];
        i += 1;
        continue;
      }
      if (ch === quote) {
        quote = '';
        continue;
      }
      buf += ch;
      continue;
    }
    if (ch === '\\' && i + 1 < segment.length) {
      buf += segment[i + 1];
      i += 1;
      continue;
    }
    if (ch === '\'' || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      push();
      continue;
    }
    buf += ch;
  }
  push();
  return words;
}

function commandBasename(word) {
  const text = String(word || '');
  const slash = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
  return slash >= 0 ? text.slice(slash + 1) : text;
}

function commandArgv(words) {
  let i = 0;
  const skipAssignments = () => {
    while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i += 1;
  };
  skipAssignments();
  while (i < words.length && WRAPPERS.has(commandBasename(words[i]).toLowerCase())) {
    i += 1;
    while (i < words.length && words[i].startsWith('-')) {
      const flag = words[i];
      i += 1;
      if (!flag.includes('=') && FLAG_TAKES_VALUE.has(flag) && i < words.length && !words[i].startsWith('-')) {
        i += 1;
      }
    }
    skipAssignments();
  }
  return words.slice(i);
}

function nestedCommandText(argv) {
  const base = commandBasename(argv[0] || '').toLowerCase();
  if (base === 'eval') return argv.slice(1).join(' ');
  if (!SHELLS.has(base)) return '';
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-c' || arg === '--command' || /^-[^-]*c/.test(arg)) return argv[i + 1] || '';
  }
  return '';
}

function matchingParen(segment, openAt) {
  let depth = 0;
  let quote = '';
  for (let i = openAt; i < segment.length; i += 1) {
    const ch = segment[i];
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < segment.length) {
        i += 1;
        continue;
      }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '\\' && i + 1 < segment.length) {
      i += 1;
      continue;
    }
    if (ch === '\'' || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function takeSubstitution(segment, i, found) {
  const ch = segment[i];
  if (ch === '`') {
    const end = segment.indexOf('`', i + 1);
    if (end < 0) return segment.length;
    found.push(segment.slice(i + 1, end));
    return end;
  }
  if (ch === '$' && segment[i + 1] === '(') {
    const end = matchingParen(segment, i + 1);
    if (end < 0) return segment.length;
    found.push(segment.slice(i + 2, end));
    return end;
  }
  return i;
}

function commandSubstitutions(segment) {
  const found = [];
  let quote = '';
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i];
    if (quote === '\'') {
      if (ch === '\'') quote = '';
      continue;
    }
    if (ch === '\\' && i + 1 < segment.length && quote !== '\'') {
      i += 1;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = '';
      else i = takeSubstitution(segment, i, found);
      continue;
    }
    if (ch === '\'' || ch === '"') {
      quote = ch;
      continue;
    }
    i = takeSubstitution(segment, i, found);
  }
  return found;
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

function tailscaleSshEnabled(args) {
  const rest = args.slice(1);
  const sub = tailscaleSubcommand(args);
  if (sub.toLowerCase() === 'ssh') return true;
  if (!/^(up|set)$/i.test(sub)) return false;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg.toLowerCase() !== '--ssh' && !/^--ssh=/i.test(arg)) continue;
    if (/^--ssh=false$/i.test(arg)) return false;
    if (arg.toLowerCase() === '--ssh' && String(rest[i + 1] || '').toLowerCase() === 'false') return false;
    return true;
  }
  return false;
}

function tailscaleSubcommand(argv) {
  const rest = argv.slice(1);
  let cursor = 0;
  while (cursor < rest.length && rest[cursor].startsWith('-')) cursor += 1;
  return rest[cursor] || '';
}

function tailscaleInvocationDeny(argv) {
  if (commandBasename(argv[0] || '').toLowerCase() !== 'tailscale') return null;
  if (tailscaleSubcommand(argv).toLowerCase() === 'funnel') {
    return deny(
      'public_agent_node',
      'Denied tailscale funnel: an agent node does not face the open web.',
    );
  }
  if (tailscaleSshEnabled(argv)) {
    return deny(
      'tailscale_ssh',
      'Denied Tailscale SSH: the agent does not open that session. A normal ssh binary is a different command.',
    );
  }
  return null;
}

function shellInvocationDeny(command, depth) {
  if (depth > 4 || !String(command || '').trim()) return null;
  const body = stripShellComments(command);
  for (const segment of simpleCommands(body)) {
    for (const nested of commandSubstitutions(segment)) {
      const inner = shellInvocationDeny(nested, depth + 1);
      if (inner) return inner;
    }
    const argv = commandArgv(shellWords(segment));
    const direct = tailscaleInvocationDeny(argv);
    if (direct) return direct;
    const nested = nestedCommandText(argv);
    if (nested) {
      const inner = shellInvocationDeny(nested, depth + 1);
      if (inner) return inner;
    }
  }
  return null;
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
  const command = shellCommand(view);
  const body = stripShellComments(command);
  if (!body.trim()) return null;
  const invocation = shellInvocationDeny(command, 0);
  if (invocation) return invocation;
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
