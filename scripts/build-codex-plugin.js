#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  getCodexPluginVersionedAssetName,
} = require('./distribution-surfaces');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_OUTPUT_DIR = path.join(PROJECT_ROOT, '.artifacts', 'codex-plugin');
const BUNDLE_ROOT_NAME = 'thumbgate-codex-plugin';
const FIXED_BINARY_DIRS = ['/usr/bin', '/bin'];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8'));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

function copyEntry(sourceRelativePath, targetRelativePath, stageDir) {
  const sourcePath = path.join(PROJECT_ROOT, sourceRelativePath);
  if (!fs.existsSync(sourcePath)) return;

  const targetPath = path.join(stageDir, targetRelativePath || sourceRelativePath);
  const stat = fs.statSync(sourcePath);

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (stat.isDirectory()) {
    fs.cpSync(sourcePath, targetPath, { recursive: true });
    return;
  }

  fs.copyFileSync(sourcePath, targetPath);
}

function buildStandaloneMarketplace() {
  const marketplace = readJson('.agents/plugins/marketplace.json');
  return {
    ...marketplace,
    plugins: (marketplace.plugins || []).map((plugin) => ({
      ...plugin,
      source: {
        ...plugin.source,
        path: './',
      },
    })),
  };
}

function resolveFixedBinary(binaryName, options = {}) {
  const accessSync = options.accessSync || fs.accessSync;
  const dirs = options.dirs || FIXED_BINARY_DIRS;

  for (const dir of dirs) {
    const binaryPath = path.join(dir, binaryName);
    try {
      accessSync(binaryPath, fs.constants.X_OK);
      return binaryPath;
    } catch {
      // Try the next fixed, system-owned directory.
    }
  }

  throw new Error(`Unable to find executable ${binaryName} in fixed system paths: ${dirs.join(', ')}`);
}

function stageCodexPluginBundle(outputDir = DEFAULT_OUTPUT_DIR) {
  const packageJson = readJson('package.json');
  const bundleDir = path.join(outputDir, 'bundle');
  const stageDir = path.join(bundleDir, BUNDLE_ROOT_NAME);
  const outputFile = path.join(outputDir, getCodexPluginVersionedAssetName(packageJson.version));

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });

  copyEntry('plugins/codex-profile/.codex-plugin', '.codex-plugin', stageDir);
  copyEntry('plugins/codex-profile/.mcp.json', '.mcp.json', stageDir);
  copyEntry('plugins/codex-profile/README.md', 'README.md', stageDir);
  copyEntry('plugins/codex-profile/INSTALL.md', 'INSTALL.md', stageDir);
  copyEntry('plugins/codex-profile/AGENTS.md', 'AGENTS.md', stageDir);
  copyEntry('LICENSE', 'LICENSE', stageDir);
  copyEntry('adapters/codex/config.toml', 'config.toml', stageDir);

  fs.mkdirSync(path.join(stageDir, '.agents', 'plugins'), { recursive: true });
  fs.writeFileSync(
    path.join(stageDir, '.agents', 'plugins', 'marketplace.json'),
    JSON.stringify(buildStandaloneMarketplace(), null, 2) + '\n'
  );

  return {
    bundleDir,
    stageDir,
    outputFile,
  };
}

function buildCodexPlugin(outputDir = DEFAULT_OUTPUT_DIR) {
  const { bundleDir, stageDir, outputFile } = stageCodexPluginBundle(outputDir);
  const zipBinary = resolveFixedBinary('zip');
  const unzipBinary = resolveFixedBinary('unzip');

  execFileSync(zipBinary, ['-qr', outputFile, BUNDLE_ROOT_NAME], {
    cwd: bundleDir,
    stdio: 'inherit',
  });

  const contents = execFileSync(unzipBinary, ['-l', outputFile], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
  });

  process.stdout.write(contents);

  return {
    stageDir,
    outputFile,
    contents,
  };
}

function isCliEntrypoint(argv = process.argv) {
  return path.resolve(argv[1] || '') === __filename;
}

function runCli(argv = process.argv, cwd = process.cwd(), log = console.log) {
  const outputDir = argv[2]
    ? path.resolve(cwd, argv[2])
    : DEFAULT_OUTPUT_DIR;
  const { outputFile } = buildCodexPlugin(outputDir);
  log(`Built Codex plugin bundle: ${outputFile}`);
  return outputFile;
}

if (isCliEntrypoint()) {
  runCli();
}

module.exports = {
  BUNDLE_ROOT_NAME,
  DEFAULT_OUTPUT_DIR,
  FIXED_BINARY_DIRS,
  buildCodexPlugin,
  buildStandaloneMarketplace,
  isCliEntrypoint,
  resolveFixedBinary,
  runCli,
  stageCodexPluginBundle,
};
