#!/usr/bin/env node
'use strict';

// Verification Stop hook: when the agent says it is done, run the project's own check (tests, lint, type check) and
// send the failure back to the agent instead of letting it stop. Boris Cherny's tip for Claude Code: give Claude a
// way to verify its work. Opt-in: nothing runs until `.thumbgate/verify.json` exists (`thumbgate ralph init` writes
// one) or THUMBGATE_VERIFY_COMMAND is set.
//
//   .thumbgate/verify.json  { "command": "npm test", "timeoutSec": 600, "maxRounds": 3 }
//
// Bounded on purpose: at most `maxRounds` blocks per session (three strikes, then it lets the agent stop and says so),
// and a tree that already passed is not run again. Claude Code also caps a Stop hook at 8 continuations in a row.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CONFIG_FILE = path.join('.thumbgate', 'verify.json');
const STATE_FILE = path.join('.thumbgate', 'verify-stop-state.json');
const DEFAULT_TIMEOUT_SEC = 600;
const DEFAULT_MAX_ROUNDS = 3;
const TAIL_LINES = 40;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function loadConfig(cwd, env = process.env) {
  const file = readJson(path.join(cwd, CONFIG_FILE), null);
  const command = (env.THUMBGATE_VERIFY_COMMAND || (file && file.command) || '').trim();
  if (!command) return null;
  return {
    command,
    timeoutSec: Number(env.THUMBGATE_VERIFY_TIMEOUT_SEC || (file && file.timeoutSec)) || DEFAULT_TIMEOUT_SEC,
    maxRounds: Number(env.THUMBGATE_VERIFY_MAX_ROUNDS || (file && file.maxRounds)) || DEFAULT_MAX_ROUNDS,
  };
}

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

// Fingerprint of the work: HEAD plus uncommitted changes plus untracked file names. Null outside git.
function treeFingerprint(cwd) {
  const head = git(cwd, ['rev-parse', 'HEAD']);
  if (head === null) return null;
  // ThumbGate's own state files change on every run; they are not the work.
  const notOurs = ['--', '.', ':(exclude).thumbgate'];
  const diff = git(cwd, ['diff', 'HEAD', ...notOurs]) || '';
  const untracked = git(cwd, ['ls-files', '--others', '--exclude-standard', ...notOurs]) || '';
  const hash = crypto.createHash('sha256').update(head).update(diff).update(untracked);
  // New files are part of the work too: hash their content, not only their names.
  for (const rel of untracked.split('\n').filter(Boolean).slice(0, 500)) {
    try { hash.update(fs.readFileSync(path.join(cwd, rel))); } catch { /* unreadable: the name still counts */ }
  }
  return hash.digest('hex');
}

function loadState(cwd) {
  return readJson(path.join(cwd, STATE_FILE), { sessions: {} });
}

function saveState(cwd, state) {
  const file = path.join(cwd, STATE_FILE);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Keep the 50 most recent sessions.
    const entries = Object.entries(state.sessions || {}).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, 50);
    fs.writeFileSync(file, `${JSON.stringify({ sessions: Object.fromEntries(entries), lastPass: state.lastPass || null }, null, 2)}\n`);
  } catch { /* state is a convenience; the check still ran */ }
}

function tail(text, lines = TAIL_LINES) {
  const all = String(text || '').trimEnd().split('\n');
  return all.slice(-lines).join('\n');
}

function runCheck(config, cwd) {
  const r = spawnSync(config.command, { cwd, shell: true, encoding: 'utf8', timeout: config.timeoutSec * 1000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CI: process.env.CI || '1' } });
  const timedOut = Boolean(r.error && r.error.code === 'ETIMEDOUT');
  return { ok: r.status === 0 && !timedOut, status: r.status, timedOut, output: `${r.stdout || ''}${r.stderr || ''}` };
}

/** Decide what the Stop hook returns. Returns an object to print as JSON, or null to let the agent stop silently. */
function evaluateStop(payload = {}, options = {}) {
  const cwd = options.cwd || payload.cwd || process.cwd();
  const config = options.config || loadConfig(cwd, options.env || process.env);
  if (!config) return null;
  const sessionId = String(payload.session_id || 'default');
  const state = loadState(cwd);
  state.sessions = state.sessions || {};
  const session = state.sessions[sessionId] || { rounds: 0 };
  const fingerprint = treeFingerprint(cwd);

  if (fingerprint && state.lastPass && state.lastPass.fingerprint === fingerprint && state.lastPass.command === config.command) {
    return null;
  }

  const run = (options.runCheck || runCheck)(config, cwd);
  const now = new Date().toISOString();
  if (run.ok) {
    state.lastPass = { fingerprint, command: config.command, at: now };
    state.sessions[sessionId] = { rounds: 0, at: now };
    saveState(cwd, state);
    return null;
  }

  session.rounds = Number(session.rounds || 0) + 1;
  session.at = now;
  state.sessions[sessionId] = session;
  saveState(cwd, state);

  const why = run.timedOut ? `timed out after ${config.timeoutSec}s` : `exited ${run.status}`;
  if (session.rounds > config.maxRounds) {
    return {
      systemMessage: `ThumbGate verify: \`${config.command}\` still fails (${why}) after ${config.maxRounds} rounds. Letting the agent stop; the work is not verified.`,
    };
  }
  return {
    decision: 'block',
    reason: `Verification failed: \`${config.command}\` ${why} (round ${session.rounds} of ${config.maxRounds}).\n`
      + `Last ${TAIL_LINES} lines:\n${tail(run.output)}\n\n`
      + 'Fix the cause, then finish. Do not skip, delete or weaken a test to make it pass.',
  };
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let payload = {};
  try { payload = JSON.parse(raw || '{}'); } catch { payload = {}; }
  const out = evaluateStop(payload);
  if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
}

module.exports = { evaluateStop, loadConfig, treeFingerprint, runCheck, CONFIG_FILE, STATE_FILE, main };

if (require.main === module) main().catch(() => {});
