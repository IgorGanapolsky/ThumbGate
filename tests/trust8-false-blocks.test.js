'use strict';

// 27 Nov 2026 (trust.8): every false block seen that day, replayed against a fresh install in a throwaway HOME,
// next to the things that must stay blocked. THUMBGATE_REPLAY_PACKAGE=<dir> runs it against an installed
// (published) package instead of this checkout.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PKG = process.env.THUMBGATE_REPLAY_PACKAGE || path.join(__dirname, '..');
const CLI = path.join(PKG, 'bin', 'cli.js');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-trust8-home-'));
const project = path.join(home, 'project');
fs.mkdirSync(project, { recursive: true });
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

// Default settings: nothing from the developer's shell that changes gate behaviour.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(THUMBGATE_|CLAUDE)/.test(key)));
Object.assign(env, { HOME: home, USERPROFILE: home, THUMBGATE_NO_TELEMETRY: '1', THUMBGATE_DISABLE_UPDATE_CHECK: '1', THUMBGATE_NO_AUTO_UPDATE: '1' });

function cli(args, payload) {
  const out = spawnSync(process.execPath, [CLI, ...args], { cwd: project, env, input: payload ? JSON.stringify(payload) : '', encoding: 'utf8', timeout: 90000 });
  // A crashed hook prints nothing and would read as "allow": fail the replay instead. 0 and 2 are the hook contract.
  const detail = `${args.join(' ')}: status=${out.status} signal=${out.signal} ${out.error ? out.error.message : ''}\n${String(out.stderr || '').slice(-2000)}`;
  assert.ok(!out.error && !out.signal && (out.status === 0 || out.status === 2), detail);
  return { status: out.status, stdout: String(out.stdout || '') };
}
const lastJson = (stdout) => {
  const line = stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  return line ? JSON.parse(line) : {};
};

cli(['init', '--agent', 'claude']);
const settings = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
const wired = (event) => (settings.hooks[event] || []).flatMap((g) => g.hooks || []).map((h) => h.command.trim().split(/\s+/).pop());

let session = 0;
const newSession = () => `trust8-${(session += 1)}`;

function preTool(sessionId, toolName, toolInput) {
  const out = lastJson(cli(['gate-check'], { hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: toolInput, cwd: project, session_id: sessionId }).stdout);
  const hso = out.hookSpecificOutput || {};
  return { decision: hso.permissionDecision || 'allow', reason: hso.permissionDecisionReason || '' };
}

const prompt = (sessionId, text) => cli(['hook-auto-capture'], { hook_event_name: 'UserPromptSubmit', prompt: text, cwd: project, session_id: sessionId });

/** Run every wired Stop hook over one reply from a Claude Code that accepts Stop feedback. */
function stop(reply) {
  const transcript = path.join(home, `${newSession()}.jsonl`);
  const entries = [
    { type: 'user', version: '2.1.200', message: { content: 'status?' } },
    { type: 'assistant', version: '2.1.200', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'gh pr view 1' } }] } },
    { type: 'assistant', version: '2.1.200', message: { content: [{ type: 'text', text: reply }] } },
  ];
  fs.writeFileSync(transcript, entries.map((e) => JSON.stringify(e)).join('\n'));
  return wired('Stop').map((sub) => lastJson(cli([sub], { hook_event_name: 'Stop', transcript_path: transcript, cwd: project, session_id: 'stop' }).stdout));
}
const objections = (reply) => stop(reply)
  .map((out) => ({ crashLike: out.decision === 'block', text: out.reason || (out.hookSpecificOutput || {}).additionalContext || '' }))
  .filter((o) => o.text);

test('the fresh install wires the hooks the replay uses', () => {
  assert.ok(wired('PreToolUse').includes('gate-check'));
  assert.ok(wired('UserPromptSubmit').includes('hook-auto-capture'));
  assert.ok(wired('Stop').length > 0);
});

test('replies that claim nothing unproven are not stopped', () => {
  for (const reply of [
    "The redesign hasn't shipped.",
    'Nothing was deployed today.',
    'The gate flagged the word "shipped" inside a quote.',
    "The gate flagged the word 'shipped' inside a quote.",
    'Live at 1:29 PM: the pull request is open.',
  ]) assert.deepEqual(objections(reply), [], reply);
});

test('a real unproven shipping claim is still sent back and says how to continue', () => {
  for (const reply of ['The fix is deployed.', 'We shipped it to production.', 'The new site went live at 1:29 PM.', 'The fix went live at 2 PM on app.example.com.', 'The new page is live at https://example.com/pricing.']) {
    const found = objections(reply);
    assert.ok(found.length > 0, reply);
    assert.match(found[0].text, /not verified|not checked|check/i, 'says how to continue');
  }
});

// Open: the shipping-claim Stop gate answers decision:block, which Claude Code shows as a hook error. The change is
// in a hook script that ThumbGate self-protection does not let an agent edit.
test('the shipping-claim stop is a note, not a hook error', { todo: 'needs the owner to approve a hook-script edit' }, () => {
  assert.ok(objections('The fix is deployed.').every((o) => !o.crashLike));
});

test('after a thumbs-down, reads, local notes and peer messages are not held', () => {
  const id = newSession();
  assert.equal(preTool(id, 'Bash', { command: 'node scripts/notify-all.js --send' }).decision, 'allow');
  prompt(id, 'thumbs down');
  for (const command of ['ls -la', 'git status', 'git log --oneline -5', 'grep -rn "TODO" src', 'gh pr view 12 --json state']) {
    const out = preTool(id, 'Bash', { command });
    assert.notEqual(out.decision, 'deny', `${command}: ${out.reason}`);
  }
  const note = preTool(id, 'Write', { file_path: path.join(project, 'notes.md'), content: 'checked the owner site' });
  assert.notEqual(note.decision, 'deny', note.reason);
  for (const message of ['Report: the build passed.', 'One more detail for you.']) {
    const out = preTool(id, 'SendMessage', { to: 'local-peer', message });
    assert.notEqual(out.decision, 'deny', out.reason);
    const mesh = preTool(id, 'mcp__agent-mesh__mesh_send_peer', { to: 'local-peer', message });
    assert.notEqual(mesh.decision, 'deny', mesh.reason);
  }
  const held = preTool(id, 'Bash', { command: 'node scripts/notify-all.js --send' });
  assert.equal(held.decision, 'deny', 'the complained action stays held');
  assert.match(held.reason, /go ahead|release/i, 'says how to continue');
});

// Open (seen 27 Nov): a local command that only writes a file mentioning a send tool's name is read as an email send.
test('a local file edit that only names a send tool is not an outbound send', { todo: 'narrowing the email gate needs its own review' }, () => {
  const command = "node -e \"require('fs').writeFileSync('notes.txt', 'mcp__slack__slack_send_message')\"";
  assert.notEqual(preTool(newSession(), 'Bash', { command }).decision, 'deny');
});

test('a commit into a folder that does not exist is not called too large to scan', () => {
  const missing = path.join(home, 'no-such-repo');
  const out = preTool(newSession(), 'Bash', { command: `git -C ${missing} commit -m "x"` });
  assert.doesNotMatch(out.reason, /scan incomplete|secret/i);
});

test('real destructive commands and duplicate chat posts stay blocked, and say how to continue', () => {
  const id = newSession();
  for (const command of ['git push --force origin main', 'rm -rf ~']) {
    const out = preTool(id, 'Bash', { command });
    assert.equal(out.decision, 'deny', command);
    assert.ok(out.reason.length > 20, 'says what was stopped');
  }
  const post = (text) => preTool(id, 'mcp__teams__send_chat_message', { chat_id: 'chat-a', text });
  const first = post('First update.');
  assert.equal(first.decision, 'allow', first.reason);
  const second = post('A second bubble.');
  assert.equal(second.decision, 'deny');
  assert.match(second.reason, /edit/i);
});

test('a time label needs its separator after the whole timestamp', () => {
  const { findDeployClaim } = require(path.join(PKG, 'scripts', 'deploy-proof-gate.js'));
  assert.ok(findDeployClaim('Live at 1:29 PM on production.'), 'the colon inside 1:29 is not a label separator');
  assert.equal(findDeployClaim('Live at 1:29 PM: the pull request is open.'), null);
  const { isLabelled } = require(path.join(PKG, 'scripts', 'claim-gate-stop.js'));
  assert.equal(isLabelled('Live at 1:29 PM on production.'), false);
  assert.equal(isLabelled('Live at 1:29 PM: the pull request is open.'), true);
});

test('a commit into a -C $VAR folder is still scanned', () => {
  const { scanStagedForCommit } = require(path.join(PKG, 'scripts', 'staged-secret-gate.js'));
  // The shell expands $PWD to a real repo; the parser sees a literal path that does not exist, which must not skip the scan.
  assert.notEqual(scanStagedForCommit('Bash', { command: 'git -C "$PWD" commit -m x' }, project), null);
  assert.equal(scanStagedForCommit('Bash', { command: `git -C ${path.join(home, 'no-such-repo')} commit -m x` }, project), null);
});
