'use strict';

// The ten SDLC prompts are a checklist. A pasted prompt is not a check.
// Deny the ship action that skips it: a no-breaking-changes claim that also
// drops a column, a public export, or a config key; a false-positive
// dismissal with no comment; a test file that names the missing cases and
// only writes the happy path; a pipeline rerun that pastes the error and
// names no cause.

const GATE = 'gitlab-sdlc-prompts';

const EDIT_TOOLS = new Set([
  'edit',
  'write',
  'search_replace',
  'multiedit',
  'strreplace',
  'str_replace',
]);
const READ_TOOLS = new Set(['read', 'grep', 'glob', 'search']);
const BENIGN = new Set([
  'rg', 'grep', 'ag', 'ack', 'echo', 'printf', 'cat', 'head', 'tail', 'less', 'more', 'wc',
]);
const WRAPPERS = new Set(['sudo', 'command', 'exec', 'nohup', 'nice', 'time', 'env']);

const NO_BREAK_RE = /\bno breaking changes?\b|\bnon-breaking\b|\bbackward[- ]compatible\b|\bnot a breaking change\b/i;
const SCHEMA_DROP_RE = /\bDROP\s+(?:COLUMN|TABLE)\b|\bALTER\s+TABLE\b[^;\n]{0,120}\bDROP\b/i;
const REMOVED_EXPORT_RE = /(?:^|\n)-\s*export\s+(?:async\s+)?(?:function|class|const|let|var|type|interface)\s+\w+/;
const REMOVED_CONFIG_RE = /(?:^|[\n'"])-\s*(?:[A-Z][A-Z0-9_]{2,}|[a-z][\w-]{2,})\s*[:=]/;
const DISMISS_RE = /dismissal_reason\s*[=:]\s*['"]?false[_ -]?positive|\b(?:glab|gitlab)\b[\s\S]{0,240}\bdismiss\b[\s\S]{0,240}false[_ -]?positive/i;
const DISMISS_REASON_RE = /(?:--comment(?:=|\s+)|"comment"\s*:\s*"|comment\s*[:=]\s*['"]?)\S{8,}/i;
const CASE_LABELS = [
  /\bedge cases?\b/i,
  /\berror conditions?\b/i,
  /\bboundary values?\b/i,
  /\binvalid inputs?\b/i,
];
const REAL_CASE_RE = /(?:\bit|\btest)\s*\(\s*['"`][^'"`]*(?:edge|error|boundary|invalid|throw|reject)|\b(?:toThrow|assert\.throws|pytest\.raises|rejects\s*\()/i;
const RERUN_RE = /\b(?:gh\s+run\s+rerun|glab\s+ci\s+(?:retry|rerun))\b/i;
const ERROR_PASTE_RE = /\b(?:Error:|##\[error\]|exit code\s+[1-9])/;
const CAUSE_RE = /\b(?:because|root cause|caused by)\b/i;

function deny(failureReason, message) {
  return {
    decision: 'deny',
    gate: GATE,
    severity: 'critical',
    failureReason,
    message,
  };
}

function stripShellComments(text) {
  let out = '';
  let quote = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      out += c;
      if (c === '\\' && quote !== "'") {
        out += text[i + 1] || '';
        i += 1;
        continue;
      }
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      out += c;
      continue;
    }
    if (c === '#' && (i === 0 || /[\s;&|()]/.test(text[i - 1]))) {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    out += c;
  }
  return out;
}

function splitTopLevel(text) {
  const parts = [];
  let out = '';
  let quote = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      out += c;
      if (c === '\\' && quote !== "'") {
        out += text[i + 1] || '';
        i += 1;
      } else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      out += c;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (two === '&&' || two === '||' || c === ';' || c === '|' || c === '\n') {
      if (out.trim()) parts.push(out.trim());
      out = '';
      if (two === '&&' || two === '||') i += 1;
      continue;
    }
    out += c;
  }
  if (out.trim()) parts.push(out.trim());
  return parts;
}

function firstExecutable(part) {
  const words = part.trim().split(/\s+/);
  let i = 0;
  while (i < words.length) {
    const bin = words[i].split('/').pop();
    if (!WRAPPERS.has(bin)) return bin;
    i += 1;
    if (bin === 'sudo' && (words[i] === '-u' || words[i] === '--user')) i += 2;
    else if (bin === 'env') {
      while (words[i] && words[i].includes('=')) i += 1;
    }
  }
  return '';
}

function substitutions(text) {
  const found = [];
  let quote = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote === "'") {
      if (c === "'") quote = '';
      continue;
    }
    if (quote === '"' && c === '\\') {
      i += 1;
      continue;
    }
    if (c === '"') {
      quote = quote === '"' ? '' : '"';
      continue;
    }
    if (!quote && c === "'") {
      quote = "'";
      continue;
    }
    if (c !== '$' || text[i + 1] !== '(') continue;
    let depth = 1;
    let body = '';
    let j = i + 2;
    for (; j < text.length && depth > 0; j += 1) {
      if (text[j] === '(') depth += 1;
      else if (text[j] === ')') depth -= 1;
      if (depth > 0) body += text[j];
    }
    if (body.trim()) found.push(body.trim());
    i = j - 1;
  }
  return found;
}

function breakingDeny(text) {
  if (!NO_BREAK_RE.test(text)) return null;
  if (!SCHEMA_DROP_RE.test(text) && !REMOVED_EXPORT_RE.test(text) && !REMOVED_CONFIG_RE.test(text)) {
    return null;
  }
  return deny(
    'breaking_change_hidden',
    'Denied a no-breaking-changes claim that also drops a column, a public export, or a config key. Check the API signature, public methods, return types, database schema, and configuration.',
  );
}

function dismissDeny(text) {
  if (!DISMISS_RE.test(text) || DISMISS_REASON_RE.test(text)) return null;
  return deny(
    'finding_dismissed',
    'Denied a false-positive dismissal with no comment. Name the reason before closing the finding.',
  );
}

function isTestPath(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  return /(?:^|\/)(?:tests?|__tests__|specs?)\//i.test(normalized)
    || /[^/]*\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(normalized);
}

function happyPathDeny(text, filePath) {
  if (!isTestPath(filePath)) return null;
  if (CASE_LABELS.filter((pattern) => pattern.test(text)).length < 3) return null;
  if (REAL_CASE_RE.test(text)) return null;
  return deny(
    'happy_path_only',
    'Denied a test write that names the edge, error, boundary, and invalid cases and only implements the happy path.',
  );
}

function rerunDeny(text) {
  if (!RERUN_RE.test(text) || !ERROR_PASTE_RE.test(text) || CAUSE_RE.test(text)) return null;
  return deny(
    'pipeline_rerun_without_cause',
    'Denied a pipeline rerun that pastes the error and does not name the cause.',
  );
}

function judgeText(text, filePath) {
  return breakingDeny(text)
    || dismissDeny(text)
    || happyPathDeny(text, filePath)
    || rerunDeny(text);
}

function editsOf(toolInput) {
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  const many = Array.isArray(input.edits) ? input.edits : [input];
  return many.map((edit) => ({
    text: String(edit.new_string ?? edit.newString ?? edit.contents ?? edit.content ?? ''),
    filePath: String(
      edit.file_path ?? edit.filePath ?? edit.path
      ?? input.file_path ?? input.filePath ?? input.path
      ?? '',
    ),
  })).filter((edit) => edit.text);
}

function heredocBodies(command) {
  const bodies = [];
  const re = /<<-?\s*(['"]?)(\w+)\1/g;
  for (let match = re.exec(command); match; match = re.exec(command)) {
    const start = command.indexOf('\n', match.index);
    const end = start < 0 ? -1 : command.indexOf(`\n${match[2]}`, start + 1);
    if (start >= 0 && end > start) bodies.push(command.slice(start + 1, end));
  }
  return bodies;
}

function testPathFrom(command) {
  const match = String(command).match(/(?:[\w./-]+\/)?[\w.-]+\.(?:test|spec)\.[cm]?[jt]sx?/);
  return match ? match[0] : '';
}

function shellDeny(command, depth = 0) {
  if (depth > 4 || !String(command || '').trim()) return null;
  const stripped = stripShellComments(command);
  for (const part of splitTopLevel(stripped)) {
    for (const nested of substitutions(part)) {
      const nestedHit = shellDeny(nested, depth + 1);
      if (nestedHit) return nestedHit;
    }
    if (BENIGN.has(firstExecutable(part))) continue;
    const hit = judgeText(part, testPathFrom(part));
    if (hit) return hit;
  }
  for (const body of heredocBodies(command)) {
    const hit = judgeText(body, testPathFrom(command));
    if (hit) return hit;
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

function evaluateGitLabSdlcPrompts(view = {}) {
  const tool = String(view.toolName || '').toLowerCase();
  if (READ_TOOLS.has(tool)) return null;
  if (EDIT_TOOLS.has(tool)) {
    const toolInput = view.toolInput && typeof view.toolInput === 'object' ? view.toolInput : {};
    for (const edit of editsOf(toolInput)) {
      const hit = judgeText(edit.text, edit.filePath);
      if (hit) return hit;
    }
    return null;
  }
  return shellDeny(shellCommand(view));
}

module.exports = {
  GATE,
  evaluateGitLabSdlcPrompts,
};
