#!/usr/bin/env node
'use strict';

/**
 * install-mcp.js — Wire the ThumbGate MCP server into Claude Code settings.
 *
 * Usage:
 *   node scripts/install-mcp.js            # global install (~/.claude/settings.json)
 *   node scripts/install-mcp.js --project  # project-level install (.claude/settings.json)
 *
 * Idempotent: re-running does not duplicate the entry.
 * Creates a .bak backup before modifying any settings file.
 */

const fs = require('fs');
const path = require('path');
const { resolveMcpEntry } = require('./mcp-config');

const MCP_SERVER_KEY = 'thumbgate';
const PKG_ROOT = path.join(__dirname, '..');
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version;

function resolveMcpServerConfig(flags = {}) {
  return resolveMcpEntry({
    pkgRoot: PKG_ROOT,
    pkgVersion: PKG_VERSION,
    scope: flags.project ? 'project' : 'home',
    targetDir: flags.cwd || process.cwd(),
  });
}

const MCP_SERVER_CONFIG = resolveMcpServerConfig();

function parseFlags(argv) {
  const flags = {};
  for (const arg of argv) {
    if (arg === '--project') flags.project = true;
    if (arg === '--dry-run') flags.dryRun = true;
  }
  return flags;
}

function resolveSettingsPath(flags) {
  if (flags.project) {
    return path.join(process.cwd(), '.claude', 'settings.json');
  }
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return path.join(home, '.claude', 'settings.json');
}

function loadSettings(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    console.warn(`Warning: ${filePath} contains malformed JSON. Starting fresh.`);
    return {};
  }
}

function backupFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const backupPath = filePath + '.bak';
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function serverConfigMatches(entry, flags = {}) {
  const expectedConfig = resolveMcpServerConfig(flags);
  return Boolean(
    entry &&
    entry.command === expectedConfig.command &&
    Array.isArray(entry.args) &&
    entry.args.length === expectedConfig.args.length &&
    entry.args.every((arg, index) => arg === expectedConfig.args[index])
  );
}

function isAlreadyInstalled(settings, flags = {}) {
  return !!(
    settings &&
    settings.mcpServers &&
    serverConfigMatches(settings.mcpServers[MCP_SERVER_KEY], flags)
  );
}

function buildMcpConfig(flags = {}) {
  return { [MCP_SERVER_KEY]: resolveMcpServerConfig(flags) };
}

function installMcp(flags) {
  const settingsPath = resolveSettingsPath(flags);
  const scope = flags.project ? 'project' : 'global';
  const serverConfig = resolveMcpServerConfig(flags);

  let settings = loadSettings(settingsPath);

  if (isAlreadyInstalled(settings, flags)) {
    console.log(`ThumbGate MCP server already installed in ${scope} settings.`);
    console.log(`  Path: ${settingsPath}`);
    return { installed: false, path: settingsPath, reason: 'already-installed' };
  }

  // Back up existing file before modifying
  const backupPath = backupFile(settingsPath);
  if (backupPath) {
    console.log(`  Backup: ${backupPath}`);
  }

  // Create or merge settings
  if (!settings) {
    settings = {};
  }

  if (!settings.mcpServers) {
    settings.mcpServers = {};
  }

  settings.mcpServers[MCP_SERVER_KEY] = serverConfig;

  // Ensure parent directory exists
  const dir = path.dirname(settingsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!flags.dryRun) {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  }

  console.log(`ThumbGate MCP server installed (${scope}).`);
  console.log(`  Path: ${settingsPath}`);
  console.log(`  Added: mcpServers.${MCP_SERVER_KEY}`);
  console.log(`  Config: ${JSON.stringify(serverConfig)}`);

  return { installed: true, path: settingsPath, backup: backupPath || null };
}

// Exported for testing
module.exports = {
  MCP_SERVER_KEY,
  MCP_SERVER_CONFIG,
  resolveMcpServerConfig,
  resolveSettingsPath,
  loadSettings,
  backupFile,
  isAlreadyInstalled,
  buildMcpConfig,
  installMcp,
  parseFlags,
};

if (require.main === module) {
  const flags = parseFlags(process.argv.slice(2));
  installMcp(flags);
}
