#!/usr/bin/env node
'use strict';

/**
 * Comparable npm CLI floor for GitHub Actions OIDC trusted publishing.
 *
 * npm docs (trusted publishers, 2026-09): OIDC publish needs npm >= 11.5.1.
 * npm 11.5.0 is not enough — comparing only major.minor lets 11.5.0 through.
 *
 * CI-only. Not added to package.json files (not a packaged runtime).
 *
 *   node scripts/npm-oidc-cli-floor.js --version=11.5.0
 *
 * Caller supplies the version (workflow: `npm -v`). This helper does not spawn
 * `npm` from PATH (Sonar S4036).
 */

const path = require('node:path');

const FLOOR = { major: 11, minor: 5, patch: 1 };
const FLOOR_LABEL = '11.5.1';
const ERROR_PREFIX = 'trusted publishing needs npm >= 11.5.1';

function parseNpmVersion(raw) {
  const text = String(raw || '').trim().replace(/^v/i, '');
  if (!text) return null;
  // Stable X.Y.Z plus optional build metadata. Prerelease (11.5.1-rc.0) is below
  // the OIDC floor even when the numeric triple matches.
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(text);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isFinite)) return null;
  return { major, minor, patch, raw: text };
}

function compareNpmVersion(parsed, floor = FLOOR) {
  if (!parsed) return -1;
  if (parsed.major !== floor.major) return parsed.major > floor.major ? 1 : -1;
  if (parsed.minor !== floor.minor) return parsed.minor > floor.minor ? 1 : -1;
  if (parsed.patch !== floor.patch) return parsed.patch > floor.patch ? 1 : -1;
  return 0;
}

function meetsNpmOidcCliFloor(raw) {
  return compareNpmVersion(parseNpmVersion(raw)) >= 0;
}

function parseCliArgs(argv = []) {
  const options = { version: null, help: false };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--version=')) options.version = arg.slice('--version='.length);
  }
  return options;
}

function evaluateNpmOidcCliFloor(raw) {
  const parsed = parseNpmVersion(raw);
  const ok = compareNpmVersion(parsed) >= 0;
  return {
    ok,
    version: String(raw || '').trim(),
    parsed,
    floor: FLOOR_LABEL,
    message: ok
      ? `${ERROR_PREFIX}, got ${String(raw || '').trim()} (ok)`
      : `${ERROR_PREFIX}, got ${String(raw || '').trim() || '(empty)'}`,
  };
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/npm-oidc-cli-floor.js --version=X.Y.Z

Fail closed unless npm >= ${FLOOR_LABEL} (OIDC trusted publishing).
npm 11.5.0 and prereleases are rejected. --version is required (no PATH spawn).
`);
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  if (args.version == null) {
    process.stderr.write(`${ERROR_PREFIX}, got (missing --version)\n`);
    return 2;
  }
  const version = args.version;
  const result = evaluateNpmOidcCliFloor(version);
  if (result.ok) {
    process.stdout.write(`npm ${result.version} meets OIDC floor ${FLOOR_LABEL}\n`);
    return 0;
  }
  process.stderr.write(`${result.message}\n`);
  return 2;
}

module.exports = {
  FLOOR,
  FLOOR_LABEL,
  ERROR_PREFIX,
  parseNpmVersion,
  compareNpmVersion,
  meetsNpmOidcCliFloor,
  parseCliArgs,
  evaluateNpmOidcCliFloor,
  runCli,
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  process.exitCode = runCli(process.argv.slice(2));
}
