'use strict';

// Contract test for scripts/buyer-effect-proof.js (buyer effect proof).
// The proof demonstrates gate EFFECTS - executor invocation counts and an
// independent sentinel - rather than verdict text alone. This test pins the
// contract so the proof cannot silently weaken: a warn must never be labeled
// BLOCKED, a deny must leave the executor untouched, a false completion must
// be NOT_VERIFIED, and the run must stay isolated from customer stats.

const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'buyer-effect-proof.js');

function runProof() {
  const out = execFileSync(process.execPath, [SCRIPT, '--json'], { encoding: 'utf8' });
  return JSON.parse(out);
}

test('buyer effect proof: all core effect checks pass', () => {
  const summary = runProof();
  assert.equal(summary.totals.fail, 0, `proof reported failures: ${JSON.stringify(summary.cases.filter((c) => c.result === 'FAIL'))}`);
  for (const id of ['A-allowed-read', 'B-warning-not-prevention', 'C-actual-denial', 'D-false-completion', 'E-repetition-scope', 'F-synthetic-vs-customer']) {
    const c = summary.cases.find((x) => x.id === id);
    assert.ok(c, `missing case ${id}`);
    assert.ok(['PASS', 'UNKNOWN'].includes(c.result), `${id} unexpectedly ${c.result}`);
    assert.ok(c.observedVerdict !== undefined && c.executorCount !== undefined && c.effectCheck && c.evidenceRef,
      `${id} missing contract fields`);
  }
});

test('a warn verdict is never labeled BLOCKED', () => {
  const summary = runProof();
  const mislabeled = summary.cases.filter((c) => c.observedVerdict === 'warn' && c.label === 'BLOCKED');
  assert.deepEqual(mislabeled, [], `warn cases labeled BLOCKED: ${JSON.stringify(mislabeled.map((c) => c.id))}`);
});

test('an actual denial leaves the executor untouched', () => {
  const summary = runProof();
  const denials = summary.cases.filter((c) => c.observedVerdict === 'deny');
  assert.ok(denials.length >= 1, 'no deny case observed');
  for (const c of denials) {
    assert.equal(c.executorCount, 0, `${c.id} executed despite a deny verdict`);
  }
});

test('false completion claims are NOT_VERIFIED', () => {
  const summary = runProof();
  const d = summary.cases.find((c) => c.id === 'D-false-completion');
  assert.equal(d.result, 'PASS');
  assert.match(d.observedVerdict, /NOT_VERIFIED/);
});
