'use strict';

// Self-heal for installs made by thumbgate <= 1.43.1. Their `init` wrote the Claude
// Code hooks to ~/.claude/settings.local.json, which Claude Code does not read, so
// the hooks never ran. A hook in that file can't repair itself (it never fires), but
// the MCP server does start, from the project's .mcp.json. On MCP start this moves
// ThumbGate's hooks to ~/.claude/settings.json. It runs only when the unread file
// still holds ThumbGate hooks, so after the first move it is a no-op.
// Opt out with THUMBGATE_DISABLE_CLAUDE_SELF_HEAL=1.

const fs = require('fs');
const path = require('path');

const THUMBGATE_HOOK_PATTERN = /(thumbgate|gate-check\b|hook-auto-capture|cache-update\b|claim-stop-check\b|hook-stop-anti-claim|session-start\b|generate-pretool-hook\.sh)/;

function legacyLocalSettingsPath(homeDir) {
  return path.join(homeDir, '.claude', 'settings.local.json');
}

function unreadFileHasThumbgateHooks(filePath) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const settings = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const hooks = settings && settings.hooks;
    if (!hooks || typeof hooks !== 'object') return false;
    return Object.values(hooks).some((entries) => Array.isArray(entries) && entries.some((entry) => {
      const list = Array.isArray(entry && entry.hooks) ? entry.hooks : [];
      return list.some((hook) => hook && typeof hook.command === 'string' && THUMBGATE_HOOK_PATTERN.test(hook.command));
    }));
  } catch {
    return false;
  }
}

function repairUnreadClaudeHooks(options = {}) {
  const env = options.env || process.env;
  const homeDir = options.homeDir || env.HOME || env.USERPROFILE || '';
  if (!homeDir) return { changed: false, skipped: true, reason: 'no-home' };
  if (env.THUMBGATE_DISABLE_CLAUDE_SELF_HEAL === '1') return { changed: false, skipped: true, reason: 'disabled' };
  if (!unreadFileHasThumbgateHooks(legacyLocalSettingsPath(homeDir))) {
    return { changed: false, skipped: true, reason: 'nothing-to-move' };
  }

  // The MCP server speaks JSON-RPC on stdout, so nothing here may write to stdout.
  const originalLog = console.log;
  console.log = (...args) => console.error(...args);
  try {
    const { wireClaudeHooks } = require('./auto-wire-hooks');
    const result = wireClaudeHooks({ dryRun: options.dryRun, projectDir: options.projectDir });
    if (result && result.changed) {
      console.error('[thumbgate] Moved Claude Code hooks from ~/.claude/settings.local.json (not read by Claude Code) to ~/.claude/settings.json. They take effect in new Claude Code sessions.');
    }
    return result;
  } catch (error) {
    return { changed: false, skipped: true, reason: 'repair-failed', error };
  } finally {
    console.log = originalLog;
  }
}

function userSettingsPath(homeDir) {
  return path.join(homeDir, '.claude', 'settings.json');
}

function entriesHaveCommand(entries, pattern) {
  return Array.isArray(entries) && entries.some((entry) => {
    const list = Array.isArray(entry && entry.hooks) ? entry.hooks : [];
    return list.some((hook) => hook && typeof hook.command === 'string' && pattern.test(hook.command));
  });
}

// Older installs have the PreToolUse gate but no PreSkillShellCommand hook; add it on MCP start.
function needsSkillShellHook(filePath) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const settings = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const hooks = settings && settings.hooks;
    if (!hooks || typeof hooks !== 'object') return false;
    if (!entriesHaveCommand(hooks.PreToolUse, /\bgate-check\b/)) return false;
    return !entriesHaveCommand(hooks.PreSkillShellCommand, /\bskill-shell-gate\b/);
  } catch {
    return false;
  }
}

function repairMissingSkillShellHook(options = {}) {
  const env = options.env || process.env;
  const homeDir = options.homeDir || env.HOME || env.USERPROFILE || '';
  if (!homeDir) return { changed: false, skipped: true, reason: 'no-home' };
  if (env.THUMBGATE_DISABLE_CLAUDE_SELF_HEAL === '1') return { changed: false, skipped: true, reason: 'disabled' };
  const settingsPath = options.settingsPath || userSettingsPath(homeDir);
  if (!needsSkillShellHook(settingsPath)) return { changed: false, skipped: true, reason: 'nothing-to-add' };

  try {
    const wiring = require('./auto-wire-hooks');
    if (!wiring.claudeSupportsSkillShellHook(env)) return { changed: false, skipped: true, reason: 'claude-too-old' };
    // Add only the missing hook; never re-run the full installer (it would reset statusLine).
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const { matcher, hooks } = wiring.skillShellHookDefinition();
    settings.hooks.PreSkillShellCommand = [...(settings.hooks.PreSkillShellCommand || []), { matcher, hooks }];
    if (!options.dryRun) fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    // stderr only: the MCP server speaks JSON-RPC on stdout.
    console.error('[thumbgate] Added the PreSkillShellCommand hook to ~/.claude/settings.json (warn-only by default). It takes effect in new Claude Code sessions.');
    return { changed: true, settingsPath };
  } catch (error) {
    return { changed: false, skipped: true, reason: 'repair-failed', error };
  }
}

module.exports = {
  legacyLocalSettingsPath,
  needsSkillShellHook,
  repairMissingSkillShellHook,
  repairUnreadClaudeHooks,
  unreadFileHasThumbgateHooks,
};
