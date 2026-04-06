const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  collectBootstrapFiles,
  summarizePermissionTier,
  generateAgentReadinessReport,
} = require('../scripts/agent-readiness');

test('collectBootstrapFiles reports missing required context files', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-bootstrap-missing-'));
  fs.writeFileSync(path.join(projectRoot, 'AGENTS.md'), '# Agents\n');

  const readiness = collectBootstrapFiles(projectRoot);

  assert.equal(readiness.ready, false);
  assert.equal(readiness.requiredPresent, 1);
  assert.deepEqual(readiness.missingRequired.sort(), ['.mcp.json', 'CLAUDE.md', 'GEMINI.md']);

  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test('summarizePermissionTier exposes write-capable default profile', () => {
  const summary = summarizePermissionTier('default');

  assert.equal(summary.profile, 'default');
  assert.equal(summary.tier, 'builder');
  assert.equal(summary.writeCapable, true);
  assert.ok(summary.writeCapableTools.includes('construct_context_pack'));
});

test('summarizePermissionTier warns when locked profile is too restrictive', () => {
  const summary = summarizePermissionTier('locked');

  assert.equal(summary.profile, 'locked');
  assert.equal(summary.ready, false);
  assert.equal(summary.writeCapable, false);
});

test('summarizePermissionTier exposes dispatch as a safe remote ops tier', () => {
  const summary = summarizePermissionTier('dispatch');

  assert.equal(summary.profile, 'dispatch');
  assert.equal(summary.tier, 'dispatch');
  assert.equal(summary.ready, true);
  assert.equal(summary.writeCapable, false);
  assert.ok(summary.allowedTools.includes('dashboard'));
  assert.ok(summary.allowedTools.includes('get_business_metrics'));
  assert.ok(!summary.allowedTools.includes('start_handoff'));
});

test('generateAgentReadinessReport aligns bootstrap and permission findings', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-bootstrap-ready-'));
  for (const fileName of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) {
    fs.writeFileSync(path.join(projectRoot, fileName), `# ${fileName}\n`);
  }
  fs.writeFileSync(path.join(projectRoot, '.mcp.json'), JSON.stringify({ mcpServers: {} }, null, 2));
  fs.mkdirSync(path.join(projectRoot, '.thumbgate'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.thumbgate', 'config.json'), JSON.stringify({ version: 1 }, null, 2));

  const previousContainer = process.env.container;
  process.env.container = '1';
  const report = generateAgentReadinessReport({
    projectRoot,
    mcpProfile: 'default',
  });
  if (previousContainer === undefined) delete process.env.container;
  else process.env.container = previousContainer;

  assert.equal(report.bootstrap.ready, true);
  assert.equal(report.permissions.profile, 'default');
  assert.equal(report.articleAlignment.contextConditioning, true);
  assert.equal(report.articleAlignment.permissionEnvelope, true);
  assert.equal(report.articleAlignment.runtimeIsolation, true);
  assert.equal(report.overallStatus, 'ready');

  fs.rmSync(projectRoot, { recursive: true, force: true });
});
