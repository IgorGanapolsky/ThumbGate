'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  evaluateDeployProof,
  findDeployClaim,
  findDeployEvidence,
  loadDeployProofConfig,
} = require('../scripts/deploy-proof-gate');

const NO_HOSTS = { hosts: [], sentinels: [] };
const EMPTY_ENV = {};

test('blocks an unproven deploy claim', () => {
  const result = evaluateDeployProof('The fix is deployed and live at app.example.com.', { config: NO_HOSTS, env: EMPTY_ENV });
  assert.equal(result.decision, 'block');
  assert.equal(result.gate, 'deploy-proof');
  assert.match(result.reason, /deployed/);
});

test('allows the claim when curl output against production is in the reply', () => {
  const reply = 'Shipped. `curl -s https://app.example.com/health` returned {"status":"ok","version":"2.1.0"}';
  assert.equal(evaluateDeployProof(reply, { config: { hosts: ['app.example.com'], sentinels: [] }, env: EMPTY_ENV }), null);
  assert.equal(evaluateDeployProof(reply, { config: NO_HOSTS, env: EMPTY_ENV }), null);
});

test('allows the claim with a buildSha or HTTP 200 from the host', () => {
  assert.equal(evaluateDeployProof('Deployed, app.example.com/health buildSha: 9f3a2b1c', { config: NO_HOSTS, env: EMPTY_ENV }), null);
  assert.equal(evaluateDeployProof('Now live. HTTP/2 200 from app.example.com', { config: NO_HOSTS, env: EMPTY_ENV }), null);
});

test('with hosts configured, proof from another host does not count', () => {
  const config = { hosts: ['app.example.com'], sentinels: [] };
  const reply = 'Deployed. curl -s https://staging.other.dev/health → HTTP 200 from staging.other.dev';
  const result = evaluateDeployProof(reply, { config, env: EMPTY_ENV });
  assert.equal(result.decision, 'block');
  assert.match(result.reason, /app\.example\.com/);
  // Health JSON and buildSha from another host do not count either.
  const staging = 'Deployed. curl https://staging.other.dev/health returned {"status":"ok","version":"2.1.0","buildSha":"9f3a2b1c"}';
  assert.equal(evaluateDeployProof(staging, { config, env: EMPTY_ENV }).decision, 'block');
  assert.equal(evaluateDeployProof('Deployed. curl -sI https://app.example.com → HTTP/2 200', { config, env: EMPTY_ENV }), null);
});

test('a curl command without a successful result is not proof', () => {
  for (const reply of [
    'Deployed. Run curl -s https://app.example.com/health to confirm.',
    'Deployed. curl https://app.example.com/health failed: connection refused.',
    'Deployed. curl -sI https://app.example.com → HTTP/2 502',
    'Deployed. curl https://app.example.com/health → {"status":"error","version":"2.1.0"}',
  ]) {
    assert.equal(evaluateDeployProof(reply, { config: NO_HOSTS, env: EMPTY_ENV }).decision, 'block', reply);
  }
});

test('deploys to staging or preview are not production claims', () => {
  assert.equal(findDeployClaim('The fix is deployed to staging, not production.'), null);
  assert.equal(findDeployClaim('Deployed on the preview environment for review.'), null);
  assert.equal(findDeployClaim('Deployed to production.'), 'Deployed');
});

test('a configured CI sentinel counts as proof', () => {
  const config = { hosts: [], sentinels: ['Deploy verified'] };
  assert.equal(evaluateDeployProof('Shipped. CI says: Deploy verified for 4f2c.', { config, env: EMPTY_ENV }), null);
});

test('negated, hypothetical and question mentions are not claims', () => {
  for (const text of [
    'It is not deployed yet.',
    'This has never shipped.',
    'Once it is deployed, run the smoke test.',
    'It will be live after the Railway rebuild.',
    'Is it live in production?',
    'Do not say deployed without proof.',
  ]) {
    assert.equal(findDeployClaim(text), null, text);
  }
  assert.equal(findDeployClaim('PR #12 merged and deployed.'), 'deployed');
});

test('THUMBGATE_DEPLOY_PROOF_GATE=0 turns the gate off', () => {
  const result = evaluateDeployProof('Deployed.', { config: NO_HOSTS, env: { THUMBGATE_DEPLOY_PROOF_GATE: '0' } });
  assert.equal(result, null);
});

test('loads hosts and sentinels from .thumbgate/deploy-proof.json and env', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-proof-'));
  fs.mkdirSync(path.join(dir, '.thumbgate'));
  fs.writeFileSync(path.join(dir, '.thumbgate', 'deploy-proof.json'), JSON.stringify({
    hosts: ['App.Example.com'],
    sentinels: ['Deploy verified'],
  }));
  const config = loadDeployProofConfig({ cwd: dir, env: { THUMBGATE_PROD_HOSTS: 'api.example.com, app.example.com' } });
  assert.deepEqual(config.hosts, ['app.example.com', 'api.example.com']);
  assert.deepEqual(config.sentinels, ['Deploy verified']);
  assert.deepEqual(findDeployEvidence('curl -sI https://api.example.com/health → HTTP/2 200', config), ['http-200']);
  assert.deepEqual(findDeployEvidence('curl -sI https://api.example.com/health', config), []);
});

test('shipped Stop hook (claim-stop-check) blocks once, then yields on retry', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-proof-hook-'));
  const cli = path.join(__dirname, '..', 'bin', 'cli.js');
  const env = { ...process.env, THUMBGATE_DEPLOY_PROOF_GATE: '1' };
  delete env.THUMBGATE_CLAIM_VERIFIERS_PATH;
  delete env.CLAUDE_TRANSCRIPT_PATH;
  delete env.CLAUDE_RESPONSE;
  const payload = { cwd: dir, last_assistant_message: 'The login fix is deployed.' };

  const first = spawnSync(process.execPath, [cli, 'claim-stop-check'], { input: JSON.stringify(payload), env, encoding: 'utf8' });
  assert.equal(first.status, 0);
  const decision = JSON.parse(first.stdout.trim());
  assert.equal(decision.decision, 'block');
  assert.equal(decision.gate, 'deploy-proof');

  const retry = spawnSync(process.execPath, [cli, 'claim-stop-check'], {
    input: JSON.stringify({ ...payload, stop_hook_active: true }), env, encoding: 'utf8',
  });
  assert.equal(retry.status, 0);
  assert.equal(retry.stdout.trim(), '');
});
