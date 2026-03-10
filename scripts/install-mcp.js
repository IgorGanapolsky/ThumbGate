#!/usr/bin/env node
'use strict';

/**
 * install-mcp.js — Wire the RLHF MCP server into Claude Code settings.
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

const MCP_SERVER_KEY = 'rlhf';
const MCP_SERVER_CONFIG = {
  command: 'npx',
  args: ['-y', 'rlhf-feedback-loop', 'serve'],
};

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
  return JSON.parse(raw);
}

function backupFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const backupPath = filePath + '.bak';
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function isAlreadyInstalled(settings) {
  return !!(
    settings &&
    settings.mcpServers &&
    settings.mcpServers[MCP_SERVER_KEY]
  );
}

function buildMcpConfig() {
  return { [MCP_SERVER_KEY]: MCP_SERVER_CONFIG };
}

function installMcp(flags) {
  const settingsPath = resolveSettingsPath(flags);
  const scope = flags.project ? 'project' : 'global';

  let settings = loadSettings(settingsPath);

  if (isAlreadyInstalled(settings)) {
    console.log(`RLHF MCP server already installed in ${scope} settings.`);
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

  settings.mcpServers[MCP_SERVER_KEY] = MCP_SERVER_CONFIG;

  // Ensure parent directory exists
  const dir = path.dirname(settingsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!flags.dryRun) {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  }

  console.log(`RLHF MCP server installed (${scope}).`);
  console.log(`  Path: ${settingsPath}`);
  console.log(`  Added: mcpServers.${MCP_SERVER_KEY}`);
  console.log(`  Config: ${JSON.stringify(MCP_SERVER_CONFIG)}`);

  return { installed: true, path: settingsPath, backup: backupPath || null };
}

// Exported for testing
module.exports = {
  MCP_SERVER_KEY,
  MCP_SERVER_CONFIG,
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
