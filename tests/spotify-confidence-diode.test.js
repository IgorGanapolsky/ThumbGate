'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  evaluateConfidenceAction,
  auditConfidenceDiodes,
  DIODES,
} = require('../scripts/spotify-confidence-diode');

test('evaluateConfidenceAction: blocks rollouts above 10% without review', () => {
  const blocked = evaluateConfidenceAction({
    tool: 'set_rollout',
    flag: 'new-checkout-flow',
    rolloutPercent: 50,
  });
  assert.equal(blocked.decision, 'block');
  assert.equal(blocked.gateId, 'gate:confidence:rollout_ceiling');
  assert.ok(blocked.reason.includes('Max autonomous canary is 10%'));

  const allowed = evaluateConfidenceAction({
    tool: 'set_rollout',
    flag: 'new-checkout-flow',
    rolloutPercent: 10,
  });
  assert.equal(allowed.decision, 'allow');
});

test('evaluateConfidenceAction: blocks flag updates when tests are failing', () => {
  const blocked = evaluateConfidenceAction({
    tool: 'update_flag',
    flag: 'beta-v2',
    testsPassed: false,
  });
  assert.equal(blocked.decision, 'block');
  assert.equal(blocked.gateId, 'gate:confidence:test_proof_required');
});

test('evaluateConfidenceAction: locks active A/B experiments against mutation', () => {
  const blocked = evaluateConfidenceAction({
    tool: 'update_flag',
    flag: 'checkout-v2-experiment',
    isActiveExperiment: true,
  });
  assert.equal(blocked.decision, 'block');
  assert.equal(blocked.gateId, 'gate:confidence:protect_active_experiment');
});

test('evaluateConfidenceAction: prevents flag deletion in production', () => {
  const blocked = evaluateConfidenceAction({
    tool: 'delete_flag',
    flag: 'legacy-auth',
    environment: 'production',
  });
  assert.equal(blocked.decision, 'block');
  assert.equal(blocked.gateId, 'gate:confidence:prevent_flag_deletion');
});

test('auditConfidenceDiodes: returns status PASS across all 4 diodes', () => {
  const audit = auditConfidenceDiodes();
  assert.equal(audit.status, 'PASS');
  assert.equal(audit.adapter, 'spotify-confidence');
  assert.equal(audit.checks.length, 4);
  assert.ok(audit.checks.every((c) => c.ok));
});

test('CLI: spotify-confidence-diode supports --json and --map-only', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'spotify-confidence-diode.js');

  const runJson = spawnSync(process.execPath, [scriptPath, '--json'], { encoding: 'utf8' });
  assert.equal(runJson.status, 0);
  const outJson = JSON.parse(runJson.stdout);
  assert.equal(outJson.status, 'PASS');

  const runMap = spawnSync(process.execPath, [scriptPath, '--map-only'], { encoding: 'utf8' });
  assert.equal(runMap.status, 0);
  const outMap = JSON.parse(runMap.stdout);
  assert.equal(outMap.status, 'ready');
  assert.equal(outMap.diodes.length, 4);
});
