#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  getClaudePluginVersionedAssetName,
} = require('./distribution-surfaces');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_OUTPUT_DIR = path.join(PROJECT_ROOT, '.artifacts', 'claude-desktop');
const RUNTIME_COPY_PATHS = [
  'bin',
  'src',
  'scripts',
  'adapters',
  'config',
  'plugins',
  'skills',
  'openapi',
  'public',
  '.well-known',
  '.claude-plugin',
  'README.md',
  'LICENSE',
  'SECURITY.md',
  'server.json',
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8'));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

function copyEntry(relativePath, stageDir) {
  const sourcePath = path.join(PROJECT_ROOT, relativePath);
  if (!fs.existsSync(sourcePath)) return;

  const targetPath = path.join(stageDir, relativePath);
  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.cpSync(sourcePath, targetPath, { recursive: true });
    return;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function exec(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    ...options,
  });
}

function buildClaudeMcpbManifest() {
  const packageJson = readJson('package.json');
  const pluginManifest = readJson('.claude-plugin/plugin.json');
  const marketplace = readJson('.claude-plugin/marketplace.json');
  const { TOOLS } = require(path.join(PROJECT_ROOT, 'scripts', 'tool-registry'));

  const repositoryUrl = String(pluginManifest.repository || packageJson.repository.url).replace(/\.git$/, '');
  const privacyPolicyUrl = `${packageJson.homepage}/privacy`;
  const marketplaceEntry = marketplace.plugins[0];
  const readme = readText('.claude-plugin/README.md')
    .split('\n')
    .slice(0, 6)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    manifest_version: '0.3',
    name: pluginManifest.name,
    display_name: 'ThumbGate',
    version: packageJson.version,
    description: marketplaceEntry.description,
    long_description: readme,
    author: {
      name: pluginManifest.author.name,
      url: repositoryUrl,
    },
    repository: {
      type: 'git',
      url: repositoryUrl,
    },
    homepage: packageJson.homepage,
    documentation: `${repositoryUrl}/blob/main/docs/CLAUDE_DESKTOP_EXTENSION.md`,
    support: `${repositoryUrl}/issues`,
    icon: 'icon.png',
    server: {
      type: 'node',
      entry_point: 'server/index.js',
      mcp_config: {
        command: 'node',
        args: ['${__dirname}/server/index.js'],
        env: {},
      },
    },
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
    })),
    tools_generated: true,
    keywords: pluginManifest.keywords,
    license: packageJson.license,
    privacy_policies: [privacyPolicyUrl],
  };
}

function stageClaudeMcpbBundle(outputDir = DEFAULT_OUTPUT_DIR) {
  const packageJson = readJson('package.json');
  const stageDir = path.join(outputDir, 'bundle');
  const outputFile = path.join(outputDir, getClaudePluginVersionedAssetName(packageJson.version));

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(stageDir, 'server'), { recursive: true });

  for (const relativePath of RUNTIME_COPY_PATHS) {
    copyEntry(relativePath, stageDir);
  }

  copyEntry('package.json', stageDir);
  copyEntry('package-lock.json', stageDir);

  fs.writeFileSync(
    path.join(stageDir, 'server', 'index.js'),
    readText('.claude-plugin/bundle/server/index.js')
  );
  fs.writeFileSync(
    path.join(stageDir, 'icon.png'),
    fs.readFileSync(path.join(PROJECT_ROOT, '.claude-plugin', 'bundle', 'icon.png'))
  );
  fs.writeFileSync(
    path.join(stageDir, 'README.md'),
    readText('.claude-plugin/README.md')
  );
  fs.writeFileSync(
    path.join(stageDir, 'manifest.json'),
    JSON.stringify(buildClaudeMcpbManifest(), null, 2) + '\n'
  );

  return {
    stageDir,
    outputFile,
  };
}

function buildClaudeMcpb(outputDir = DEFAULT_OUTPUT_DIR) {
  const { stageDir, outputFile } = stageClaudeMcpbBundle(outputDir);

  exec('npm', ['ci', '--omit=dev'], { cwd: stageDir });
  exec('npx', ['-y', '@anthropic-ai/mcpb', 'pack', stageDir, outputFile], { cwd: PROJECT_ROOT });

  const info = execFileSync('npx', ['-y', '@anthropic-ai/mcpb', 'info', outputFile], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
  });

  process.stdout.write(info);

  return {
    stageDir,
    outputFile,
    info,
  };
}

if (require.main === module) {
  const outputDir = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : DEFAULT_OUTPUT_DIR;
  const { outputFile } = buildClaudeMcpb(outputDir);
  console.log(`Built Claude Desktop bundle: ${outputFile}`);
}

module.exports = {
  DEFAULT_OUTPUT_DIR,
  buildClaudeMcpbManifest,
  stageClaudeMcpbBundle,
  buildClaudeMcpb,
};
