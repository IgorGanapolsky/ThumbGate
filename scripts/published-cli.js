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
  return `mkdir -p ${shellQuote(prefixDir)} && exec npm ${publishedCliArgs(pkgVersion, commandArgs, { prefixDir }).map(shellQuote).join(' ')}`;
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
  runtimePrefixDir,
  runPublishedCli,
  runPublishedCliHelp,
};
