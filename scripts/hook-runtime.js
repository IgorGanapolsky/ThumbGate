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

// A linked git worktree (or anything under .thumbgate-worktrees) is deleted after merge.
// A hook that points inside one breaks every tool call once it is gone (23 Nov 2026).
function isDisposableCheckout(root) {
  const normalized = String(root).split(path.sep).join('/');
  if (normalized.includes('/.thumbgate-worktrees/') || normalized.includes('/worktrees/')) return true;
  try {
    return fs.statSync(path.join(root, '.git')).isFile();
  } catch {
    return false;
  }
}

function resolveCliCommand(subcommand) {
  // Source checkout: direct node command for development, but never from a disposable
  // worktree. Those get the stable launcher at ~/.thumbgate/bin/thumbgate-hook.
  if (isSourceCheckout(PKG_ROOT)) {
    if (isDisposableCheckout(PKG_ROOT)) {
      return `${shellQuote(shimPath())} ${subcommand}`;
    }
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

function observeToolResultHookCommand() {
  return buildPortableHookCommand('observe-tool-result');
}

function skillShellHookCommand() {
  return buildPortableHookCommand('skill-shell-gate');
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

function codexObserveToolResultHookCommand() {
  return buildCodexPortableHookCommand('observe-tool-result');
}

function codexStatuslineCommand() {
  return buildCodexPortableHookCommand('statusline-render');
}

// The Cursor shell gate goes through the same portable runtime as every other hook. It used to pin
// `node <install>/scripts/cursor-shell-gate.js`; with failClosed: true, a cleared npx cache or a deleted worktree then
// blocked every shell command in every Cursor project. The shim and the pinned npm-exec runtime cannot go missing that way.
function cursorShellGateHookCommand() {
  return buildPortableHookCommand('cursor-gate');
}

/** An older ThumbGate shell-gate entry that points at one install's scripts/cursor-shell-gate.js. */
function isPinnedCursorShellGateCommand(command) {
  return /cursor-shell-gate\.js/.test(String(command || ''));
}

/** A Cursor hook that runs one ThumbGate CLI subcommand (cursor-prompt, cursor-mcp-gate, cursor-record, cursor-stop). */
// Portable like the Claude Code hooks: ~/.cursor/hooks.json is user-wide, so it must not point into an npx cache or
// a disposable worktree that will be gone tomorrow (beforeMCPExecution is failClosed, so a dead path blocks MCP).
function cursorCliHookCommand(subcommand) {
  return buildPortableHookCommand(subcommand);
}

module.exports = {
  buildPortableHookCommand,
  cursorCliHookCommand,
  buildCodexPortableHookCommand,
  cacheUpdateHookCommand,
  claimStopHookCommand,
  codexObserveToolResultHookCommand,
  observeToolResultHookCommand,
  skillShellHookCommand,
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
  cursorShellGateHookCommand,
  isPinnedCursorShellGateCommand,
  isDisposableCheckout,
};
