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
  // Codex hooks live in user-global config. Pinning them to a disposable source
  // worktree breaks every hook as soon as normal post-merge cleanup removes it.
  // The stable @latest launcher stays offline at configuration time and survives
  // cleanup. Checkout-pinned hooks remain available as an explicit dev override.
  if (isSourceCheckout(PKG_ROOT) && process.env.THUMBGATE_CODEX_USE_SOURCE_RUNTIME === '1') {
    return `node ${shellQuote(path.join(PKG_ROOT, 'bin', 'cli.js'))} ${subcommand}`;
  }
  if (isSourceCheckout(PKG_ROOT)) {
    return publishedCliShellCommand('latest', [subcommand]);
  }
  const version = packageVersion();
  if (publishedHookCommandsAvailable(version)) {
    return publishedCliShellCommand('latest', [subcommand]);
  }
  return publishedCliShellCommand('latest', [subcommand]);
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

function spendGuardHookCommand() {
  // Prefer package script path so npm installs get ERP spend-guard without manual ~/.thumbgate wiring.
  if (isSourceCheckout(PKG_ROOT)) {
    return `node ${shellQuote(path.join(PKG_ROOT, 'scripts', 'thumbgate-spend-guard.js'))}`;
  }
  return `node ${shellQuote(path.join(PKG_ROOT, 'scripts', 'thumbgate-spend-guard.js'))}`;
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

function claimStopHookCommand() {
  return buildPortableHookCommand('claim-stop-check');
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
  claimStopHookCommand,
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
  spendGuardHookCommand,
  statuslineCommand,
  userPromptHookCommand,
};
