'use strict';

// Catastrophic floor (2026-07-11): warn-by-default (CEO decision 2026-06-04) downgrades almost
// every deny to a warn so legitimate work is never blocked. A SMALL, conservative allowlist of
// gate IDs for TRULY IRREVERSIBLE actions is the exception — they stay a hard DENY even in
// warn-by-default mode, because a warning is worthless once the action lands and there is no undo:
//   - force-push        (git push --force/-f rewrites published history)
//   - rm-rf-home-or-root (rm -rf of / ~ $HOME wipes the filesystem)
//
// The floor is a GATE-ID EXEMPTION (reusing the engine's existing gate detection, the same
// mechanism self-protect uses) — deliberately NOT a new regex over the raw command, which would
// be evadable theater. Owner escape mirrors self-protect: THUMBGATE_CATASTROPHIC_OVERRIDE=1.
//
// Coverage strategy:
//   - rm-rf is asserted end-to-end through the real `bin/cli.js gate-check` subprocess — it is
//     never shadowed by other gates, so it is deterministic in every environment.
//   - force-push is asserted at the unit level against applyEnforcementPosture(): in a repo with
//     a local-only task scope active, a real `git push --force` is intercepted first by the
//     local-only-remote-side-effect scope gate, which would make a subprocess assertion flaky
//     across environments. Testing the posture function directly with a resolved `force-push`
//     gate id proves the floor logic without that ordering dependency.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const engine = require('../scripts/gates-engine');
const { applyEnforcementPosture, isCatastrophicGate } = engine;

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

// Run `fn` with the catastrophic-floor env vars in a known state, then restore them, so a stray
// THUMBGATE_STRICT_ENFORCEMENT / THUMBGATE_CATASTROPHIC_OVERRIDE in the runner cannot skew the
// unit assertions.
function withEnv(overrides, fn) {
  const keys = ['THUMBGATE_STRICT_ENFORCEMENT', 'THUMBGATE_CATASTROPHIC_OVERRIDE', 'THUMBGATE_SELF_PROTECT_OVERRIDE'];
  const saved = {};
  for (const k of keys) saved[k] = process.env[k];
  for (const k of keys) delete process.env[k];
  for (const [k, v] of Object.entries(overrides)) process.env[k] = v;
  try {
    return fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const denyResult = (gate) => ({ decision: 'deny', gate, message: `blocked by ${gate}` });

// --- Unit: the floor is a targeted gate-id exemption -------------------------------------------

test('isCatastrophicGate recognizes only the irreversible gate ids', () => {
  assert.equal(isCatastrophicGate('force-push'), true);
  assert.equal(isCatastrophicGate('rm-rf-home-or-root'), true);
  // Controls: recoverable / non-self-protect denies are NOT on the floor.
  assert.equal(isCatastrophicGate('git-reset-hard'), false);
  assert.equal(isCatastrophicGate('protected-branch-push'), false);
  assert.equal(isCatastrophicGate('git-clean-force'), false);
  assert.equal(isCatastrophicGate(undefined), false);
});

test('force-push (rewrites published history) stays DENY by default', () => {
  const out = withEnv({}, () => applyEnforcementPosture(denyResult('force-push')));
  assert.equal(out.decision, 'deny', `catastrophic force-push must not be downgraded to warn`);
});

test('rm-rf-home-or-root stays DENY by default (unit)', () => {
  const out = withEnv({}, () => applyEnforcementPosture(denyResult('rm-rf-home-or-root')));
  assert.equal(out.decision, 'deny');
});

test('CONTROL: a non-catastrophic deny (git-reset-hard) still downgrades to WARN', () => {
  // Proves the floor is targeted, not a blanket block: recoverable denies keep warn-by-default.
  const out = withEnv({}, () => applyEnforcementPosture(denyResult('git-reset-hard')));
  assert.equal(out.decision, 'warn');
  assert.equal(out.warnByDefault, true);
});

test('THUMBGATE_CATASTROPHIC_OVERRIDE=1 downgrades the catastrophic deny to WARN', () => {
  const out = withEnv({ THUMBGATE_CATASTROPHIC_OVERRIDE: '1' }, () =>
    applyEnforcementPosture(denyResult('force-push')),
  );
  assert.equal(out.decision, 'warn', 'owner escape must let the catastrophic action through as a warning');
});

// --- End-to-end: rm -rf of home/root through the real gate-check subprocess ---------------------

const RM_RF_HOME = { tool_name: 'Bash', tool_input: { command: 'rm -rf ~/' } };
const GIT_RESET_HARD = { tool_name: 'Bash', tool_input: { command: 'git reset --hard HEAD~5' } };

test('rm -rf of home DENIES by default (warn-by-default posture) — subprocess', () => {
  const v = gateCheck(RM_RF_HOME);
  assert.equal(v.decision, 'deny', `expected deny, got ${v.decision}\n${v.raw.slice(0, 300)}`);
});

test('CONTROL: git reset --hard still only WARNS by default — subprocess', () => {
  // If this ever flips to deny, the floor stopped being targeted and became a blanket block.
  assert.notEqual(gateCheck(GIT_RESET_HARD).decision, 'deny', 'recoverable deny must stay warn-by-default');
});

test('THUMBGATE_CATASTROPHIC_OVERRIDE=1 releases rm -rf of home to a warning — subprocess', () => {
  const v = gateCheck(RM_RF_HOME, { THUMBGATE_CATASTROPHIC_OVERRIDE: '1' });
  assert.notEqual(v.decision, 'deny', 'the owner escape must let the action through as a warning');
});
