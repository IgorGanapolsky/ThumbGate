'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function publishedCliArgs(pkgVersion, commandArgs = []) {
  return ['--yes', '--package', `thumbgate@${pkgVersion}`, 'thumbgate', ...commandArgs];
}

function runPublishedCli(pkgVersion, commandArgs = [], options = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-published-cli-'));
  try {
    return execFileSync('npx', publishedCliArgs(pkgVersion, commandArgs), {
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
  runPublishedCli,
  runPublishedCliHelp,
};
