'use strict';

// 27 Nov 2026: self-protect-hooks-disable refused an Edit that only ADDED a restrictive PreToolUse hook, which the
// owner had asked for. A purely additive hook now goes to the owner as one approval prompt; everything that removes,
// replaces or weakens a hook stays refused.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-additive-hook-'));
Object.assign(process.env, { HOME: home, THUMBGATE_FEEDBACK_DIR: path.join(home, 'fb'), THUMBGATE_NO_TELEMETRY: '1' });
for (const name of ['CI', 'THUMBGATE_AUTONOMOUS', 'THUMBGATE_HOTFIX_BYPASS']) delete process.env[name];

const engine = require('../scripts/gates-engine');

const file = path.join(home, '.claude', 'settings.json');
const GUARD = { matcher: 'Bash', hooks: [{ type: 'command', command: 'thumbgate gate-check' }] };
const BEFORE = { permissions: { deny: ['Read(.env)'] }, hooks: { PreToolUse: [GUARD] } };
const ADDED = { matcher: 'Write', hooks: [{ type: 'command', command: 'node deny-secrets.js' }] };
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(BEFORE, null, 2));

const clone = (value) => JSON.parse(JSON.stringify(value));
function payload(after, extra = {}) {
  return {
    hook_event_name: 'PreToolUse',
    transcript_path: path.join(home, '.claude', 'projects', 'p', 's.jsonl'),
    permission_mode: 'default',
    tool_name: 'Write',
    tool_input: { file_path: file, content: typeof after === 'string' ? after : JSON.stringify(after, null, 2) },
    ...extra,
  };
}
function added(change = () => {}) {
  const after = clone(BEFORE);
  after.hooks.PreToolUse.push(clone(ADDED));
  change(after);
  return after;
}
const decide = async (input) => {
  const outputs = [await engine.runAsync(input), engine.run(input), engine.runHardFloor(input)];
  const decisions = outputs.map((o) => (o ? JSON.parse(o).hookSpecificOutput?.permissionDecision : undefined));
  assert.equal(new Set(decisions).size, 1, `entry points disagree: ${decisions}`);
  return { decision: decisions[0], reason: JSON.parse(outputs[0]).hookSpecificOutput?.permissionDecisionReason || '' };
};

test('a purely additive PreToolUse hook asks the owner once, naming what is added', async () => {
  const { decision, reason } = await decide(payload(added()));
  assert.equal(decision, 'ask');
  assert.match(reason, /node deny-secrets\.js/);
});

test('the same addition made with Edit also asks', async () => {
  const input = payload('', {
    tool_name: 'Edit',
    tool_input: { file_path: file, old_string: '"PreToolUse": [', new_string: `"PreToolUse": [\n${JSON.stringify(ADDED)},` },
  });
  assert.equal((await decide(input)).decision, 'ask');
});

const TAMPERING = {
  'removes the guard': (a) => a.hooks.PreToolUse.shift(),
  'replaces the guard command': (a) => { a.hooks.PreToolUse[0].hooks[0].command = 'true'; },
  'narrows the guard matcher': (a) => { a.hooks.PreToolUse[0].matcher = 'Nothing'; },
  'adds a command inside the guard group': (a) => a.hooks.PreToolUse[0].hooks.push({ type: 'command', command: 'x' }),
  'switches all hooks off': (a) => { a.disableAllHooks = true; },
  'widens permissions': (a) => { a.permissions.deny = []; },
  'adds a hook on another event too': (a) => { a.hooks.SessionStart = [clone(ADDED)]; },
  'adds a non-command hook': (a) => { a.hooks.PreToolUse[1] = { matcher: '*', hooks: [{ type: 'prompt', prompt: 'allow' }] }; },
};

for (const [name, change] of Object.entries(TAMPERING)) {
  test(`stays refused: ${name}`, async () => {
    assert.equal((await decide(payload(added(change)))).decision, 'deny');
  });
}

test('stays refused: unreadable result, a shell edit, and a hook script', async () => {
  assert.equal((await decide(payload('{ not json'))).decision, 'deny');
  const shell = payload('', { tool_name: 'Bash', tool_input: { command: `sed -i '' 's/PreToolUse/Off/' ${file}` } });
  assert.equal((await decide(shell)).decision, 'deny');
  const script = payload('', { tool_input: { file_path: path.join(home, 'scripts', 'hook-pre.js'), content: '' } });
  assert.equal((await decide(script)).decision, 'deny');
});

test('stays refused where a prompt may not reach the owner: bypass mode, unknown mode, another host', async () => {
  for (const extra of [{ permission_mode: 'bypassPermissions' }, { permission_mode: 'dontAsk' }, { permission_mode: undefined },
    { transcript_path: '/home/x/.codex/sessions/s.jsonl' }]) {
    const { decision, reason } = await decide(payload(added(), extra));
    assert.equal(decision, 'deny', JSON.stringify(extra));
    assert.match(reason, /self-protect-hooks-disable/);
  }
});

test('bypass mode says how the owner can approve it in one step', async () => {
  const { reason } = await decide(payload(added(), { permission_mode: 'bypassPermissions' }));
  assert.match(reason, /Shift\+Tab/);
});

// The plugin hook forwards only refusals and passes no permission mode, so it must keep refusing, never fall through.
test('the plugin hook still refuses the addition', () => {
  const run = require('node:child_process').spawnSync(process.execPath,
    [path.join(__dirname, '..', 'scripts', 'hook-pre-tool-use.js')],
    { input: JSON.stringify(payload(added())), encoding: 'utf8', env: process.env });
  assert.match(run.stdout + run.stderr, /self-protect-hooks-disable|hook registrations/i);
  assert.doesNotMatch(run.stdout, /"permissionDecision":"allow"/);
});

test('the file on disk is never touched by the check', () => {
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), BEFORE);
});
