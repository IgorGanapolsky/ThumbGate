'use strict';

// The learned-rule store (gates a thumbs-down promoted, claim rules, send holds and the
// feedback log) is protection state. An agent that can delete or rewrite it can remove the
// rule that blocks it, so agent writes to it hit the self-protect-config hard floor even with
// every bypass env set. Reads stay allowed, and other files under .thumbgate/ are untouched.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');
const REPO = path.join(__dirname, '..');

function gateCheck(input, env = {}) {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-learned-store-test-'));
  try {
    const res = spawnSync(process.execPath, [CLI, 'gate-check'], {
      input: JSON.stringify({ ...input, cwd: REPO }),
      cwd: REPO,
      env: {
        ...process.env,
        THUMBGATE_STATE_DIR: runtimeDir,
        THUMBGATE_FEEDBACK_DIR: runtimeDir,
        THUMBGATE_SECRET_SCAN_PROVIDER: 'heuristic',
        THUMBGATE_PRO_MODE: '1',
        THUMBGATE_NO_RATE_LIMIT: '1',
        THUMBGATE_NO_NUDGE: '1',
        THUMBGATE_HOTFIX_BYPASS: '',
        THUMBGATE_STRICT_ENFORCEMENT: '',
        THUMBGATE_SELF_PROTECT_OVERRIDE: '',
        THUMBGATE_ALLOW_SELF_EDIT: '',
        ...env,
      },
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, `gate-check failed:\n${res.stderr}`);
    const raw = res.stdout || '';
    const brace = raw.indexOf('{');
    assert.notEqual(brace, -1, `gate-check did not emit JSON:\n${raw}`);
    const payload = JSON.parse(raw.slice(brace));
    const hook = payload.hookSpecificOutput || {};
    return {
      decision: hook.permissionDecision ?? null,
      reason: hook.permissionDecisionReason || '',
      raw,
    };
  } finally {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  }
}

const ADVERSARIAL_BYPASS_ENV = {
  THUMBGATE_HOTFIX_BYPASS: '1',
  THUMBGATE_SELF_PROTECT_OVERRIDE: '1',
  THUMBGATE_ALLOW_SELF_EDIT: '1',
};

const DENIED = [
  ['Write over the promoted thumbs-down gates', {
    tool_name: 'Write',
    tool_input: { file_path: '.thumbgate/auto-promoted-gates.json', content: '{"gates":[]}' },
  }],
  ['Edit the claim rules', {
    tool_name: 'Edit',
    tool_input: { file_path: '/repo/.thumbgate/claim-gate-rules.json', old_string: 'x', new_string: '' },
  }],
  ['rm the send holds', {
    tool_name: 'Bash',
    tool_input: { command: 'rm -f .thumbgate/send-gate-state.json' },
  }],
  ['sed the prevention rules', {
    tool_name: 'Bash',
    tool_input: { command: "sed -i '' '/force-push/d' .thumbgate/prevention-rules.md" },
  }],
  ['truncate the feedback log', {
    tool_name: 'Bash',
    tool_input: { command: ': > .thumbgate/feedback-log.jsonl' },
  }],
  ['rewrite the global per-project store', {
    tool_name: 'Bash',
    tool_input: { command: "echo '{}' > ~/.thumbgate/projects/demo/auto-promoted-gates.json" },
  }],
  ['move the legacy store aside', {
    tool_name: 'Bash',
    tool_input: { command: 'mv .claude/memory/feedback/auto-promoted-gates.json /tmp/x.json' },
  }],
  ['write the compat store', {
    tool_name: 'Write',
    tool_input: { file_path: '.thumbgate-compat/send-gate-state.json', content: '{}' },
  }],
];

for (const [label, input] of DENIED) {
  test(`learned-rule store: ${label} is denied even with bypass env set`, () => {
    const result = gateCheck(input, ADVERSARIAL_BYPASS_ENV);
    assert.equal(result.decision, 'deny', result.raw.slice(0, 500));
    assert.ok(result.reason.includes('[GATE:self-protect-config]'), result.reason);
  });
}

const NOT_SELF_PROTECTED = [
  ['reading the feedback log', {
    tool_name: 'Bash',
    tool_input: { command: 'cat .thumbgate/feedback-log.jsonl | tail -5' },
  }],
  ['grepping the promoted gates', {
    tool_name: 'Bash',
    tool_input: { command: 'grep force-push .thumbgate/auto-promoted-gates.json' },
  }],
  ['writing an unrelated file under .thumbgate', {
    tool_name: 'Write',
    tool_input: { file_path: '.thumbgate/notes.md', content: 'hello' },
  }],
  ['writing a similarly named file outside the store', {
    tool_name: 'Write',
    tool_input: { file_path: 'docs/feedback-log.jsonl.md', content: 'hello' },
  }],
];

for (const [label, input] of NOT_SELF_PROTECTED) {
  test(`learned-rule store: ${label} does not trip self-protect-config`, () => {
    const result = gateCheck(input);
    assert.ok(!result.reason.includes('[GATE:self-protect-config]'), result.raw.slice(0, 500));
  });
}
