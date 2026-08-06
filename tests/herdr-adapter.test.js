'use strict';

// The Herdr plugin is a governance layer for a terminal multiplexer, so its
// hard requirement is the inverse of most code: it must never wedge the
// terminal it governs. Every assertion here is about degrading safely.
//
// The manifest assertions exist because the first version of this adapter
// shipped a `herdr-plugin.json`, which Herdr does not read at all — the spec
// requires `herdr-plugin.toml`. A plugin that silently never loads is worse
// than one that fails loudly.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PLUGIN_DIR = path.join(__dirname, '..', 'adapters', 'herdr');
const MANIFEST = path.join(PLUGIN_DIR, 'herdr-plugin.toml');
const ADAPTER = path.join(PLUGIN_DIR, 'herdr-approvals-adapter.js');

function runAdapter(subcommand, context = {}) {
  const res = spawnSync(process.execPath, [ADAPTER, subcommand], {
    encoding: 'utf8',
    input: JSON.stringify(context),
    timeout: 30000,
    // Empty PATH additions are not enough to hide a globally installed
    // thumbgate, so these tests assert only on properties that hold either way.
    env: { ...process.env },
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

test('manifest is TOML at the exact filename Herdr reads', () => {
  assert.ok(fs.existsSync(MANIFEST), 'herdr-plugin.toml must exist — Herdr ignores any other name');
  assert.equal(
    fs.existsSync(path.join(PLUGIN_DIR, 'herdr-plugin.json')),
    false,
    'a stray herdr-plugin.json implies the JSON manifest regression came back',
  );
});

test('manifest declares the required top-level fields', () => {
  const toml = fs.readFileSync(MANIFEST, 'utf8');
  for (const field of ['id', 'name', 'version', 'min_herdr_version']) {
    assert.match(toml, new RegExp(`^${field}\\s*=`, 'm'), `manifest must declare ${field}`);
  }
  assert.match(toml, /^id\s*=\s*"thumbgate\.approvals"$/m);
  // Herdr validates min_herdr_version against the running binary; an invented
  // value would make the plugin refuse to load on supported installs.
  assert.match(toml, /^min_herdr_version\s*=\s*"0\.7\.0"$/m);
});

test('manifest wires every action the adapter implements, and no others', () => {
  const toml = fs.readFileSync(MANIFEST, 'utf8');
  const declared = [...toml.matchAll(/^id\s*=\s*"([a-z-]+)"$/gm)].map((m) => m[1]);
  const { COMMANDS } = require(ADAPTER);
  for (const actionId of declared) {
    if (actionId === 'thumbgate.approvals') continue;
    assert.ok(COMMANDS[actionId], `manifest action "${actionId}" has no adapter implementation`);
  }
  // seed-scope is an event handler rather than an action, so it is implemented
  // but intentionally not declared under [[actions]].
  assert.ok(COMMANDS['seed-scope'], 'seed-scope must exist for the worktree.created event');
});

test('every subcommand exits 0 even when ThumbGate is absent', () => {
  // This is the whole safety contract: a governance plugin that exits non-zero
  // can break a Herdr pane. ThumbGate being uninstalled is the common case for
  // a new user evaluating the plugin from the marketplace.
  for (const subcommand of ['startup', 'queue', 'gates', 'block-last', 'seed-scope']) {
    const out = runAdapter(subcommand);
    assert.equal(out.code, 0, `${subcommand} must exit 0; got ${out.code} (${out.stderr.slice(0, 120)})`);
    assert.ok(out.stdout.length > 0, `${subcommand} must explain itself on stdout`);
  }
});

test('an unknown subcommand fails loudly instead of pretending to work', () => {
  const out = runAdapter('definitely-not-a-command');
  assert.equal(out.code, 1);
  assert.match(out.stdout, /Unknown subcommand/);
});

test('malformed context JSON does not crash the adapter', () => {
  const res = spawnSync(process.execPath, [ADAPTER, 'seed-scope'], {
    encoding: 'utf8',
    input: 'not json at all',
    timeout: 30000,
  });
  assert.equal(res.status, 0, 'a bad context payload must degrade, not throw');
});
