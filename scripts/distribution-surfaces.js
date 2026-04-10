'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PRODUCTHUNT_URL = 'https://www.producthunt.com/products/thumbgate';
const CLAUDE_PLUGIN_LATEST_ASSET_NAME = 'thumbgate-claude-desktop.mcpb';
const CLAUDE_PLUGIN_NEXT_ASSET_NAME = 'thumbgate-claude-desktop-next.mcpb';
const CLAUDE_PLUGIN_REVIEW_LATEST_ASSET_NAME = 'thumbgate-claude-plugin-review.zip';
const CLAUDE_PLUGIN_REVIEW_NEXT_ASSET_NAME = 'thumbgate-claude-plugin-review-next.zip';
const CODEX_PLUGIN_LATEST_ASSET_NAME = 'thumbgate-codex-plugin.zip';
const CODEX_PLUGIN_NEXT_ASSET_NAME = 'thumbgate-codex-plugin-next.zip';

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

function getClaudePluginReviewVersionedAssetName(version = getPackageVersion(ROOT)) {
  const normalized = String(version || '').replace(/^v/, '');
  return `thumbgate-claude-plugin-review-v${normalized}.zip`;
}

function isPrereleaseVersion(version = getPackageVersion(ROOT)) {
  return /^\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/.test(String(version || '').trim());
}

function getClaudePluginChannelAssetName(version = getPackageVersion(ROOT)) {
  return isPrereleaseVersion(version) ? CLAUDE_PLUGIN_NEXT_ASSET_NAME : CLAUDE_PLUGIN_LATEST_ASSET_NAME;
}

function getClaudePluginReviewChannelAssetName(version = getPackageVersion(ROOT)) {
  return isPrereleaseVersion(version)
    ? CLAUDE_PLUGIN_REVIEW_NEXT_ASSET_NAME
    : CLAUDE_PLUGIN_REVIEW_LATEST_ASSET_NAME;
}

function getClaudePluginLatestDownloadUrl(root = ROOT) {
  return `${getRepositoryUrl(root)}/releases/latest/download/${CLAUDE_PLUGIN_LATEST_ASSET_NAME}`;
}

function getClaudePluginVersionedDownloadUrl(root = ROOT, version = getPackageVersion(root)) {
  const normalized = String(version || '').replace(/^v/, '');
  return `${getRepositoryUrl(root)}/releases/download/v${normalized}/${getClaudePluginVersionedAssetName(normalized)}`;
}

function getClaudePluginReviewLatestDownloadUrl(root = ROOT) {
  return `${getRepositoryUrl(root)}/releases/latest/download/${CLAUDE_PLUGIN_REVIEW_LATEST_ASSET_NAME}`;
}

function getClaudePluginReviewVersionedDownloadUrl(root = ROOT, version = getPackageVersion(root)) {
  const normalized = String(version || '').replace(/^v/, '');
  return `${getRepositoryUrl(root)}/releases/download/v${normalized}/${getClaudePluginReviewVersionedAssetName(normalized)}`;
}

function getCodexPluginVersionedAssetName(version = getPackageVersion(ROOT)) {
  const normalized = String(version || '').replace(/^v/, '');
  return `thumbgate-codex-plugin-v${normalized}.zip`;
}

function getCodexPluginChannelAssetName(version = getPackageVersion(ROOT)) {
  return isPrereleaseVersion(version) ? CODEX_PLUGIN_NEXT_ASSET_NAME : CODEX_PLUGIN_LATEST_ASSET_NAME;
}

function getCodexPluginLatestDownloadUrl(root = ROOT) {
  return `${getRepositoryUrl(root)}/releases/latest/download/${CODEX_PLUGIN_LATEST_ASSET_NAME}`;
}

function getCodexPluginVersionedDownloadUrl(root = ROOT, version = getPackageVersion(root)) {
  const normalized = String(version || '').replace(/^v/, '');
  return `${getRepositoryUrl(root)}/releases/download/v${normalized}/${getCodexPluginVersionedAssetName(normalized)}`;
}

module.exports = {
  CLAUDE_PLUGIN_LATEST_ASSET_NAME,
  CLAUDE_PLUGIN_NEXT_ASSET_NAME,
  CLAUDE_PLUGIN_REVIEW_LATEST_ASSET_NAME,
  CLAUDE_PLUGIN_REVIEW_NEXT_ASSET_NAME,
  CODEX_PLUGIN_LATEST_ASSET_NAME,
  CODEX_PLUGIN_NEXT_ASSET_NAME,
  PRODUCTHUNT_URL,
  getClaudePluginChannelAssetName,
  getClaudePluginLatestDownloadUrl,
  getClaudePluginReviewChannelAssetName,
  getClaudePluginReviewLatestDownloadUrl,
  getClaudePluginReviewVersionedAssetName,
  getClaudePluginReviewVersionedDownloadUrl,
  getClaudePluginVersionedAssetName,
  getClaudePluginVersionedDownloadUrl,
  getCodexPluginChannelAssetName,
  getCodexPluginLatestDownloadUrl,
  getCodexPluginVersionedAssetName,
  getCodexPluginVersionedDownloadUrl,
  getPackageVersion,
  getRepositoryUrl,
  isPrereleaseVersion,
};
