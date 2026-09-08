'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const {
  classifyTrustHandoffPath,
  buildAllowlistBridgeHonestyReport,
  SOURCE_URL,
} = require('../scripts/allowlist-bridge-honesty');
const egress = require('../scripts/agent-egress-policy');
const { buildNetworkPolicy } = require('../scripts/docker-sandbox-planner');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'allowlist-bridge-honesty.js');
const CLI = path.join(ROOT, 'bin', 'cli.js');

test('npm registry and Hugging Face are bridge hops, not trust boundaries', () => {
  assert.equal(egress.classifyHostRole('registry.npmjs.org').role, 'bridge');
  assert.equal(egress.classifyHostRole('registry.npmjs.org').trusted, false);
  assert.equal(egress.classifyHostRole('huggingface.co').role, 'bridge');
  assert.equal(egress.classifyHostRole('cas-bridge.huggingface.co').role, 'bridge');
  assert.equal(egress.classifyHostRole('verdaccio.internal.example').role, 'bridge');
  assert.equal(egress.classifyHostRole('api.github.com').role, 'public');
});

test('allowlisted npm GET is STATIC_ALLOW_BRIDGE; Authorization fails closed', () => {
  const policy = { allowHosts: ['registry.npmjs.org'] };
  const allowed = egress.evaluateEgressStaticOnly(
    { url: 'https://registry.npmjs.org/thumbgate' },
    policy
  );
  assert.equal(allowed.action, 'allow');
  assert.equal(allowed.judgmentType, 'STATIC_ALLOW_BRIDGE');
  assert.equal(allowed.trusted, false);

  const denied = egress.evaluateEgressStaticOnly(
    {
      url: 'https://registry.npmjs.org/thumbgate',
      headers: { Authorization: 'Bearer not-a-live-secret' },
    },
    policy
  );
  assert.equal(denied.action, 'deny');
  assert.equal(denied.judgmentType, 'ALLOWLIST_BRIDGE_CREDENTIAL');
});

test('observe-mode does not promote package-proxy traffic onto allowHosts', () => {
  const drafted = egress.draftPolicyFromObservations([
    { host: 'api.github.com', agentId: 'default' },
    { host: 'api.github.com', agentId: 'default' },
    { host: 'registry.npmjs.org', agentId: 'default' },
    { host: 'registry.npmjs.org', agentId: 'default' },
    { host: 'package-proxy.example', agentId: 'default' },
    { host: 'package-proxy.example', agentId: 'default' },
  ], { agentId: 'default' });
  assert.ok(drafted.allowHosts.includes('api.github.com'));
  assert.ok(!drafted.allowHosts.includes('registry.npmjs.org'));
  assert.ok(!drafted.allowHosts.includes('package-proxy.example'));
  assert.ok(drafted.bridgeHosts.includes('registry.npmjs.org'));
  assert.ok(drafted.bridgeHosts.includes('package-proxy.example'));
});

test('trust-handoff paths are not sandbox-contained', () => {
  const hook = classifyTrustHandoffPath('.github/workflows/ci.yml');
  assert.equal(hook.handoff, true);
  assert.equal(hook.contained, false);
  const readme = classifyTrustHandoffPath('README.md');
  assert.equal(readme.handoff, false);
});

test('doctor fails when allowlist is treated as a trust boundary', () => {
  const report = buildAllowlistBridgeHonestyReport({
    allowHosts: ['registry.npmjs.org'],
    treatAllowlistAsTrustBoundary: true,
  });
  assert.equal(report.status, 'fail');
  assert.equal(report.allowlistIsTrustBoundary, false);
  assert.ok(report.findings.some((f) => f.id === 'allowlist_treated_as_trust_boundary'));
});

test('doctor refuses GitLab Duo SKU clone', () => {
  const report = buildAllowlistBridgeHonestyReport({ cloneGitLabDuo: true });
  assert.equal(report.status, 'fail');
  assert.equal(report.clonedGitLabDuo, false);
  assert.ok(report.findings.some((f) => f.id === 'refuse_sku_clone'));
});

test('doctor fails claimed-contained writes to privileged consumers', () => {
  const report = buildAllowlistBridgeHonestyReport({
    writes: ['.mcp.json', 'config/gates/default.json'],
    claimedContained: true,
  });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'trust_handoff_claimed_contained'));
});

test('live deny-network-egress allowlist classifies npm as a bridge hop and stays ready', () => {
  const report = buildAllowlistBridgeHonestyReport({ root: ROOT });
  assert.equal(report.ok, true);
  assert.ok(report.metrics.denyNetworkEgressGate);
  assert.ok(report.classifiedHosts.some((row) => row.host === 'registry.npmjs.org' && row.role === 'bridge'));
  assert.match(SOURCE_URL, /gitlab-ai-sandbox-access/);
});

test('CLI script --json exits 0 on this repo', () => {
  const result = spawnSync(process.execPath, [SCRIPT, `--root=${ROOT}`, '--json'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.name, 'thumbgate-allowlist-bridge-honesty');
  assert.equal(payload.allowlistIsTrustBoundary, false);
});

test('thumbgate CLI allowlist-bridge-honesty is wired', () => {
  const result = spawnSync(process.execPath, [
    CLI,
    'allowlist-bridge-honesty',
    `--root=${ROOT}`,
    '--json',
  ], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.name, 'thumbgate-allowlist-bridge-honesty');
});

test('docker sandbox network policy does not treat allowlist as trust', () => {
  const policy = buildNetworkPolicy({
    requiresNetwork: true,
    allowedHosts: ['registry.npmjs.org', 'api.github.com'],
  });
  assert.equal(policy.allowlistIsTrustBoundary, false);
  assert.ok(policy.bridgeHosts.includes('registry.npmjs.org'));
});
