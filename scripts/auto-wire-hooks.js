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
const {
  cacheUpdateHookCommand,
  preToolHookCommand,
  sessionStartHookCommand,
  statuslineCommand,
  userPromptHookCommand,
} = require('./hook-runtime');

function getHome() {
  return process.env.HOME || process.env.USERPROFILE || '';
}

// --- Hook definitions ---
const CLAUDE_HOOKS = {
  PreToolUse: {
    matcher: 'Bash|Edit|Write|MultiEdit',
    hooks: [{ type: 'command', command: preToolHookCommand() }],
  },
  UserPromptSubmit: {
    hooks: [{ type: 'command', command: userPromptHookCommand() }],
  },
  PostToolUse: {
    matcher: 'mcp__thumbgate__feedback_stats|mcp__thumbgate__dashboard',
    hooks: [{ type: 'command', command: cacheUpdateHookCommand() }],
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
    if (['forge', 'forgecode', 'forge-code'].includes(normalized)) return 'forge';
    return null;
  }

  // Auto-detect by checking for config files
  const home = getHome();
  if (fs.existsSync(path.join(home, '.claude'))) return 'claude-code';
  if (fs.existsSync(path.join(home, '.codex'))) return 'codex';
  if (fs.existsSync(path.join(home, '.gemini'))) return 'gemini';
  if (fs.existsSync(path.join(process.cwd(), 'forge.yaml'))) return 'forge';
  return null;
}

// --- Claude Code wiring ---

function claudeSettingsPath() {
  return path.join(getHome(), '.claude', 'settings.local.json');
}

function claudeSharedSettingsPath() {
  return path.join(getHome(), '.claude', 'settings.json');
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

/**
 * pruneStaleFileHooks — Remove hook entries whose command references a shell
 * script path that no longer exists on disk.
 *
 * Only paths that look like file references (contain a `/` or `\`, or end with
 * `.sh`) are checked.  Pure command strings (node calls, npx invocations, etc.)
 * are left untouched.
 *
 * @param {Array}  hookArray  - The array of hook-entry objects for one lifecycle.
 * @param {string} [baseDir]  - Directory used to resolve relative paths
 *                              (defaults to process.cwd()).
 * @returns {{ hooks: Array, removedPaths: string[] }}
 */
function pruneStaleFileHooks(hookArray, baseDir) {
  if (!Array.isArray(hookArray)) {
    return { hooks: [], removedPaths: [] };
  }

  const resolveBase = baseDir || process.cwd();
  const removedPaths = [];

  const hooks = hookArray.filter((entry) => {
    const entryHooks = Array.isArray(entry && entry.hooks) ? entry.hooks : [];
    let shouldRemove = false;

    for (const hook of entryHooks) {
      const command = hook && typeof hook.command === 'string' ? hook.command : '';
      if (!command) continue;

      // Extract the first token as the potential script path.
      const firstToken = command.split(/\s+/)[0];

      // Only treat it as a file reference if it looks like a path.
      const looksLikePath =
        firstToken.includes('/') ||
        firstToken.includes('\\') ||
        firstToken.endsWith('.sh');

      if (!looksLikePath) continue;

      // Resolve the path (absolute or relative to baseDir).
      const resolved = path.isAbsolute(firstToken)
        ? firstToken
        : path.resolve(resolveBase, firstToken);

      if (!fs.existsSync(resolved)) {
        removedPaths.push(firstToken);
        shouldRemove = true;
        break;
      }
    }

    return !shouldRemove;
  });

  return { hooks, removedPaths };
}

function pruneLegacyHookEntries(hookArray, expectedCommand, legacyPattern) {
  if (!Array.isArray(hookArray)) {
    return { hooks: [], removed: false };
  }

  let removed = false;
  const hooks = hookArray.filter((entry) => {
    const entryHooks = Array.isArray(entry && entry.hooks) ? entry.hooks : [];
    const shouldRemove = entryHooks.some((hook) => {
      const command = hook && typeof hook.command === 'string' ? hook.command : '';
      return command !== expectedCommand && legacyPattern.test(command);
    });
    if (shouldRemove) {
      removed = true;
      return false;
    }
    return true;
  });

  return { hooks, removed };
}

function syncClaudeStatusLine(settingsPath, desiredStatusLine, dryRun) {
  const settings = loadJsonFile(settingsPath) || {};
  if (settings.statusLine && settings.statusLine.command === desiredStatusLine) {
    return false;
  }

  settings.statusLine = { type: 'command', command: desiredStatusLine };
  if (!dryRun) {
    const dir = path.dirname(settingsPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  }
  return true;
}

/**
 * claudeProjectSettingsPath — returns the project-level .claude/settings.json
 * path relative to the given base directory (defaults to CWD).
 */
function claudeProjectSettingsPath(baseDir) {
  return path.join(baseDir || process.cwd(), '.claude', 'settings.json');
}

/**
 * pruneStaleHooksInFile — reads a settings file, removes any hook entries that
 * reference missing shell script files, and writes the file back if changed.
 *
 * @param {string}  filePath - Absolute path to the settings JSON file.
 * @param {string}  baseDir  - Base directory for resolving relative script paths.
 * @param {boolean} dryRun   - When true, changes are computed but not persisted.
 * @returns {{ changed: boolean, removedPaths: string[] }}
 */
function pruneStaleHooksInFile(filePath, baseDir, dryRun) {
  const settings = loadJsonFile(filePath);
  if (!settings || !settings.hooks || typeof settings.hooks !== 'object') {
    return { changed: false, removedPaths: [] };
  }

  const allRemovedPaths = [];
  let changed = false;

  for (const lifecycle of Object.keys(settings.hooks)) {
    const { hooks, removedPaths } = pruneStaleFileHooks(settings.hooks[lifecycle], baseDir);
    if (removedPaths.length > 0) {
      settings.hooks[lifecycle] = hooks;
      allRemovedPaths.push(...removedPaths);
      changed = true;
    }
  }

  if (changed && !dryRun) {
    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2) + '\n');
  }

  return { changed, removedPaths: allRemovedPaths };
}

function wireClaudeHooks(options) {
  const settingsPath = options.settingsPath || claudeSettingsPath();
  const sharedSettingsPath = options.sharedSettingsPath || claudeSharedSettingsPath();
  const projectSettingsPath =
    options.projectSettingsPath || claudeProjectSettingsPath(options.projectDir);
  const dryRun = options.dryRun || false;
  const projectDir = options.projectDir || process.cwd();
  const desiredStatusLine = statuslineCommand();

  // --- Step 0: clean up stale hooks from BOTH settings locations ---
  const staleWarnings = [];

  // User-level: ~/.claude/settings.local.json
  const userStale = pruneStaleHooksInFile(settingsPath, projectDir, dryRun);
  for (const p of userStale.removedPaths) {
    const msg = `Removed stale hook referencing missing file: ${p}`;
    console.warn(msg);
    staleWarnings.push({ file: settingsPath, path: p });
  }

  // Project-level: $CWD/.claude/settings.json (takes precedence for some events)
  if (fs.existsSync(projectSettingsPath)) {
    const projStale = pruneStaleHooksInFile(projectSettingsPath, projectDir, dryRun);
    for (const p of projStale.removedPaths) {
      const msg = `Removed stale hook referencing missing file: ${p}`;
      console.warn(msg);
      staleWarnings.push({ file: projectSettingsPath, path: p });
    }
  }

  let settings = loadJsonFile(settingsPath) || {};
  settings.hooks = settings.hooks || {};

  const added = [];
  const legacyPatterns = {
    PreToolUse: /(generate-pretool-hook\.sh|\bgate-check\b)/,
    UserPromptSubmit: /(hook-auto-capture\.sh|hook-auto-capture\b)/,
    PostToolUse: /(hook-thumbgate-cache-updater|cache-update\b)/,
    SessionStart: /(thumbgate_session_start\.sh|session-start\b)/,
  };

  for (const [lifecycle, hookDef] of Object.entries(CLAUDE_HOOKS)) {
    const hookCommand = hookDef.hooks[0].command;
    const pruned = pruneLegacyHookEntries(settings.hooks[lifecycle], hookCommand, legacyPatterns[lifecycle]);
    settings.hooks[lifecycle] = pruned.hooks;
    if (pruned.removed) {
      added.push({ lifecycle, command: `${hookCommand} (replaced legacy ThumbGate hook)` });
    }

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
    if (!settings.statusLine || settings.statusLine.command !== desiredStatusLine) {
      if (!dryRun) {
        const dir = path.dirname(settingsPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      }
      settings.statusLine = { type: 'command', command: desiredStatusLine };
      if (!dryRun) {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
      }
      const addedEntries = [{ lifecycle: 'statusLine', command: desiredStatusLine }];
      if (syncClaudeStatusLine(sharedSettingsPath, desiredStatusLine, dryRun)) {
        addedEntries.push({ lifecycle: 'statusLine', command: `${desiredStatusLine} (synced ~/.claude/settings.json)` });
      }
      return { changed: true, settingsPath, added: addedEntries };
    }
    const sharedStatusChanged = syncClaudeStatusLine(sharedSettingsPath, desiredStatusLine, dryRun);
    return {
      changed: sharedStatusChanged,
      settingsPath,
      added: sharedStatusChanged ? [{ lifecycle: 'statusLine', command: `${desiredStatusLine} (synced ~/.claude/settings.json)` }] : [],
    };
  }

  settings.statusLine = { type: 'command', command: desiredStatusLine };

  if (!dryRun) {
    const dir = path.dirname(settingsPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  }

  if (syncClaudeStatusLine(sharedSettingsPath, desiredStatusLine, dryRun)) {
    added.push({ lifecycle: 'statusLine', command: `${desiredStatusLine} (synced ~/.claude/settings.json)` });
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

  const preToolPruned = pruneLegacyHookEntries(config.hooks.PreToolUse, preToolCmd, /(generate-pretool-hook\.sh|\bgate-check\b)/);
  config.hooks.PreToolUse = preToolPruned.hooks;
  const userPromptPruned = pruneLegacyHookEntries(config.hooks.UserPromptSubmit, userPromptCmd, /(hook-auto-capture\.sh|hook-auto-capture\b)/);
  config.hooks.UserPromptSubmit = userPromptPruned.hooks;

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

  const preToolPruned = pruneLegacyHookEntries(settings.hooks.PreToolUse, preToolCmd, /(generate-pretool-hook\.sh|\bgate-check\b)/);
  settings.hooks.PreToolUse = preToolPruned.hooks;
  const userPromptPruned = pruneLegacyHookEntries(settings.hooks.UserPromptSubmit, userPromptCmd, /(hook-auto-capture\.sh|hook-auto-capture\b)/);
  settings.hooks.UserPromptSubmit = userPromptPruned.hooks;

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

// --- ForgeCode wiring ---

function forgeConfigPath() {
  return path.join(process.cwd(), 'forge.yaml');
}

function wireForgeHooks(options) {
  const dryRun = options.dryRun || false;

  const preToolCmd = preToolHookCommand();
  const userPromptCmd = userPromptHookCommand();

  // ForgeCode uses YAML config (forge.yaml). We write a JSON-based hooks
  // sidecar file (.thumbgate/forge-hooks.json) and append skill entries to
  // forge.yaml if they are not already present.
  const hooksPath = options.settingsPath || path.join(path.dirname(forgeConfigPath()), '.thumbgate', 'forge-hooks.json');
  let existing = loadJsonFile(hooksPath) || {};
  existing.hooks = existing.hooks || {};

  const added = [];

  if (!hookAlreadyPresent(existing.hooks.PreToolUse, preToolCmd)) {
    existing.hooks.PreToolUse = existing.hooks.PreToolUse || [];
    existing.hooks.PreToolUse.push({
      matcher: 'Bash',
      hooks: [{ type: 'command', command: preToolCmd }],
    });
    added.push({ lifecycle: 'PreToolUse', command: preToolCmd });
  }

  if (!hookAlreadyPresent(existing.hooks.UserPromptSubmit, userPromptCmd)) {
    existing.hooks.UserPromptSubmit = existing.hooks.UserPromptSubmit || [];
    existing.hooks.UserPromptSubmit.push({
      hooks: [{ type: 'command', command: userPromptCmd }],
    });
    added.push({ lifecycle: 'UserPromptSubmit', command: userPromptCmd });
  }

  if (added.length === 0) {
    return { changed: false, settingsPath: hooksPath, added: [] };
  }

  if (!dryRun) {
    const dir = path.dirname(hooksPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(hooksPath, JSON.stringify(existing, null, 2) + '\n');
  }

  return { changed: true, settingsPath: hooksPath, added };
}

// --- Dispatcher ---

function wireHooks(options) {
  const agent = detectAgent(options.agent);
  if (!agent) {
    return {
      error: 'Could not detect AI agent. Use --agent=claude-code|codex|gemini|forge',
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
    case 'forge':
      result = wireForgeHooks(options);
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
  wireForgeHooks,
  hookAlreadyPresent,
  loadJsonFile,
  parseFlags,
  claudeSettingsPath,
  claudeSharedSettingsPath,
  claudeProjectSettingsPath,
  codexConfigPath,
  geminiSettingsPath,
  syncClaudeStatusLine,
  forgeConfigPath,
  pruneStaleFileHooks,
  pruneStaleHooksInFile,
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
