'use strict';

// Tests for `npx thumbgate hermes-gate` — the Nous Research Hermes Agent
// `pre_tool_call` shell hook. It reads Hermes tool-call JSON from stdin and emits
// {"decision":"block","reason":...} to veto a call or {} to allow it, reusing the
// same gate pipeline as `gate-check`. State is isolated via THUMBGATE_STATE_DIR so
// a developer's learned ~/.thumbgate rules can't make these non-deterministic.

const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');

function runHermesGate(payload, extraEnv = {}) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-hermes-gate-'));
  const out = execFileSync('node', [CLI, 'hermes-gate'], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      ...process.env,
      THUMBGATE_STATE_DIR: stateDir,
      // Neutralize inherited posture flags; the command sets strict itself.
      THUMBGATE_STRICT_ENFORCEMENT: '',
      THUMBGATE_HOTFIX_BYPASS: '',
      THUMBGATE_HERMES_WARN_ONLY: '',
      ...extraEnv,
    },
  });
  return JSON.parse(out.trim());
}

test('hermes-gate blocks a force-push and emits Hermes block format', () => {
  const decision = runHermesGate({
    hook_event_name: 'pre_tool_call',
    tool_name: 'terminal',
    tool_input: { command: 'git push --force origin main' },
    session_id: 's1',
    cwd: '/tmp',
  });
  assert.equal(decision.decision, 'block', `expected block, got ${JSON.stringify(decision)}`);
  assert.ok(
    typeof decision.reason === 'string' && decision.reason.length > 0,
    'a block decision must carry a non-empty reason',
  );
});

test('hermes-gate allows a safe read_file', () => {
  const decision = runHermesGate({
    hook_event_name: 'pre_tool_call',
    tool_name: 'read_file',
    tool_input: { file_path: '/tmp/notes.md' },
  });
  assert.notEqual(decision.decision, 'block', `safe read must not block: ${JSON.stringify(decision)}`);
});

test('hermes-gate fails OPEN on malformed stdin (never wedges Hermes)', () => {
  const decision = runHermesGate('this is not valid json');
  assert.notEqual(decision.decision, 'block', `malformed input must not block: ${JSON.stringify(decision)}`);
});

test('hermes-gate honors THUMBGATE_HERMES_WARN_ONLY (advisory mode never blocks)', () => {
  const decision = runHermesGate(
    {
      hook_event_name: 'pre_tool_call',
      tool_name: 'terminal',
      tool_input: { command: 'git push --force origin main' },
    },
    { THUMBGATE_HERMES_WARN_ONLY: '1' },
  );
  assert.notEqual(decision.decision, 'block', `warn-only mode must not block: ${JSON.stringify(decision)}`);
});

for (const [label, payload] of [
  ['terminal environment override', {
    tool_name: 'terminal',
    tool_input: { command: 'export THUMBGATE_HOTFIX_BYPASS=1' },
  }],
  ['patch hook disable', {
    tool_name: 'patch',
    tool_input: {
      file_path: '.claude/settings.json',
      old_string: '"PreToolUse": []',
      new_string: '"PreToolUse": [{"hooks": []}]',
    },
  }],
]) {
  test(`hermes-gate keeps ${label} on the hard floor under bypass flags`, () => {
    const decision = runHermesGate(
      { hook_event_name: 'pre_tool_call', ...payload },
      {
        THUMBGATE_HERMES_WARN_ONLY: '1',
        THUMBGATE_HOTFIX_BYPASS: '1',
        THUMBGATE_SELF_PROTECT_OVERRIDE: '1',
        THUMBGATE_ALLOW_SELF_EDIT: '1',
      },
    );
    assert.equal(decision.decision, 'block', JSON.stringify(decision));
    assert.match(decision.reason, /\[GATE:self-protect-/);
  });
}

test('Hermes operator bypass still allows an ordinary force-push gate', () => {
  const decision = runHermesGate(
    {
      hook_event_name: 'pre_tool_call',
      tool_name: 'terminal',
      tool_input: { command: 'git push --force origin main' },
    },
    { THUMBGATE_HOTFIX_BYPASS: '1' },
  );
  assert.notEqual(decision.decision, 'block', JSON.stringify(decision));
});
