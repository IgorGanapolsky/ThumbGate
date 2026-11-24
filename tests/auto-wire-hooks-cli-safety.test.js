'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'auto-wire-hooks.js');

function listAll(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    out.push(full);
    if (fs.statSync(full).isDirectory()) out.push(...listAll(full));
  }
  return out;
}

function run(args, home, cwd) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home },
  });
}

function withTempHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-autowire-home-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-autowire-cwd-'));
  try {
    return fn(home, cwd);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

for (const flag of ['--help', '-h']) {
  test(`${flag} prints usage and writes nothing under HOME`, () => {
    withTempHome((home, cwd) => {
      const result = run(['--agent=claude', flag], home, cwd);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Usage:/);
      assert.deepEqual(listAll(home), [], 'help must not create any file');
      assert.deepEqual(listAll(cwd), [], 'help must not create any file in the project');
    });
  });
}

test('--dry-run prints the planned entries and writes nothing under HOME', () => {
  withTempHome((home, cwd) => {
    const result = run(['--agent=claude', '--dry-run'], home, cwd);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /DRY RUN/);
    assert.match(result.stdout, /PreToolUse/);
    assert.deepEqual(listAll(home), [], 'dry run must not create any file');
    assert.deepEqual(listAll(cwd), [], 'dry run must not create any file in the project');
  });
});

test('hook commands from a worktree checkout use the stable launcher, never a worktree path', () => {
  const { isDisposableCheckout, resolveCliCommand } = require('../scripts/hook-runtime');
  const { shimPath } = require('../scripts/install-shim');
  const root = path.join(__dirname, '..');
  // This test file itself may run from a worktree or the main checkout.
  const command = resolveCliCommand('gate-check');
  if (isDisposableCheckout(root)) {
    assert.ok(command.includes(shimPath()), command);
    assert.doesNotMatch(command, /\.thumbgate-worktrees|\/worktrees\//);
  }
  assert.equal(isDisposableCheckout('/Users/x/workspace/.thumbgate-worktrees/foo'), true);
  assert.equal(isDisposableCheckout('/Users/x/repo/.claude/worktrees/foo'), true);
  assert.equal(isDisposableCheckout(os.tmpdir()), false);
});

test('dry-run output from any checkout never names a worktree path', () => {
  withTempHome((home, cwd) => {
    const result = run(['--agent=claude', '--dry-run'], home, cwd);
    assert.doesNotMatch(result.stdout, /\.thumbgate-worktrees|\/worktrees\//);
  });
});
