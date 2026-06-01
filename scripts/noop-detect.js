'use strict';

// scripts/noop-detect.js
//
// No-op / redundant-action detection for ThumbGate.
//
// Given an action's pre/post state (file diff, command exit code + output),
// this module decides whether the action actually changed anything OR whether
// it is byte-identical to an attempt already seen this session. Both are strong,
// cheap "the agent is looping" repeat signals that plug into
// track_action -> prevention_rules.
//
// Design goals:
//   * Pure / file-local. No edits to shared modules from inside here.
//   * Normalize volatile fields (timestamps, shas, ANSI, trailing whitespace)
//     before hashing so non-deterministic output does not defeat detection.
//   * Guard partial writes: a truncated after-state that is a strict prefix of
//     the before-state must NOT be reported as a no-op.
//
// Persistence lives beside session-actions.json (derived from
// gates-engine.SESSION_ACTIONS_PATH) so it picks up THUMBGATE_STATE_DIR
// overrides and shares the same TTL semantics.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const gatesEngine = require('./gates-engine');

// Match the same 1h session window the engine uses for session actions.
const ATTEMPT_TTL_MS = 60 * 60 * 1000;

// -- volatile-field normalization ------------------------------------------
//
// Each pattern strips a class of non-deterministic noise so that two outputs
// which differ only by a timestamp / sha / uuid / ANSI color / trailing
// whitespace hash-equal. Exported so the test suite can assert the contract.
const VOLATILE_PATTERNS = [
  // ANSI escape / color codes (e.g. \x1b[0m). Strip first so later patterns
  // see clean text.
  { name: 'ansi', re: /\x1b\[[0-9;]*[A-Za-z]/g, replacement: '' },
  // ISO-8601 timestamps: 2026-05-31T12:34:56(.123)?(Z|+00:00)
  {
    name: 'iso8601',
    re: /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g,
    replacement: '<TS>',
  },
  // UUIDs (dashed form) — must run before the hexblob pattern, otherwise the
  // trailing 12-char hex segment gets rewritten first and the UUID never matches.
  {
    name: 'uuid',
    re: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
    replacement: '<UUID>',
  },
  // Epoch integers wider than 10 digits (ms/ns timestamps) — run before the
  // hexblob pattern so all-decimal epochs are not swallowed as hex first.
  { name: 'epoch', re: /\b\d{11,}\b/g, replacement: '<EPOCH>' },
  // Long hex blobs (commit shas, uuids without dashes, content hashes): 12+ hex chars.
  { name: 'hexblob', re: /\b[0-9a-fA-F]{12,}\b/g, replacement: '<HEX>' },
  // Trailing whitespace is stripped in normalizeVolatile() via a bounded linear
  // scan (not a regex) to avoid super-linear backtracking on adversarial input.
];

// Strip trailing spaces/tabs from a single line via a bounded reverse scan.
// Linear in line length; replaces /[ \t]+$/ without any regex backtracking.
function stripTrailingSpaceTab(line) {
  let end = line.length;
  while (end > 0) {
    const c = line.charCodeAt(end - 1);
    if (c !== 32 && c !== 9) break; // 32 = space, 9 = tab
    end -= 1;
  }
  return line.slice(0, end);
}

// Normalize a string by applying every volatile pattern, then trimming a
// trailing newline so "foo\n" and "foo" are equivalent.
function normalizeVolatile(value) {
  if (value === null || value === undefined) return '';
  let out = String(value);
  for (const pattern of VOLATILE_PATTERNS) {
    out = out.replace(pattern.re, pattern.replacement);
  }
  // Strip trailing space/tab per line without a backtracking-prone regex.
  out = out.split('\n').map(stripTrailingSpaceTab).join('\n');
  // Normalize CRLF, then strip the trailing run of newlines via a bounded
  // linear scan (replaces /\n+$/ without regex backtracking).
  out = out.replace(/\r\n/g, '\n');
  let end = out.length;
  while (end > 0 && out.charCodeAt(end - 1) === 10) end -= 1; // 10 = \n
  return out.slice(0, end);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

// -- state hashing ----------------------------------------------------------
//
// computeActionStateHash produces a single stable fingerprint for an action's
// observable state. For file actions the fingerprint is the normalized content;
// for command actions it is exit code + normalized stdout/stderr.
function computeActionStateHash(action = {}) {
  const kind = action.kind === 'command' ? 'command' : 'file';

  if (kind === 'command') {
    const exitCode = action.exitCode === undefined || action.exitCode === null
      ? ''
      : String(action.exitCode);
    const parts = [
      'command',
      `exit:${exitCode}`,
      `stdout:${normalizeVolatile(action.stdout)}`,
      `stderr:${normalizeVolatile(action.stderr)}`,
    ];
    return sha256(parts.join('\x00'));
  }

  // file kind: hash the relevant content (after-content is the canonical state
  // for a single snapshot; for diff comparisons detectNoop compares before/after
  // separately). Include filePath so two unrelated files never collide.
  const content = action.afterContent !== undefined && action.afterContent !== null
    ? action.afterContent
    : action.beforeContent;
  const parts = [
    'file',
    `path:${action.filePath || ''}`,
    `content:${normalizeVolatile(content)}`,
  ];
  return sha256(parts.join('\x00'));
}

// Hash just a content blob for before/after comparison (no path/kind framing).
function contentHash(content) {
  return sha256(normalizeVolatile(content));
}

// -- no-op detection --------------------------------------------------------
//
// detectNoop({ before, after }) returns { noop, reason }.
//   before/after: { kind, filePath, beforeContent/afterContent OR content,
//                   exitCode, stdout, stderr }
//
// We accept a flexible shape: the caller may pass a single action object with
// beforeContent/afterContent, or split before/after sub-objects. Both forms
// resolve to the same decision.
function detectNoop(input = {}) {
  const before = input.before || {};
  const after = input.after || {};

  // Determine kind from whichever side declares it (default file).
  const kind = (before.kind || after.kind || input.kind) === 'command'
    ? 'command'
    : 'file';

  if (kind === 'command') {
    const beforeExit = before.exitCode;
    const afterExit = after.exitCode;
    if (beforeExit !== undefined && afterExit !== undefined && beforeExit !== afterExit) {
      return { noop: false, reason: 'exit-code-changed' };
    }
    const beforeOut = contentHash(`${normalizeVolatile(before.stdout)}\x00${normalizeVolatile(before.stderr)}`);
    const afterOut = contentHash(`${normalizeVolatile(after.stdout)}\x00${normalizeVolatile(after.stderr)}`);
    if (beforeOut === afterOut) {
      return { noop: true, reason: 'command-output-unchanged' };
    }
    return { noop: false, reason: 'command-output-changed' };
  }

  // file kind.
  const beforeContent = before.content !== undefined ? before.content
    : (before.beforeContent !== undefined ? before.beforeContent : input.beforeContent);
  const afterContent = after.content !== undefined ? after.content
    : (after.afterContent !== undefined ? after.afterContent : input.afterContent);

  const beforeStr = beforeContent === undefined || beforeContent === null ? '' : String(beforeContent);
  const afterStr = afterContent === undefined || afterContent === null ? '' : String(afterContent);

  // Partial-write guard: an after-state that is a strict, shorter prefix of the
  // before-state is a truncation, not a no-op — even though hashes differ, we
  // make the intent explicit so callers never mistake it.
  if (afterStr.length > 0 && afterStr.length < beforeStr.length && beforeStr.startsWith(afterStr)) {
    return { noop: false, reason: 'partial-write-truncation' };
  }

  if (contentHash(beforeStr) === contentHash(afterStr)) {
    return { noop: true, reason: 'file-content-unchanged' };
  }
  return { noop: false, reason: 'file-content-changed' };
}

// -- attempt persistence ----------------------------------------------------
//
// Stores (sessionId -> { "actionId\x00stateHash": timestamp }) so a repeated
// (actionId, stateHash) tuple within the TTL window is a strong repeat signal.
function attemptsPath() {
  const sessionActionsPath = gatesEngine.SESSION_ACTIONS_PATH;
  return path.join(path.dirname(sessionActionsPath), 'noop-attempts.json');
}

function loadAttempts() {
  try {
    const raw = fs.readFileSync(attemptsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch (e) {
    return {};
  }
}

function pruneExpired(store, now) {
  let changed = false;
  for (const sessionId of Object.keys(store)) {
    const bucket = store[sessionId];
    if (!bucket || typeof bucket !== 'object') {
      delete store[sessionId];
      changed = true;
      continue;
    }
    for (const key of Object.keys(bucket)) {
      const ts = bucket[key];
      if (typeof ts !== 'number' || now - ts >= ATTEMPT_TTL_MS) {
        delete bucket[key];
        changed = true;
      }
    }
    if (Object.keys(bucket).length === 0) {
      delete store[sessionId];
      changed = true;
    }
  }
  return changed;
}

function saveAttempts(store) {
  const file = attemptsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2) + '\n');
}

function attemptKey(actionId, stateHash) {
  return `${String(actionId)}\x00${String(stateHash)}`;
}

// recordActionAttempt persists that (sessionId, actionId, stateHash) was seen.
// Returns { recorded: boolean, alreadySeen: boolean }.
function recordActionAttempt(sessionId, actionId, stateHash) {
  const sid = String(sessionId || 'default');
  const now = Date.now();
  const store = loadAttempts();
  pruneExpired(store, now);

  if (!store[sid] || typeof store[sid] !== 'object') store[sid] = {};
  const key = attemptKey(actionId, stateHash);
  const alreadySeen = Object.prototype.hasOwnProperty.call(store[sid], key);
  store[sid][key] = now;
  saveAttempts(store);
  return { recorded: true, alreadySeen };
}

// isRepeatAttempt returns true when this exact (actionId, stateHash) tuple was
// already recorded for this session within the TTL window.
function isRepeatAttempt(sessionId, actionId, stateHash) {
  const sid = String(sessionId || 'default');
  const now = Date.now();
  const store = loadAttempts();
  const bucket = store[sid];
  if (!bucket || typeof bucket !== 'object') return false;
  const ts = bucket[attemptKey(actionId, stateHash)];
  if (typeof ts !== 'number') return false;
  return now - ts < ATTEMPT_TTL_MS;
}

module.exports = {
  VOLATILE_PATTERNS,
  ATTEMPT_TTL_MS,
  normalizeVolatile,
  computeActionStateHash,
  detectNoop,
  recordActionAttempt,
  isRepeatAttempt,
  // Exposed for tests / introspection.
  attemptsPath,
};
