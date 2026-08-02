'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  preToolHookCommand,
  claimStopHookCommand,
  userPromptHookCommand,
  sessionStartHookCommand,
  cacheUpdateHookCommand,
  statuslineCommand,
} = require('../scripts/hook-runtime');

// Higher-level regression guard. Even if `publishedCliShellCommand` keeps the
// subcommand on its fast path, a future refactor of `resolveCliCommand` (or any
// new branch — Volta shim, source checkout, future builders) could lose the
// subcommand. Test the actual surface that `thumbgate init` writes to Claude
// Code's settings.json: each hook-command getter must return a string that
// ends in (or contains) its specific subcommand on every branch it could take.

const HOOKS = [
  ['statuslineCommand', statuslineCommand, 'statusline-render'],
  ['preToolHookCommand', preToolHookCommand, 'gate-check'],
  ['claimStopHookCommand', claimStopHookCommand, 'claim-stop-check'],
  ['userPromptHookCommand', userPromptHookCommand, 'hook-auto-capture'],
  ['sessionStartHookCommand', sessionStartHookCommand, 'session-start'],
  ['cacheUpdateHookCommand', cacheUpdateHookCommand, 'cache-update'],
];

for (const [name, fn, expectedSubcommand] of HOOKS) {
  test(`${name}() result contains the "${expectedSubcommand}" subcommand`, () => {
    const command = fn();
    assert.ok(
      command.includes(expectedSubcommand),
      `${name}() must include "${expectedSubcommand}" — got: ${command}`,
    );
  });

  test(`${name}() does not exec the bare binary without its subcommand`, () => {
    const command = fn();
    // Forbid any `exec PATH` that is immediately followed by `||`, `;`, `&&`,
    // pipe, redirect, end-of-line, or whitespace+end — i.e. no subcommand
    // before any shell continuation. This is the regression pattern we keep
    // hitting: `exec "$BIN"` (no args) which silently runs `thumbgate` with
    // no subcommand and prints the help screen instead of running the hook.
    const bareExecPattern = /\bexec\s+["']?[^"'\s]+(?:\.js)?["']?\s*(?:\|\||;|&&|\||>|<|$)/;
    const match = command.match(bareExecPattern);
    assert.equal(
      match,
      null,
      `${name}() must never exec the binary without a subcommand — found ${match && match[0]} in: ${command}`,
    );
  });
}
