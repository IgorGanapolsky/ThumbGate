#!/usr/bin/env node
'use strict';

/**
 * build-grok-plugin.js (v0.1 — initial standardization step)
 *
 * First cut at a Grok Build plugin bundle.
 * Goal: Produce a versioned zip that gives users a clean, one-stop Grok experience.
 *
 * This is the opening move of the publishing standardization effort.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_OUTPUT_DIR = path.join(PROJECT_ROOT, '.artifacts', 'grok-plugin');
const BUNDLE_ROOT_NAME = 'thumbgate-grok-plugin';

function getPackageVersion() {
  return require(path.join(PROJECT_ROOT, 'package.json')).version;
}

function copyEntry(sourceRelativePath, targetRelativePath, stageDir) {
  const sourcePath = path.join(PROJECT_ROOT, sourceRelativePath);
  if (!fs.existsSync(sourcePath)) return;

  const targetPath = path.join(stageDir, targetRelativePath || sourceRelativePath);
  const stat = fs.statSync(sourcePath);

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (stat.isDirectory()) {
    fs.cpSync(sourcePath, targetPath, { recursive: true });
  } else {
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function stageGrokPluginBundle(outputDir = DEFAULT_OUTPUT_DIR) {
  const version = getPackageVersion();
  const bundleDir = path.join(outputDir, 'bundle');
  const stageDir = path.join(bundleDir, BUNDLE_ROOT_NAME);
  const outputFile = path.join(outputDir, `thumbgate-grok-plugin-v${version}.zip`);

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });

  // Core Grok dedicated surface (first-class)
  copyEntry('adapters/grok', 'adapters/grok', stageDir);
  copyEntry('adapters/xai-grok', 'adapters/xai-grok', stageDir);

  // Minimal runtime surface needed for Grok (Claude-compatible)
  copyEntry('bin', 'bin', stageDir);
  copyEntry('scripts', 'scripts', stageDir);
  copyEntry('adapters/claude', 'adapters/claude', stageDir);
  copyEntry('adapters/mcp', 'adapters/mcp', stageDir);

  // Essential docs
  copyEntry('LICENSE', 'LICENSE', stageDir);
  copyEntry('adapters/grok/README.md', 'README.md', stageDir);
  copyEntry('adapters/grok/.mcp.json', '.mcp.json', stageDir);

  // Small marketplace-style hint (future use)
  fs.mkdirSync(path.join(stageDir, '.agents', 'plugins'), { recursive: true });
  fs.writeFileSync(
    path.join(stageDir, '.agents', 'plugins', 'grok.json'),
    JSON.stringify({
      name: "ThumbGate for Grok Build",
      version,
      description: "First-class PreToolUse governance + feedback loop for xAI Grok Build CLI",
      entry: "adapters/grok",
    }, null, 2) + '\n'
  );

  return { bundleDir, stageDir, outputFile, version };
}

function buildGrokPlugin(outputDir = DEFAULT_OUTPUT_DIR) {
  const { bundleDir, stageDir, outputFile, version } = stageGrokPluginBundle(outputDir);

  const zipBinary = 'zip';
  try {
    execFileSync(zipBinary, ['-qr', outputFile, BUNDLE_ROOT_NAME], {
      cwd: bundleDir,
      stdio: 'inherit',
    });
  } catch (e) {
    console.error('zip command failed — falling back to simple tar for now');
    // Fallback for environments without zip
    execFileSync('tar', ['-czf', outputFile.replace('.zip', '.tar.gz'), BUNDLE_ROOT_NAME], {
      cwd: bundleDir,
    });
    console.log(`Created fallback tarball instead of .zip`);
    return { stageDir, outputFile: outputFile.replace('.zip', '.tar.gz'), version };
  }

  console.log(`Built Grok plugin bundle: ${outputFile}`);
  return { stageDir, outputFile, version };
}

if (require.main === module) {
  buildGrokPlugin();
}

module.exports = { buildGrokPlugin, stageGrokPluginBundle };
