'use strict';

const fs = require('fs');
const path = require('path');
const {
  isSourceCheckout,
  publishedCliAvailable,
} = require('./mcp-config');
const { publishedCliShellCommand } = require('./published-cli');

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

function resolveCliBaseCommand() {
  const version = packageVersion();
  if (publishedHookCommandsAvailable(version)) {
    return publishedCliShellCommand(version);
  }
  if (isSourceCheckout(PKG_ROOT)) {
    return `node ${shellQuote(path.join(PKG_ROOT, 'bin', 'cli.js'))}`;
  }
  return publishedCliShellCommand(version);
}

function resolveCodexCliBaseCommand() {
  const version = packageVersion();
  if (publishedHookCommandsAvailable(version)) {
    return publishedCliShellCommand('latest', [], { preferInstalled: false });
  }
  if (isSourceCheckout(PKG_ROOT)) {
    return `node ${shellQuote(path.join(PKG_ROOT, 'bin', 'cli.js'))}`;
  }
  return publishedCliShellCommand('latest', [], { preferInstalled: false });
}

function buildPortableHookCommand(subcommand) {
  return `${resolveCliBaseCommand()} ${subcommand}`;
}

function buildCodexPortableHookCommand(subcommand) {
  return `${resolveCodexCliBaseCommand()} ${subcommand}`;
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
  resolveCodexCliBaseCommand,
  resolveCliBaseCommand,
  sessionStartHookCommand,
  statuslineCommand,
  userPromptHookCommand,
};
