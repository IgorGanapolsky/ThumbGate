'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

test('VS Code extension registers ThumbGate MCP provider and conversion commands', () => {
  const manifest = readJson('plugins/vscode-extension/package.json');
  const extension = fs.readFileSync(path.join(root, 'plugins/vscode-extension/src/extension.js'), 'utf8');
  const readme = fs.readFileSync(path.join(root, 'plugins/vscode-extension/README.md'), 'utf8');
  const licensePath = path.join(root, 'plugins/vscode-extension/LICENSE');

  assert.equal(manifest.name, 'thumbgate');
  assert.equal(manifest.displayName, 'ThumbGate');
  assert.equal(manifest.publisher, 'igorganapolsky');
  assert.equal(manifest.main, './src/extension.js');
  assert.equal(manifest.contributes.mcpServerDefinitionProviders[0].id, 'thumbgate');
  assert.deepEqual(
    manifest.contributes.commands.map((command) => command.command),
    [
      'thumbgate.initWorkspace',
      'thumbgate.openDashboard',
      'thumbgate.capturePositive',
      'thumbgate.captureNegative',
      'thumbgate.showStats',
      'thumbgate.upgradePro',
    ],
  );
  assert.match(extension, /registerMcpServerDefinitionProvider/);
  assert.match(extension, /McpStdioServerDefinition/);
  assert.match(extension, /thumbgate@latest/);
  assert.match(extension, /writeWorkspaceMcpConfig/);
  assert.doesNotMatch(extension, /--agent', 'vscode/);
  assert.match(readme, /Open VSX/i);
  assert.match(readme, /Antigravity/i);
  assert.match(readme, /Do not claim Marketplace installs/i);
  assert.ok(fs.existsSync(licensePath));
});

test('VS Code workspace MCP writer creates the official .vscode/mcp.json shape', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-vscode-mcp-'));
  const extensionPath = path.join(root, 'plugins/vscode-extension/src/extension.js');
  const vscodeStub = {
    workspace: {},
    window: {},
    commands: {},
    env: {},
    Uri: { parse(value) { return value; } },
  };
  const Module = require('node:module');
  const originalLoad = Module._load;

  try {
    Module._load = function patchedLoad(request, parent, isMain) {
      if (request === 'vscode') return vscodeStub;
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[extensionPath];
    const extension = require(extensionPath);
    const writtenPath = extension.writeWorkspaceMcpConfig(path.join(tmp, '.vscode', 'mcp.json'));
    const mcp = JSON.parse(fs.readFileSync(writtenPath, 'utf8'));

    assert.deepEqual(mcp, {
      servers: {
        thumbgate: {
          command: 'npx',
          args: ['--yes', '--package', 'thumbgate@latest', 'thumbgate', 'serve'],
        },
      },
    });
  } finally {
    Module._load = originalLoad;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Antigravity install path is VSIX/Open VSX-compatible without overclaiming marketplace status', () => {
  const install = fs.readFileSync(path.join(root, 'plugins/antigravity-extension/INSTALL.md'), 'utf8');

  assert.match(install, /VS Code-compatible/i);
  assert.match(install, /Open VSX/i);
  assert.match(install, /direct VSIX/i);
  assert.match(install, /Do not say: "Published in the Antigravity Marketplace"/);
  assert.match(install, /thumbgate@latest/);
});

test('JetBrains scaffold points to the same ThumbGate runtime and Marketplace path', () => {
  const build = fs.readFileSync(path.join(root, 'plugins/jetbrains-plugin/build.gradle.kts'), 'utf8');
  const settings = fs.readFileSync(path.join(root, 'plugins/jetbrains-plugin/settings.gradle.kts'), 'utf8');
  const pluginXml = fs.readFileSync(path.join(root, 'plugins/jetbrains-plugin/src/main/resources/META-INF/plugin.xml'), 'utf8');
  const actions = fs.readFileSync(path.join(root, 'plugins/jetbrains-plugin/src/main/kotlin/ai/thumbgate/jetbrains/ThumbGateActions.kt'), 'utf8');
  const readme = fs.readFileSync(path.join(root, 'plugins/jetbrains-plugin/README.md'), 'utf8');

  assert.match(build, /org\.jetbrains\.intellij\.platform/);
  assert.match(build, /org\.jetbrains\.kotlin\.jvm"\) version "2\.3\.0"/);
  assert.doesNotMatch(build, /org\.jetbrains\.intellij\.platform"\) version/);
  assert.match(settings, /org\.jetbrains\.intellij\.platform\.settings/);
  assert.match(settings, /version "2\.16\.0"/);
  assert.match(settings, /defaultRepositories\(\)/);
  assert.match(build, /intellijIdeaCommunity/);
  assert.match(pluginXml, /ai\.thumbgate\.jetbrains/);
  assert.match(pluginXml, /ThumbGate: Init Project/);
  assert.match(actions, /thumbgate@latest/);
  assert.match(actions, /\.mcp\.json/);
  assert.match(readme, /JetBrains Marketplace/);
  assert.match(readme, /Do not claim installs/);
});

test('README and distribution docs promote IDE marketplaces without claiming publication', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const distribution = fs.readFileSync(path.join(root, 'docs/PLUGIN_DISTRIBUTION.md'), 'utf8');
  const ideDistribution = fs.readFileSync(path.join(root, 'docs/IDE_MARKETPLACE_DISTRIBUTION.md'), 'utf8');

  assert.match(readme, /VS Code \/ Open VSX/);
  assert.match(readme, /JetBrains/);
  assert.match(readme, /Antigravity-compatible/);
  assert.match(distribution, /VS Code \/ Open VSX/);
  assert.match(distribution, /JetBrains Marketplace/);
  assert.match(distribution, /Antigravity/);
  assert.match(ideDistribution, /Status: implementation-ready, not yet proof of marketplace publication/);
});
