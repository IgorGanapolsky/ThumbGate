'use strict';

// A pass after a deleted or skipped assertion is not a product pass.
// A retry is allowed for a test reload. A retry of publish, login, or
// checkout/reset/clean changes the meaning of the step, so it is denied.

const GATE = 'mabl-failure-honesty';

const EDIT_TOOLS = new Set([
  'edit',
  'search_replace',
  'multiedit',
  'strreplace',
  'str_replace',
]);

const ASSERTION_RE = /\bassert\s*(?:\(|\.)|\bexpect\s*\(|(?:^|[\n;])\s*assert\s+/g;
const SKIP_RE = /\b(?:it|test|describe)\.skip\b|\bxit\s*\(/g;
const TEST_COMMAND_RE = /\b(?:npm\s+(?:run\s+)?test|node\s+--test|pytest)\b/;
const FORCED_GREEN_RE = /\|\|\s*(?:\/bin\/true|true|exit\s+0)\b|\|\|\s*:/;
const NON_RETRIABLE = [
  /\bgit\s+(?:-C\s+\S+\s+)?push\b/i,
  /\bgh\s+pr\s+merge\b/i,
  /\baz\s+repos\s+pr\b/i,
  /\bgit\s+(?:-C\s+\S+\s+)?(?:checkout|reset|clean)\b/i,
  /\b(?:gh\s+auth\s+login|az\s+login|gcloud\s+auth\s+login|aws\s+login)\b/i,
  /\bmfa\b/i,
];

function stripComments(text) {
  return String(text || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1')
    .replace(/(^|\s)#[^\n]*/g, '$1');
}

function countMatches(text, pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  return (stripComments(text).match(re) || []).length;
}

function isTestPath(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  if (!normalized) return false;
  return /(?:^|\/)tests?\//i.test(normalized)
    || /(?:^|\/)__tests__\//i.test(normalized)
    || /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(normalized)
    || /_test\.py$/i.test(normalized)
    || /(?:^|\/)test_[^/]+\.py$/i.test(normalized);
}

function editedPath(source) {
  if (!source || typeof source !== 'object') return '';
  return source.file_path || source.path || source.filePath || '';
}

function editPairs(toolInput) {
  const file = editedPath(toolInput);
  if (Array.isArray(toolInput.edits)) {
    return toolInput.edits.map((edit) => ({
      file: editedPath(edit) || file,
      oldText: edit.old_string || edit.oldString || '',
      newText: edit.new_string || edit.newString || '',
    }));
  }
  return [{
    file,
    oldText: toolInput.old_string || toolInput.oldString || '',
    newText: toolInput.new_string || toolInput.newString || toolInput.contents || toolInput.content || '',
  }];
}

function deny(failureReason, message) {
  return {
    decision: 'deny',
    gate: GATE,
    severity: 'critical',
    failureReason,
    message,
  };
}

function assertionDeny(pair) {
  if (!isTestPath(pair.file)) return null;
  const oldAssertions = countMatches(pair.oldText, ASSERTION_RE);
  const newAssertions = countMatches(pair.newText, ASSERTION_RE);
  if (newAssertions < oldAssertions) {
    return deny(
      'assertion_removed',
      `Denied edit of ${pair.file}: the replacement has fewer assertions than the text it removes. A pass after deleting an assertion is not a product pass.`,
    );
  }
  const oldSkips = countMatches(pair.oldText, SKIP_RE);
  const newSkips = countMatches(pair.newText, SKIP_RE);
  if (newSkips > oldSkips) {
    return deny(
      'assertion_skipped',
      `Denied edit of ${pair.file}: the replacement adds a skipped test. Skipping the assertion is not a product pass.`,
    );
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

function stripShellComments(command) {
  const text = String(command || '');
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
    if (c === '"' || c === "'" || c === '`') {
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

function isWordChar(c) {
  return /[A-Za-z0-9_]/.test(c || '');
}

function wordAt(text, index, word) {
  if (text.slice(index, index + word.length) !== word) return false;
  const before = index === 0 || !isWordChar(text[index - 1]);
  const after = index + word.length >= text.length || !isWordChar(text[index + word.length]);
  return before && after;
}

function skipQuoted(text, index) {
  const quote = text[index];
  let i = index + 1;
  while (i < text.length) {
    if (text[i] === '\\' && quote !== "'") {
      i += 2;
      continue;
    }
    if (text[i] === quote) return i;
    i += 1;
  }
  return text.length - 1;
}

function endOfDoDone(text, from) {
  let doAt = -1;
  for (let i = from; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      i = skipQuoted(text, i);
      continue;
    }
    if (wordAt(text, i, 'do')) {
      doAt = i + 2;
      break;
    }
  }
  if (doAt < 0) return -1;
  let depth = 1;
  for (let i = doAt; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      i = skipQuoted(text, i);
      continue;
    }
    if (wordAt(text, i, 'do')) {
      depth += 1;
      i += 1;
      continue;
    }
    if (wordAt(text, i, 'done')) {
      depth -= 1;
      if (depth === 0) return i + 4;
      i += 3;
    }
  }
  return text.length;
}

function endOfSimple(text, from) {
  let i = from;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      i = skipQuoted(text, i) + 1;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (two === '&&' || two === '||' || c === ';' || c === '|' || c === '\n') break;
    i += 1;
  }
  return i;
}

function loopRegions(command) {
  const regions = [];
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i];
    if (c === '"' || c === "'" || c === '`') {
      i = skipQuoted(command, i);
      continue;
    }
    if (wordAt(command, i, 'for') || wordAt(command, i, 'while') || wordAt(command, i, 'until')) {
      const end = endOfDoDone(command, i);
      if (end > i) regions.push(command.slice(i, end));
      continue;
    }
    if (wordAt(command, i, 'retry')) {
      regions.push(command.slice(i, endOfSimple(command, i + 5)));
    }
  }
  return regions;
}

function shellDeny(command) {
  const body = stripShellComments(command);
  if (TEST_COMMAND_RE.test(body) && FORCED_GREEN_RE.test(body)) {
    return deny(
      'forced_green',
      'Denied test command: `|| true`, `|| :`, or `|| exit 0` forces the suite green. A pass after ignoring the failure is not a product pass.',
    );
  }
  for (const region of loopRegions(body)) {
    const hit = NON_RETRIABLE.find((pattern) => pattern.test(region));
    if (!hit) continue;
    const shown = region.match(hit);
    return deny(
      'retry_changes_meaning',
      `Denied retry of \`${shown ? shown[0] : 'that command'}\`: repeating publish, login, checkout, reset, or clean changes the meaning of the step. Run it once.`,
    );
  }
  return null;
}

function evaluateMablFailureHonesty(view = {}) {
  const tool = String(view.toolName || '').toLowerCase();
  if (EDIT_TOOLS.has(tool)) {
    const toolInput = view.toolInput && typeof view.toolInput === 'object' ? view.toolInput : {};
    for (const pair of editPairs(toolInput)) {
      const result = assertionDeny(pair);
      if (result) return result;
    }
    return null;
  }
  return shellDeny(shellCommand(view));
}

module.exports = {
  GATE,
  evaluateMablFailureHonesty,
};
