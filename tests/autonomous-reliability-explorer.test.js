'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createRng,
  exploreReliability,
  formatExplorerReport,
  writeReport,
  FAULTS,
} = require('../scripts/autonomous-reliability-explorer');
const { listInvariants } = require('../scripts/reliability-invariants');

test('createRng is deterministic for the same seed', () => {
  const a = createRng(42);
  const b = createRng(42);
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  assert.deepEqual(seqA, seqB);
});

test('invariant catalog covers gates, retrieval, feedback, eval, audit', () => {
  const ids = listInvariants().map((i) => i.id);
  assert.ok(ids.includes('gate-never-throws'));
  assert.ok(ids.includes('gate-rm-rf-blocked'));
  assert.ok(ids.includes('gate-secret-exfil-blocked'));
  assert.ok(ids.includes('audit-never-throws'));
  assert.ok(ids.includes('retrieval-scope-isolation'));
  assert.ok(ids.includes('replay-determinism'));
  assert.ok(ids.includes('findings-promoteable'));
  assert.ok(FAULTS.length >= 10);
});

test('exploreReliability is seed-reproducible', () => {
  const r1 = exploreReliability({ seed: 7, iterations: 6, checkReplay: false });
  const r2 = exploreReliability({ seed: 7, iterations: 6, checkReplay: false });
  assert.deepEqual(r1.faultPlan, r2.faultPlan);
  assert.equal(r1.summary.violations, r2.summary.violations);
});

test('exploreReliability writes report artifacts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-are-test-'));
  const report = exploreReliability({ seed: 99, iterations: 4, checkReplay: false });
  const paths = writeReport(report, dir);
  assert.ok(fs.existsSync(paths.jsonPath));
  assert.ok(fs.existsSync(paths.mdPath));
  const md = formatExplorerReport(report);
  assert.match(md, /Autonomous reliability explorer/);
  assert.match(md, /Reproduction/);
});

test('circular tool input no longer crashes gate evaluation (explorer regression)', () => {
  // Found by explorer under toxic-tool-input fault: audit-trail JSON.stringify threw.
  const { evaluateGates } = require('../scripts/gates-engine');
  const t = { command: 'git ' + 'push --' + 'force origin main', nested: {} };
  t.nested.self = t;
  assert.doesNotThrow(() => evaluateGates('Bash', t));
});
