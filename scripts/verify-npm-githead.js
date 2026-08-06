#!/usr/bin/env node
'use strict';

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

async function queryRegistry(packageName, version, fetchImpl = globalThis.fetch) {
  try {
    const packagePath = encodeURIComponent(packageName);
    const versionPath = encodeURIComponent(version);
    const response = await fetchImpl(`https://registry.npmjs.org/${packagePath}/${versionPath}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 404) return { state: 'unpublished', metadata: null };
    if (!response.ok) return { state: 'registry_error', metadata: null };
    const metadata = await response.json();
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
  ancestry = 'unknown',
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
    // A SHA mismatch is only drift when the published commit is NOT in this
    // commit's history. Between releases main is simply ahead of the last
    // published version -- the normal state after every content-only merge.
    // Requiring exact equality made this check go red on main after any push
    // touching public/ or src/ until someone cut a release.
    // 'unknown' fails closed: never pass on an ancestry we could not prove.
    if (ancestry === 'ancestor') {
      return {
        ...base,
        verdict: 'pass',
        state: 'published',
        observedSha,
        reason: 'published release is an ancestor; main is ahead of the last release',
      };
    }
    return { ...base, verdict: 'fail', state: 'published', observedSha, reason: 'published version belongs to another commit' };
  }
  return { ...base, verdict: 'pass', state: 'published', observedSha, reason: 'registry gitHead matches the release commit' };
}

/**
 * Is `ancestorSha` reachable from `descendantSha`? Answered with local git so
 * the guard needs no network and no credentials. Returns 'unknown' when git
 * cannot answer -- notably on a shallow clone, where the objects are absent --
 * and the evaluator treats 'unknown' as drift.
 */
function resolveAncestryLocally(ancestorSha, descendantSha, deps = {}) {
  if (!ancestorSha || !descendantSha) return 'unknown';
  if (ancestorSha === descendantSha) return 'ancestor';
  const run = deps.spawnSync || require('child_process').spawnSync;
  const has = (sha) => run('git', ['cat-file', '-e', `${sha}^{commit}`], { encoding: 'utf8' }).status === 0;
  if (!has(ancestorSha) || !has(descendantSha)) return 'unknown';
  const res = run('git', ['merge-base', '--is-ancestor', ancestorSha, descendantSha], { encoding: 'utf8' });
  if (res.status === 0) return 'ancestor';
  if (res.status === 1) return 'unrelated';
  return 'unknown';
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
  const ancestryResolver = options.resolveAncestry || resolveAncestryLocally;

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
    const registryResult = await resolver(packageName, version);
    const observedSha = String((registryResult.metadata || {}).gitHead || '').trim();
    report = evaluateRegistryIdentity({
      packageName,
      version,
      expectedSha,
      allowUnpublished,
      registryResult,
      attempts: attempt,
      ancestry: observedSha ? await ancestryResolver(observedSha, expectedSha) : 'unknown',
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
  resolveAncestryLocally,
  evaluateRegistryIdentity,
  verifyNpmGitHead,
};
