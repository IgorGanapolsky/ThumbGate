
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

test('GTC 2026: NVIDIA Governance Layers are present', () => {
  const gatesConfig = JSON.parse(fs.readFileSync('config/gates/default.json', 'utf8'));
  const layers = gatesConfig.gates.map(g => g.layer);
  
  assert.ok(layers.includes('Identity'), 'Identity layer missing');
  assert.ok(layers.includes('Decisions'), 'Decisions layer missing');
  assert.ok(layers.includes('Execution'), 'Execution layer missing');
  assert.ok(layers.includes('Supply Chain'), 'Supply Chain layer missing');
  assert.ok(layers.includes('Cloud'), 'Cloud layer missing');
});

test('GTC 2026: Credit-Based Billing ($49 Pack) is live', () => {
  const { CONFIG } = require('../scripts/billing');
  const pack = CONFIG.CREDIT_PACKS['mistake-free-starter'];
  
  assert.ok(pack, 'Starter pack missing');
  assert.equal(pack.amountCents, 4900, 'Price must be $49');
  assert.equal(pack.credits, 500, 'Must have 500 credits');
});

test('GTC 2026: Anti-Amnesia Primer is valid', () => {
  const primer = fs.readFileSync('primer.md', 'utf8');
  assert.match(primer, /\$100\/day after-tax profit/, 'North Star missing');
  assert.match(primer, /## Obsidian Recall Status/, 'Obsidian status missing');
  assert.match(primer, /## Live Operational Loops/, 'Loops section missing');
});

test('GTC 2026: Agent-Native CLI returns JSON', () => {
  const output = execSync('node bin/cli.js cfo --json', { encoding: 'utf8' });
  const json = JSON.parse(output);
  assert.ok(json.summary, 'CLI must return valid JSON summary');
});

test('GTC 2026: Azure Fabric Enterprise Bridge is functional', () => {
  const { syncToFabric } = require('../scripts/fabric-sync');
  const artifactPath = syncToFabric();
  assert.ok(fs.existsSync(artifactPath), 'Fabric artifact not created');
  
  const data = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.ok(Array.isArray(data), 'Fabric data must be an array');
  assert.ok(data[0].fabric_ontology_match, 'Fabric ontology mapping missing');
});

test('GTC 2026: Structured Obsidian Sync (Layer 5) logic', () => {
  const mockVault = path.join(process.cwd(), 'test-vault-gsd');
  if (fs.existsSync(mockVault)) fs.rmSync(mockVault, { recursive: true });
  fs.mkdirSync(mockVault);
  
  process.env.RLHF_OBSIDIAN_VAULT_PATH = mockVault;
  execSync('bash bin/obsidian-sync.sh');
  
  // Script uses PROJECT_NAME=$(basename "$(pwd)")
  const projectName = path.basename(process.cwd());
  const projectDir = path.join(mockVault, 'AI-Memories', projectName);
  
  if (!fs.existsSync(path.join(projectDir, 'Decisions'))) {
    console.log('DEBUG: Vault Root:', mockVault);
    console.log('DEBUG: Expected Project Dir:', projectDir);
    console.log('DEBUG: Actual contents of mock vault:', execSync(`find ${mockVault}`, { encoding: 'utf8' }));
  }

  assert.ok(fs.existsSync(path.join(projectDir, 'Decisions')), 'Decisions folder missing');
  assert.ok(fs.existsSync(path.join(projectDir, 'Growth')), 'Growth folder missing');
  
  fs.rmSync(mockVault, { recursive: true });
});
