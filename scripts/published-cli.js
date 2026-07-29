'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function shellQuote(value) {
  return JSON.stringify(String(value));
}

function runtimePrefixDir(prefixDir) {
  return prefixDir || path.join(os.homedir(), '.thumbgate', 'runtime');
}

// For GENERATED SHELL COMMANDS only. Shell command strings land in shared, committed config
// (.mcp.json entries, hook command lines), so expanding os.homedir() at generation time bakes
// the generating machine's home into files other machines execute — /Users/alice/.thumbgate
// fails with a permission error on bob's machine. shellQuote uses double quotes, so a literal
// $HOME expands at RUNTIME on whichever machine runs the command. Non-shell consumers
// (execFileSync paths) must keep using runtimePrefixDir, which returns a real filesystem path.
const SHELL_RUNTIME_PREFIX = '$HOME/.thumbgate/runtime';

function installedRuntimeBin(prefixDir) {
  return path.join(runtimePrefixDir(prefixDir), 'node_modules', '.bin', 'thumbgate');
}

function publishedCliArgs(pkgVersion, commandArgs = [], options = {}) {
  return [
    'exec',
    '--prefix',
    runtimePrefixDir(options.prefixDir),
    '--yes',
    '--package',
    `thumbgate@${pkgVersion}`,
    '--',
    'thumbgate',
    ...commandArgs,
  ];
}

function publishedCliShellCommand(pkgVersion, commandArgs = [], options = {}) {
  // Default to the runtime-expanded $HOME form; an explicit options.prefixDir (tests,
  // throwaway prefixes) is honoured verbatim.
  const prefixDir = options.prefixDir || SHELL_RUNTIME_PREFIX;
  const runtimeBin = installedRuntimeBin(prefixDir);
  const escapedArgs = commandArgs.map(shellQuote).join(' ');
  const fastPath = `[ -x ${shellQuote(runtimeBin)} ] && exec ${shellQuote(runtimeBin)}${escapedArgs ? ` ${escapedArgs}` : ''}`;
  const installPath = `mkdir -p ${shellQuote(prefixDir)} && exec npm ${publishedCliArgs(pkgVersion, commandArgs, { prefixDir }).map(shellQuote).join(' ')}`;
  return `${fastPath} || ${installPath}`;
}

function runPublishedCli(pkgVersion, commandArgs = [], options = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-published-cli-'));
  const prefixDir = path.join(tmpDir, 'runtime');
  try {
    fs.mkdirSync(prefixDir, { recursive: true });
    return execFileSync('npm', publishedCliArgs(pkgVersion, commandArgs, { prefixDir }), {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: options.timeout || 8000,
      cwd: tmpDir,
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function runPublishedCliHelp(pkgVersion, options = {}) {
  return runPublishedCli(pkgVersion, ['help'], options);
}

module.exports = {
  publishedCliArgs,
  publishedCliShellCommand,
  installedRuntimeBin,
  runtimePrefixDir,
  runPublishedCli,
  runPublishedCliHelp,
};
