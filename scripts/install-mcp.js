#!/usr/bin/env node
'use strict';

/**
 * install-mcp.js — Wire the ThumbGate MCP server (and PreToolUse hooks) into
 * Claude Code settings.
 *
 * Usage:
 *   node scripts/install-mcp.js            # global install (~/.claude/settings.json)
 *   node scripts/install-mcp.js --project  # project-level install (.claude/settings.json)
 *   node scripts/install-mcp.js --no-hooks # MCP only, skip hook wiring
 *   node scripts/install-mcp.js --dry-run  # preview without writing
 *
 * Idempotent: re-running does not duplicate the entry.
 * Creates a .bak backup before modifying any settings file.
 *
 * By default this command performs BOTH steps a Claude Code install needs:
 *   1. Add the `thumbgate` MCP server to settings.json (or project .claude/settings.json)
 *   2. Wire PreToolUse / UserPromptSubmit / PostToolUse / SessionStart hooks
 *      via wireClaudeHooks() from auto-wire-hooks.js
 *
 * Prior to this change, `install-mcp` only handled step 1, silently leaving
 * the gate-enforcement hooks unwired. The single-command UX in the README and
 * landing page (`npx thumbgate init --agent claude-code`) expects both steps,
 * and this matches it.
 */

const fs = require('fs');
const path = require('path');
const { resolveMcpEntry } = require('./mcp-config');
const { wireClaudeHooks } = require('./auto-wire-hooks');

const MCP_SERVER_KEY = 'thumbgate';
const LEGACY_MCP_SERVER_KEYS = ['mcp-memory-gateway', 'rlhf'];
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

function parseFlags(argv) {
  const flags = {};
  for (const arg of argv) {
    if (arg === '--project') flags.project = true;
    if (arg === '--dry-run') flags.dryRun = true;
    if (arg === '--no-hooks') flags.noHooks = true;
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
  const hasLegacyAliases = Boolean(
    settings &&
    settings.mcpServers &&
    LEGACY_MCP_SERVER_KEYS.some((key) => Object.prototype.hasOwnProperty.call(settings.mcpServers, key))
  );
  return !!(
    settings &&
    settings.mcpServers &&
    !hasLegacyAliases &&
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
  for (const legacyKey of LEGACY_MCP_SERVER_KEYS) {
    if (Object.prototype.hasOwnProperty.call(settings.mcpServers, legacyKey)) {
      delete settings.mcpServers[legacyKey];
    }
  }

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

/**
 * installHooks — wire the Claude Code PreToolUse/UserPromptSubmit/PostToolUse/
 * SessionStart hooks. Delegates to wireClaudeHooks() so we stay in sync with
 * how `thumbgate init --agent=claude-code` writes them. Failures are reported
 * but do not throw, so a partial install (MCP succeeded, hooks failed) still
 * leaves the user with a functioning MCP server.
 *
 * @param {{ project?: boolean, dryRun?: boolean }} flags
 * @returns {{ wired: boolean, settingsPath: string|null, added: Array, error?: string }}
 */
function installHooks(flags) {
  try {
    const wireOptions = { dryRun: Boolean(flags.dryRun) };
    if (flags.project) {
      wireOptions.projectDir = process.cwd();
    }
    const result = wireClaudeHooks(wireOptions);
    return {
      wired: Boolean(result && result.changed),
      settingsPath: (result && result.settingsPath) || null,
      added: (result && result.added) || [],
    };
  } catch (err) {
    return {
      wired: false,
      settingsPath: null,
      added: [],
      error: err && err.message ? err.message : String(err),
    };
  }
}

/**
 * installMcpAndHooks — top-level entry that combines MCP server install and
 * hook wiring into one operation. Maintained alongside the bare `installMcp`
 * for back-compat with callers that only want the MCP wiring.
 */
function installMcpAndHooks(flags = {}) {
  const mcpResult = installMcp(flags);
  if (flags.noHooks) {
    return { mcp: mcpResult, hooks: { wired: false, skipped: true } };
  }

  const hooksResult = installHooks(flags);
  if (hooksResult.error) {
    console.warn(`  Hooks: skipped (${hooksResult.error})`);
  } else if (hooksResult.wired) {
    console.log(`ThumbGate hooks wired.`);
    if (hooksResult.settingsPath) console.log(`  Path: ${hooksResult.settingsPath}`);
    for (const entry of hooksResult.added) {
      console.log(`  ${entry.lifecycle}: ${entry.command}`);
    }
  } else if (hooksResult.added.length === 0) {
    console.log('ThumbGate hooks already wired.');
  }

  return { mcp: mcpResult, hooks: hooksResult };
}

// Exported for testing
module.exports = {
  MCP_SERVER_KEY,
  LEGACY_MCP_SERVER_KEYS,
  resolveMcpServerConfig,
  resolveSettingsPath,
  loadSettings,
  backupFile,
  isAlreadyInstalled,
  buildMcpConfig,
  installMcp,
  installHooks,
  installMcpAndHooks,
  parseFlags,
};

// Use a path-based main check per CLAUDE.md (SonarCloud S3403 — require.main
// can be unreliable under some module loaders).
if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  const flags = parseFlags(process.argv.slice(2));
  installMcpAndHooks(flags);
}
