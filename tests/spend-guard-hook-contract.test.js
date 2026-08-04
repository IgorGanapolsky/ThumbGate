'use strict';

// End-to-end cover for the money guard AS A HOOK PROCESS.
//
// The precision test covers the matcher in isolation. This one spawns the guard
// the way the runtime does — PreToolUse JSON on stdin — and asserts both halves
// of the contract:
//   1. decision:  ordinary developer payloads pass, real commerce payloads deny
//   2. transport: stdout is either empty or exactly one JSON object
//
// (2) exists because a hook that emits malformed stdout surfaces to the user as
// "Hook JSON output validation failed - (root): Invalid input", which is
// indistinguishable from a policy denial and hides the real decision.
//
// Vectors are derived from the pattern so this file never embeds the tokens it
// tests, and so it stays correct if the token list changes.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const GUARD = path.join(__dirname, '..', 'scripts', 'thumbgate-spend-guard.js');

function matcher() {
  const src = fs.readFileSync(GUARD, 'utf8');
  const m = src.match(/const DIRECT_CHECKOUT_PATH\s*=\s*(\/[\s\S]*?\/i);/);
  assert.ok(m, 'commerce-path matcher not found');
  // eslint-disable-next-line no-eval
  return eval(m[1]);
}

function tokens() {
  const inner = matcher().source.match(/\[\\\/#\]\(\?:([^)]+)\)/);
  assert.ok(inner, 'expected character-class prefixed token group');
  return inner[1].split('|').map((t) => t.replace(/\?$/, ''));
}

function hosts() {
  return [...new Set(matcher().source.match(/[a-z]+\\\.[a-z]+\\\.[a-z]+/g) || [])]
    .map((h) => h.replace(/\\/g, ''));
}

function runGuard(payload) {
  const res = spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 15000,
  });
  return { code: res.status, stdout: (res.stdout || '').trim(), stderr: (res.stderr || '').trim() };
}

// A hook must emit nothing, or exactly one parseable JSON object. Anything else
// is reported to the user as an opaque validation failure.
function assertTransportContract(out, label) {
  if (out.stdout === '') return;
  let parsed;
  assert.doesNotThrow(
    () => { parsed = JSON.parse(out.stdout); },
    `${label}: stdout must be empty or exactly one JSON object, got: ${out.stdout.slice(0, 200)}`,
  );
  assert.equal(typeof parsed, 'object', `${label}: stdout JSON must be an object`);
  assert.notEqual(parsed, null, `${label}: stdout JSON must not be null`);
}

test('ordinary developer payloads are not denied', () => {
  for (const token of tokens()) {
    for (const payload of [
      { tool_name: 'Bash', tool_input: { command: `vcs ${token} -b feature/x` } },
      { tool_name: 'Write', tool_input: { file_path: 'a.py', content: `"""describe the ${token} tier."""` } },
    ]) {
      const out = runGuard(payload);
      assertTransportContract(out, `allow/${token}`);
      assert.equal(out.code, 0, `"${token}" in ordinary context must not be denied (stderr: ${out.stderr.slice(0, 160)})`);
    }
  }
});

test('real commerce payloads are still denied', () => {
  const urls = [
    ...hosts().map((h) => `https://${h}/session/abc`),
    ...tokens().map((t) => `https://vendor.example.com/${t}`),
  ];
  for (const url of urls) {
    const out = runGuard({ tool_name: 'WebFetch', tool_input: { url } });
    assertTransportContract(out, `deny/${url}`);
    assert.notEqual(out.code, 0, `${url} must stay denied`);
  }
});

test('the hook honours its stdout transport contract on every path', () => {
  const samples = [
    { tool_name: 'Bash', tool_input: { command: 'git status' } },
    { tool_name: 'Read', tool_input: { file_path: 'README.md' } },
    { tool_name: 'WebFetch', tool_input: { url: `https://${hosts()[0]}/x` } },
  ];
  for (const payload of samples) {
    assertTransportContract(runGuard(payload), `transport/${payload.tool_name}`);
  }
});
