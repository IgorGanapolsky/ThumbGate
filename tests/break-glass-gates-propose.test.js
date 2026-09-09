'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  SCHEMA_VERSION,
  GATES_REL,
  evaluatePropose,
  evaluateCheckout,
  formatText,
} = require('../scripts/break-glass-gates-propose');

const ROOT = path.join(__dirname, '..');
const DEFAULT_JSON = path.join(ROOT, GATES_REL);

function hashFile(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

test('propose disables a named gate in the patch and does not write default.json', () => {
  const before = hashFile(DEFAULT_JSON);
  const report = evaluatePropose({
    root: ROOT,
    reason: 'false positive on permission-change-approval',
    disableGateIds: ['permission-change-approval'],
  });
  assert.equal(report.decision, 'allow');
  assert.equal(report.liveApply, false);
  assert.equal(report.defaultJsonTouched, false);
  assert.equal(hashFile(DEFAULT_JSON), before);
  assert.ok(report.touchedGateIds.includes('permission-change-approval'));
  assert.match(report.patch, /permission-change-approval/);
  assert.match(report.patch, /breakGlassProposed/);
  assert.match(report.claimBoundary, /was not written/i);
});

test('--apply is a deny and still does not write default.json', () => {
  const before = hashFile(DEFAULT_JSON);
  const report = evaluatePropose({
    root: ROOT,
    reason: 'try live',
    disableGateIds: ['permission-change-approval'],
    apply: true,
  });
  assert.equal(report.decision, 'deny');
  assert.ok(report.issues.includes('live_apply_refused'));
  assert.equal(hashFile(DEFAULT_JSON), before);
});

test('writePath equal to default.json is refused', () => {
  const before = hashFile(DEFAULT_JSON);
  const report = evaluatePropose({
    root: ROOT,
    reason: 'sneak write',
    disableGateIds: ['permission-change-approval'],
    writePath: DEFAULT_JSON,
  });
  assert.equal(report.decision, 'deny');
  assert.ok(report.issues.includes('refused_write_default_json'));
  assert.equal(hashFile(DEFAULT_JSON), before);
});

test('relative writePath is resolved from root not cwd', () => {
  const before = hashFile(DEFAULT_JSON);
  const report = evaluatePropose({
    root: ROOT,
    reason: 'sneak write relative',
    disableGateIds: ['permission-change-approval'],
    writePath: GATES_REL,
  });
  assert.equal(report.decision, 'deny');
  assert.ok(report.issues.includes('live_apply_refused'));
  assert.ok(report.issues.includes('refused_write_default_json'));
  assert.equal(hashFile(DEFAULT_JSON), before);
});

test('missing reason fails closed', () => {
  const report = evaluatePropose({ root: ROOT, disableGateIds: ['permission-change-approval'] });
  assert.equal(report.decision, 'deny');
  assert.ok(report.issues.includes('missing_reason'));
});

test('unknown gate id fails closed', () => {
  const report = evaluatePropose({
    root: ROOT,
    reason: 'no such gate',
    disableGateIds: ['definitely-not-a-gate'],
  });
  assert.equal(report.decision, 'deny');
  assert.ok(report.issues.includes('unknown_gate_ids'));
});

test('model saying apply is safe is not a grant', () => {
  const report = evaluatePropose({
    root: ROOT,
    reason: 'fp',
    disableGateIds: ['permission-change-approval'],
    modelSaidSafe: true,
  });
  assert.equal(report.decision, 'deny');
  assert.ok(report.issues.includes('model_cannot_grant_authority'));
});

test('default checkout maps break-glass emergency and refuses live apply', () => {
  const report = evaluateCheckout();
  assert.equal(report.schemaVersion, `${SCHEMA_VERSION}.checkout`);
  assert.equal(report.livePromotionAllowed, false);
  assert.equal(report.decision, 'allow');
  assert.equal(report.items.find((row) => row.id === 'break_glass_emergency_surface').status, 'pass');
  assert.equal(report.items.find((row) => row.id === 'live_default_json_apply').status, 'not_wired');
});

test('claimLive is refused', () => {
  const report = evaluateCheckout({ claimLive: true });
  assert.equal(report.decision, 'deny');
  assert.ok(report.liveBlockedReasons.includes('claimLive_refused_without_live_gates_apply'));
});

test('formatText deny path does not throw', () => {
  const text = formatText(evaluatePropose({ root: ROOT }));
  assert.match(text, /decision=deny/);
});

test('CLI default checkout exits 0', () => {
  const cli = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'break-glass-gates-propose.js'),
  ], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr + cli.stdout);
  assert.match(cli.stdout, /not_wired/);
});

test('CLI --apply exits 2 and leaves default.json unchanged', () => {
  const before = hashFile(DEFAULT_JSON);
  const cli = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'break-glass-gates-propose.js'),
    '--apply',
    '--reason',
    'nope',
  ], { encoding: 'utf8' });
  assert.equal(cli.status, 2, cli.stderr + cli.stdout);
  assert.match(cli.stdout, /live_apply_refused/);
  assert.equal(hashFile(DEFAULT_JSON), before);
});

test('CLI --decide without payload exits 2', () => {
  const cli = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'break-glass-gates-propose.js'),
    '--decide',
  ], { encoding: 'utf8' });
  assert.equal(cli.status, 2, cli.stderr + cli.stdout);
  assert.match(cli.stdout, /missing_decide_payload/);
});

test('CLI --claim-live before --decide denies even on a clean payload', () => {
  const cli = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'break-glass-gates-propose.js'),
    '--claim-live',
    '--decide',
    JSON.stringify({
      reason: 'fp',
      disableGateIds: ['permission-change-approval'],
    }),
  ], { encoding: 'utf8' });
  assert.equal(cli.status, 2, cli.stderr + cli.stdout);
  assert.match(cli.stdout, /Refused: this doctor cannot live-apply/);
  assert.doesNotMatch(cli.stdout, /decision=allow/);
});

test('CLI --decide propose exits 0 and does not write default.json', () => {
  const before = hashFile(DEFAULT_JSON);
  const cli = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'break-glass-gates-propose.js'),
    '--gates',
    '--decide',
    JSON.stringify({
      reason: 'false positive on permission-change-approval',
      disableGateIds: ['permission-change-approval'],
    }),
  ], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr + cli.stdout);
  assert.match(cli.stdout, /decision=allow/);
  assert.match(cli.stdout, /--- a\/config\/gates\/default.json/);
  assert.equal(hashFile(DEFAULT_JSON), before);
});

test('break-glass-gates-propose stays checkout-only (script_not_in_pack_ok)', () => {
  const pkg = require('../package.json');
  const files = pkg.files || [];
  assert.equal(files.includes('scripts/break-glass-gates-propose.js'), false);
  assert.equal(files.includes('scripts/break-glass-gates.js'), false);
  assert.equal(pkg.scripts['break-glass:gates-propose'], 'node scripts/break-glass-gates-propose.js');
});
