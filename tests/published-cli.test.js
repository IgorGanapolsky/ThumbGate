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

test('publishedCliShellCommand can bypass the installed runtime for latest-resolving launchers', () => {
  const prefixDir = runtimePrefixDir('/tmp/thumbgate-runtime');
  const command = publishedCliShellCommand('latest', ['serve'], {
    prefixDir,
    preferInstalled: false,
  });

  assert.doesNotMatch(command, /\[ -x /);
  assert.match(command, /thumbgate@latest/);
  assert.match(command, /npm "install"/);
  assert.match(command, /node_modules\/\.bin\/thumbgate/);
  assert.match(command, /serve/);
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

test('publishedCliShellCommand preferInstalled=false exec line includes the subcommand', () => {
  const command = publishedCliShellCommand('latest', ['serve'], {
    prefixDir: '/tmp/thumbgate-runtime',
    preferInstalled: false,
  });
  assert.match(command, /exec\s+"[^"]+"\s+"serve"/, 'install-then-exec must include the subcommand');
});
