'use strict';

const fs = require('fs');
const path = require('path');
const {
  isSourceCheckout,
  publishedCliAvailable,
} = require('./mcp-config');
const { publishedCliShellCommand } = require('./published-cli');
const { shimInstalled, shimPath } = require('./install-shim');

const PKG_ROOT = path.join(__dirname, '..');
const featureSupportCache = new Map();

function packageVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'));
  return pkg.version;
}

function shellQuote(value) {
  return JSON.stringify(String(value));
}

function publishedHookCommandsAvailable(version) {
  if (!publishedCliAvailable(version)) {
    return false;
  }
  if (featureSupportCache.has(version)) {
    return featureSupportCache.get(version);
  }

  const available = true;
  featureSupportCache.set(version, available);
  return available;
}

function resolveCliCommand(subcommand) {
  // Source checkout: always use direct node command for development
  if (isSourceCheckout(PKG_ROOT)) {
    return `node ${shellQuote(path.join(PKG_ROOT, 'bin', 'cli.js'))} ${subcommand}`;
  }
  // Prefer stable shim — always resolves @latest, survives version bumps
  if (shimInstalled()) {
    return `${shellQuote(shimPath())} ${subcommand}`;
  }
  const version = packageVersion();
  if (publishedHookCommandsAvailable(version)) {
    return publishedCliShellCommand(version, [subcommand]);
  }
  return publishedCliShellCommand(version, [subcommand]);
}

function resolveCodexCliCommand(subcommand) {
  const version = packageVersion();
  if (publishedHookCommandsAvailable(version)) {
    return publishedCliShellCommand('latest', [subcommand], { preferInstalled: false });
  }
  if (isSourceCheckout(PKG_ROOT)) {
    return `node ${shellQuote(path.join(PKG_ROOT, 'bin', 'cli.js'))} ${subcommand}`;
  }
  return publishedCliShellCommand('latest', [subcommand], { preferInstalled: false });
}

function buildPortableHookCommand(subcommand) {
  return resolveCliCommand(subcommand);
}

function buildCodexPortableHookCommand(subcommand) {
  return resolveCodexCliCommand(subcommand);
}

function preToolHookCommand() {
  return buildPortableHookCommand('gate-check');
}

function userPromptHookCommand() {
  return buildPortableHookCommand('hook-auto-capture');
}

function sessionStartHookCommand() {
  return buildPortableHookCommand('session-start');
}

function cacheUpdateHookCommand() {
  return buildPortableHookCommand('cache-update');
}

function statuslineCommand() {
  return buildPortableHookCommand('statusline-render');
}

function codexPreToolHookCommand() {
  return buildCodexPortableHookCommand('gate-check');
}

function codexUserPromptHookCommand() {
  return buildCodexPortableHookCommand('hook-auto-capture');
}

function codexSessionStartHookCommand() {
  return buildCodexPortableHookCommand('session-start');
}

function codexCacheUpdateHookCommand() {
  return buildCodexPortableHookCommand('cache-update');
}

function codexStatuslineCommand() {
  return buildCodexPortableHookCommand('statusline-render');
}

module.exports = {
  buildPortableHookCommand,
  buildCodexPortableHookCommand,
  cacheUpdateHookCommand,
  codexCacheUpdateHookCommand,
  codexPreToolHookCommand,
  codexSessionStartHookCommand,
  codexStatuslineCommand,
  codexUserPromptHookCommand,
  packageVersion,
  publishedHookCommandsAvailable,
  preToolHookCommand,
  resolveCodexCliCommand,
  resolveCliCommand,
  sessionStartHookCommand,
  statuslineCommand,
  userPromptHookCommand,
};
