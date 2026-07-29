'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  installedRuntimeBin,
  publishedCliShellCommand,
  runtimePrefixDir,
} = require('../scripts/published-cli');

test('publishedCliShellCommand prefers the installed runtime binary before npm exec fallback', () => {
  const prefixDir = runtimePrefixDir('/tmp/thumbgate-runtime');
  const command = publishedCliShellCommand('1.1.0', ['statusline-render'], { prefixDir });

  assert.match(command, /\[ -x /);
  assert.match(command, /node_modules\/\.bin\/thumbgate/);
  assert.match(command, /statusline-render/);
  assert.match(command, /npm "exec"/);
});

test('publishedCliShellCommand fast-starts the serve launcher instead of reinstalling on every launch', () => {
  const prefixDir = runtimePrefixDir('/tmp/thumbgate-runtime');
  const command = publishedCliShellCommand('latest', ['serve'], { prefixDir });

  // Fast-path guard exists: exec the installed runtime binary when present.
  assert.match(command, /\[ -x /, 'must include a [ -x fast-path guard');
  assert.match(command, /thumbgate@latest/, 'must resolve @latest for the npx fallback');
  assert.match(command, /node_modules\/\.bin\/thumbgate/);
  const [fastPath] = command.split(' || ');
  assert.match(fastPath, /exec\s+"[^"]+"\s+"serve"/, 'fast-path must exec the runtime with the serve subcommand');
  // The blocking per-launch reinstall form must be gone.
  assert.doesNotMatch(command, /npm "install"/, 'must not block startup on a per-launch npm install');
});

test('installedRuntimeBin resolves within the runtime prefix directory', () => {
  const binPath = installedRuntimeBin('/tmp/thumbgate-runtime');
  assert.match(binPath, /\/tmp\/thumbgate-runtime\/node_modules\/\.bin\/thumbgate$/);
});

// Regression guard for a real bug class: an earlier published thumbgate emitted
// a fast-path branch (`[ -x BIN ] && exec BIN || ...`) that DROPPED the subcommand.
// The npm-fallback branch still had it, so existing tests passed — but in
// practice when the runtime bin existed (always, after first install) Claude
// Code would exec bare `thumbgate`, which prints the help screen. That help
// became the user's statusline; the hook calls became no-ops; nothing actually
// fired. Re-running `thumbgate init` would silently reinstall the broken
// settings. Asserting per-branch independently so the bug class cannot return
// even if one branch is patched and the other regresses.
test('publishedCliShellCommand fast-path INDEPENDENTLY includes the subcommand', () => {
  const prefixDir = runtimePrefixDir('/tmp/thumbgate-runtime');
  const command = publishedCliShellCommand('1.21.0', ['statusline-render'], { prefixDir });
  const [fastPath, fallback] = command.split(' || ');
  assert.ok(fastPath && fallback, 'must have both branches');
  assert.match(fastPath, /\[ -x .* \] && exec /, 'fast-path shape');
  assert.match(fastPath, /exec\s+"[^"]+"\s+"statusline-render"/, 'fast-path exec must include the subcommand');
  assert.match(fallback, /statusline-render/, 'fallback must include the subcommand');
});

test('publishedCliShellCommand emits the subcommand twice (once per branch) for every hook command', () => {
  const prefixDir = runtimePrefixDir('/tmp/thumbgate-runtime');
  const hookSubcommands = ['gate-check', 'hook-auto-capture', 'session-start', 'cache-update', 'statusline-render'];
  for (const sub of hookSubcommands) {
    const command = publishedCliShellCommand('1.21.0', [sub], { prefixDir });
    const occurrences = command.match(new RegExp(sub, 'g')) || [];
    assert.equal(
      occurrences.length,
      2,
      `${sub} must appear exactly twice (fast-path exec + npm-fallback exec); got ${occurrences.length}: ${command}`,
    );
  }
});

test('publishedCliShellCommand latest-resolving serve launcher includes the subcommand in both branches', () => {
  const command = publishedCliShellCommand('latest', ['serve'], {
    prefixDir: '/tmp/thumbgate-runtime',
  });
  const [fastPath, fallback] = command.split(' || ');
  assert.ok(fastPath && fallback, 'must have both branches');
  assert.match(fastPath, /exec\s+"[^"]+"\s+"serve"/, 'fast-path exec must include the subcommand');
  assert.match(fallback, /serve/, 'npx fallback must include the subcommand');
});

test('generated shell commands never embed the generating machine home', () => {
  // Regression: runtimePrefixDir expanded os.homedir() at GENERATION time, so shared config
  // (.mcp.json entries, hook command lines) carried /Users/<generating-user>/.thumbgate and
  // failed with permission errors on every other machine. Shell strings must defer to $HOME.
  const os = require('os');
  for (const args of [['serve'], ['--version'], []]) {
    const cmd = publishedCliShellCommand('1.29.2', args);
    assert.ok(!cmd.includes(os.homedir()),
      `generated shell command bakes in this machine's home: ${cmd.slice(0, 90)}`);
    assert.ok(cmd.includes('$HOME/.thumbgate/runtime'),
      'shell command lost its runtime-expanded $HOME prefix');
  }
});
