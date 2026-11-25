'use strict';

// AGENT-3667: a Cursor hook that errors must deny the shell command, not allow it.
// Cursor's own rule (cursor.com/docs/agent/hooks, read 2026-11-25): a hook that crashes, times out or exits with a
// code other than 2 is allowed through unless the hook entry sets failClosed: true. So there are two layers to check:
// our scripts must answer deny when they fail, and every hook entry we ship must carry failClosed: true.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SHELL_GATE = path.join(ROOT, 'scripts', 'cursor-shell-gate.js');
const PLUGIN = path.join(ROOT, 'plugins', 'cursor-marketplace');
const GATE_CHECK = path.join(PLUGIN, 'scripts', 'gate-check.sh');

function runShellGate(stdin) {
  return cp.spawnSync(process.execPath, [SHELL_GATE], { input: stdin, encoding: 'utf8', timeout: 20000 });
}

function tempScript(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-cursor-fc-'));
  const file = path.join(dir, 'fake-cli.sh');
  fs.writeFileSync(file, `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  return { file, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function runGateCheck(cliPath, stdin) {
  return cp.spawnSync('bash', [GATE_CHECK], {
    input: stdin,
    encoding: 'utf8',
    timeout: 20000,
    env: { ...process.env, THUMBGATE_CLI: cliPath },
  });
}

test('cursor-shell-gate denies when its input cannot be parsed', () => {
  const r = runShellGate('this is not json');
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(out.permission, 'deny', `expected deny, got ${r.stdout}`);
  assert.match(out.user_message || '', /ThumbGate/);
});

test('cursor-shell-gate still allows a harmless command', () => {
  const r = runShellGate(JSON.stringify({ command: 'ls -la', cwd: ROOT }));
  assert.equal(JSON.parse(r.stdout.trim()).permission, 'allow');
});

test('plugin gate-check.sh denies (exit 2) when the ThumbGate command fails', () => {
  const fake = tempScript('echo boom >&2; exit 1');
  try {
    const r = runGateCheck(fake.file, JSON.stringify({ command: 'ls' }));
    assert.equal(r.status, 2, `exit ${r.status}: ${r.stdout}`);
    assert.equal(JSON.parse(r.stdout.trim()).permission, 'deny');
  } finally { fake.done(); }
});

test('plugin gate-check.sh denies (exit 2) when the ThumbGate command prints nothing', () => {
  const fake = tempScript('cat >/dev/null; exit 0');
  try {
    const r = runGateCheck(fake.file, JSON.stringify({ command: 'ls' }));
    assert.equal(r.status, 2, `exit ${r.status}: ${r.stdout}`);
    assert.equal(JSON.parse(r.stdout.trim()).permission, 'deny');
  } finally { fake.done(); }
});

test('plugin gate-check.sh denies when the ThumbGate command prints something that is not a decision', () => {
  const fake = tempScript('cat >/dev/null; echo "<html>502</html>"');
  try {
    const r = runGateCheck(fake.file, JSON.stringify({ command: 'ls' }));
    assert.equal(r.status, 2, `exit ${r.status}: ${r.stdout}`);
  } finally { fake.done(); }
});

test('plugin gate-check.sh still allows when the ThumbGate command says allow', () => {
  const fake = tempScript('cat >/dev/null; echo \'{"permission":"allow"}\'');
  try {
    const r = runGateCheck(fake.file, JSON.stringify({ command: 'ls' }));
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(r.stdout.trim()).permission, 'allow');
  } finally { fake.done(); }
});

test('every beforeShellExecution hook entry we ship sets failClosed: true', () => {
  const files = [
    path.join(PLUGIN, 'hooks', 'hooks.json'),
    path.join(ROOT, 'adapters', 'cursor', 'hooks-snippet.json'),
  ];
  for (const file of files) {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const entries = (parsed.hooks || parsed).beforeShellExecution;
    assert.ok(Array.isArray(entries) && entries.length > 0, `${file} has no beforeShellExecution`);
    for (const entry of entries) assert.equal(entry.failClosed, true, `${path.relative(ROOT, file)}: ${JSON.stringify(entry)}`);
  }
});

test('the hook entry thumbgate init writes to ~/.cursor/hooks.json sets failClosed: true', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-cursor-fc-home-'));
  try {
    const { wireCursorBeforeShellGate } = require('../scripts/auto-wire-hooks');
    const hooksPath = path.join(home, 'hooks.json');
    wireCursorBeforeShellGate({ cursorHooksPath: hooksPath });
    const written = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
    const ours = written.hooks.beforeShellExecution.filter((e) => /cursor-(shell-)?gate/.test(e.command));
    assert.ok(ours.length > 0, 'no ThumbGate entry written');
    for (const entry of ours) assert.equal(entry.failClosed, true);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('thumbgate init upgrades an older Cursor entry that has no failClosed', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-cursor-fc-up-'));
  try {
    const { wireCursorBeforeShellGate } = require('../scripts/auto-wire-hooks');
    const { cursorShellGateHookCommand } = require('../scripts/hook-runtime');
    const hooksPath = path.join(home, 'hooks.json');
    fs.writeFileSync(hooksPath, JSON.stringify({ version: 1, hooks: { beforeShellExecution: [{ command: cursorShellGateHookCommand(), timeout: 10 }] } }));
    const r = wireCursorBeforeShellGate({ cursorHooksPath: hooksPath });
    assert.equal(r.changed, true);
    const written = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
    assert.equal(written.hooks.beforeShellExecution[0].failClosed, true);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
