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
  const prefixDir = runtimePrefixDir(options.prefixDir);
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
