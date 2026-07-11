'use strict';

// Self-protection gates must bind regardless of enforcement posture. An agent must never be
// able to disable ThumbGate's own guardrails on a mere warning — by the time the warning is
// logged, the guardrail is already gone. A deliberate owner escape,
// THUMBGATE_SELF_PROTECT_OVERRIDE=1, exists so an accidental warn posture cannot strand the
// owner from repairing their own config (self-lockout, 2026-07-07).
//
// Scope of this change: the two self-protect gates that fire FIRST — self-protect-kill
// (killing the enforcement engine) and self-protect-env-override (exporting THUMBGATE_* /
// LANEKEEP_* to disable checks) — now hard-deny by default. The file-edit vectors
// (self-protect-config, self-protect-hooks-disable) are shadowed by earlier gates
// (protected-file-approval-required, workflow-sentinel) and remain approval/warn-gated;
// hardening those requires gate reordering and is a tracked follow-up, deliberately not
// bundled here.
//
// These run the real `bin/cli.js gate-check` subprocess, so they assert observed behavior.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');
const REPO = path.join(__dirname, '..');

function gateCheck(input, env = {}) {
  const res = spawnSync('node', [CLI, 'gate-check'], {
    input: JSON.stringify({ ...input, cwd: REPO }),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  const out = res.stdout || '';
  const brace = out.indexOf('{');
  if (brace === -1) return { decision: null, raw: out };
  const hook = JSON.parse(out.slice(brace)).hookSpecificOutput || {};
  return { decision: hook.permissionDecision ?? null, raw: out };
}

const KILL = { tool_name: 'Bash', tool_input: { command: 'pkill -f gates-engine' } };
const ENV_OVERRIDE = { tool_name: 'Bash', tool_input: { command: 'export THUMBGATE_HOTFIX_BYPASS=1' } };
// A deny that is NOT self-protective AND NOT on the catastrophic floor — proves the change is
// targeted, not a blanket hard-block. (`git reset --hard` is recoverable via reflog, so it
// deliberately stays warn-by-default; force-push, which rewrites published history, is on the
// catastrophic floor and now denies by default — see tests/enforcement-catastrophic-floor.test.js.)
const GIT_RESET_HARD = { tool_name: 'Bash', tool_input: { command: 'git reset --hard HEAD~5' } };

test('self-protect-kill DENIES by default (warn-by-default posture)', () => {
  const v = gateCheck(KILL);
  assert.equal(v.decision, 'deny', `expected deny, got ${v.decision}\n${v.raw.slice(0, 300)}`);
});

test('self-protect-env-override DENIES by default', () => {
  const v = gateCheck(ENV_OVERRIDE);
  assert.equal(v.decision, 'deny', `expected deny, got ${v.decision}\n${v.raw.slice(0, 300)}`);
});

test('THUMBGATE_SELF_PROTECT_OVERRIDE=1 is the escape hatch: kill downgrades to warn', () => {
  const v = gateCheck(KILL, { THUMBGATE_SELF_PROTECT_OVERRIDE: '1' });
  assert.notEqual(v.decision, 'deny', 'the owner escape must let the action through as a warning');
});

test('the escape hatch also releases env-override', () => {
  const v = gateCheck(ENV_OVERRIDE, { THUMBGATE_SELF_PROTECT_OVERRIDE: '1' });
  assert.notEqual(v.decision, 'deny');
});

test('strict enforcement still denies self-protect (unchanged)', () => {
  assert.equal(gateCheck(KILL, { THUMBGATE_STRICT_ENFORCEMENT: '1' }).decision, 'deny');
});

test('CONTROL: a non-self-protect, non-catastrophic deny (git reset --hard) still only WARNS by default', () => {
  // If this ever flips to `deny`, the change stopped being targeted and became a blanket
  // hard-block — the warn-by-default policy the CEO deliberately chose (2026-06-04).
  assert.notEqual(
    gateCheck(GIT_RESET_HARD).decision,
    'deny',
    'git reset --hard is not self-protective and is recoverable; warn-by-default must still apply',
  );
});

test('CONTROL: git reset --hard DOES deny under strict — proving the gate itself still fires', () => {
  assert.equal(gateCheck(GIT_RESET_HARD, { THUMBGATE_STRICT_ENFORCEMENT: '1' }).decision, 'deny');
});
