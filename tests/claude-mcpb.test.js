const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const packageJson = require('../package.json');
const { TOOLS } = require('../scripts/tool-registry');
const {
  getClaudePluginChannelAssetName,
  getClaudePluginLatestDownloadUrl,
  CLAUDE_PLUGIN_REVIEW_NEXT_ASSET_NAME,
  getCodexPluginChannelAssetName,
  getCodexPluginLatestDownloadUrl,
  getCodexPluginVersionedAssetName,
  getCodexPluginVersionedDownloadUrl,
  getPackageVersion,
  getClaudePluginReviewChannelAssetName,
  getClaudePluginReviewLatestDownloadUrl,
  getClaudePluginReviewVersionedAssetName,
  getClaudePluginReviewVersionedDownloadUrl,
  getClaudePluginVersionedDownloadUrl,
  getRepositoryUrl,
  getClaudePluginVersionedAssetName,
} = require('../scripts/distribution-surfaces');
const {
  buildClaudeMcpbManifest,
  buildClaudeReviewZip,
  resolveBuildRequest,
  runBuildRequest,
  stageClaudeMcpbBundle,
} = require('../scripts/build-claude-mcpb');

test('claude mcpb manifest stays aligned with the package metadata and tool registry', () => {
  const manifest = buildClaudeMcpbManifest();

  assert.equal(manifest.manifest_version, '0.3');
  assert.equal(manifest.name, 'thumbgate');
  assert.equal(manifest.display_name, 'ThumbGate');
  assert.equal(manifest.version, packageJson.version);
  assert.match(manifest.description, /Claude Desktop|workflow hardening|Pre-Action Checks/i);
  assert.match(manifest.documentation, /docs\/CLAUDE_DESKTOP_EXTENSION\.md$/);
  assert.match(manifest.support, /\/issues$/);
  assert.deepEqual(manifest.privacy_policies, [`${packageJson.homepage}/privacy`]);
  assert.equal(manifest.server.type, 'node');
  assert.equal(manifest.server.entry_point, 'server/index.js');
  assert.deepEqual(manifest.server.mcp_config.args, ['${__dirname}/server/index.js']);
  assert.equal(manifest.tools_generated, true);
  assert.match(manifest.long_description, /up to 8 prior recorded entries/i);
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
    assert.equal(path.basename(outputFile), getClaudePluginVersionedAssetName(packageJson.version));

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const readme = fs.readFileSync(readmePath, 'utf8');
    const launcher = fs.readFileSync(launcherPath, 'utf8');

    assert.equal(manifest.version, packageJson.version);
    assert.equal(manifest.icon, 'icon.png');
    assert.match(readme, /History-aware lesson distillation/i);
    assert.match(readme, /up to 8 prior recorded entries/i);
    assert.match(readme, /60-second follow-up/i);
    assert.match(readme, /relatedFeedbackId/);
    assert.match(readme, /Privacy Policy/i);
    assert.match(readme, /Data Collection/i);
    assert.match(readme, /build:claude-mcpb/i);
    assert.match(launcher, /cliPath = path\.join/);
    assert.match(launcher, /serve/);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('claude review zip staging writes a review-ready packet and zip', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-review-stage-'));

  try {
    const { stageDir, outputFile } = buildClaudeReviewZip(outputDir);

    assert.equal(fs.existsSync(path.join(stageDir, '.claude-plugin', 'plugin.json')), true);
    assert.equal(fs.existsSync(path.join(stageDir, 'docs', 'CLAUDE_DESKTOP_EXTENSION.md')), true);
    assert.equal(fs.existsSync(path.join(stageDir, 'README.md')), true);
    assert.equal(fs.existsSync(path.join(stageDir, 'LICENSE')), true);
    assert.equal(fs.existsSync(path.join(stageDir, 'server.json')), true);
    assert.equal(fs.existsSync(outputFile), true);
    assert.equal(path.basename(outputFile), getClaudePluginReviewVersionedAssetName(packageJson.version));
    assert.ok(fs.statSync(outputFile).size > 0);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('review zip distribution surfaces stay canonical for stable and prerelease channels', () => {
  const repoRoot = path.join(__dirname, '..');

  assert.equal(getPackageVersion(repoRoot), packageJson.version);
  assert.equal(getRepositoryUrl(repoRoot), 'https://github.com/IgorGanapolsky/ThumbGate');
  assert.equal(getClaudePluginChannelAssetName('1.2.3'), 'thumbgate-claude-desktop.mcpb');
  assert.equal(getClaudePluginChannelAssetName('1.2.3-beta.1'), 'thumbgate-claude-desktop-next.mcpb');
  assert.equal(
    getClaudePluginReviewVersionedAssetName('1.2.3'),
    'thumbgate-claude-plugin-review-v1.2.3.zip'
  );
  assert.equal(
    getClaudePluginReviewChannelAssetName('1.2.3'),
    'thumbgate-claude-plugin-review.zip'
  );
  assert.equal(
    getClaudePluginReviewChannelAssetName('1.2.3-beta.1'),
    CLAUDE_PLUGIN_REVIEW_NEXT_ASSET_NAME
  );
  assert.match(
    getClaudePluginLatestDownloadUrl(repoRoot),
    /releases\/latest\/download\/thumbgate-claude-desktop\.mcpb$/
  );
  assert.match(
    getClaudePluginVersionedDownloadUrl(repoRoot, '1.2.3'),
    /releases\/download\/v1\.2\.3\/thumbgate-claude-desktop-v1\.2\.3\.mcpb$/
  );
  assert.match(
    getClaudePluginReviewLatestDownloadUrl(repoRoot),
    /releases\/latest\/download\/thumbgate-claude-plugin-review\.zip$/
  );
  assert.match(
    getClaudePluginReviewVersionedDownloadUrl(repoRoot, '1.2.3'),
    /releases\/download\/v1\.2\.3\/thumbgate-claude-plugin-review-v1\.2\.3\.zip$/
  );
  assert.equal(getCodexPluginVersionedAssetName('1.2.3'), 'thumbgate-codex-plugin-v1.2.3.zip');
  assert.equal(getCodexPluginChannelAssetName('1.2.3'), 'thumbgate-codex-plugin.zip');
  assert.equal(getCodexPluginChannelAssetName('1.2.3-beta.1'), 'thumbgate-codex-plugin-next.zip');
  assert.match(
    getCodexPluginLatestDownloadUrl(repoRoot),
    /releases\/latest\/download\/thumbgate-codex-plugin\.zip$/
  );
  assert.match(
    getCodexPluginVersionedDownloadUrl(repoRoot, '1.2.3'),
    /releases\/download\/v1\.2\.3\/thumbgate-codex-plugin-v1\.2\.3\.zip$/
  );
});

test('build request helpers route Claude bundle modes without invoking packaging in tests', () => {
  const stableRequest = resolveBuildRequest([], '/tmp/thumbgate');
  const reviewRequest = resolveBuildRequest(['--review-zip', 'dist/review'], '/tmp/thumbgate');
  const allRequest = resolveBuildRequest(['--all'], '/tmp/thumbgate');
  const calls = [];
  const deps = {
    buildClaudeMcpb(outputDir) {
      calls.push(['mcpb', outputDir]);
      return { outputFile: path.join(outputDir, 'bundle.mcpb') };
    },
    buildClaudeReviewZip(outputDir) {
      calls.push(['review', outputDir]);
      return { outputFile: path.join(outputDir, 'review.zip') };
    },
  };

  assert.deepEqual(stableRequest, {
    mode: 'mcpb',
    outputDir: path.join(__dirname, '..', '.artifacts', 'claude-desktop'),
  });
  assert.deepEqual(reviewRequest, {
    mode: 'review-zip',
    outputDir: path.resolve('/tmp/thumbgate', 'dist/review'),
  });
  assert.deepEqual(allRequest, {
    mode: 'all',
    outputDir: path.join(__dirname, '..', '.artifacts', 'claude-desktop'),
  });

  assert.deepEqual(runBuildRequest(stableRequest, deps), [
    `Built Claude Desktop bundle: ${path.join(stableRequest.outputDir, 'bundle.mcpb')}`,
  ]);
  assert.deepEqual(runBuildRequest(reviewRequest, deps), [
    `Built Claude plugin review zip: ${path.resolve('/tmp/thumbgate', 'dist/review', 'review.zip')}`,
  ]);
  assert.deepEqual(runBuildRequest(allRequest, deps), [
    `Built Claude Desktop bundle: ${path.join(allRequest.outputDir, 'bundle.mcpb')}`,
    `Built Claude plugin review zip: ${path.join(allRequest.outputDir, 'review.zip')}`,
  ]);
  assert.deepEqual(calls, [
    ['mcpb', stableRequest.outputDir],
    ['review', reviewRequest.outputDir],
    ['mcpb', allRequest.outputDir],
    ['review', allRequest.outputDir],
  ]);
});

test('claude desktop submission doc covers history-aware lesson distillation', () => {
  const extensionDoc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'CLAUDE_DESKTOP_EXTENSION.md'), 'utf8');

  assert.match(extensionDoc, /history-aware lesson distillation/i);
  assert.match(extensionDoc, /chatHistory/);
  assert.match(extensionDoc, /relatedFeedbackId/);
  assert.match(extensionDoc, /up to 8 prior recorded entries/i);
  assert.match(extensionDoc, /60-second follow-up/i);
});
