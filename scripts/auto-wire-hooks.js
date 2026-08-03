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
  claimStopHookCommand,
  codexCacheUpdateHookCommand,
  codexPreToolHookCommand,
  codexSessionStartHookCommand,
  codexStatuslineCommand,
  codexUserPromptHookCommand,
  preToolHookCommand,
  sessionStartHookCommand,
  statuslineCommand,
  userPromptHookCommand,
} = require('./hook-runtime');
const { installShim } = require('./install-shim');

function getHome() {
  return process.env.HOME || process.env.USERPROFILE || '';
}

// --- Hook definitions ---
const CLAUDE_HOOKS = {
  PreToolUse: {
    matcher: '.*',
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
  Stop: {
    hooks: [{ type: 'command', command: claimStopHookCommand() }],
  },
};

const CODEX_HOOKS = {
  PreToolUse: {
    matcher: '.*',
    hooks: [{ type: 'command', command: codexPreToolHookCommand() }],
  },
  UserPromptSubmit: {
    hooks: [{ type: 'command', command: codexUserPromptHookCommand() }],
  },
  PostToolUse: {
    matcher: 'mcp__thumbgate__feedback_stats|mcp__thumbgate__dashboard',
    hooks: [{ type: 'command', command: codexCacheUpdateHookCommand() }],
  },
  SessionStart: {
    hooks: [{ type: 'command', command: codexSessionStartHookCommand() }],
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
    if (['cursor'].includes(normalized)) return 'cursor';
    return null;
  }

  // Auto-detect by checking for config files
  const home = getHome();
  if (fs.existsSync(path.join(home, '.claude'))) return 'claude-code';
  if (fs.existsSync(path.join(home, '.codex'))) return 'codex';
  if (fs.existsSync(path.join(home, '.gemini'))) return 'gemini';
  if (fs.existsSync(path.join(process.cwd(), 'forge.yaml'))) return 'forge';
  if (fs.existsSync(path.join(process.cwd(), '.cursor'))) return 'cursor';
  return null;
}

// --- Cursor wiring ---
// Cursor uses .cursor/mcp.json in the project root. We write the ThumbGate MCP
// server config there so Cursor picks up the server on next restart. Cursor's
// native hook model is different from Claude Code's — we rely on the MCP
// server's PreToolUse-equivalent enforcement via the gate-check tool.

function cursorMcpConfigPath() {
  return path.join(process.cwd(), '.cursor', 'mcp.json');
}

function wireCursorHooks(options = {}) {
  const mcpPath = cursorMcpConfigPath();
  const dir = path.dirname(mcpPath);
  const thumbgateServer = {
    command: 'npx',
    args: ['--yes', '--package', 'thumbgate@latest', 'thumbgate', 'serve'],
  };

  let existing = { mcpServers: {} };
  if (fs.existsSync(mcpPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
      if (!existing.mcpServers) existing.mcpServers = {};
    } catch {
      return { changed: false, error: `Could not parse ${mcpPath}` };
    }
  }

  const before = JSON.stringify(existing.mcpServers.thumbgate || null);
  existing.mcpServers.thumbgate = thumbgateServer;
  const after = JSON.stringify(existing.mcpServers.thumbgate);

  const addedEntry = {
    lifecycle: 'mcpServers.thumbgate',
    command: `${thumbgateServer.command} ${thumbgateServer.args.join(' ')}`,
  };

  if (options.dryRun) {
    return {
      changed: before !== after,
      dryRun: true,
      settingsPath: mcpPath,
      added: before === after ? [] : [addedEntry],
    };
  }

  if (before === after) {
    return { changed: false, settingsPath: mcpPath, added: [] };
  }

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(mcpPath, JSON.stringify(existing, null, 2) + '\n');
  return { changed: true, settingsPath: mcpPath, added: [addedEntry] };
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

function pruneNarrowPreToolEntries(hookArray, expectedCommand) {
  if (!Array.isArray(hookArray)) return { hooks: [], removed: false };
  let removed = false;
  const hooks = hookArray.filter((entry) => {
    const ownsCommand = Array.isArray(entry?.hooks)
      && entry.hooks.some((hook) => hook?.command === expectedCommand);
    const matcher = typeof entry?.matcher === 'string' ? entry.matcher.trim() : '';
    if (ownsCommand && matcher && matcher !== '.*') {
      removed = true;
      return false;
    }
    return true;
  });
  return { hooks, removed };
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
// Shell-style variable expansion limited to the env vars Claude Code
// documents for hook commands (CLAUDE_PROJECT_DIR), plus other process env
// vars. Surrounding ASCII quotes are stripped first so tokens like
// `"$CLAUDE_PROJECT_DIR"/.claude/hooks/x.sh` resolve correctly.
function expandShellToken(token, resolveBase) {
  let s = token;
  if (s.startsWith('"') && s.includes('"', 1)) {
    s = s.slice(1, s.indexOf('"', 1)) + s.slice(s.indexOf('"', 1) + 1);
  } else if (s.startsWith("'") && s.includes("'", 1)) {
    s = s.slice(1, s.indexOf("'", 1)) + s.slice(s.indexOf("'", 1) + 1);
  }
  const lookup = (name) => (name === 'CLAUDE_PROJECT_DIR'
    ? process.env.CLAUDE_PROJECT_DIR || resolveBase
    : process.env[name]);
  s = s.replace(/\$\{([A-Za-z_]\w*)\}/g, (_, n) => {
    const v = lookup(n);
    return v == null ? `\${${n}}` : v;
  });
  s = s.replace(/\$([A-Za-z_]\w*)/g, (_, n) => {
    const v = lookup(n);
    return v == null ? `$${n}` : v;
  });
  return s;
}

// Returns the raw (unexpanded) script-path token if the command points at a
// missing script file, else null. Anything that doesn't look like a file
// reference, or contains unresolved $VAR after expansion, returns null —
// caller treats null as "keep the hook" (err on the side of NOT pruning).
function staleHookPath(command, resolveBase) {
  if (!command) return null;
  const rawFirstToken = command.split(/\s+/)[0];
  const firstToken = expandShellToken(rawFirstToken, resolveBase);
  const looksLikePath =
    firstToken.includes('/') ||
    firstToken.includes('\\') ||
    firstToken.endsWith('.sh');
  if (!looksLikePath) return null;
  if (firstToken.includes('$')) return null;
  const resolved = path.isAbsolute(firstToken)
    ? firstToken
    : path.resolve(resolveBase, firstToken);
  return fs.existsSync(resolved) ? null : rawFirstToken;
}

function pruneStaleFileHooks(hookArray, baseDir) {
  if (!Array.isArray(hookArray)) {
    return { hooks: [], removedPaths: [] };
  }
  const resolveBase = baseDir || process.cwd();
  const removedPaths = [];
  const hooks = hookArray.filter((entry) => {
    const entryHooks = Array.isArray(entry && entry.hooks) ? entry.hooks : [];
    for (const hook of entryHooks) {
      const command = hook && typeof hook.command === 'string' ? hook.command : '';
      const stale = staleHookPath(command, resolveBase);
      if (stale !== null) {
        removedPaths.push(stale);
        return false;
      }
    }
    return true;
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

  // --- Install stable shim before resolving hook commands ---
  // The shim at ~/.thumbgate/bin/thumbgate-hook always resolves @latest,
  // so hooks never go stale across version bumps (Volta-style pattern).
  // Skip in source-checkout mode — developers use direct node commands.
  if (!dryRun && !require('./mcp-config').isSourceCheckout(path.join(__dirname, '..'))) {
    try {
      installShim();
    } catch {
      // Non-fatal: fall back to version-pinned commands
    }
  }

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
    Stop: /(hook-stop-anti-claim\.js|claim-stop-check\b)/,
  };

  for (const [lifecycle, hookDef] of Object.entries(CLAUDE_HOOKS)) {
    const hookCommand = hookDef.hooks[0].command;
    const pruned = pruneLegacyHookEntries(settings.hooks[lifecycle], hookCommand, legacyPatterns[lifecycle]);
    settings.hooks[lifecycle] = pruned.hooks;
    if (pruned.removed) {
      added.push({ lifecycle, command: `${hookCommand} (replaced legacy ThumbGate hook)` });
    }
    if (lifecycle === 'PreToolUse') {
      const coverage = pruneNarrowPreToolEntries(settings.hooks[lifecycle], hookCommand);
      settings.hooks[lifecycle] = coverage.hooks;
      if (coverage.removed) {
        added.push({ lifecycle, command: `${hookCommand} (expanded to all tools)` });
      }
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

function codexTomlConfigPath(configPath = codexConfigPath()) {
  return path.join(path.dirname(configPath), 'config.toml');
}

function escapeRegexLiteral(value) {
  return String(value).replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function tomlSectionRegex(name) {
  const sectionName = escapeRegexLiteral(name);
  return new RegExp(String.raw`^\[${sectionName}\]\n(?:^(?!\[).*(?:\n|$))*`, 'm');
}

function codexUserPromptTomlBlock() {
  const hookCommand = codexUserPromptHookCommand();
  return `[hooks.user_prompt_submit]\ncommand = "sh"\nargs = ["-lc", ${JSON.stringify(hookCommand)}]\n`;
}

function upsertCodexUserPromptToml(configPath, dryRun = false) {
  const tomlPath = codexTomlConfigPath(configPath);
  const current = fs.existsSync(tomlPath) ? fs.readFileSync(tomlPath, 'utf8') : '';
  const canonicalBlock = codexUserPromptTomlBlock();
  const sectionRegex = tomlSectionRegex('hooks.user_prompt_submit');
  const existingMatch = sectionRegex.exec(current);
  let next;

  if (existingMatch) {
    const existingBlock = existingMatch[0];
    if (existingBlock === canonicalBlock) {
      return { changed: false, settingsPath: tomlPath };
    }
    next = current.replace(sectionRegex, canonicalBlock);
  } else {
    const prefix = current.trimEnd();
    next = `${prefix}${prefix ? '\n\n' : ''}${canonicalBlock}`;
  }

  if (!dryRun) {
    const dir = path.dirname(tomlPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tomlPath, next.endsWith('\n') ? next : `${next}\n`);
  }

  return { changed: true, settingsPath: tomlPath };
}

function writeJsonFile(filePath, payload, dryRun) {
  if (dryRun) {
    return;
  }

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n');
}

function upsertCodexHook(configHooks, lifecycle, hookDef, legacyPattern) {
  const hookCommand = hookDef.hooks[0].command;
  const pruned = pruneLegacyHookEntries(configHooks[lifecycle], hookCommand, legacyPattern);
  configHooks[lifecycle] = pruned.hooks;

  const added = [];
  if (pruned.removed) {
    added.push({ lifecycle, command: `${hookCommand} (replaced legacy ThumbGate hook)` });
  }
  if (lifecycle === 'PreToolUse') {
    const coverage = pruneNarrowPreToolEntries(configHooks[lifecycle], hookCommand);
    configHooks[lifecycle] = coverage.hooks;
    if (coverage.removed) {
      added.push({ lifecycle, command: `${hookCommand} (expanded to all tools)` });
    }
  }

  if (hookAlreadyPresent(configHooks[lifecycle], hookCommand)) {
    return added;
  }

  const entry = { hooks: hookDef.hooks };
  if (hookDef.matcher) {
    entry.matcher = hookDef.matcher;
  }

  configHooks[lifecycle] = configHooks[lifecycle] || [];
  configHooks[lifecycle].push(entry);
  added.push({ lifecycle, command: hookCommand });
  return added;
}

function syncCodexStatusLine(config, desiredStatusLine) {
  if (config.statusLine && config.statusLine.command === desiredStatusLine) {
    return false;
  }

  config.statusLine = { type: 'command', command: desiredStatusLine };
  return true;
}

function wireCodexHooks(options) {
  const configPath = options.settingsPath || codexConfigPath();
  const dryRun = options.dryRun || false;
  const desiredStatusLine = codexStatuslineCommand();
  const tomlResult = upsertCodexUserPromptToml(configPath, dryRun);

  let config = loadJsonFile(configPath) || {};
  config.hooks = config.hooks || {};

  const added = [];
  const legacyPatterns = {
    PreToolUse: /(generate-pretool-hook\.sh|\bgate-check\b)/,
    UserPromptSubmit: /(hook-auto-capture\.sh|hook-auto-capture\b)/,
    PostToolUse: /(hook-thumbgate-cache-updater|cache-update\b)/,
    SessionStart: /(thumbgate_session_start\.sh|session-start\b)/,
  };

  for (const [lifecycle, hookDef] of Object.entries(CODEX_HOOKS)) {
    added.push(...upsertCodexHook(config.hooks, lifecycle, hookDef, legacyPatterns[lifecycle]));
  }

  if (added.length === 0) {
    if (syncCodexStatusLine(config, desiredStatusLine)) {
      writeJsonFile(configPath, config, dryRun);
      const statusAdded = [{ lifecycle: 'statusLine', command: desiredStatusLine }];
      if (tomlResult.changed) {
        statusAdded.push({ lifecycle: 'UserPromptSubmit', command: `${codexUserPromptHookCommand()} (${tomlResult.settingsPath})` });
      }
      return { changed: true, settingsPath: configPath, added: statusAdded };
    }
    return {
      changed: tomlResult.changed,
      settingsPath: configPath,
      added: tomlResult.changed
        ? [{ lifecycle: 'UserPromptSubmit', command: `${codexUserPromptHookCommand()} (${tomlResult.settingsPath})` }]
        : [],
    };
  }

  syncCodexStatusLine(config, desiredStatusLine);
  writeJsonFile(configPath, config, dryRun);

  added.push({ lifecycle: 'statusLine', command: desiredStatusLine });
  if (tomlResult.changed) {
    added.push({ lifecycle: 'UserPromptSubmit', command: `${codexUserPromptHookCommand()} (${tomlResult.settingsPath})` });
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
  settings.hooks.PreToolUse = pruneNarrowPreToolEntries(settings.hooks.PreToolUse, preToolCmd).hooks;
  const userPromptPruned = pruneLegacyHookEntries(settings.hooks.UserPromptSubmit, userPromptCmd, /(hook-auto-capture\.sh|hook-auto-capture\b)/);
  settings.hooks.UserPromptSubmit = userPromptPruned.hooks;

  if (!hookAlreadyPresent(settings.hooks.PreToolUse, preToolCmd)) {
    settings.hooks.PreToolUse = settings.hooks.PreToolUse || [];
    settings.hooks.PreToolUse.push({
      matcher: '.*',
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

  existing.hooks.PreToolUse = pruneNarrowPreToolEntries(existing.hooks.PreToolUse, preToolCmd).hooks;

  if (!hookAlreadyPresent(existing.hooks.PreToolUse, preToolCmd)) {
    existing.hooks.PreToolUse = existing.hooks.PreToolUse || [];
    existing.hooks.PreToolUse.push({
      matcher: '.*',
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
      error: 'Could not detect AI agent. Use --agent=claude-code|codex|gemini|forge|cursor',
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
    case 'cursor':
      result = wireCursorHooks(options);
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
  pruneNarrowPreToolEntries,
  loadJsonFile,
  parseFlags,
  claudeSettingsPath,
  claudeSharedSettingsPath,
  claudeProjectSettingsPath,
  codexConfigPath,
  codexTomlConfigPath,
  upsertCodexUserPromptToml,
  geminiSettingsPath,
  syncClaudeStatusLine,
  forgeConfigPath,
  pruneStaleFileHooks,
  pruneStaleHooksInFile,
  CLAUDE_HOOKS,
  preToolHookCommand,
  claimStopHookCommand,
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
