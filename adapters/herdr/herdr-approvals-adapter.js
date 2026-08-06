#!/usr/bin/env node
'use strict';

/**
 * ThumbGate approvals adapter for Herdr (herdr.dev).
 *
 * Herdr invokes this as an argv command — no shell expansion — for the
 * [[startup]], [[actions]] and [[events]] entries declared in
 * herdr-plugin.toml. Herdr injects HERDR_BIN_PATH, HERDR_SOCKET_PATH,
 * HERDR_PLUGIN_ID, HERDR_PLUGIN_CONFIG_DIR and HERDR_PLUGIN_STATE_DIR, and
 * passes context JSON on stdin. The whole Herdr CLI is the plugin API, so we
 * call back through HERDR_BIN_PATH rather than importing anything from Herdr.
 *
 * Design rule: a governance plugin must never wedge the terminal it governs.
 * Every path degrades to a printed explanation and exit 0 when ThumbGate or
 * Herdr is unavailable. On 2026-08-05 a ThumbGate gate blocked its own repair
 * path for 60+ operations; this adapter is the same failure class and must not
 * repeat it.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const HERDR_BIN = process.env.HERDR_BIN_PATH || 'herdr';

function run(bin, args, input) {
  const res = spawnSync(bin, args, { encoding: 'utf8', input, timeout: 20000, env: process.env });
  return {
    ok: res.status === 0,
    status: res.status,
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim(),
  };
}

// ThumbGate is resolved at call time: an operator may have it on PATH, in a
// pinned runtime, or not at all. Never assume, never install silently.
//
// A missing binary surfaces as exit 127 (or a null status when spawn itself
// fails), NOT as an exception — so both must fall through to the npx path.
// Treating 127 as a real ThumbGate answer made the adapter report "unavailable"
// on machines where npx could have resolved it (caught in live testing).
function isCommandMissing(res) {
  return res.status === null || res.status === 127;
}

function thumbgate(args) {
  const direct = run('thumbgate', args);
  if (!isCommandMissing(direct)) return direct;
  return run('npx', ['--yes', '--package', 'thumbgate', 'thumbgate', ...args]);
}

function readContext() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function listAgentPanes() {
  const res = run(HERDR_BIN, ['agent', 'list', '--json']);
  if (!res.ok) return [];
  try {
    const parsed = JSON.parse(res.stdout);
    return Array.isArray(parsed) ? parsed : parsed.agents || [];
  } catch {
    return [];
  }
}

function unavailable(what, detail) {
  process.stdout.write(`ThumbGate approvals: ${what} unavailable — ${detail}\n`);
  process.stdout.write('The plugin stays out of the way; your panes are unaffected.\n');
  return 0;
}

function cmdStartup() {
  const probe = thumbgate(['--version']);
  if (!probe.ok) {
    return unavailable('ThumbGate', 'not installed. Run `npm i -g thumbgate` to enable gating.');
  }
  process.stdout.write(`ThumbGate approvals ready (thumbgate ${probe.stdout.split('\n')[0]}).\n`);
  const panes = listAgentPanes();
  if (panes.length) {
    process.stdout.write(`Governing ${panes.length} agent pane(s) in this session.\n`);
  }
  return 0;
}

// The reason this plugin exists. A per-session PreToolUse hook can only ever
// show one agent's pending decision; Herdr knows every pane at once, so the
// operator adjudicates the whole fleet from one surface.
function cmdQueue() {
  const stats = thumbgate(['gate-stats', '--json']);
  if (!stats.ok) {
    return unavailable('gate stats', stats.stderr || 'thumbgate gate-stats failed');
  }
  let parsed = {};
  try {
    parsed = JSON.parse(stats.stdout);
  } catch {
    process.stdout.write(`${stats.stdout}\n`);
    return 0;
  }

  const panes = listAgentPanes();
  const pending = parsed.pendingApproval ?? parsed.pending ?? 0;
  const blocked = parsed.blocked ?? 0;
  const warned = parsed.warned ?? 0;

  process.stdout.write('ThumbGate — fleet approval queue\n');
  process.stdout.write(`  agent panes:        ${panes.length}\n`);
  process.stdout.write(`  awaiting approval:  ${pending}\n`);
  process.stdout.write(`  blocked (session):  ${blocked}\n`);
  process.stdout.write(`  warned (session):   ${warned}\n`);
  if (pending === 0 && blocked === 0) {
    process.stdout.write('\nNothing is waiting on you.\n');
  }
  return 0;
}

function cmdGates() {
  const rules = thumbgate(['prevention-rules']);
  if (!rules.ok) {
    return unavailable('prevention rules', rules.stderr || 'thumbgate prevention-rules failed');
  }
  process.stdout.write(`${rules.stdout}\n`);
  return 0;
}

// The thumbs-down, from wherever the operator is looking. Turning a mistake
// into a rule is the product; this makes it one keystroke inside Herdr.
function cmdBlockLast() {
  const ctx = readContext();
  const where = (ctx.pane && ctx.pane.title) || (ctx.agent && ctx.agent.name) || 'this pane';
  const res = thumbgate([
    'capture-feedback',
    '--feedback=down',
    `--context=Herdr pane "${where}": operator blocked the last action`,
    '--tags=herdr,fleet-approval',
  ]);
  if (!res.ok) {
    return unavailable('feedback capture', res.stderr || 'thumbgate capture-feedback failed');
  }
  process.stdout.write('Captured. ThumbGate will gate this pattern across every pane.\n');
  return 0;
}

// A brand-new worktree is an ungoverned blast radius until a scope exists, so
// bind one at creation time instead of after the first mistake.
function cmdSeedScope() {
  const ctx = readContext();
  const dir = (ctx.worktree && ctx.worktree.path) || ctx.path || process.cwd();
  const res = thumbgate(['gate-check', '--repo', dir]);
  if (!res.ok) {
    return unavailable('scope seeding', res.stderr || 'thumbgate gate-check failed');
  }
  process.stdout.write(`ThumbGate scope seeded for new worktree: ${dir}\n`);
  return 0;
}

const COMMANDS = {
  startup: cmdStartup,
  queue: cmdQueue,
  gates: cmdGates,
  'block-last': cmdBlockLast,
  'seed-scope': cmdSeedScope,
};

function main() {
  const subcommand = process.argv[2] || 'queue';
  const fn = COMMANDS[subcommand];
  if (!fn) {
    process.stdout.write(`Unknown subcommand "${subcommand}". Known: ${Object.keys(COMMANDS).join(', ')}\n`);
    return 1;
  }
  try {
    return fn();
  } catch (err) {
    return unavailable('ThumbGate approvals', err && err.message ? err.message : String(err));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  process.exitCode = main();
}

module.exports = { COMMANDS, thumbgate, listAgentPanes };
