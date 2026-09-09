'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  SCHEMA_VERSION,
  discoverObservedAdapters,
  evaluateChecklist,
  formatText,
  loadRegistry,
} = require('../scripts/ai-identity-checklist');

function tmpRoot(adapterNames) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-id-'));
  fs.mkdirSync(path.join(dir, 'adapters'));
  for (const name of adapterNames) {
    fs.mkdirSync(path.join(dir, 'adapters', name));
    fs.writeFileSync(path.join(dir, 'adapters', name, 'README.md'), `${name}\n`);
  }
  for (const rel of [
    'config/mcp-allowlists.json',
    'src/agent-identity-boundary.js',
    'scripts/gates-engine.js',
    'scripts/action-receipts.js',
    'scripts/session-lease.js',
    'scripts/mcp-oauth.js',
  ]) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), '{}\n');
  }
  return dir;
}

function writeRegistry(dir, agents, extras = {}) {
  const file = path.join(dir, 'registry.json');
  fs.writeFileSync(file, JSON.stringify({
    owner: extras.owner || 'Igor Ganapolsky',
    humanPrincipalId: extras.humanPrincipalId || 'igor-ganapolsky',
    agents,
  }));
  return file;
}

test('default checkout inventory has no shadow adapters and does not claim Okta live', () => {
  const report = evaluateChecklist();
  assert.equal(report.schemaVersion, SCHEMA_VERSION);
  assert.equal(report.affiliation, 'none');
  assert.equal(report.livePromotionAllowed, false);
  assert.equal(report.modeledNotMeasured, true);
  assert.equal(report.counts.shadow, 0, report.shadowAgents.join(','));
  assert.equal(report.decision, 'allow');
  assert.ok(report.weAreNot.includes('CIBA'));
  assert.equal(report.items.find((row) => row.id === 'ciba_rar').status, 'not_wired');
  assert.equal(report.items.find((row) => row.id === 'token_vaulting').status, 'not_wired');
  assert.equal(report.items.find((row) => row.id === 'universal_logout').status, 'not_wired');
  assert.equal(report.items.find((row) => row.id === 'hitl_sensitive_actions').status, 'mapped_not_ciba');
  assert.match(report.claimBoundary, /not a production identity winner/);
});

test('registry covers every discovered adapter directory', () => {
  const observed = discoverObservedAdapters(path.join(__dirname, '..'));
  const registry = loadRegistry(path.join(__dirname, '..', 'evals', 'ai-identity-checklist', 'registry.json'));
  const ids = new Set(registry.agents.map((agent) => agent.id));
  assert.ok(observed.length >= 20, `expected packaged adapters, got ${observed.length}`);
  assert.deepEqual(observed.filter((id) => !ids.has(id)), []);
});

test('unregistered observed adapter is shadow AI and denies', () => {
  const root = tmpRoot(['claude', 'codex']);
  const registryPath = writeRegistry(root, [
    { id: 'adapter:claude', purpose: 'Claude wiring' },
  ]);
  const report = evaluateChecklist({ root, registryPath });
  fs.rmSync(root, { recursive: true, force: true });
  assert.equal(report.decision, 'deny');
  assert.deepEqual(report.shadowAgents, ['adapter:codex']);
  assert.equal(report.items.find((row) => row.id === 'shadow_ai').status, 'fail');
});

test('missing owner or purpose fails closed', () => {
  const root = tmpRoot(['claude']);
  const report = evaluateChecklist({
    root,
    observedAgentIds: ['adapter:claude'],
    registry: {
      missing: false,
      agents: [{
        id: 'adapter:claude',
        owner: null,
        purpose: null,
        humanPrincipalId: null,
        lifecycleStatus: 'active',
      }],
    },
  });
  fs.rmSync(root, { recursive: true, force: true });
  assert.equal(report.decision, 'deny');
  assert.equal(report.items.find((row) => row.id === 'human_owner').status, 'fail');
  assert.equal(report.items.find((row) => row.id === 'documented_purpose').status, 'fail');
  assert.equal(report.items.find((row) => row.id === 'human_principal').status, 'fail');
});

test('empty adapter discovery fails closed instead of allowing', () => {
  const root = tmpRoot([]);
  const registryPath = writeRegistry(root, [
    {
      id: 'adapter:claude',
      owner: 'Igor Ganapolsky',
      purpose: 'Claude wiring',
      humanPrincipalId: 'igor-ganapolsky',
    },
  ]);
  const report = evaluateChecklist({ root, registryPath });
  fs.rmSync(root, { recursive: true, force: true });
  assert.equal(report.decision, 'deny');
  assert.equal(report.items.find((row) => row.id === 'human_owner').status, 'pass');
  assert.equal(report.items.find((row) => row.id === 'human_principal').status, 'pass');
  const shadow = report.items.find((row) => row.id === 'shadow_ai');
  assert.equal(shadow.status, 'fail');
  assert.match(shadow.detail, /inventory unavailable/i);
  assert.equal(shadow.inventoryUnavailable, true);
});

test('complete local inventory allows without becoming a live identity plane', () => {
  const root = tmpRoot(['claude']);
  const registryPath = writeRegistry(root, [
    { id: 'adapter:claude', purpose: 'Claude wiring' },
  ]);
  const report = evaluateChecklist({ root, registryPath });
  fs.rmSync(root, { recursive: true, force: true });
  assert.equal(report.decision, 'allow');
  assert.equal(report.livePromotionAllowed, false);
  assert.equal(report.counts.shadow, 0);
});

test('claimLive is refused while CIBA/vault/logout stay not_wired', () => {
  const report = evaluateChecklist({ claimLive: true });
  assert.equal(report.decision, 'deny');
  assert.equal(report.livePromotionAllowed, false);
  assert.ok(report.liveBlockedReasons.includes('claimLive_refused_without_ciba_vault_ud'));
  assert.ok(report.liveBlockedReasons.includes('not_wired:ciba_rar'));
  assert.match(report.claimBoundary, /cannot become a live identity control plane/);
});

test('CLI prints mapped-not-CIBA honesty and exits 0 on the default inventory', () => {
  const cli = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'ai-identity-checklist.js'),
  ], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /shadow=0/);
  assert.match(cli.stdout, /Not CIBA\/RAR/);
  assert.doesNotMatch(cli.stdout, /Okta for AI Agents is live/i);
  assert.doesNotMatch(cli.stdout, /CIBA is live/);
});

test('formatText never says the agents are first-class Okta identities', () => {
  const text = formatText(evaluateChecklist());
  assert.match(text, /affiliation=none/);
  assert.match(text, /not: Okta for AI Agents, Universal Directory/);
  assert.doesNotMatch(text, /Okta for AI Agents is live/i);
  assert.doesNotMatch(text, /CIBA is live/);
});
