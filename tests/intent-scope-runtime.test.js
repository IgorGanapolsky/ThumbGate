'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const {
  SCHEMA_VERSION,
  evaluateCheckout,
  evaluateIntentScope,
  formatText,
} = require('../scripts/intent-scope-runtime');

const completeCall = {
  identity: 'adapter:claude',
  declaredIntent: 'read_repo',
  allowedIntents: ['read_repo', 'run_tests'],
  tool: 'Read',
  approvedTools: ['Read', 'Grep'],
  resource: 'README.md',
  authorizedResources: ['README.md', 'package.json'],
};

test('complete intent inside scope allows without claiming AgentMinder', () => {
  const report = evaluateIntentScope(completeCall);
  assert.equal(report.decision, 'allow');
  assert.deepEqual(report.issues, []);
  assert.equal(report.redirectGateway, false);
  assert.ok(report.weAreNot.includes('AgentMinder'));
  assert.match(report.claimBoundary, /not AgentMinder/i);
});

test('missing declared intent fails closed even when identity is present', () => {
  const report = evaluateIntentScope({
    identity: 'adapter:claude',
    allowedIntents: ['read_repo'],
    tool: 'Read',
    approvedTools: ['Read'],
  });
  assert.equal(report.decision, 'deny');
  assert.ok(report.issues.includes('missing_declared_intent'));
});

test('intent outside authorized scope denies', () => {
  const report = evaluateIntentScope({
    ...completeCall,
    declaredIntent: 'exfiltrate_secrets',
  });
  assert.equal(report.decision, 'deny');
  assert.ok(report.issues.includes('intent_out_of_scope'));
});

test('empty scope inventory fails closed', () => {
  const report = evaluateIntentScope({
    identity: 'adapter:claude',
    declaredIntent: 'read_repo',
    allowedIntents: [],
  });
  assert.equal(report.decision, 'deny');
  assert.ok(report.issues.includes('scope_inventory_unavailable'));
});

test('unapproved tool denies even when intent matches', () => {
  const report = evaluateIntentScope({
    ...completeCall,
    tool: 'Bash',
  });
  assert.equal(report.decision, 'deny');
  assert.ok(report.issues.includes('tool_not_approved'));
});

test('model saying the call is safe is not a grant', () => {
  const report = evaluateIntentScope({
    ...completeCall,
    modelSaidSafe: true,
  });
  assert.equal(report.decision, 'deny');
  assert.ok(report.issues.includes('model_cannot_grant_authority'));
});

test('default checkout maps PreToolUse rails and does not claim VCF', () => {
  const report = evaluateCheckout();
  assert.equal(report.schemaVersion, `${SCHEMA_VERSION}.checkout`);
  assert.equal(report.affiliation, 'none');
  assert.equal(report.livePromotionAllowed, false);
  assert.equal(report.decision, 'allow');
  assert.equal(report.items.find((row) => row.id === 'runtime_intercept').status, 'pass');
  assert.equal(report.items.find((row) => row.id === 'audit_receipts').status, 'pass');
  assert.equal(report.items.find((row) => row.id === 'authzen_gateway').status, 'not_wired');
  assert.match(report.claimBoundary, /not Broadcom AgentMinder/);
});

test('claimLive is refused', () => {
  const report = evaluateCheckout({ claimLive: true });
  assert.equal(report.decision, 'deny');
  assert.ok(report.liveBlockedReasons.includes('claimLive_refused_without_agentminder_gateway'));
});

test('formatText deny path does not throw', () => {
  const denied = evaluateIntentScope({ identity: 'x' });
  const text = formatText(denied);
  assert.match(text, /decision=deny/);
  assert.doesNotMatch(text, /TypeError/);
});

test('CLI default checkout exits 0 and names AgentMinder as not-us', () => {
  const cli = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'intent-scope-runtime.js'),
  ], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr + cli.stdout);
  assert.match(cli.stdout, /AgentMinder/);
  assert.match(cli.stdout, /not_wired/);
});

test('CLI --decide wiki-style missing intent exits 2', () => {
  const cli = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'intent-scope-runtime.js'),
    '--decide',
    JSON.stringify({ identity: 'adapter:claude', allowedIntents: ['read_repo'] }),
  ], { encoding: 'utf8' });
  assert.equal(cli.status, 2, cli.stderr + cli.stdout);
  assert.match(cli.stdout, /missing_declared_intent/);
});

test('CLI --decide without payload exits 2 (not checkout allow)', () => {
  const cli = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'intent-scope-runtime.js'),
    '--decide',
  ], { encoding: 'utf8' });
  assert.equal(cli.status, 2, cli.stderr + cli.stdout);
  assert.match(cli.stdout, /missing_decide_payload/);
});

test('CLI --decide= empty payload exits 2', () => {
  const cli = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'intent-scope-runtime.js'),
    '--decide=',
  ], { encoding: 'utf8' });
  assert.equal(cli.status, 2, cli.stderr + cli.stdout);
  assert.match(cli.stdout, /missing_decide_payload/);
});

test('intent-scope-runtime stays checkout-only (script_not_in_pack_ok)', () => {
  const pkg = require('../package.json');
  const files = pkg.files || [];
  assert.equal(
    files.includes('scripts/intent-scope-runtime.js'),
    false,
    'do not pack this doctor; unique-file successor must not bump the npm bundle ratchet',
  );
  assert.equal(pkg.scripts['intent:scope'], 'node scripts/intent-scope-runtime.js');
});
