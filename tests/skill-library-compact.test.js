'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const {
  SCHEMA_VERSION,
  evaluateLibrary,
  evaluateCheckout,
  formatText,
} = require('../scripts/skill-library-compact');

const compactLibrary = {
  families: ['force-push-main', 'secret-in-chat'],
  procedures: [
    { body: 'Never force-push protected main. Open a PR.' },
    { body: 'Never echo pasted credentials. Store in Keychain only.' },
  ],
  episodes: [{ id: 'ep-1' }, { id: 'ep-2' }, { id: 'ep-3' }, { id: 'ep-4' }],
};

test('compact procedural families allow without claiming SkillGLoW scores', () => {
  const report = evaluateLibrary(compactLibrary);
  assert.equal(report.decision, 'allow');
  assert.deepEqual(report.issues, []);
  assert.ok(report.weAreNot.includes('SkillGLoW'));
  assert.match(report.claimBoundary, /not SkillGLoW/i);
  assert.match(report.claimBoundary, /not a 17\.2-point claim/);
});

test('one generic global document collapses and denies', () => {
  const report = evaluateLibrary({
    form: 'single_document',
    procedures: [{ body: 'Be careful and try your best.' }],
  });
  assert.equal(report.decision, 'deny');
  assert.ok(report.issues.includes('generic_document_collapse'));
});

test('flat per-task pool inflates and denies', () => {
  const report = evaluateLibrary({
    episodes: [{ id: 't1' }, { id: 't2' }],
    procedures: [{ body: 'fix t1' }, { body: 'fix t2' }],
    families: [],
  });
  assert.equal(report.decision, 'deny');
  assert.ok(report.issues.includes('per_task_pool_inflation'));
});

test('instance-bound prior is not a reusable procedure', () => {
  const report = evaluateLibrary({
    families: ['ci'],
    procedures: [{
      body: 'On /Users/igorganapolsky/workspace/git/igor/ThumbGate pull/3812 sha ba30e441c657132daa38ef7bc688938f667bbe8f never retry.',
    }],
  });
  assert.equal(report.decision, 'deny');
  assert.ok(report.issues.includes('instance_bound_not_deinstantiated'));
});

test('commit without measured execution fails closed', () => {
  const report = evaluateLibrary({
    ...compactLibrary,
    commit: true,
  });
  assert.equal(report.decision, 'deny');
  assert.ok(report.issues.includes('commit_without_execution_gate'));
});

test('commit that degrades the library is rejected', () => {
  const report = evaluateLibrary({
    ...compactLibrary,
    commit: true,
    executionMeasured: true,
    executionDelta: -0.12,
  });
  assert.equal(report.decision, 'deny');
  assert.ok(report.issues.includes('commit_degrades_library'));
});

test('model saying the library is better is not a grant', () => {
  const report = evaluateLibrary({
    ...compactLibrary,
    modelSaidBetter: true,
  });
  assert.equal(report.decision, 'deny');
  assert.ok(report.issues.includes('model_cannot_grant_authority'));
});

test('empty inventory fails closed', () => {
  const report = evaluateLibrary({});
  assert.equal(report.decision, 'deny');
  assert.ok(report.issues.includes('library_inventory_unavailable'));
});

test('measured non-degrading commit allows', () => {
  const report = evaluateLibrary({
    ...compactLibrary,
    commit: true,
    executionMeasured: true,
    executionDelta: 0.04,
  });
  assert.equal(report.decision, 'allow');
});

test('default checkout maps existing rails and does not claim GLoW', () => {
  const report = evaluateCheckout();
  assert.equal(report.schemaVersion, `${SCHEMA_VERSION}.checkout`);
  assert.equal(report.affiliation, 'none');
  assert.equal(report.livePromotionAllowed, false);
  assert.equal(report.decision, 'allow');
  assert.equal(report.items.find((row) => row.id === 'procedure_promotion').status, 'pass');
  assert.equal(report.items.find((row) => row.id === 'glow_weave_trainer').status, 'not_wired');
  assert.match(report.claimBoundary, /not SkillGLoW/);
});

test('claimLive is refused', () => {
  const report = evaluateCheckout({ claimLive: true });
  assert.equal(report.decision, 'deny');
  assert.ok(report.liveBlockedReasons.includes('claimLive_refused_without_skillglow_runtime'));
});

test('formatText deny path does not throw', () => {
  const text = formatText(evaluateLibrary({}));
  assert.match(text, /decision=deny/);
  assert.doesNotMatch(text, /TypeError/);
});

test('CLI default checkout exits 0 and names SkillGLoW as not-us', () => {
  const cli = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'skill-library-compact.js'),
  ], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr + cli.stdout);
  assert.match(cli.stdout, /SkillGLoW/);
  assert.match(cli.stdout, /not_wired/);
});

test('CLI --decide per-task pool exits 2', () => {
  const cli = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'skill-library-compact.js'),
    '--decide',
    JSON.stringify({
      episodes: [{ id: 'a' }, { id: 'b' }],
      procedures: [{ body: 'a' }, { body: 'b' }],
    }),
  ], { encoding: 'utf8' });
  assert.equal(cli.status, 2, cli.stderr + cli.stdout);
  assert.match(cli.stdout, /per_task_pool_inflation/);
});

test('skill-library-compact stays checkout-only (script_not_in_pack_ok)', () => {
  const pkg = require('../package.json');
  const files = pkg.files || [];
  assert.equal(
    files.includes('scripts/skill-library-compact.js'),
    false,
    'do not pack this doctor; unique-file successor must not bump the npm bundle ratchet',
  );
  assert.equal(pkg.scripts['skill:library-compact'], 'node scripts/skill-library-compact.js');
});
