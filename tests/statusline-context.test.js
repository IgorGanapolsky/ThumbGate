'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CONTEXT_CACHE_MAX_AGE_MS,
  contextCachePath,
  getBranchName,
  getPrNumber,
  getStatuslineContext,
  inferWorkItemLabel,
  isFreshCache,
  readContextCache,
  resolveGhBinary,
  resolveGitBinary,
  writeContextCache,
} = require('../scripts/statusline-context');

function makeTmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-statusline-'));
}

test('inferWorkItemLabel preserves explicit AB identifiers', () => {
  assert.equal(inferWorkItemLabel('bugfix/AB#1663699-account-profile-hardening'), 'AB#1663699');
});

test('inferWorkItemLabel infers Azure-style work item labels from numeric branch tokens', () => {
  assert.equal(inferWorkItemLabel('bugfix/1663699-account-profile-hardening'), 'AB#1663699');
  assert.equal(inferWorkItemLabel('feature/checkout-1234567-hardening'), 'AB#1234567');
});

test('inferWorkItemLabel returns empty string when no work item token is present', () => {
  assert.equal(inferWorkItemLabel('feature/thumbgate-statusline'), '');
});

test('isFreshCache only accepts recently updated caches', () => {
  const now = Date.parse('2026-04-19T23:58:00.000Z');
  assert.equal(isFreshCache({ updatedAt: '2026-04-19T23:57:30.000Z' }, now), true);
  assert.equal(isFreshCache({ updatedAt: '2026-04-19T23:55:30.000Z' }, now), false);
  assert.equal(isFreshCache(null, now), false);
});

test('isFreshCache rejects caches with unparseable updatedAt', () => {
  const now = Date.parse('2026-04-19T23:58:00.000Z');
  assert.equal(isFreshCache({ updatedAt: 'not a date' }, now), false);
  assert.equal(isFreshCache({}, now), false);
});

test('CONTEXT_CACHE_MAX_AGE_MS is 2 minutes', () => {
  assert.equal(CONTEXT_CACHE_MAX_AGE_MS, 120000);
});

test('inferWorkItemLabel returns empty string for empty / whitespace input', () => {
  assert.equal(inferWorkItemLabel(''), '');
  assert.equal(inferWorkItemLabel('   '), '');
  assert.equal(inferWorkItemLabel(null), '');
  assert.equal(inferWorkItemLabel(undefined), '');
});

test('contextCachePath / readContextCache / writeContextCache round-trip through the home dir', () => {
  const home = makeTmpHome();
  try {
    const cachePath = contextCachePath({ env: { HOME: home }, home });
    assert.ok(cachePath.endsWith('statusline-context.json'));

    assert.equal(readContextCache({ env: { HOME: home }, home }), null);

    const payload = { branchName: 'main', prNumber: '42', updatedAt: new Date().toISOString() };
    const written = writeContextCache(payload, { env: { HOME: home }, home });
    assert.equal(written, cachePath);

    const round = readContextCache({ env: { HOME: home }, home });
    assert.deepEqual(round, payload);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('readContextCache returns null when the file contains invalid JSON', () => {
  const home = makeTmpHome();
  try {
    const cachePath = contextCachePath({ env: { HOME: home }, home });
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, '{ not json');
    assert.equal(readContextCache({ env: { HOME: home }, home }), null);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('resolveGhBinary returns first executable from fixed-path list', () => {
  const seen = [];
  const stubAccessSync = (p, _mode) => {
    seen.push(p);
    if (p === '/opt/homebrew/bin/gh') return;
    throw new Error('ENOENT');
  };
  assert.equal(resolveGhBinary(stubAccessSync), '/opt/homebrew/bin/gh');
  assert.ok(seen.length >= 1);
});

test('resolveGhBinary returns null when no fixed binary is executable', () => {
  const stubAccessSync = () => { throw new Error('ENOENT'); };
  assert.equal(resolveGhBinary(stubAccessSync), null);
});

test('resolveGitBinary respects THUMBGATE_GIT_BIN env override', () => {
  const real = fs.accessSync;
  fs.accessSync = (p, _mode) => {
    if (p === '/custom/git') return;
    throw new Error('ENOENT');
  };
  try {
    assert.equal(resolveGitBinary({ env: { THUMBGATE_GIT_BIN: '/custom/git' } }), '/custom/git');
  } finally {
    fs.accessSync = real;
  }
});

test('resolveGitBinary returns null when no candidate binary exists', () => {
  const real = fs.accessSync;
  fs.accessSync = () => { throw new Error('ENOENT'); };
  try {
    assert.equal(resolveGitBinary({ env: {} }), null);
  } finally {
    fs.accessSync = real;
  }
});

test('getBranchName returns empty string when projectDir is missing', () => {
  assert.equal(getBranchName(''), '');
  assert.equal(getBranchName(null), '');
  assert.equal(getBranchName(undefined), '');
});

test('getPrNumber returns empty string when projectDir is missing', () => {
  assert.equal(getPrNumber('', {}), '');
  assert.equal(getPrNumber(null, {}), '');
});

test('getPrNumber returns empty string when gh binary cannot be resolved', () => {
  const result = getPrNumber('/tmp', {
    ghBinary: null,
    accessSync: () => { throw new Error('ENOENT'); },
  });
  assert.equal(result, '');
});

test('getStatuslineContext short-circuits via _TEST env override', () => {
  const fixture = {
    branchName: 'feature/test',
    workItemLabel: 'AB#123',
    prNumber: '456',
    prLabel: 'PR #456',
    projectDir: '/tmp/x',
    updatedAt: '2026-04-19T23:58:00.000Z',
  };
  const result = getStatuslineContext({
    env: { _TEST_THUMBGATE_STATUSLINE_CONTEXT_JSON: JSON.stringify(fixture) },
  });
  assert.deepEqual(result, fixture);
});

test('getStatuslineContext runs the full path and writes the cache when no TEST override', () => {
  const home = makeTmpHome();
  try {
    // Stub gh/git binaries as absent by forcing env that points at a non-existent THUMBGATE_GIT_BIN.
    // With no executables resolvable, branchName/prNumber fall through to empty strings.
    const env = {
      HOME: home,
      THUMBGATE_STATUSLINE_BRANCH: 'feature/AB#1234-demo',
      THUMBGATE_STATUSLINE_PR_NUMBER: '99',
      THUMBGATE_RUNTIME_DIR: path.join(home, '.thumbgate'),
    };
    const result = getStatuslineContext({ env, cwd: home, homeDir: home });
    assert.equal(result.branchName, 'feature/AB#1234-demo');
    assert.equal(result.workItemLabel, 'AB#1234');
    assert.equal(result.prNumber, '99');
    assert.equal(result.prLabel, 'PR #99');
    assert.ok(result.updatedAt);

    // Cache was written
    const cached = readContextCache({ env, home });
    assert.ok(cached);
    assert.equal(cached.prNumber, '99');

    // Second call with cache hit should reuse prNumber when cache is fresh
    const second = getStatuslineContext({
      env: { ...env, THUMBGATE_STATUSLINE_PR_NUMBER: '' },
      cwd: home,
      homeDir: home,
    });
    assert.equal(second.prNumber, '99', 'should reuse fresh cached prNumber');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
