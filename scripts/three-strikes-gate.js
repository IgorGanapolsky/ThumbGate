#!/usr/bin/env node
'use strict';

/**
 * three-strikes-gate.js: stop an agent from retrying the same failing command
 * a fourth time (docs/guides/anti-babysitting-gates.md).
 *
 * The rule comes from the Claude Code team's own PR watch: push at most three
 * times for one issue, then report what was tried, because a check that keeps
 * failing after three rounds usually means the approach is wrong.
 *
 *   post (PostToolUse and PostToolUseFailure on Bash): record whether the
 *        command failed. A success clears that command's streak.
 *   pre  (PreToolUse on Bash): deny a command that already failed
 *        maxStrikes times in a row within strikeWindowMinutes, and tell the
 *        agent to change the approach or escalate with the attempts so far.
 *
 * Commands are compared after trimming output plumbing (2>&1, | tail -n 20,
 * leading cd), so "npm test 2>&1 | tail -5" and "npm test" are the same try.
 * Read-only probes such as grep, ls and test exit non-zero normally and are
 * never counted. Same opt-in as reply-discipline-gates.js; fails open.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const reply = require('./reply-discipline-gates');

const DEFAULTS = Object.freeze({ maxStrikes: 3, strikeWindowMinutes: 30 });
const BASH_TOOLS = new Set(['Bash', 'Shell', 'bash']);
// Commands whose non-zero exit is an answer ("no match", "missing"), not a failure.
const PROBE_COMMANDS = new Set(['grep', 'rg', 'egrep', 'fgrep', 'ls', 'cat', 'head', 'tail', 'test', '[', '[[', 'which', 'type', 'diff', 'cmp', 'pgrep', 'find', 'stat', 'true', 'false']);

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function parseJson(text, fallback = {}) {
  try { return JSON.parse(text); } catch { return fallback; }
}

function loadConfig(options = {}) {
  const cfg = reply.loadConfig(options);
  const own = (cfg && typeof cfg.threeStrikes === 'object' && cfg.threeStrikes) || {};
  return { ...DEFAULTS, ...own, enabled: cfg.enabled === true && own.enabled !== false };
}

/** The part of a command that identifies the attempt, without output plumbing. */
function normalizeCommand(command) {
  let c = String(command || '').replace(/\s+/g, ' ').trim();
  c = c.replace(/^(?:cd\s+\S+\s*&&\s*)+/, '');
  c = c.replace(/\s*\|\s*(?:tail|head)(?:\s+-n)?(?:\s+-?\d+)?\s*$/, '');
  c = c.replace(/\s*[12]?>&[12]\s*/g, ' ');
  c = c.replace(/\s*[12]?>\s*\/dev\/null\s*/g, ' ');
  return c.replace(/\s+/g, ' ').trim();
}

/** True only when every part of the command (split on && || ; |) is a read-only probe. */
function isProbe(key) {
  const segments = String(key).split(/\s*(?:&&|\|\||;|\|)\s*/).filter(Boolean);
  if (segments.length === 0) return false;
  return segments.every((seg) => {
    const [first = '', second = ''] = seg.trim().split(' ');
    const name = path.basename(first);
    if (name === 'command') return second === '-v' || second === '-V';
    return PROBE_COMMANDS.has(name);
  });
}

function commandOf(payload = {}) {
  const input = payload.tool_input || {};
  return typeof input.command === 'string' ? input.command : '';
}

function failed(payload = {}) {
  const name = String(payload.hook_event_name || payload.hookEventName || '');
  if (name === 'PostToolUseFailure') return true;
  if (typeof payload.error === 'string' && payload.error.trim()) return true;
  const r = payload.tool_response;
  if (r && typeof r === 'object' && !Array.isArray(r)) {
    for (const k of ['exit_code', 'exitCode', 'returnCode', 'code']) {
      if (typeof r[k] === 'number') return r[k] !== 0;
    }
    if (r.interrupted === true) return false; // the person stopped it; not a strike
  }
  return false;
}

function errorSnippet(payload = {}) {
  const r = payload.tool_response;
  const text = (typeof payload.error === 'string' && payload.error)
    || (r && typeof r === 'object' && (r.stderr || r.stdout))
    || (typeof r === 'string' ? r : '');
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  return (lines.slice(-1)[0] || '').slice(0, 160);
}

// --- Ledger (per session, other sessions' entries survive each write)

function ledgerPath(options = {}) {
  const env = options.env || process.env;
  const dir = env.THUMBGATE_PR_LEDGER_DIR || path.join(env.HOME || os.homedir(), '.thumbgate', 'pr-discipline');
  return path.join(dir, 'three-strikes.json');
}

function readLedger(file) {
  return parseJson(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{}', {});
}

function writeLedger(file, ledger) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(ledger, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function recordResult(payload, options = {}) {
  if (!BASH_TOOLS.has(payload.tool_name || '')) return null;
  const key = normalizeCommand(commandOf(payload));
  if (!key || isProbe(key)) return null;
  const file = ledgerPath(options);
  const ledger = readLedger(file);
  const sid = payload.session_id || 'unknown';
  const entry = ledger[sid] || { commands: {} };
  const now = options.now || Date.now();
  const cfg = { ...DEFAULTS, ...(options.config || {}) };
  if (failed(payload)) {
    const existing = entry.commands[key];
    // A streak older than the window has expired: this failure starts a new one.
    const fresh = !existing || now - Number(existing.lastFailedAt || 0) > cfg.strikeWindowMinutes * 60 * 1000;
    const prev = fresh ? { strikes: 0, attempts: [] } : existing;
    const attempts = [...prev.attempts, { at: new Date(now).toISOString(), error: errorSnippet(payload) }].slice(-5);
    entry.commands[key] = { strikes: prev.strikes + 1, lastFailedAt: now, attempts };
  } else if (entry.commands[key]) {
    delete entry.commands[key];
  } else {
    return null;
  }
  ledger[sid] = entry;
  writeLedger(file, ledger);
  return entry.commands[key] || { strikes: 0 };
}

function evaluatePre(payload, options = {}) {
  const cfg = { ...DEFAULTS, ...(options.config || {}) };
  if (!BASH_TOOLS.has(payload.tool_name || '')) return { deny: false };
  const key = normalizeCommand(commandOf(payload));
  if (!key || isProbe(key)) return { deny: false };
  const entry = readLedger(ledgerPath(options))[payload.session_id || 'unknown'];
  const streak = entry && entry.commands && entry.commands[key];
  if (!streak || streak.strikes < cfg.maxStrikes) return { deny: false };
  const now = options.now || Date.now();
  if (now - Number(streak.lastFailedAt || 0) > cfg.strikeWindowMinutes * 60 * 1000) return { deny: false };
  const tried = streak.attempts.map((a, i) => `${i + 1}. ${a.error || '(no error text)'}`).join(' ');
  return {
    deny: true,
    rule: 'three-strikes',
    reason: `ThumbGate three strikes: "${key.slice(0, 120)}" failed ${streak.strikes} times in a row. `
      + 'Three failed rounds usually means the approach is wrong, so a fourth identical try is blocked. '
      + 'Change the approach (a different fix, a narrower command, a different tool) or stop and report the attempts and what you would try next. '
      + `Recent errors: ${tried}`,
  };
}

async function main(mode = process.argv[2], options = {}) {
  const payload = parseJson(options.stdin !== undefined ? options.stdin : readStdin(), {});
  const config = loadConfig({ cwd: payload.cwd, env: options.env });
  const out = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
  if (!config.enabled) { out({}); return 0; }
  try {
    if (mode === 'pre') {
      const r = evaluatePre(payload, { ...options, config });
      if (r.deny) out({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: r.reason } });
      else out({});
    } else if (mode === 'post') {
      recordResult(payload, { ...options, config });
      out({});
    } else out({});
  } catch (err) {
    process.stderr.write(`three-strikes-gate: ${err && err.message}\n`);
    out({}); // fail open
  }
  return 0;
}

module.exports = {
  DEFAULTS,
  loadConfig,
  normalizeCommand,
  isProbe,
  failed,
  recordResult,
  evaluatePre,
  ledgerPath,
  main,
};

if (require.main === module) {
  main().then((code) => { process.exitCode = code; });
}
