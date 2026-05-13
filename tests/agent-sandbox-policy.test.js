const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSandboxManifest,
  evaluateHarnessComputeSeparation,
  buildSmitheryUplinkPlan,
} = require('../scripts/agent-sandbox-policy');

test('sandbox manifest blocks read-write credential mounts', () => {
  const manifest = buildSandboxManifest({
    provider: 'e2b',
    mounts: [{ name: 'secrets', source: '.env', mode: 'readwrite' }],
  });
  assert.equal(manifest.ok, false);
  assert.match(manifest.issues.join('\n'), /credential/);
});

test('harness compute separation requires external state and checkpointing', () => {
  const result = evaluateHarnessComputeSeparation({
    credentialsInSandbox: true,
    externalizedState: false,
    snapshotting: false,
    subagentCount: 2,
    isolatedSubagentSandboxes: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.issues.length, 4);
});

test('Smithery uplink plan treats remote local tools as gated production tools', () => {
  const plan = buildSmitheryUplinkPlan({
    localServers: [{ id: 'chrome', url: 'http://localhost:9090/mcp', remoteExposure: true }],
  });
  assert.match(plan.servers[0].addCommand, /smithery mcp add/);
  assert.ok(plan.servers[0].requiredGuards.some((guard) => guard.includes('human approval')));
});
