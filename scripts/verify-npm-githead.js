#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const DEFAULT_MAX_ATTEMPTS = 1;
const DEFAULT_RETRY_DELAY_MS = 5_000;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseArgs(argv = []) {
  const options = {
    packageName: 'thumbgate',
    version: '',
    expectedSha: process.env.GITHUB_SHA || '',
    allowUnpublished: false,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    retryDelayMs: DEFAULT_RETRY_DELAY_MS,
    json: false,
  };
  for (const arg of argv) {
    if (arg === '--allow-unpublished') options.allowUnpublished = true;
    else if (arg === '--json') options.json = true;
    else if (arg.startsWith('--package=')) options.packageName = arg.slice('--package='.length);
    else if (arg.startsWith('--version=')) options.version = arg.slice('--version='.length);
    else if (arg.startsWith('--expected-sha=')) options.expectedSha = arg.slice('--expected-sha='.length);
    else if (arg.startsWith('--max-attempts=')) options.maxAttempts = positiveInteger(arg.slice('--max-attempts='.length), DEFAULT_MAX_ATTEMPTS);
    else if (arg.startsWith('--retry-delay-ms=')) options.retryDelayMs = positiveInteger(arg.slice('--retry-delay-ms='.length), DEFAULT_RETRY_DELAY_MS);
  }
  options.packageName = String(options.packageName || '').trim();
  options.version = String(options.version || '').trim();
  options.expectedSha = String(options.expectedSha || '').trim();
  return options;
}

function queryRegistry(packageName, version) {
  const result = spawnSync('npm', [
    'view',
    `${packageName}@${version}`,
    'version',
    'gitHead',
    '--json',
  ], { encoding: 'utf8', timeout: 20_000 });

  if (result.status !== 0) {
    const diagnostic = `${result.stderr || ''}\n${result.stdout || ''}`;
    return diagnostic.includes('E404')
      ? { state: 'unpublished', metadata: null }
      : { state: 'registry_error', metadata: null };
  }

  try {
    const metadata = JSON.parse(result.stdout || '{}');
    return { state: 'published', metadata };
  } catch {
    return { state: 'registry_error', metadata: null };
  }
}

function evaluateRegistryIdentity({
  packageName,
  version,
  expectedSha,
  allowUnpublished,
  registryResult,
  attempts = 1,
}) {
  const base = { packageName, version, expectedSha, attempts };
  if (registryResult.state === 'unpublished') {
    return allowUnpublished
      ? { ...base, verdict: 'pass', state: 'unpublished', observedSha: null, reason: 'version is available for this commit' }
      : { ...base, verdict: 'retry', state: 'unpublished', observedSha: null, reason: 'version is not published yet' };
  }
  if (registryResult.state !== 'published' || !registryResult.metadata) {
    return { ...base, verdict: 'retry', state: 'registry_error', observedSha: null, reason: 'registry identity is unavailable' };
  }

  const observedVersion = String(registryResult.metadata.version || '').trim();
  const observedSha = String(registryResult.metadata.gitHead || '').trim();
  if (observedVersion !== version) {
    return { ...base, verdict: 'fail', state: 'published', observedSha: observedSha || null, reason: 'registry version mismatch' };
  }
  if (!observedSha) {
    return { ...base, verdict: 'fail', state: 'published', observedSha: null, reason: 'published version has no gitHead attestation' };
  }
  if (observedSha !== expectedSha) {
    return { ...base, verdict: 'fail', state: 'published', observedSha, reason: 'published version belongs to another commit' };
  }
  return { ...base, verdict: 'pass', state: 'published', observedSha, reason: 'registry gitHead matches the release commit' };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyNpmGitHead(options = {}) {
  const packageName = String(options.packageName || 'thumbgate').trim();
  const version = String(options.version || '').trim();
  const expectedSha = String(options.expectedSha || '').trim();
  const allowUnpublished = options.allowUnpublished === true;
  const maxAttempts = positiveInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS);
  const retryDelayMs = positiveInteger(options.retryDelayMs, DEFAULT_RETRY_DELAY_MS);
  const resolver = options.queryRegistry || queryRegistry;

  if (!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(packageName) || !version || !expectedSha) {
    return {
      verdict: 'fail',
      state: 'invalid_input',
      packageName,
      version,
      expectedSha,
      observedSha: null,
      attempts: 0,
      reason: 'package, version, and expected SHA are required',
    };
  }

  let report = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    report = evaluateRegistryIdentity({
      packageName,
      version,
      expectedSha,
      allowUnpublished,
      registryResult: resolver(packageName, version),
      attempts: attempt,
    });
    if (report.verdict !== 'retry') return report;
    if (attempt < maxAttempts) await delay(retryDelayMs);
  }
  return { ...report, verdict: 'fail' };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await verifyNpmGitHead(options);
  process.stdout.write(options.json
    ? `${JSON.stringify(report, null, 2)}\n`
    : `${report.verdict.toUpperCase()}: ${report.reason} (${report.version}, ${report.observedSha || 'unpublished'})\n`);
  if (report.verdict !== 'pass') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().catch(() => {
    process.stderr.write('npm registry identity verification failed unexpectedly.\n');
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_RETRY_DELAY_MS,
  parseArgs,
  queryRegistry,
  evaluateRegistryIdentity,
  verifyNpmGitHead,
};
