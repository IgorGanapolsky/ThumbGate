#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CONFIG_HOOKS_MIN_VERSION = { major: 2, minor: 54, patch: 0 };
const THUMBGATE_PRE_COMMIT = 'thumbgate-pre-commit';
const THUMBGATE_PRE_PUSH = 'thumbgate-pre-push';

function parseGitVersion(versionText) {
  const match = String(versionText || '').match(/git version (\d+)\.(\d+)\.(\d+)/i);
  if (!match) {
    return null;
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

function compareVersions(left, right) {
  if (!left || !right) {
    return -1;
  }
  if (left.major !== right.major) {
    return left.major - right.major;
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }
  return left.patch - right.patch;
}

function supportsConfigBasedHooks(versionText) {
  return compareVersions(parseGitVersion(versionText), CONFIG_HOOKS_MIN_VERSION) >= 0;
}

function runGit(args, cwd, { allowFailure = false } = {}) {
  // NOSONAR javascript:S4036 — invoking `git` by name is intentional: this
  // installer runs inside a developer's repo where git must come from the
  // user's own PATH. Pinning an absolute path would break on every machine
  // that installs git via brew/apt/scoop/Xcode/Git-for-Windows. The command
  // name ('git') is a hard-coded literal, not user input, so shell-injection
  // via args is not possible; args is always an array, so spawnSync does not
  // go through a shell. Reviewed as safe.
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status !== 0 && !allowFailure) {
    const stderr = (result.stderr || '').trim();
    throw new Error(stderr || `git ${args.join(' ')} failed`);
  }

  return {
    status: Number.isInteger(result.status) ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function getGitVersion(repoRoot) {
  return runGit(['--version'], repoRoot).stdout.trim();
}

function readGitConfig(key, repoRoot) {
  const result = runGit(['config', '--local', '--get', key], repoRoot, { allowFailure: true });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim() || null;
}

function readGitConfigAll(key, repoRoot) {
  const result = runGit(['config', '--local', '--get-all', key], repoRoot, { allowFailure: true });
  if (result.status !== 0) {
    return [];
  }
  return result.stdout
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);
}

function setGitConfig(key, value, repoRoot, { append = false } = {}) {
  const args = ['config', '--local'];
  if (append) {
    args.push('--add');
  }
  args.push(key, value);
  runGit(args, repoRoot);
}

function unsetGitConfig(key, repoRoot, { all = false } = {}) {
  const args = ['config', '--local'];
  if (all) {
    args.push('--unset-all');
  } else {
    args.push('--unset');
  }
  args.push(key);
  runGit(args, repoRoot, { allowFailure: true });
}

function ensureHookExecutables(hooksDir) {
  for (const entry of fs.readdirSync(hooksDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    // 0o700 — rwx for the repo owner only. Git runs hooks as the same user
    // that invoked the git command, so group/other execute bits serve no
    // purpose here and would unnecessarily widen permissions.
    fs.chmodSync(path.join(hooksDir, entry.name), 0o700);
  }
}

function resolvesToRepoHooksDir(hooksPath, repoRoot) {
  if (!hooksPath) {
    return false;
  }
  return path.resolve(repoRoot, hooksPath) === path.join(repoRoot, '.githooks');
}

function ensureHookConfig(hookName, eventName, commandPath, readConfig, readConfigAll, setConfig, unsetConfig) {
  let changed = false;
  const commandKey = `hook.${hookName}.command`;
  const eventKey = `hook.${hookName}.event`;
  const enabledKey = `hook.${hookName}.enabled`;

  if (readConfig(commandKey) !== commandPath) {
    setConfig(commandKey, commandPath);
    changed = true;
  }

  const existingEvents = readConfigAll(eventKey);
  if (existingEvents.length !== 1 || existingEvents[0] !== eventName) {
    unsetConfig(eventKey, { all: true });
    setConfig(eventKey, eventName, { append: true });
    changed = true;
  }

  if (readConfig(enabledKey) !== 'true') {
    setConfig(enabledKey, 'true');
    changed = true;
  }

  return changed;
}

function installGitHooks(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '..'));
  const hooksDir = path.join(repoRoot, '.githooks');

  if (!fs.existsSync(hooksDir)) {
    throw new Error(`No .githooks directory found at ${hooksDir}`);
  }

  ensureHookExecutables(hooksDir);

  const readConfig = options.readConfig || ((key) => readGitConfig(key, repoRoot));
  const readConfigAll = options.readConfigAll || ((key) => readGitConfigAll(key, repoRoot));
  const setConfig = options.setConfig || ((key, value, configOptions = {}) => setGitConfig(key, value, repoRoot, configOptions));
  const unsetConfig = options.unsetConfig || ((key, configOptions = {}) => unsetGitConfig(key, repoRoot, configOptions));
  const gitVersion = options.gitVersion || getGitVersion(repoRoot);
  const preCommitPath = path.join(hooksDir, 'pre-commit');
  const prePushPath = path.join(hooksDir, 'pre-push');

  if (supportsConfigBasedHooks(gitVersion)) {
    let changed = false;
    changed = ensureHookConfig(
      THUMBGATE_PRE_COMMIT,
      'pre-commit',
      preCommitPath,
      readConfig,
      readConfigAll,
      setConfig,
      unsetConfig
    ) || changed;
    changed = ensureHookConfig(
      THUMBGATE_PRE_PUSH,
      'pre-push',
      prePushPath,
      readConfig,
      readConfigAll,
      setConfig,
      unsetConfig
    ) || changed;

    const existingHooksPath = readConfig('core.hooksPath');
    let disabledRepoHooksPath = false;
    if (resolvesToRepoHooksDir(existingHooksPath, repoRoot)) {
      unsetConfig('core.hooksPath');
      changed = true;
      disabledRepoHooksPath = true;
    }

    return {
      changed,
      mode: 'config',
      gitVersion,
      repoRoot,
      settingsTarget: '.git/config',
      hooks: [
        { event: 'pre-commit', command: preCommitPath },
        { event: 'pre-push', command: prePushPath },
      ],
      disabledRepoHooksPath,
      preservedHooksPath: disabledRepoHooksPath ? null : existingHooksPath,
    };
  }

  const desiredHooksPath = '.githooks';
  const currentHooksPath = readConfig('core.hooksPath');
  const changed = currentHooksPath !== desiredHooksPath;
  if (changed) {
    setConfig('core.hooksPath', desiredHooksPath);
  }

  return {
    changed,
    mode: 'hookspath',
    gitVersion,
    repoRoot,
    settingsTarget: '.git/config',
    hooksPath: desiredHooksPath,
  };
}

function formatInstallSummary(result) {
  if (result.mode === 'config') {
    const lines = [
      '✓ Git hooks activated via local git config (Git 2.54+ config hooks)',
      `  git: ${result.gitVersion}`,
    ];
    for (const hook of result.hooks) {
      lines.push(`  ${hook.event}: ${hook.command}`);
    }
    if (result.disabledRepoHooksPath) {
      lines.push('  disabled core.hooksPath=.githooks to avoid duplicate runs');
    } else if (result.preservedHooksPath) {
      lines.push(`  preserved existing core.hooksPath=${result.preservedHooksPath}`);
    }
    return lines.join('\n');
  }

  return [
    '✓ Git hooks activated at .githooks/ (core.hooksPath fallback)',
    `  git: ${result.gitVersion}`,
    '  pre-commit: package parity, version sync, congruence, claims, gates',
    '  pre-push:   npm pack dry-run, internal link validation, regression guards',
  ].join('\n');
}

module.exports = {
  CONFIG_HOOKS_MIN_VERSION,
  THUMBGATE_PRE_COMMIT,
  THUMBGATE_PRE_PUSH,
  compareVersions,
  ensureHookConfig,
  formatInstallSummary,
  installGitHooks,
  parseGitVersion,
  resolvesToRepoHooksDir,
  supportsConfigBasedHooks,
};

function isCliEntrypoint(entryModule = require.main) {
  return Boolean(entryModule && entryModule.filename === __filename);
}

if (isCliEntrypoint()) {
  try {
    const result = installGitHooks();
    console.log(formatInstallSummary(result));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports.isCliEntrypoint = isCliEntrypoint;
