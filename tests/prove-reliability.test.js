'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  proveReliability,
  DEFAULT_SEED,
  DEFAULT_ITERATIONS,
} = require('../scripts/prove-reliability');
const {
  promoteFindings,
  exploreReliability,
  FAULTS,
} = require('../scripts/autonomous-reliability-explorer');
const { listInvariants } = require('../scripts/reliability-invariants');

test('proveReliability uses fixed seed and writes proof artifacts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-prove-rel-'));
  const proof = proveReliability({
    seed: DEFAULT_SEED,
    iterations: 6,
    proofDir: dir,
    promote: true,
    checkReplay: false,
  });
  assert.equal(proof.seed, DEFAULT_SEED);
  assert.ok(proof.iterations >= 1);
  assert.ok(fs.existsSync(proof.artifacts.proofJson));
  assert.ok(fs.existsSync(proof.artifacts.proofMd));
  assert.ok(fs.existsSync(proof.artifacts.reportJson));
  assert.equal(typeof proof.passed, 'boolean');
  assert.equal(typeof proof.violations, 'number');
});

test('high-ROI fault catalog includes rm-rf, secret, force-push', () => {
  const ids = FAULTS.map((f) => f.id);
  assert.ok(ids.includes('rm-rf-root'));
  assert.ok(ids.includes('secret-inline'));
  assert.ok(ids.includes('force-push-main'));
  assert.ok(ids.includes('toxic-tool-input'));
});

test('high-ROI invariants include secret, rm-rf, audit, promote', () => {
  const ids = listInvariants().map((i) => i.id);
  assert.ok(ids.includes('gate-secret-exfil-blocked'));
  assert.ok(ids.includes('gate-rm-rf-blocked'));
  assert.ok(ids.includes('audit-never-throws'));
  assert.ok(ids.includes('findings-promoteable'));
});

test('promoteFindings writes feedback + memory on violations', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-promote-'));
  const fakeReport = {
    generatedAt: new Date().toISOString(),
    seed: 99,
    iterations: 2,
    findings: [
      {
        invariantId: 'gate-never-throws',
        detail: 'synthetic failure for promote test',
        phase: 'gates',
        faultId: 'toxic-tool-input',
        runIndex: 0,
      },
    ],
    reproduction: { command: 'node scripts/autonomous-reliability-explorer.js --seed=99' },
  };
  const out = promoteFindings(fakeReport, { outDir: dir });
  assert.equal(out.ok, true);
  assert.equal(out.promoted, 1);
  assert.ok(fs.existsSync(out.path));
  assert.ok(fs.existsSync(out.memoryPath));
  const feedback = fs.readFileSync(out.path, 'utf8');
  assert.match(feedback, /autonomous-reliability-explorer/);
  assert.match(feedback, /gate-never-throws/);
});

test('exploreReliability seed-reproducible with expanded fault set', () => {
  const r1 = exploreReliability({ seed: 11, iterations: 8, checkReplay: false });
  const r2 = exploreReliability({ seed: 11, iterations: 8, checkReplay: false });
  assert.deepEqual(r1.faultPlan, r2.faultPlan);
  assert.equal(r1.summary.violations, r2.summary.violations);
});

test('DEFAULT_ITERATIONS is bounded for CI cost', () => {
  assert.ok(DEFAULT_ITERATIONS <= 20);
  assert.ok(DEFAULT_ITERATIONS >= 4);
});
