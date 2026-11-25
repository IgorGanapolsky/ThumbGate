#!/usr/bin/env node
'use strict';

/**
 * Which ThumbGate gates are enforced on which host, generated from real runs (AGENT-3667 item P).
 *
 * A cell says "enforced" only when this script ran the gate's denial through that host's real hook path in this
 * checkout and the hook denied it. Anything not run says "untested". A command that ran and was allowed says
 * "not enforced". Text typed into a chat window or a web page is no tool call, so no hook sees it: "out of scope".
 *
 *   node scripts/host-gate-matrix.js --write   run the probes, rewrite docs/compat/host-gate-results.json,
 *                                             docs/host-compatibility.md and the README block
 *   node scripts/host-gate-matrix.js --check   run the probes, fail if the committed files differ
 *
 * Hook paths used (each is the command the host is configured to run):
 *   Claude Code  bin/cli.js gate-check, Claude PreToolUse JSON on stdin
 *   Cursor       plugins/cursor-marketplace/scripts/gate-check.sh (beforeShellExecution), Cursor {command} JSON on stdin
 * Codex and Gemini CLI call the same gate-check command, but no run with their own payload shapes exists, so
 * their cells stay "untested".
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');
const CURSOR_PLUGIN = path.join(ROOT, 'plugins', 'cursor-marketplace');
const RESULTS_PATH = path.join(ROOT, 'docs', 'compat', 'host-gate-results.json');
const DOC_PATH = path.join(ROOT, 'docs', 'host-compatibility.md');
const README_PATH = path.join(ROOT, 'README.md');
const START = '<!-- host-gate-matrix:start -->';
const END = '<!-- host-gate-matrix:end -->';

const HOSTS = [
  { id: 'claude-code', label: 'Claude Code', check: 'bin/cli.js gate-check, Claude PreToolUse JSON on stdin (Bash tool)' },
  { id: 'cursor', label: 'Cursor', check: 'plugins/cursor-marketplace/scripts/gate-check.sh, Cursor beforeShellExecution JSON on stdin; deny = exit 2' },
  { id: 'codex', label: 'Codex', check: 'no run: Codex calls the same gate-check command, but nothing here sends it Codex\'s own payload' },
  { id: 'gemini-cli', label: 'Gemini CLI', check: 'no run: no test sends the gate Gemini CLI\'s own hook payload' },
];
const RUNNABLE = new Set(['claude-code', 'cursor']);

// One row per gate. `command` is a shell command the gate must deny. Gates that need project state (task scope,
// release readiness, approvals) are not listed: they have no stateless denial to run.
const GATE_ROWS = [
  { id: 'force-push', command: 'git push --force origin main' },
  { id: 'git-reset-hard', command: 'git reset --hard HEAD~1' },
  { id: 'git-clean-force', command: 'git clean -fdx' },
  { id: 'rm-rf-home-or-root', command: 'rm -rf ~/' },
  { id: 'cloud-bulk-delete', command: 'aws s3 rm s3://prod-bucket --recursive' },
  { id: 'terraform-destroy', command: 'terraform destroy -auto-approve' },
  { id: 'kubectl-bulk-delete', command: 'kubectl delete namespace prod' },
  { id: 'docker-system-prune-all', command: 'docker system prune -af --volumes' },
  { id: 'iam-policy-change', command: 'aws iam attach-user-policy --user-name bob --policy-arn arn:aws:iam::aws:policy/AdministratorAccess' },
];
const LEARNED_ROW = { id: 'learned-from-two-thumbs-downs', command: 'node ./scripts/notify-all-customers.js --send', note: 'two typed thumbs-downs on one command, then the same command' };
const CHAT_ROW = { id: 'text-typed-in-a-chat-or-web-page', note: 'no hook sees text that is not a tool call' };

function world() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-host-matrix-')));
  const project = path.join(home, 'proj');
  fs.mkdirSync(project);
  cp.execFileSync('git', ['init', '-q'], { cwd: project });
  const env = { ...process.env, HOME: home, USERPROFILE: home, THUMBGATE_FEEDBACK_DIR: path.join(project, '.thumbgate'), THUMBGATE_NO_RATE_LIMIT: '1', THUMBGATE_NO_TELEMETRY: '1', PWD: project };
  for (const n of ['THUMBGATE_STRICT_ENFORCEMENT', 'THUMBGATE_GOVERNANCE_MODE', 'THUMBGATE_CLI', 'THUMBGATE_SHARED_TREE', 'THUMBGATE_CANARY']) delete env[n];
  return { home, project, env, done: () => fs.rmSync(home, { recursive: true, force: true }) };
}

function spawn(cmd, args, w, input) {
  return cp.spawnSync(cmd, args, { cwd: w.project, env: w.env, input, encoding: 'utf8', timeout: 90000 });
}

function lastJson(text) {
  const lines = String(text || '').trim().split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try { return JSON.parse(lines[i]); } catch { /* keep looking */ }
  }
  return {};
}

/** Run one command through a host's hook path. Returns {denied, detail}. */
function runHost(host, w, command, sessionId = 'matrix-session') {
  if (host === 'claude-code') {
    const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: w.project, session_id: sessionId, hook_event_name: 'PreToolUse' });
    const res = spawn(process.execPath, [CLI, 'gate-check'], w, input);
    const out = lastJson(res.stdout);
    const decision = out.hookSpecificOutput && out.hookSpecificOutput.permissionDecision;
    const reason = String((out.hookSpecificOutput && out.hookSpecificOutput.permissionDecisionReason) || '');
    return { denied: decision === 'deny', gate: (reason.match(/\[GATE:([a-z0-9-]+)\]/i) || [])[1] || '', detail: `exit ${res.status}, permissionDecision ${decision || 'none'}` };
  }
  if (host === 'cursor') {
    const input = JSON.stringify({ command, cwd: w.project, conversation_id: sessionId, hook_event_name: 'beforeShellExecution' });
    const res = cp.spawnSync('bash', [path.join(CURSOR_PLUGIN, 'scripts', 'gate-check.sh')], { cwd: w.project, env: { ...w.env, THUMBGATE_CLI: `${process.execPath} ${CLI}` }, input, encoding: 'utf8', timeout: 90000 });
    const out = lastJson(res.stdout);
    return { denied: out.permission === 'deny' && res.status === 2, gate: (String(out.user_message || '').match(/\[GATE:([a-z0-9-]+)\]/i) || [])[1] || '', detail: `exit ${res.status}, permission ${out.permission || 'none'}` };
  }
  throw new Error(`no hook runner for ${host}`);
}

/** Type a prompt the way the host submits it, through that host's prompt hook. */
function typePrompt(host, w, prompt, sessionId = 'matrix-session') {
  if (host === 'claude-code') {
    spawn(process.execPath, [CLI, 'hook-auto-capture'], w, JSON.stringify({ prompt, session_id: sessionId, cwd: w.project, hook_event_name: 'UserPromptSubmit' }));
  } else if (host === 'cursor') {
    cp.spawnSync('bash', [path.join(CURSOR_PLUGIN, 'scripts', 'prompt-capture.sh')], { cwd: w.project, env: { ...w.env, THUMBGATE_CLI: `${process.execPath} ${CLI}` }, input: JSON.stringify({ prompt, conversation_id: sessionId, hook_event_name: 'beforeSubmitPrompt', workspace_roots: [w.project] }), encoding: 'utf8', timeout: 90000 });
  }
}

function probeGate(host, row) {
  const w = world();
  try {
    const r = runHost(host, w, row.command);
    // "enforced" is for this gate: a denial by a different gate does not show that this one works on the host.
    const byThisGate = r.denied && r.gate === row.id;
    const who = r.denied ? ` by gate ${r.gate || 'unknown'}` : '';
    return { status: byThisGate ? 'enforced' : 'not enforced', check: `${row.command} -> ${r.detail}${who}` };
  } finally {
    w.done();
  }
}

function probeLearned(host) {
  const w = world();
  const command = LEARNED_ROW.command;
  try {
    const before = runHost(host, w, command);
    if (before.denied) return { status: 'not enforced', check: `denied before any thumbs-down, so the learning step was not what denied it (${before.detail})` };
    typePrompt(host, w, 'thumbs down: that was wrong, it mailed every single customer without asking me first');
    const afterOne = runHost(host, w, command);
    typePrompt(host, w, 'thumbs down again: you did it a second time and mailed all customers with no approval');
    const afterTwo = runHost(host, w, command);
    if (afterOne.denied) return { status: 'not enforced', check: `denied after one thumbs-down (${afterOne.detail}); expected two` };
    return { status: afterTwo.denied ? 'enforced' : 'not enforced', check: `${command}: allowed, one thumbs-down allowed, after two ${afterTwo.denied ? 'denied' : 'still allowed'} (${afterTwo.detail})` };
  } finally {
    w.done();
  }
}

function untested(host) {
  return { status: 'untested', check: host.check };
}

/** Run every probe. Returns the results object that is committed and rendered. */
function runProbes() {
  const rows = [];
  for (const row of GATE_ROWS) {
    const cells = {};
    for (const host of HOSTS) cells[host.id] = RUNNABLE.has(host.id) ? probeGate(host.id, row) : untested(host);
    rows.push({ id: row.id, kind: 'gate', command: row.command, cells });
  }
  const learned = {};
  for (const host of HOSTS) learned[host.id] = RUNNABLE.has(host.id) ? probeLearned(host.id) : untested(host);
  rows.push({ id: LEARNED_ROW.id, kind: 'learned', command: LEARNED_ROW.command, note: LEARNED_ROW.note, cells: learned });
  const chat = {};
  for (const host of HOSTS) chat[host.id] = { status: 'out of scope', check: CHAT_ROW.note };
  rows.push({ id: CHAT_ROW.id, kind: 'chat', note: CHAT_ROW.note, cells: chat });
  return { schema: 1, hosts: HOSTS.map((h) => ({ id: h.id, label: h.label, check: h.check })), rows };
}

const STATUSES = new Set(['enforced', 'not enforced', 'untested', 'out of scope']);

/** Problems with a results object. An "enforced" cell must carry a recorded denial from a run. */
function validateResults(results) {
  const errors = [];
  if (!results || !Array.isArray(results.rows) || !Array.isArray(results.hosts)) return ['results must have hosts and rows'];
  for (const row of results.rows) {
    for (const host of results.hosts) {
      const cell = row.cells && row.cells[host.id];
      if (!cell) { errors.push(`${row.id} / ${host.id}: missing cell`); continue; }
      if (!STATUSES.has(cell.status)) errors.push(`${row.id} / ${host.id}: unknown status "${cell.status}"`);
      if (cell.status === 'enforced') {
        if (!RUNNABLE.has(host.id)) errors.push(`${row.id} / ${host.id}: "enforced" for a host with no runnable hook path`);
        if (row.kind === 'gate' && !new RegExp(`(?:permissionDecision|permission) deny by gate ${row.id}$`).test(String(cell.check))) errors.push(`${row.id} / ${host.id}: "enforced" without a recorded denial by this gate in "${cell.check}"`);
        if (row.kind === 'learned' && !/after two denied/.test(String(cell.check))) errors.push(`${row.id} / ${host.id}: "enforced" without a recorded denial after two thumbs-downs in "${cell.check}"`);
        if (row.kind === 'chat') errors.push(`${row.id} / ${host.id}: chat text can never be "enforced"`);
      }
      if (cell.status === 'untested' && !cell.check) errors.push(`${row.id} / ${host.id}: untested cell has no note`);
    }
  }
  return errors;
}

function cellText(cell) {
  return cell.status;
}

function renderTable(results) {
  const head = ['Gate', ...results.hosts.map((h) => h.label)];
  const lines = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  for (const row of results.rows) {
    const label = row.kind === 'chat' ? 'Text typed in a chat window or web page' : row.kind === 'learned' ? 'Gate learned from two thumbs-downs' : `\`${row.id}\``;
    lines.push(`| ${label} | ${results.hosts.map((h) => cellText(row.cells[h.id])).join(' | ')} |`);
  }
  return lines.join('\n');
}

function renderReadmeBlock(results) {
  return [
    START,
    '## Gate coverage by host',
    '',
    'Which gates were actually denied on which host. Generated by `npm run compat:matrix` from real runs through each host\'s hook path; nothing here is typed by hand. "enforced" means a test ran that gate\'s denial through that host in this checkout. "not enforced" means the command ran and was allowed. "untested" means no run exists. Details and the exact check per host: [docs/host-compatibility.md](docs/host-compatibility.md).',
    '',
    renderTable(results),
    END,
  ].join('\n');
}

function renderDoc(results) {
  const out = [
    '# Gate coverage by host',
    '',
    'Generated by `node scripts/host-gate-matrix.js --write` (`npm run compat:matrix`). Do not edit by hand: `npm run compat:check` and `tests/host-gate-matrix.test.js` fail when this file differs from a fresh run.',
    '',
    'A cell says **enforced** only when the generator ran that gate\'s denial through the host\'s real hook path in this checkout and the hook denied it. **not enforced**: the command ran and the hook allowed it. **untested**: no run exists, so nothing is claimed. **out of scope**: the thing is not a tool call, so no hook sees it.',
    '',
    renderTable(results),
    '',
    '## How each host was checked',
    '',
    ...results.hosts.map((h) => `- **${h.label}**: ${h.check}`),
    '',
    '## Probes',
    '',
    '| Row | Command or note | Claude Code check | Cursor check |',
    '|---|---|---|---|',
    ...results.rows.map((row) => `| ${row.id} | ${row.command ? `\`${row.command}\`` : row.note} | ${row.cells['claude-code'].check.replace(/\|/g, '/')} | ${row.cells.cursor.check.replace(/\|/g, '/')} |`),
    '',
    '## Limits',
    '',
    '- A denial here is the default configuration in a clean home folder. A project profile, strict mode or a different install can change it.',
    '- The Codex and Gemini CLI columns stay "untested" until a test sends the gate each host\'s own payload shape.',
    '- Text typed into a chat window or web page is never seen by a hook. ThumbGate gates tool calls such as shell commands and file writes, not text typed into a web page.',
    '- Gates that need project state (task scope, release readiness, approvals) have no stateless denial to run and are not in this table.',
    '',
  ];
  return out.join('\n');
}

function spliceReadme(readme, block) {
  const startAt = readme.indexOf(START);
  const endAt = readme.indexOf(END);
  if (startAt !== -1 && endAt > startAt) return readme.slice(0, startAt) + block + readme.slice(endAt + END.length);
  const anchor = '\n## Docs\n';
  const at = readme.indexOf(anchor);
  if (at === -1) throw new Error('README has no "## Docs" heading to place the table before');
  return `${readme.slice(0, at)}\n${block}\n${readme.slice(at)}`;
}

function render(results, readme) {
  return {
    json: `${JSON.stringify(results, null, 2)}\n`,
    doc: renderDoc(results),
    readme: spliceReadme(readme, renderReadmeBlock(results)),
  };
}

function main(argv) {
  const mode = argv.includes('--write') ? 'write' : 'check';
  const results = runProbes();
  const errors = validateResults(results);
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  const next = render(results, fs.readFileSync(README_PATH, 'utf8'));
  if (mode === 'write') {
    fs.mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });
    fs.writeFileSync(RESULTS_PATH, next.json);
    fs.writeFileSync(DOC_PATH, next.doc);
    fs.writeFileSync(README_PATH, next.readme);
    console.log(`wrote ${path.relative(ROOT, RESULTS_PATH)}, ${path.relative(ROOT, DOC_PATH)} and the README block`);
    return;
  }
  const stale = [];
  if (!fs.existsSync(RESULTS_PATH) || fs.readFileSync(RESULTS_PATH, 'utf8') !== next.json) stale.push('docs/compat/host-gate-results.json');
  if (!fs.existsSync(DOC_PATH) || fs.readFileSync(DOC_PATH, 'utf8') !== next.doc) stale.push('docs/host-compatibility.md');
  if (fs.readFileSync(README_PATH, 'utf8') !== next.readme) stale.push('README.md');
  if (stale.length) { console.error(`out of date, rerun: node scripts/host-gate-matrix.js --write\n${stale.join('\n')}`); process.exit(1); }
  console.log('host gate matrix is current');
}

module.exports = { HOSTS, GATE_ROWS, RESULTS_PATH, DOC_PATH, README_PATH, START, END, runProbes, validateResults, render, renderTable, spliceReadme };

if (require.main === module) main(process.argv.slice(2));
