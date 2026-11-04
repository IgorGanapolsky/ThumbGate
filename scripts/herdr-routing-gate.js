'use strict';

/**
 * herdr-routing-gate.js
 *
 * PreToolUse rule: an Edit, Write, or file-changing Bash call whose target is
 * under ~/workspace/ThumbGate or ~/workspace/dayglass is denied when the calling
 * session's working directory is outside that repository.
 *
 * Deny message format:
 * "This repo is worked by its herdr agent. Use skill herdr-delegate: herdr --session <thumbgate|dayglass> agent prompt <pane> ..."
 *
 * Reads stay allowed. Sessions running inside the repository are never blocked.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const PROTECTED_REPOS = [
  {
    name: 'ThumbGate',
    session: 'thumbgate',
    // Target repo paths relative to homedir or absolute
    relativePaths: ['workspace/ThumbGate', 'workspace/thumbgate'],
  },
  {
    name: 'dayglass',
    session: 'dayglass',
    relativePaths: ['workspace/dayglass', 'workspace/Dayglass'],
  },
];

const READ_ONLY_TOOLS = new Set([
  'read',
  'read_file',
  'view',
  'grep',
  'glob',
  'list_dir',
  'search',
  'find',
]);

const EDIT_WRITE_TOOLS = new Set([
  'edit',
  'write',
  'multiedit',
  'strreplace',
  'str_replace_editor',
  'notebookedit',
  'notebook_edit',
  'applypatch',
  'patch',
]);

// Read-only command patterns when run via Bash
const READ_ONLY_BASH_COMMANDS = new Set([
  'cat',
  'head',
  'tail',
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'ag',
  'find',
  'ls',
  'stat',
  'file',
  'wc',
  'diff',
  'which',
  'whereis',
  'pwd',
  'echo',
  'printf',
]);

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  'status',
  'log',
  'diff',
  'show',
  'branch',
  'rev-parse',
  'describe',
  'tag',
  'remote',
  'config',
  'ls-files',
  'ls-remote',
  'cat-file',
  'check-ref-format',
  'shortlog',
  'stash',
]);

function expandHome(p) {
  if (!p || typeof p !== 'string') return '';
  const home = os.homedir();
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(home, p.slice(2));
  }
  return p;
}

function resolveProtectedRepos() {
  const home = os.homedir();
  const resolved = [];

  for (const repo of PROTECTED_REPOS) {
    const paths = new Set();
    for (const rel of repo.relativePaths) {
      const full = path.resolve(home, rel);
      paths.add(full);
      try {
        if (fs.existsSync(full)) {
          paths.add(fs.realpathSync(full));
        }
      } catch (_) {}
    }
    resolved.push({
      name: repo.name,
      session: repo.session,
      paths: Array.from(paths),
    });
  }
  return resolved;
}

function resolveCanonicalPath(targetPath, baseCwd) {
  if (!targetPath || typeof targetPath !== 'string') return '';
  let cleaned = targetPath.trim().replace(/^['"]|['"]$/g, '');
  if (!cleaned) return '';

  let absolute;
  if (cleaned.startsWith('~')) {
    absolute = expandHome(cleaned);
  } else if (path.isAbsolute(cleaned)) {
    absolute = cleaned;
  } else if (baseCwd) {
    absolute = path.resolve(baseCwd, cleaned);
  } else {
    absolute = path.resolve(cleaned);
  }

  // Canonicalize via realpath if exists, or canonicalize existing ancestors
  try {
    return fs.realpathSync(absolute);
  } catch (_) {
    // If the path does not exist yet (e.g. creating a new file), canonicalize the parent directory
    let current = path.dirname(absolute);
    const parts = [path.basename(absolute)];
    while (current && current !== path.dirname(current)) {
      try {
        if (fs.existsSync(current)) {
          const realParent = fs.realpathSync(current);
          return path.join(realParent, ...parts);
        }
      } catch (_) {}
      parts.unshift(path.basename(current));
      current = path.dirname(current);
    }
    return path.normalize(absolute);
  }
}

function isInsideDirectory(childPath, parentDir) {
  if (!childPath || !parentDir) return false;
  const rel = path.relative(parentDir, childPath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function matchProtectedRepo(candidatePath) {
  if (!candidatePath) return null;
  const repos = resolveProtectedRepos();
  for (const repo of repos) {
    for (const repoPath of repo.paths) {
      if (isInsideDirectory(candidatePath, repoPath)) {
        return repo;
      }
    }
  }
  return null;
}

function isCallingCwdInsideRepo(callingCwd, repo) {
  if (!callingCwd || !repo) return false;
  const canonicalCwd = resolveCanonicalPath(callingCwd);
  for (const repoPath of repo.paths) {
    if (isInsideDirectory(canonicalCwd, repoPath)) {
      return true;
    }
  }
  return false;
}

function isBashReadOnly(command) {
  if (!command || typeof command !== 'string') return false;
  const cmd = command.trim();

  // If there are output redirections (> or >>), it is a mutating command
  // Note: 2>&1 without other redirection is allowed, but > file or >> file is mutating
  if (/(?:^|[^&21])>{1,2}\s*[^&]/.test(cmd)) {
    return false;
  }

  // Tokenize compound commands (&&, ||, ;, |)
  // If any sub-command in a pipeline or chain is mutating, it's not read-only.
  const subCommands = cmd.split(/(?:&&|\|\||;|\||\n)/).map((s) => s.trim()).filter(Boolean);
  if (subCommands.length === 0) return true;

  for (const sub of subCommands) {
    // Strip leading env vars or cd if any
    const parts = sub.split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;

    let idx = 0;
    while (idx < parts.length && parts[idx].includes('=')) {
      idx++;
    }
    if (idx >= parts.length) continue;

    const baseCmd = path.basename(parts[idx]);
    if (baseCmd === 'git') {
      // Skip flags like -C <path> before subcommand
      let subIdx = idx + 1;
      while (subIdx < parts.length) {
        if (parts[subIdx] === '-C') {
          subIdx += 2;
          continue;
        }
        if (parts[subIdx].startsWith('-')) {
          subIdx++;
          continue;
        }
        break;
      }
      const gitSub = parts[subIdx];
      if (!gitSub || !READ_ONLY_GIT_SUBCOMMANDS.has(gitSub)) {
        return false;
      }
      continue;
    }

    if (READ_ONLY_BASH_COMMANDS.has(baseCmd)) {
      continue;
    }

    // Any other command is considered potentially mutating
    return false;
  }

  return true;
}

function extractFileTargetsFromToolInput(toolInput = {}) {
  const targets = [];
  const scalarKeys = [
    'file_path',
    'filePath',
    'path',
    'target_path',
    'target_file',
    'notebook_path',
    'notebookPath',
  ];
  for (const k of scalarKeys) {
    if (typeof toolInput[k] === 'string' && toolInput[k].trim()) {
      targets.push(toolInput[k].trim());
    }
  }

  const arrayKeys = ['files', 'file_paths', 'filePaths', 'paths', 'changed_files', 'changedFiles'];
  for (const k of arrayKeys) {
    if (Array.isArray(toolInput[k])) {
      for (const item of toolInput[k]) {
        if (typeof item === 'string' && item.trim()) {
          targets.push(item.trim());
        }
      }
    }
  }

  return targets;
}

function extractFileTargetsFromBash(command, callingCwd) {
  if (!command || typeof command !== 'string') return [];
  const targets = [];

  // Match redirection targets: > file or >> file
  const redirRegex = /(?:^|[^&21])>{1,2}\s*([^\s;|<>&]+)/g;
  let match;
  while ((match = redirRegex.exec(command)) !== null) {
    if (match[1]) targets.push(match[1]);
  }

  // Match arguments following common mutating commands
  // rm, touch, mkdir, cp, mv, sed -i, etc.
  const mutatingCmdRegex = /\b(?:rm|touch|mkdir|cp|mv|truncate|tee|unlink|rmdir)\s+([^;&|\n]+)/g;
  while ((match = mutatingCmdRegex.exec(command)) !== null) {
    const rawArgs = match[1].trim();
    // Split arguments, ignoring flags
    const tokens = rawArgs.split(/\s+/).filter((t) => t && !t.startsWith('-'));
    targets.push(...tokens);
  }

  // Match git -C <repo> or cd <repo> && ...
  const gitMinusCRegex = /\bgit\s+(?:-[a-zA-Z0-9_-]+\s+)*-C\s+([^\s;|<>&]+)/g;
  while ((match = gitMinusCRegex.exec(command)) !== null) {
    const repoPath = match[1];
    targets.push(repoPath);
  }

  const cdThenRegex = /\bcd\s+([^\s;&|]+)/g;
  while ((match = cdThenRegex.exec(command)) !== null) {
    const cdTarget = match[1];
    targets.push(cdTarget);
  }

  // Check any tokens in command that contain paths to protected repos
  // e.g. path strings containing ThumbGate or dayglass
  const tokenRegex = /([~a-zA-Z0-9_\-./]+(?:ThumbGate|dayglass)[~a-zA-Z0-9_\-./]*)/gi;
  while ((match = tokenRegex.exec(command)) !== null) {
    targets.push(match[1]);
  }

  return targets;
}

/**
 * Evaluates the Herdr routing gate for a tool call.
 *
 * @param {Object} input - Tool call input
 * @param {string} [input.tool_name]
 * @param {string} [input.toolName]
 * @param {Object} [input.tool_input]
 * @param {Object} [input.toolInput]
 * @param {string} [input.cwd]
 * @returns {Object|null} Gate result if blocked, or null if allowed.
 */
function evaluateHerdrRoutingGate(input = {}) {
  const toolName = input.tool_name || input.toolName || '';
  const rawInput = input.tool_input ?? input.toolInput ?? {};
  const toolInput = typeof rawInput === 'object' && rawInput !== null ? rawInput : {};

  // Calling session working directory
  const callingCwd =
    input.cwd ||
    toolInput.cwd ||
    process.env.CLAUDE_PROJECT_DIR ||
    process.cwd();

  const toolLower = toolName.toLowerCase();

  // 1. If tool is explicitly read-only, allow
  if (READ_ONLY_TOOLS.has(toolLower)) {
    return null;
  }

  const isBash = toolLower === 'bash' || toolLower === 'shell' || toolLower === 'terminal';
  const isEditWrite = EDIT_WRITE_TOOLS.has(toolLower) || EDIT_WRITE_TOOLS.has(toolName);

  let targetPaths = [];

  if (isEditWrite) {
    targetPaths = extractFileTargetsFromToolInput(toolInput);
    if (targetPaths.length === 0 && toolInput.command) {
      targetPaths = extractFileTargetsFromBash(toolInput.command, callingCwd);
    }
  } else if (isBash) {
    const command = toolInput.command || toolInput.cmd || '';
    if (!command || isBashReadOnly(command)) {
      return null;
    }
    targetPaths = extractFileTargetsFromBash(command, callingCwd);
  } else {
    // Check if other tools specify targets under protected repos
    targetPaths = extractFileTargetsFromToolInput(toolInput);
  }

  if (targetPaths.length === 0) {
    return null;
  }

  for (const rawTarget of targetPaths) {
    const canonicalTarget = resolveCanonicalPath(rawTarget, callingCwd);
    const protectedRepo = matchProtectedRepo(canonicalTarget);
    if (protectedRepo) {
      // Target is inside protectedRepo. Check if the calling session is inside the protected repo itself.
      if (isCallingCwdInsideRepo(callingCwd, protectedRepo)) {
        // Sessions running inside the repo are never blocked
        return null;
      }

      // Calling session is outside the repo! Deny.
      const message = `This repo is worked by its herdr agent. Use skill herdr-delegate: herdr --session ${protectedRepo.session} agent prompt <pane> ...`;
      return {
        decision: 'deny',
        gate: 'herdr-routing-gate',
        severity: 'critical',
        failureReason: message,
        message,
        repo: protectedRepo.name,
        session: protectedRepo.session,
      };
    }
  }

  return null;
}

module.exports = {
  evaluateHerdrRoutingGate,
  resolveProtectedRepos,
  resolveCanonicalPath,
  isInsideDirectory,
  matchProtectedRepo,
  isCallingCwdInsideRepo,
  isBashReadOnly,
  PROTECTED_REPOS,
};
