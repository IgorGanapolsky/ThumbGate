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
function repairProjectMcpConfigs(options = {}) {
  const projectDir = options.projectDir || process.cwd();
  const repairedFiles = [];

  const candidateDirs = [projectDir];
  const worktreesDir = path.join(projectDir, '.worktrees');
  if (fs.existsSync(worktreesDir)) {
    try {
      for (const entry of fs.readdirSync(worktreesDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          candidateDirs.push(path.join(worktreesDir, entry.name));
        }
      }
    } catch { /* best-effort */ }
  }

  for (const dir of candidateDirs) {
    // 1. Heal .mcp.json
    const mcpJsonPath = path.join(dir, '.mcp.json');
    if (fs.existsSync(mcpJsonPath)) {
      try {
        const raw = fs.readFileSync(mcpJsonPath, 'utf8');
        const parsed = JSON.parse(raw);
        let mutated = false;
        if (parsed && parsed.mcpServers && typeof parsed.mcpServers === 'object') {
          if (parsed.mcpServers.rlhf) {
            if (!parsed.mcpServers.thumbgate) {
              parsed.mcpServers.thumbgate = parsed.mcpServers.rlhf;
            }
            delete parsed.mcpServers.rlhf;
            mutated = true;
          }
          const tg = parsed.mcpServers.thumbgate;
          if (tg && Array.isArray(tg.args)) {
            for (let i = 0; i < tg.args.length; i++) {
              if (/^thumbgate@1\.(?:[0-9]|[12][0-9]|3[0-8])\./.test(String(tg.args[i]))) {
                tg.args[i] = 'thumbgate@latest';
                mutated = true;
              }
            }
          }
        }
        if (mutated && !options.dryRun) {
          fs.writeFileSync(mcpJsonPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
          repairedFiles.push(mcpJsonPath);
        } else if (mutated) {
          repairedFiles.push(mcpJsonPath);
        }
      } catch { /* ignore malformed JSON */ }
    }

    // 2. Heal .claude/settings.json and .claude/settings.local.json
    for (const rel of ['.claude/settings.json', '.claude/settings.local.json']) {
      const settingsFile = path.join(dir, rel);
      if (!fs.existsSync(settingsFile)) continue;
      try {
        const raw = fs.readFileSync(settingsFile, 'utf8');
        const parsed = JSON.parse(raw);
        let mutated = false;
        if (Array.isArray(parsed.enabledMcpjsonServers)) {
          const idx = parsed.enabledMcpjsonServers.indexOf('rlhf');
          if (idx !== -1) {
            if (parsed.enabledMcpjsonServers.includes('thumbgate')) {
              parsed.enabledMcpjsonServers.splice(idx, 1);
            } else {
              parsed.enabledMcpjsonServers[idx] = 'thumbgate';
            }
            mutated = true;
          }
        }
        if (parsed.mcpServers && typeof parsed.mcpServers === 'object' && parsed.mcpServers.rlhf) {
          if (!parsed.mcpServers.thumbgate) {
            parsed.mcpServers.thumbgate = parsed.mcpServers.rlhf;
          }
          delete parsed.mcpServers.rlhf;
          mutated = true;
        }
        if (mutated && !options.dryRun) {
          fs.writeFileSync(settingsFile, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
          repairedFiles.push(settingsFile);
        } else if (mutated) {
          repairedFiles.push(settingsFile);
        }
      } catch { /* ignore malformed JSON */ }
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
