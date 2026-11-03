'use strict';

const fs = require('fs');
const path = require('path');
const { wireCodexHooks } = require('./auto-wire-hooks');

function codexDir(homeDir) {
  return path.join(homeDir, '.codex');
}

function codexConfigPath(homeDir) {
  return path.join(codexDir(homeDir), 'config.json');
}

function shouldAttemptCodexSelfHeal(options = {}) {
  const env = options.env || process.env;
  const homeDir = options.homeDir || env.HOME || env.USERPROFILE || '';
  if (!homeDir) return false;
  if (env.THUMBGATE_DISABLE_CODEX_SELF_HEAL === '1') return false;
  return fs.existsSync(codexDir(homeDir));
}

function repairCodexHooks(options = {}) {
  const env = options.env || process.env;
  const homeDir = options.homeDir || env.HOME || env.USERPROFILE || '';
  if (!shouldAttemptCodexSelfHeal({ env, homeDir })) {
    return { changed: false, skipped: true, reason: 'codex-not-detected' };
  }

  const settingsPath = options.settingsPath || codexConfigPath(homeDir);
  try {
    return wireCodexHooks({ settingsPath, dryRun: options.dryRun });
  } catch (error) {
    return { changed: false, skipped: true, reason: 'repair-failed', error };
  }
}

/**
 * Self-heals project-level `.mcp.json`, `.claude/settings.json`, and
 * `.claude/settings.local.json` files so legacy `rlhf` server keys or
 * single-instance-locked `thumbgate@1.5.0` pins never break MCP startup
 * in other projects (e.g., `~/workspace/trading`).
 */
function migrateRlhfServerKey(mcpServers) {
  if (!mcpServers || typeof mcpServers !== 'object' || !mcpServers.rlhf) {
    return false;
  }
  if (!mcpServers.thumbgate) {
    mcpServers.thumbgate = mcpServers.rlhf;
  }
  delete mcpServers.rlhf;
  return true;
}

function upgradeLegacyThumbgatePin(mcpServers) {
  const args = mcpServers?.thumbgate?.args;
  if (!Array.isArray(args)) return false;
  let updated = false;
  for (let i = 0; i < args.length; i++) {
    if (/^thumbgate@1\.(?:\d|[12]\d|3[0-8])\./.test(String(args[i]))) {
      args[i] = 'thumbgate@latest';
      updated = true;
    }
  }
  return updated;
}

function healMcpJsonFile(mcpJsonPath, dryRun) {
  if (!fs.existsSync(mcpJsonPath)) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf8'));
    const servers = parsed?.mcpServers;
    const migrated = migrateRlhfServerKey(servers);
    const upgraded = upgradeLegacyThumbgatePin(servers);
    if (!migrated && !upgraded) return false;
    if (!dryRun) {
      fs.writeFileSync(mcpJsonPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    }
    return true;
  } catch {
    return false;
  }
}

function healEnabledMcpServersArray(arr) {
  if (!Array.isArray(arr)) return false;
  const idx = arr.indexOf('rlhf');
  if (idx === -1) return false;
  if (arr.includes('thumbgate')) {
    arr.splice(idx, 1);
  } else {
    arr[idx] = 'thumbgate';
  }
  return true;
}

function healClaudeSettingsFile(settingsFile, dryRun) {
  if (!fs.existsSync(settingsFile)) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    const listHealed = healEnabledMcpServersArray(parsed?.enabledMcpjsonServers);
    const keyHealed = migrateRlhfServerKey(parsed?.mcpServers);
    if (!listHealed && !keyHealed) return false;
    if (!dryRun) {
      fs.writeFileSync(settingsFile, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    }
    return true;
  } catch {
    return false;
  }
}

function collectCandidateProjectDirs(projectDir) {
  const dirs = [projectDir];
  const worktreesDir = path.join(projectDir, '.worktrees');
  if (!fs.existsSync(worktreesDir)) return dirs;
  try {
    for (const entry of fs.readdirSync(worktreesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(path.join(worktreesDir, entry.name));
    }
  } catch { /* best-effort */ }
  return dirs;
}

function repairProjectMcpConfigs(options = {}) {
  const projectDir = options.projectDir || process.cwd();
  const repairedFiles = [];
  for (const dir of collectCandidateProjectDirs(projectDir)) {
    const mcpJsonPath = path.join(dir, '.mcp.json');
    if (healMcpJsonFile(mcpJsonPath, options.dryRun)) {
      repairedFiles.push(mcpJsonPath);
    }
    for (const rel of ['.claude/settings.json', '.claude/settings.local.json']) {
      const settingsFile = path.join(dir, rel);
      if (healClaudeSettingsFile(settingsFile, options.dryRun)) {
        repairedFiles.push(settingsFile);
      }
    }
  }
  return { changed: repairedFiles.length > 0, repairedFiles };
}

module.exports = {
  codexConfigPath,
  repairCodexHooks,
  repairProjectMcpConfigs,
  shouldAttemptCodexSelfHeal,
};
