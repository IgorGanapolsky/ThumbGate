'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PRODUCTHUNT_URL = 'https://www.producthunt.com/products/thumbgate';
const CLAUDE_PLUGIN_LATEST_ASSET_NAME = 'thumbgate-claude-desktop.mcpb';

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function getPackageVersion(root = ROOT) {
  return String(readJson(root, 'package.json').version || '').trim();
}

function getRepositoryUrl(root = ROOT) {
  return String(readJson(root, 'package.json').repository.url || '').replace(/\.git$/, '');
}

function getClaudePluginVersionedAssetName(version = getPackageVersion(ROOT)) {
  const normalized = String(version || '').replace(/^v/, '');
  return `thumbgate-claude-desktop-v${normalized}.mcpb`;
}

function getClaudePluginLatestDownloadUrl(root = ROOT) {
  return `${getRepositoryUrl(root)}/releases/latest/download/${CLAUDE_PLUGIN_LATEST_ASSET_NAME}`;
}

function getClaudePluginVersionedDownloadUrl(root = ROOT, version = getPackageVersion(root)) {
  const normalized = String(version || '').replace(/^v/, '');
  return `${getRepositoryUrl(root)}/releases/download/v${normalized}/${getClaudePluginVersionedAssetName(normalized)}`;
}

module.exports = {
  CLAUDE_PLUGIN_LATEST_ASSET_NAME,
  PRODUCTHUNT_URL,
  getClaudePluginLatestDownloadUrl,
  getClaudePluginVersionedAssetName,
  getClaudePluginVersionedDownloadUrl,
  getPackageVersion,
  getRepositoryUrl,
};
