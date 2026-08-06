'use strict';

// A gate whose escape hatch is inside the locked door is not a guardrail, it is
// a stop-work order.
//
// On 2026-08-06 the pr-thread-resolution gate armed after an ordinary commit on
// a feature branch and then denied EVERY tool call in the session — Bash, Read,
// Write, Edit, ToolSearch, get_scope_state, gate_stats, and satisfy_gate itself.
// satisfy_gate is the only tool that can clear it, so there was no reachable way
// out; the session was permanently halted and a human had to intervene.
//
// The cause was one line. The exemption list compared the raw toolName against
// bare names, but hook payloads deliver MCP tools as "mcp__<server>__<tool>", so
// "mcp__thumbgate__satisfy_gate" never matched "satisfy_gate". The gate's own
// comment already documented the intended behaviour ("the satisfy_gate/
// track_action tools themselves are exempt ... so an agent can actually gather
// evidence and call satisfy_gate") — the code just did not implement it.
//
// These tests exist so the escape hatch can never be walled in again.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// State must be isolated BEFORE gates-engine is required: it resolves
// THUMBGATE_STATE_DIR once at module load.
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-livelock-'));
process.env.THUMBGATE_STATE_DIR = stateDir;

const {
  evaluatePendingPrThreadResolutionGate,
  trackAction,
} = require('../scripts/gates-engine');

const PENDING_ACTION = 'pr_thread_resolution_verified_after_commit';

function armGate() {
  trackAction(PENDING_ACTION, {});
}

test('the gate actually fires for an ordinary tool once armed', () => {
  // Guards the other tests: if arming silently no-ops, every "not blocked"
  // assertion below would pass vacuously and prove nothing.
  armGate();
  const verdict = evaluatePendingPrThreadResolutionGate('Write', { file_path: '/tmp/x.txt' });
  assert.ok(verdict, 'expected the armed gate to deny an ordinary tool');
  assert.equal(verdict.decision, 'deny');
  assert.equal(verdict.gate, 'pr-thread-resolution-verified-required');
});

test('satisfy_gate is never blocked by the gate it exists to satisfy', () => {
  armGate();
  assert.equal(
    evaluatePendingPrThreadResolutionGate('mcp__thumbgate__satisfy_gate', { gateId: 'pr_threads_checked' }),
    null,
    'the MCP-prefixed satisfy_gate must be exempt — blocking it is a livelock',
  );
});

test('the bare tool name stays exempt too', () => {
  // Both call shapes reach this code path depending on transport, so neither
  // may regress.
  armGate();
  assert.equal(evaluatePendingPrThreadResolutionGate('satisfy_gate', {}), null);
});

test('every evidence-gathering tool is exempt in both bare and MCP form', () => {
  armGate();
  for (const bare of ['recall', 'search_lessons', 'verify_claim', 'satisfy_gate', 'track_action']) {
    assert.equal(
      evaluatePendingPrThreadResolutionGate(bare, {}),
      null,
      `${bare} must be exempt`,
    );
    assert.equal(
      evaluatePendingPrThreadResolutionGate(`mcp__thumbgate__${bare}`, {}),
      null,
      `mcp__thumbgate__${bare} must be exempt`,
    );
  }
});

test('the exemption does not leak to arbitrary tools that merely contain "__"', () => {
  // Stripping the prefix must not turn into "allow anything namespaced".
  armGate();
  const verdict = evaluatePendingPrThreadResolutionGate('mcp__evil__deploy_to_prod', {});
  assert.ok(verdict, 'an unrelated MCP tool must still be denied');
  assert.equal(verdict.decision, 'deny');
});
