#!/usr/bin/env node
'use strict';

/**
 * auto-wire-hooks.js — Auto-wire PreToolUse hooks into AI agent settings.
 *
 * Detects the AI agent (claude-code, codex, gemini) and injects ThumbGate gate
 * hooks into the agent's settings file. Preserves existing hooks.
 *
 * Usage:
 *   node scripts/auto-wire-hooks.js --agent claude-code
 *   node scripts/auto-wire-hooks.js                      # auto-detect
 *   node scripts/auto-wire-hooks.js --dry-run             # preview only
 */

const fs = require('fs');
const path = require('path');

const PKG_ROOT = path.join(__dirname, '..');

function quoteShellPath(filePath) {
  return `"${String(filePath).replace(/"/g, '\\"')}"`;
}

function getHome() {
  return process.env.HOME || process.env.USERPROFILE || '';
}

// --- Hook definitions ---

function preToolHookCommand() {
  return `bash ${quoteShellPath(path.join(PKG_ROOT, 'scripts', 'generate-pretool-hook.sh'))}`;
}

function userPromptHookCommand() {
  return `bash ${quoteShellPath(path.join(PKG_ROOT, 'scripts', 'hook-auto-capture.sh'))}`;
}

function sessionStartHookCommand() {
  return 'bash scripts/thumbgate_session_start.sh';
  return `bash ${quoteShellPath(path.join(PKG_ROOT, 'scripts', 'rlhf_session_start.sh'))}`;
}

const CLAUDE_HOOKS = {
  PreToolUse: {
    matcher: 'Bash',
    hooks: [{ type: 'command', command: preToolHookCommand() }],
  },
  UserPromptSubmit: {
    hooks: [{ type: 'command', command: userPromptHookCommand() }],
  },
  SessionStart: {
    hooks: [{ type: 'command', command: sessionStartHookCommand() }],
  },
};

// --- Agent detection ---

function detectAgent(flagAgent) {
  if (flagAgent) {
    const normalized = flagAgent.toLowerCase().replace(/[_\s]/g, '-');
    if (['claude-code', 'claude'].includes(normalized)) return 'claude-code';
    if (['codex'].includes(normalized)) return 'codex';
    if (['gemini'].includes(normalized)) return 'gemini';
    return null;
  }

  // Auto-detect by checking for config files
  const home = getHome();
  if (fs.existsSync(path.join(home, '.claude'))) return 'claude-code';
  if (fs.existsSync(path.join(home, '.codex'))) return 'codex';
  if (fs.existsSync(path.join(home, '.gemini'))) return 'gemini';
  return null;
}

// --- Claude Code wiring ---

function claudeSettingsPath() {
  return path.join(getHome(), '.claude', 'settings.local.json');
}

function loadJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function hookAlreadyPresent(hookArray, command) {
  if (!Array.isArray(hookArray)) return false;
  return hookArray.some(
    (entry) =>
      Array.isArray(entry.hooks) &&
      entry.hooks.some((h) => h.command === command)
  );
}

function wireClaudeHooks(options) {
  const settingsPath = options.settingsPath || claudeSettingsPath();
  const dryRun = options.dryRun || false;

  let settings = loadJsonFile(settingsPath) || {};
  settings.hooks = settings.hooks || {};

  const added = [];

  for (const [lifecycle, hookDef] of Object.entries(CLAUDE_HOOKS)) {
    const hookCommand = hookDef.hooks[0].command;

    if (hookAlreadyPresent(settings.hooks[lifecycle], hookCommand)) {
      continue;
    }

    settings.hooks[lifecycle] = settings.hooks[lifecycle] || [];
    const entry = { hooks: hookDef.hooks };
    if (hookDef.matcher) {
      entry.matcher = hookDef.matcher;
    }
    settings.hooks[lifecycle].push(entry);
    added.push({ lifecycle, command: hookCommand });
  }

  if (added.length === 0) {
    return { changed: false, settingsPath, added: [] };
  }

  if (!dryRun) {
    const dir = path.dirname(settingsPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  }

  return { changed: true, settingsPath, added };
}

// --- Codex wiring ---

function codexConfigPath() {
  return path.join(getHome(), '.codex', 'config.json');
}

function wireCodexHooks(options) {
  const configPath = options.settingsPath || codexConfigPath();
  const dryRun = options.dryRun || false;

  let config = loadJsonFile(configPath) || {};
  config.hooks = config.hooks || {};

  const added = [];
  const preToolCmd = preToolHookCommand();
  const userPromptCmd = userPromptHookCommand();

  if (!hookAlreadyPresent(config.hooks.PreToolUse, preToolCmd)) {
    config.hooks.PreToolUse = config.hooks.PreToolUse || [];
    config.hooks.PreToolUse.push({
      matcher: 'Bash',
      hooks: [{ type: 'command', command: preToolCmd }],
    });
    added.push({ lifecycle: 'PreToolUse', command: preToolCmd });
  }

  if (!hookAlreadyPresent(config.hooks.UserPromptSubmit, userPromptCmd)) {
    config.hooks.UserPromptSubmit = config.hooks.UserPromptSubmit || [];
    config.hooks.UserPromptSubmit.push({
      hooks: [{ type: 'command', command: userPromptCmd }],
    });
    added.push({ lifecycle: 'UserPromptSubmit', command: userPromptCmd });
  }

  if (added.length === 0) {
    return { changed: false, settingsPath: configPath, added: [] };
  }

  if (!dryRun) {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  }

  return { changed: true, settingsPath: configPath, added };
}

// --- Gemini wiring ---

function geminiSettingsPath() {
  return path.join(getHome(), '.gemini', 'settings.json');
}

function wireGeminiHooks(options) {
  const settingsPath = options.settingsPath || geminiSettingsPath();
  const dryRun = options.dryRun || false;

  let settings = loadJsonFile(settingsPath) || {};
  settings.hooks = settings.hooks || {};

  const added = [];
  const preToolCmd = preToolHookCommand();
  const userPromptCmd = userPromptHookCommand();

  if (!hookAlreadyPresent(settings.hooks.PreToolUse, preToolCmd)) {
    settings.hooks.PreToolUse = settings.hooks.PreToolUse || [];
    settings.hooks.PreToolUse.push({
      matcher: 'Bash',
      hooks: [{ type: 'command', command: preToolCmd }],
    });
    added.push({ lifecycle: 'PreToolUse', command: preToolCmd });
  }

  if (!hookAlreadyPresent(settings.hooks.UserPromptSubmit, userPromptCmd)) {
    settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit || [];
    settings.hooks.UserPromptSubmit.push({
      hooks: [{ type: 'command', command: userPromptCmd }],
    });
    added.push({ lifecycle: 'UserPromptSubmit', command: userPromptCmd });
  }

  if (added.length === 0) {
    return { changed: false, settingsPath, added: [] };
  }

  if (!dryRun) {
    const dir = path.dirname(settingsPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  }

  return { changed: true, settingsPath, added };
}

// --- Dispatcher ---

function wireHooks(options) {
  const agent = detectAgent(options.agent);
  if (!agent) {
    return {
      error: 'Could not detect AI agent. Use --agent=claude-code|codex|gemini',
      agent: null,
      changed: false,
    };
  }

  let result;
  switch (agent) {
    case 'claude-code':
      result = wireClaudeHooks(options);
      break;
    case 'codex':
      result = wireCodexHooks(options);
      break;
    case 'gemini':
      result = wireGeminiHooks(options);
      break;
    default:
      return { error: `Unsupported agent: ${agent}`, agent, changed: false };
  }

  return { ...result, agent };
}

function parseFlags(argv) {
  const flags = {};
  for (const arg of argv) {
    if (arg === '--dry-run') flags.dryRun = true;
    if (arg === '--wire-hooks') flags.wireHooks = true;
    if (arg.startsWith('--agent=')) flags.agent = arg.slice('--agent='.length);
    if (arg.startsWith('--agent') && !arg.includes('=')) {
      const idx = argv.indexOf(arg);
      if (idx + 1 < argv.length && !argv[idx + 1].startsWith('--')) {
        flags.agent = argv[idx + 1];
      }
    }
  }
  return flags;
}

// --- Exports ---

module.exports = {
  detectAgent,
  wireHooks,
  wireClaudeHooks,
  wireCodexHooks,
  wireGeminiHooks,
  hookAlreadyPresent,
  loadJsonFile,
  parseFlags,
  claudeSettingsPath,
  codexConfigPath,
  geminiSettingsPath,
  CLAUDE_HOOKS,
  preToolHookCommand,
  userPromptHookCommand,
  sessionStartHookCommand,
};

if (require.main === module) {
  const flags = parseFlags(process.argv.slice(2));
  const result = wireHooks(flags);

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (!result.changed) {
    console.log(`Hooks already wired for ${result.agent} at ${result.settingsPath}`);
  } else {
    const prefix = flags.dryRun ? '[DRY RUN] Would add' : 'Added';
    console.log(`${prefix} hooks for ${result.agent}:`);
    for (const h of result.added) {
      console.log(`  ${h.lifecycle}: ${h.command}`);
    }
    console.log(`  Settings: ${result.settingsPath}`);
  }
}
