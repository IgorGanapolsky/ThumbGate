'use strict';

/**
 * hook-self-protection.test.js
 *
 * Regression coverage for the self-protection gate added 2026-07-08 after
 * Andy Martin's review pointed out that an agent could silently edit the
 * files that configure ThumbGate (hook wiring, gate config) and thereby
 * disable the firewall before continuing.
 *
 * Contract:
 *   - Edits to governance files (.claude/settings.json, scripts/hook-*.js,
 *     config/gates/**, config/enforcement.json, config/mcp-allowlists.json)
 *     hard-block unless a scoped approval or break-glass recovery is active.
 *   - Non-governance edits produce nothing.
 *   - Environment flags cannot bypass the floor.
 */

const { test } = require('node:test');
const assert = require('node:assert');

const {
  selfProtectionTarget,
  evaluateSelfProtection,
} = require('../scripts/self-protection.js');

const GOVERNANCE_FILES = [
  '.claude/settings.json',
  '.claude/settings.local.json',
  '/abs/path/repo/.claude/settings.json',
  'scripts/hook-pre-tool-use.js',
  'scripts/hook-stop-self-score.sh',
  'config/gates/default.json',
  'config/budget.json',
  'config/enforcement.json',
  'config/mcp-allowlists.json',
  '.thumbgate/config.json',
  '.thumbgate/feedback/financial-control-ledger.jsonl',
  '.thumbgate/feedback/financial-control-ledger.head.json',
  '.thumbgate/feedback/financial-control-ledger.journal.json',
  '.thumbgate/feedback/human-escalations.jsonl',
  '.thumbgate/feedback/human-escalations.head.json',
  '.thumbgate/feedback/human-escalations.journal.json',
  'thumbgate.json',
];

const NON_GOVERNANCE_FILES = [
  'src/index.js',
  'README.md',
  'scripts/feedback-loop.js', // a script, but not a hook-* script
  'config/other.json',
  'tests/hook-self-protection.test.js',
];

function withEnv(overrides, fn) {
  const saved = {};
  for (const k of Object.keys(overrides)) {
    saved[k] = process.env[k];
    if (overrides[k] === undefined) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(overrides)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('selfProtectionTarget matches governance files for edit-like tools', () => {
  for (const f of GOVERNANCE_FILES) {
    assert.ok(
      selfProtectionTarget('Edit', { file_path: f }),
      `expected ${f} to be a self-protection target`
    );
    assert.ok(selfProtectionTarget('Write', { file_path: f }), `Write ${f}`);
  }
});

test('selfProtectionTarget ignores non-governance files', () => {
  for (const f of NON_GOVERNANCE_FILES) {
    assert.strictEqual(
      selfProtectionTarget('Edit', { file_path: f }),
      null,
      `expected ${f} NOT to be a target`
    );
  }
});

test('selfProtectionTarget ignores non-edit tools (Bash cannot be mistaken for a file edit)', () => {
  assert.strictEqual(selfProtectionTarget('Bash', { command: 'rm .claude/settings.json' }), null);
  assert.strictEqual(selfProtectionTarget('Read', { file_path: '.claude/settings.json' }), null);
});

test('default posture hard-blocks self-governance edits', () => {
  withEnv({ THUMBGATE_STRICT_ENFORCEMENT: undefined, THUMBGATE_ALLOW_SELF_EDIT: undefined }, () => {
    const r = evaluateSelfProtection('Edit', { file_path: '.claude/settings.json' });
    assert.ok(r, 'expected a decision');
    assert.strictEqual(r.action, 'block');
    assert.match(r.message, /self-protection/i);
  });
});

test('strict posture remains a hard block', () => {
  withEnv({ THUMBGATE_STRICT_ENFORCEMENT: '1', THUMBGATE_ALLOW_SELF_EDIT: undefined }, () => {
    const r = evaluateSelfProtection('Edit', { file_path: 'config/gates/default.json' });
    assert.ok(r);
    assert.strictEqual(r.action, 'block');
  });
});

test('legacy environment escape cannot disable self-protection', () => {
  withEnv({
    THUMBGATE_STRICT_ENFORCEMENT: '1',
    THUMBGATE_ALLOW_SELF_EDIT: '1',
    THUMBGATE_SELF_PROTECT_OVERRIDE: '1',
    THUMBGATE_HOTFIX_BYPASS: '1',
  }, () => {
    const result = evaluateSelfProtection('Edit', { file_path: '.claude/settings.json' });
    assert.ok(result);
    assert.strictEqual(result.action, 'block');
  });
});

test('non-governance edits return null in every posture', () => {
  for (const strict of [undefined, '1']) {
    withEnv({ THUMBGATE_STRICT_ENFORCEMENT: strict, THUMBGATE_ALLOW_SELF_EDIT: undefined }, () => {
      assert.strictEqual(evaluateSelfProtection('Edit', { file_path: 'src/index.js' }), null);
    });
  }
});
