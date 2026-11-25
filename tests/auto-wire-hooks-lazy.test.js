'use strict';

// Loop 3 of docs/decisions/2026-11-24-revenue-funnel-activation.md: the hook table was built when
// the module loaded, before wireClaudeHooks installed the stable shim, so every first install wired
// hooks pinned to `thumbgate@<init version>` that never update. The table must be read at wire time.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('Claude hook commands are resolved when read, not when the module loads', () => {
  const runtimePath = require.resolve('../scripts/hook-runtime');
  const wirePath = require.resolve('../scripts/auto-wire-hooks');
  const real = require(runtimePath);
  let current = 'pinned thumbgate@1.40.14 gate-check';
  const stub = { ...real, preToolHookCommand: () => current };
  const saved = require.cache[runtimePath];
  delete require.cache[wirePath];
  require.cache[runtimePath] = { id: runtimePath, filename: runtimePath, loaded: true, exports: stub, path: path.dirname(runtimePath) };
  try {
    const wire = require(wirePath);
    assert.equal(wire.CLAUDE_HOOKS.PreToolUse.hooks[0].command, 'pinned thumbgate@1.40.14 gate-check');
    current = '"$HOME/.thumbgate/bin/thumbgate-hook" gate-check'; // the shim now exists
    assert.equal(wire.CLAUDE_HOOKS.PreToolUse.hooks[0].command, current);
    assert.equal(wire.claudeHooks().PreToolUse.hooks[0].command, current);
  } finally {
    require.cache[runtimePath] = saved;
    delete require.cache[wirePath];
  }
});
