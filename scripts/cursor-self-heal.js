'use strict';

// Self-heal for Cursor installs made by thumbgate <= 1.45.0. Their `init --agent cursor` wired only
// beforeShellExecution in ~/.cursor/hooks.json, so a thumbs-down typed in Cursor never reached ThumbGate and MCP
// chat sends were never gated. On MCP server start (from .cursor/mcp.json) and on the shell gate, this adds the
// missing loop hooks (beforeSubmitPrompt, beforeMCPExecution, after*, stop). It writes only when the file already
// holds ThumbGate's shell gate and a loop hook is missing, so after the first repair it is a read and nothing else.
// It never writes to stdout (the MCP server and the shell gate both speak JSON there).
// Opt out with THUMBGATE_DISABLE_CURSOR_SELF_HEAL=1.

const fs = require('fs');
const path = require('path');

function cursorHooksPath(homeDir) {
  return path.join(homeDir, '.cursor', 'hooks.json');
}

function hasThumbgateShellGate(hooks) {
  const entries = Array.isArray(hooks && hooks.beforeShellExecution) ? hooks.beforeShellExecution : [];
  return entries.some((entry) => /cursor-shell-gate\.js/.test(String((entry && entry.command) || '')));
}

function repairCursorHooks(options = {}) {
  const env = options.env || process.env;
  const homeDir = options.homeDir || env.HOME || env.USERPROFILE || '';
  if (!homeDir) return { changed: false, skipped: true, reason: 'no-home' };
  if (env.THUMBGATE_DISABLE_CURSOR_SELF_HEAL === '1') return { changed: false, skipped: true, reason: 'disabled' };
  const file = cursorHooksPath(homeDir);
  let config;
  try {
    if (!fs.existsSync(file)) return { changed: false, skipped: true, reason: 'no-cursor-hooks' };
    config = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { changed: false, skipped: true, reason: 'unreadable' };
  }
  if (!config || !config.hooks || !hasThumbgateShellGate(config.hooks)) {
    return { changed: false, skipped: true, reason: 'not-a-thumbgate-cursor-install' };
  }
  const { CURSOR_LOOP_HOOKS, isThumbgateLoopHook } = require('./auto-wire-hooks');
  const { cursorCliHookCommand } = require('./hook-runtime');
  const added = [];
  for (const spec of CURSOR_LOOP_HOOKS) {
    if (!Array.isArray(config.hooks[spec.lifecycle])) config.hooks[spec.lifecycle] = [];
    if (config.hooks[spec.lifecycle].some((entry) => isThumbgateLoopHook(entry, spec.subcommand))) continue;
    const command = cursorCliHookCommand(spec.subcommand);
    config.hooks[spec.lifecycle].push({ command, ...spec.extra });
    added.push({ lifecycle: spec.lifecycle, command });
  }
  if (added.length === 0) return { changed: false, skipped: true, reason: 'already-wired' };
  if (options.dryRun) return { changed: true, dryRun: true, settingsPath: file, added };
  try {
    fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  } catch (error) {
    return { changed: false, skipped: true, reason: 'write-failed', error };
  }
  console.error(`[thumbgate] Added ${added.length} Cursor hook(s) to ~/.cursor/hooks.json so a thumbs-down holds the next action. Restart Cursor to load them.`);
  return { changed: true, settingsPath: file, added };
}

module.exports = { cursorHooksPath, hasThumbgateShellGate, repairCursorHooks };
