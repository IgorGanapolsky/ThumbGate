#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * build-grok-plugin.js — Generates the Grok (xAI) plugin bundle.
 */

const VERSION = require('../package.json').version;
const ARTIFACT_DIR = path.join(__dirname, '..', '.artifacts');
const PLUGIN_NAME = `thumbgate-grok-plugin-v${VERSION}.zip`;

function buildGrokPlugin() {
  console.log(`Building Grok Plugin v${VERSION}...`);
  
  if (!fs.existsSync(ARTIFACT_DIR)) {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  }

  const buildPath = path.join(ARTIFACT_DIR, 'grok-build');
  if (fs.existsSync(buildPath)) {
    fs.rmSync(buildPath, { recursive: true, force: true });
  }
  fs.mkdirSync(buildPath, { recursive: true });

  // Copy manifest and README
  fs.copyFileSync(path.join(__dirname, '..', 'adapters', 'xai-grok', 'README.md'), path.join(buildPath, 'README.md'));
  
  // Create a shim index.js
  const shim = `
module.exports = {
  name: "ThumbGate for Grok",
  version: "${VERSION}",
  capabilities: ["pre-action-gates", "reliability-memory"]
};
`;
  fs.writeFileSync(path.join(buildPath, 'index.js'), shim);

  // Zip it
  try {
    execSync(`zip -r ${PLUGIN_NAME} .`, { cwd: buildPath });
    fs.renameSync(path.join(buildPath, PLUGIN_NAME), path.join(ARTIFACT_DIR, PLUGIN_NAME));
    console.log(`✓ Created Grok artifact: ${PLUGIN_NAME}`);
  } catch (e) {
    console.error(`✗ Failed to zip Grok plugin: ${e.message}`);
  }
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  buildGrokPlugin();
}
