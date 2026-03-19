const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const packageJson = require('../package.json');
const { TOOLS } = require('../scripts/tool-registry');
const {
  buildClaudeMcpbManifest,
  stageClaudeMcpbBundle,
} = require('../scripts/build-claude-mcpb');

test('claude mcpb manifest stays aligned with the package metadata and tool registry', () => {
  const manifest = buildClaudeMcpbManifest();

  assert.equal(manifest.manifest_version, '0.3');
  assert.equal(manifest.name, 'mcp-memory-gateway');
  assert.equal(manifest.display_name, 'MCP Memory Gateway');
  assert.equal(manifest.version, packageJson.version);
  assert.match(manifest.description, /Claude Desktop|workflow hardening|Pre-Action Gates/i);
  assert.match(manifest.documentation, /docs\/CLAUDE_DESKTOP_EXTENSION\.md$/);
  assert.match(manifest.support, /\/issues$/);
  assert.deepEqual(manifest.privacy_policies, [`${packageJson.homepage}/privacy`]);
  assert.equal(manifest.server.type, 'node');
  assert.equal(manifest.server.entry_point, 'server/index.js');
  assert.deepEqual(manifest.server.mcp_config.args, ['${__dirname}/server/index.js']);
  assert.equal(manifest.tools_generated, true);
  assert.deepEqual(
    manifest.tools.map((tool) => tool.name),
    TOOLS.map((tool) => tool.name)
  );
});

test('claude mcpb staging writes a submission-ready bundle directory', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-mcpb-stage-'));

  try {
    const { stageDir, outputFile } = stageClaudeMcpbBundle(outputDir);
    const manifestPath = path.join(stageDir, 'manifest.json');
    const readmePath = path.join(stageDir, 'README.md');
    const launcherPath = path.join(stageDir, 'server', 'index.js');
    const iconPath = path.join(stageDir, 'icon.png');

    assert.equal(fs.existsSync(manifestPath), true);
    assert.equal(fs.existsSync(readmePath), true);
    assert.equal(fs.existsSync(launcherPath), true);
    assert.equal(fs.existsSync(iconPath), true);
    assert.equal(fs.existsSync(outputFile), false);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const readme = fs.readFileSync(readmePath, 'utf8');
    const launcher = fs.readFileSync(launcherPath, 'utf8');

    assert.equal(manifest.version, packageJson.version);
    assert.equal(manifest.icon, 'icon.png');
    assert.match(readme, /Privacy Policy/i);
    assert.match(readme, /Data Collection/i);
    assert.match(readme, /build:claude-mcpb/i);
    assert.match(launcher, /cliPath = path\.join/);
    assert.match(launcher, /serve/);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});
