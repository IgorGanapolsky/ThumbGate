'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  isSourceCheckout,
  isVersionPublished,
  resolveStableSourceRoot,
} = require('./mcp-config');

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
  if (!isVersionPublished(version)) {
    return false;
  }
  if (featureSupportCache.has(version)) {
    return featureSupportCache.get(version);
  }

  let available = false;
  try {
    const helpText = execFileSync('npx', ['-y', `thumbgate@${version}`, 'help'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 8000,
    });
    available = ['gate-check', 'cache-update', 'statusline-render', 'hook-auto-capture', 'session-start']
      .every((command) => helpText.includes(command));
  } catch {
    available = false;
  }

  featureSupportCache.set(version, available);
  return available;
}

function resolveCliBaseCommand() {
  const version = packageVersion();
  if (isSourceCheckout(PKG_ROOT) && !publishedHookCommandsAvailable(version)) {
    const sourceRoot = resolveStableSourceRoot(PKG_ROOT) || PKG_ROOT;
    return `node ${shellQuote(path.join(sourceRoot, 'bin', 'cli.js'))}`;
  }
  return `npx -y thumbgate@${version}`;
}

function buildPortableHookCommand(subcommand) {
  return `${resolveCliBaseCommand()} ${subcommand}`;
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

module.exports = {
  buildPortableHookCommand,
  cacheUpdateHookCommand,
  packageVersion,
  publishedHookCommandsAvailable,
  preToolHookCommand,
  resolveCliBaseCommand,
  sessionStartHookCommand,
  statuslineCommand,
  userPromptHookCommand,
};
