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
  codexObserveToolResultHookCommand,
  observeToolResultHookCommand,
  codexPreToolHookCommand,
  codexSessionStartHookCommand,
  codexStatuslineCommand,
  codexUserPromptHookCommand,
  preToolHookCommand,
  sessionStartHookCommand,
  skillShellHookCommand,
  statuslineCommand,
  userPromptHookCommand,
  cursorShellGateHookCommand,
  isPinnedCursorShellGateCommand,
  cursorCliHookCommand,
  isDisposableCheckout,
} = require('./hook-runtime');
const { installShim } = require('./install-shim');

function getHome() {
  return process.env.HOME || process.env.USERPROFILE || '';
}

// Bash|Shell stays an exact alternative. The teams clause is a regex so a
// successful Teams send is observed on PostToolUse, and the same matcher
// watches PostToolUseFailure because a non-zero shell exit never arrives
// on PostToolUse.
const OBSERVE_TOOL_MATCHER = '^(?:Bash|Shell|bash)$|teams.*(send|reply|post_message)';

// --- Hook definitions ---
// Built on demand, never at module load: the commands depend on whether the stable shim at
// ~/.thumbgate/bin/thumbgate-hook exists, and wireClaudeHooks installs it just before wiring.
// Built at load time, a first install wired hooks pinned to `thumbgate@<init version>`, which
// never update (2026-11-25, docs/decisions/2026-11-24-revenue-funnel-activation.md loop 3).
// PreSkillShellCommand (Claude Code 2.1.332) sees skill load-time shell commands. Older
// versions warn about the key on every start, so wire it only for 2.1.332+ (=1/=0 forces).
const SKILL_SHELL_MIN_CLAUDE = [2, 1, 332];
let cachedClaudeVersion;

function parseClaudeVersion(text) {
  const match = String(text || '').match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1, 4).map(Number) : null;
}

function versionAtLeast(version, minimum) {
  if (!version) return false;
  for (let i = 0; i < minimum.length; i += 1) {
    if (version[i] !== minimum[i]) return version[i] > minimum[i];
  }
  return true;
}

function installedClaudeVersion() {
  if (cachedClaudeVersion !== undefined) return cachedClaudeVersion;
  cachedClaudeVersion = null;
  try {
    const { spawnSync } = require('child_process');
    const result = spawnSync('claude', ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      shell: process.platform === 'win32',
    });
    if (result.status === 0) cachedClaudeVersion = parseClaudeVersion(result.stdout);
  } catch {
    cachedClaudeVersion = null;
  }
  return cachedClaudeVersion;
}

function claudeSupportsSkillShellHook(env = process.env) {
  const flag = String(env.THUMBGATE_SKILL_SHELL_HOOK || '').trim();
  if (flag === '1') return true;
  if (flag === '0') return false;
  return versionAtLeast(installedClaudeVersion(), SKILL_SHELL_MIN_CLAUDE);
}

function skillShellHookDefinition() {
  return { matcher: '.*', hooks: [{ type: 'command', command: skillShellHookCommand() }], legacyPattern: /\bskill-shell-gate\b/ };
}

function claudeHooks() {
  return {
    ...(claudeSupportsSkillShellHook() ? { PreSkillShellCommand: skillShellHookDefinition() } : {}),
    PreToolUse: {
      matcher: '.*',
      hooks: [{ type: 'command', command: preToolHookCommand() }],
    },
    UserPromptSubmit: {
      hooks: [{ type: 'command', command: userPromptHookCommand() }],
    },
    PostToolUse: [
      {
        matcher: 'mcp__thumbgate__feedback_stats|mcp__thumbgate__dashboard',
        hooks: [{ type: 'command', command: cacheUpdateHookCommand() }],
        legacyPattern: /(hook-thumbgate-cache-updater|cache-update\b)/,
      },
      {
        matcher: OBSERVE_TOOL_MATCHER,
        hooks: [{ type: 'command', command: observeToolResultHookCommand() }],
        legacyPattern: /observe-tool-result\b/,
      },
    ],
    PostToolUseFailure: {
      matcher: OBSERVE_TOOL_MATCHER,
      hooks: [{ type: 'command', command: observeToolResultHookCommand() }],
      legacyPattern: /observe-tool-result\b/,
    },
    SessionStart: {
      hooks: [{ type: 'command', command: sessionStartHookCommand() }],
    },
    Stop: {
      hooks: [{ type: 'command', command: claimStopHookCommand() }],
    },
  };
}

const CODEX_HOOKS = {
  PreToolUse: {
    matcher: '.*',
    hooks: [{ type: 'command', command: codexPreToolHookCommand() }],
  },
  UserPromptSubmit: {
    hooks: [{ type: 'command', command: codexUserPromptHookCommand() }],
  },
  PostToolUse: [
    {
      matcher: 'mcp__thumbgate__feedback_stats|mcp__thumbgate__dashboard',
      hooks: [{ type: 'command', command: codexCacheUpdateHookCommand() }],
      legacyPattern: /(hook-thumbgate-cache-updater|cache-update\b)/,
    },
    {
      matcher: OBSERVE_TOOL_MATCHER,
      hooks: [{ type: 'command', command: codexObserveToolResultHookCommand() }],
      legacyPattern: /observe-tool-result\b/,
    },
  ],
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

function cursorHooksJsonPath() {
  return path.join(getHome(), '.cursor', 'hooks.json');
}

function isStaleCursorGateCheckHook(entry) {
  const command = String(entry?.command || '');
  return command.includes('thumbgate') && command.includes('gate-check');
}

const CURSOR_LOOP_HOOKS = [
  { lifecycle: 'beforeSubmitPrompt', subcommand: 'cursor-prompt', extra: { timeout: 10 } },
  { lifecycle: 'beforeMCPExecution', subcommand: 'cursor-mcp-gate', extra: { timeout: 10, failClosed: true } },
  { lifecycle: 'afterShellExecution', subcommand: 'cursor-record', extra: { timeout: 10 } },
  { lifecycle: 'afterMCPExecution', subcommand: 'cursor-record', extra: { timeout: 10 } },
  { lifecycle: 'afterAgentResponse', subcommand: 'cursor-record', extra: { timeout: 10 } },
  { lifecycle: 'stop', subcommand: 'cursor-stop', extra: { timeout: 15, loop_limit: 1 } },
];

// Match by subcommand, not the exact command: the source checkout, the shim and `npx thumbgate@x` all spell it
// differently, and a second copy of the same hook would place every hold twice.
function isThumbgateLoopHook(entry, subcommand) {
  const command = String((entry && entry.command) || '');
  return /thumbgate|cli\.js/i.test(command) && new RegExp(`\\s["']?${subcommand}["']?(\\s|$)`).test(command);
}

function wireCursorBeforeShellGate(options = {}) {
  const hooksPath = options.cursorHooksPath || cursorHooksJsonPath();
  const command = cursorShellGateHookCommand();
  const hookEntry = { command, timeout: 10, failClosed: true };
  const added = [];

  let existing = { hooks: { beforeShellExecution: [] }, version: 1 };
  if (fs.existsSync(hooksPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
    } catch {
      return { changed: false, error: `Could not parse ${hooksPath}`, settingsPath: hooksPath, added: [] };
    }
  }
  if (!existing.hooks) existing.hooks = {};
  if (!Array.isArray(existing.hooks.beforeShellExecution)) {
    existing.hooks.beforeShellExecution = [];
  }

  const beforeShell = existing.hooks.beforeShellExecution;
  const isStale = (entry) => isStaleCursorGateCheckHook(entry) || isPinnedCursorShellGateCommand(entry && entry.command);
  const staleRemoved = beforeShell.filter(isStale);
  if (staleRemoved.length > 0) {
    existing.hooks.beforeShellExecution = beforeShell.filter((entry) => !isStale(entry));
    for (const entry of staleRemoved) {
      const why = isPinnedCursorShellGateCommand(entry.command) ? 'replaced install-pinned shell gate' : 'removed stale gate-check';
      added.push({ lifecycle: `beforeShellExecution (${why})`, command: entry.command });
    }
  }

  const alreadyWired = existing.hooks.beforeShellExecution.some((entry) => isThumbgateLoopHook(entry, 'cursor-gate'));
  if (!alreadyWired) {
    existing.hooks.beforeShellExecution.unshift(hookEntry);
    added.unshift({ lifecycle: 'beforeShellExecution', command });
  }

  // Installs from before AGENT-3667 have our entry without failClosed; Cursor lets a crashed or timed-out hook through
  // unless failClosed is true, so upgrade the entry in place.
  let upgradedFailClosed = false;
  for (const entry of existing.hooks.beforeShellExecution) {
    if (isThumbgateLoopHook(entry, 'cursor-gate') && entry.failClosed !== true) {
      entry.failClosed = true;
      upgradedFailClosed = true;
      added.push({ lifecycle: 'beforeShellExecution (failClosed set)', command });
    }
  }

  // The rest of the feedback loop: a typed thumbs-down/up reaches ThumbGate before the next tool call
  // (beforeSubmitPrompt), MCP chat sends go through the same holds and send rules (beforeMCPExecution), and the
  // claim gate sees what this turn ran and said (after* + stop). Without these a Cursor thumbs-down holds nothing.
  let loopAdded = 0;
  for (const spec of CURSOR_LOOP_HOOKS) {
    const command = cursorCliHookCommand(spec.subcommand);
    if (!Array.isArray(existing.hooks[spec.lifecycle])) existing.hooks[spec.lifecycle] = [];
    if (existing.hooks[spec.lifecycle].some((entry) => isThumbgateLoopHook(entry, spec.subcommand))) continue;
    existing.hooks[spec.lifecycle].push({ command, ...spec.extra });
    added.push({ lifecycle: spec.lifecycle, command });
    loopAdded += 1;
  }

  const changed = staleRemoved.length > 0 || !alreadyWired || upgradedFailClosed || loopAdded > 0;
  if (!changed) {
    return { changed: false, settingsPath: hooksPath, added: [] };
  }

  if (options.dryRun) {
    return { changed: true, dryRun: true, settingsPath: hooksPath, added };
  }

  const dir = path.dirname(hooksPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(hooksPath, JSON.stringify(existing, null, 2) + '\n');
  return { changed: true, settingsPath: hooksPath, added };
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

  const shellGateOpts = {
    ...options,
    cursorHooksPath: options.cursorHooksPath,
  };

  if (options.dryRun) {
    const shellGate = wireCursorBeforeShellGate(shellGateOpts);
    const mcpChanged = before !== after;
  return {
      changed: mcpChanged || shellGate.changed,
      dryRun: true,
      settingsPath: shellGate.settingsPath && shellGate.settingsPath !== mcpPath
        ? `${mcpPath}, ${shellGate.settingsPath}`
        : mcpPath,
      added: (mcpChanged ? [addedEntry] : []).concat(shellGate.added || []),
      shellGate,
    };
  }

  if (before === after) {
    const shellGate = wireCursorBeforeShellGate(shellGateOpts);
    if (shellGate.changed) {
      return {
        changed: true,
        settingsPath: shellGate.settingsPath || mcpPath,
        added: shellGate.added || [],
        shellGate,
      };
    }
    return { changed: false, settingsPath: mcpPath, added: [] };
  }

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(mcpPath, JSON.stringify(existing, null, 2) + '\n');
  const shellGate = wireCursorBeforeShellGate(shellGateOpts);
  const combinedAdded = [addedEntry].concat(shellGate.added || []);
  const settingsPath = shellGate.settingsPath && shellGate.settingsPath !== mcpPath
    ? `${mcpPath}, ${shellGate.settingsPath}`
    : mcpPath;
  return {
    changed: true,
    settingsPath,
    added: combinedAdded,
    shellGate,
  };
}

// --- Claude Code wiring ---

// Claude Code loads user-wide hooks from ~/.claude/settings.json. It does not read
// ~/.claude/settings.local.json (only <project>/.claude/settings.local.json), which is
// where init used to write them, so a default install's hooks never ran. Checked
// 2026-11-25 with Claude Code 2.1.332: a SessionStart hook in ~/.claude/settings.json
// ran, and the same hook in ~/.claude/settings.local.json did not.
function claudeSettingsPath() {
  return path.join(getHome(), '.claude', 'settings.json');
}

function claudeLegacyLocalSettingsPath() {
  return path.join(getHome(), '.claude', 'settings.local.json');
}

// Remove ThumbGate hooks from the old ~/.claude/settings.local.json so they are not
// left behind once they live in ~/.claude/settings.json. Other entries are kept.
function migrateLegacyLocalClaudeHooks(legacyPath, hookDefs, dryRun) {
  const legacy = loadJsonFile(legacyPath);
  if (!legacy || !legacy.hooks || typeof legacy.hooks !== 'object') return 0;
  let removed = 0;
  for (const { lifecycle, pattern, command } of hookDefs) {
    const entries = legacy.hooks[lifecycle];
    if (!Array.isArray(entries)) continue;
    const kept = entries.filter((entry) => {
      const entryHooks = Array.isArray(entry && entry.hooks) ? entry.hooks : [];
      const isThumbGate = entryHooks.some((hook) => {
        const cmd = hook && typeof hook.command === 'string' ? hook.command : '';
        return cmd === command || pattern.test(cmd) || /thumbgate/i.test(cmd);
      });
      return !isThumbGate;
    });
    removed += entries.length - kept.length;
    if (kept.length) legacy.hooks[lifecycle] = kept;
    else delete legacy.hooks[lifecycle];
  }
  if (removed && !dryRun) {
    if (Object.keys(legacy.hooks).length === 0) delete legacy.hooks;
    fs.writeFileSync(legacyPath, JSON.stringify(legacy, null, 2) + '\n');
  }
  return removed;
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
  // `python3 ~/.claude/hooks/x.py`: the shell expands ~ to the home folder. Without this the file reads as missing
  // and init deleted a person's working hook (standing-orders.py, 27 Nov 2026).
  if (s === '~' || s.startsWith('~/')) {
    const home = process.env.HOME || process.env.USERPROFILE || require('os').homedir();
    if (home) s = path.join(home, s.slice(1));
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
const SCRIPT_INTERPRETERS = new Set(['node', 'nodejs', 'sh', 'bash', 'zsh', 'python', 'python3']);

function staleHookPath(command, resolveBase) {
  if (!command) return null;
  const tokens = command.trim().split(/\s+/);
  let rawFirstToken = tokens[0];
  let runsScript = false;
  // `node /gone/script.js`: the interpreter is never a path, so check the script it runs.
  // Without this a hook that points at a deleted worktree survives every cleanup and breaks
  // each tool call (23 Nov 2026, ThumbGate-main-live).
  if (SCRIPT_INTERPRETERS.has(path.basename(rawFirstToken))) {
    // -c / -e / -p / --eval / --print run inline code, not a script file.
    let script = null;
    for (const token of tokens.slice(1)) {
      if (/^(-[cep]|--eval|--print)$/.test(token)) return null;
      if (!token.startsWith('-')) { script = token; break; }
    }
    if (!script) return null;
    rawFirstToken = script;
    runsScript = true;
  }
  const firstToken = expandShellToken(rawFirstToken, resolveBase);
  const looksLikePath =
    runsScript ||
    firstToken.includes('/') ||
    firstToken.includes('\\') ||
    firstToken.endsWith('.sh');
  if (!looksLikePath) return null;
  if (firstToken.includes('$')) return null;
  // ~otheruser/... is another account's home: never decide that is missing.
  if (firstToken.startsWith('~')) return null;
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

function hookDefinitionList(hookDefOrList) {
  return Array.isArray(hookDefOrList) ? hookDefOrList : [hookDefOrList];
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
  // Worktree checkouts get hooks that call the stable launcher, so it must exist.
  const sourceRoot = path.join(__dirname, '..');
  if (!dryRun && (!require('./mcp-config').isSourceCheckout(sourceRoot) || isDisposableCheckout(sourceRoot))) {
    try {
      installShim();
    } catch {
      // Non-fatal: fall back to version-pinned commands
    }
    // The hooks run the cached runtime, so a newer package than the runtime means init must refresh it
    // (it used to print "already configured" and leave the runtime behind). Detached, opt-out with
    // THUMBGATE_NO_AUTO_UPDATE=1.
    try {
      require('./runtime-auto-update').refreshRuntimeOnInit({ packageVersion: require('../package.json').version });
    } catch {
      // Best effort: the shim's daily check and the MCP path still catch up.
    }
  }

  const desiredStatusLine = statuslineCommand();

  // --- Step 0: clean up stale hooks from BOTH settings locations ---
  const staleWarnings = [];

  // User-level: ~/.claude/settings.json (or the explicit settingsPath)
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

  let migratedLegacyHooks = 0;
  if (!options.settingsPath) {
    const defs = [];
    for (const [lifecycle, hookDefOrList] of Object.entries(claudeHooks())) {
      for (const hookDef of hookDefinitionList(hookDefOrList)) {
        const pattern = hookDef.legacyPattern || legacyPatterns[lifecycle];
        if (pattern) defs.push({ lifecycle, pattern, command: hookDef.hooks[0].command });
      }
    }
    migratedLegacyHooks = migrateLegacyLocalClaudeHooks(claudeLegacyLocalSettingsPath(), defs, dryRun);
  }
  const migrationNote = migratedLegacyHooks
    ? [{ lifecycle: 'migration', command: `removed ${migratedLegacyHooks} ThumbGate hook(s) from ~/.claude/settings.local.json, which Claude Code does not read` }]
    : [];

  for (const [lifecycle, hookDefOrList] of Object.entries(claudeHooks())) {
    for (const hookDef of hookDefinitionList(hookDefOrList)) {
      const hookCommand = hookDef.hooks[0].command;
      const legacyPattern = hookDef.legacyPattern || legacyPatterns[lifecycle];
      const pruned = pruneLegacyHookEntries(settings.hooks[lifecycle], hookCommand, legacyPattern);
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
      const addedEntries = [{ lifecycle: 'statusLine', command: desiredStatusLine }, ...migrationNote];
      if (syncClaudeStatusLine(sharedSettingsPath, desiredStatusLine, dryRun)) {
        addedEntries.push({ lifecycle: 'statusLine', command: `${desiredStatusLine} (synced ~/.claude/settings.json)` });
      }
      return { changed: true, settingsPath, added: addedEntries };
    }
    const sharedStatusChanged = syncClaudeStatusLine(sharedSettingsPath, desiredStatusLine, dryRun);
    return {
      changed: sharedStatusChanged || migrationNote.length > 0,
      settingsPath,
      added: [
        ...(sharedStatusChanged ? [{ lifecycle: 'statusLine', command: `${desiredStatusLine} (synced ~/.claude/settings.json)` }] : []),
        ...migrationNote,
      ],
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
  added.push(...migrationNote);

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

  for (const [lifecycle, hookDefOrList] of Object.entries(CODEX_HOOKS)) {
    for (const hookDef of hookDefinitionList(hookDefOrList)) {
      const legacyPattern = hookDef.legacyPattern || legacyPatterns[lifecycle];
      added.push(...upsertCodexHook(config.hooks, lifecycle, hookDef, legacyPattern));
    }
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
    if (arg === '--help' || arg === '-h') flags.help = true;
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
  CURSOR_LOOP_HOOKS,
  isThumbgateLoopHook,
  detectAgent,
  wireHooks,
  wireClaudeHooks,
  wireCursorBeforeShellGate,
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
  codexTomlConfigPath,
  upsertCodexUserPromptToml,
  geminiSettingsPath,
  syncClaudeStatusLine,
  forgeConfigPath,
  pruneStaleFileHooks,
  staleHookPath,
  pruneStaleHooksInFile,
  claudeHooks,
  claudeSupportsSkillShellHook,
  skillShellHookDefinition,
  parseClaudeVersion,
  versionAtLeast,
  SKILL_SHELL_MIN_CLAUDE,
  preToolHookCommand,
  claimStopHookCommand,
  userPromptHookCommand,
  sessionStartHookCommand,
};
// Read at access time so the commands reflect whether the shim exists now.
Object.defineProperty(module.exports, 'CLAUDE_HOOKS', { enumerable: true, get: claudeHooks });

const USAGE = `Usage: node scripts/auto-wire-hooks.js [--agent=<claude-code|codex|gemini|forge|cursor>] [--dry-run] [--help]

  --dry-run   print the entries that would be written; write nothing
  --help, -h  print this text; write nothing
`;

if (require.main === module) {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    console.log(USAGE);
    process.exit(0);
  }
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
