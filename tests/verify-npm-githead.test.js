'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseArgs,
  evaluateRegistryIdentity,
  verifyNpmGitHead,
} = require('../scripts/verify-npm-githead');

const base = {
  packageName: 'thumbgate',
  version: '1.32.0',
  expectedSha: 'release-sha',
  allowUnpublished: false,
};

test('parseArgs reads immutable release identity and retry policy', () => {
  const options = parseArgs([
    '--package=thumbgate',
    '--version=1.32.0',
    '--expected-sha=release-sha',
    '--allow-unpublished',
    '--max-attempts=12',
    '--retry-delay-ms=1000',
    '--json',
  ]);
  assert.deepEqual(options, {
    packageName: 'thumbgate',
    version: '1.32.0',
    expectedSha: 'release-sha',
    allowUnpublished: true,
    maxAttempts: 12,
    retryDelayMs: 1000,
    json: true,
  });
});

test('matching registry gitHead passes', () => {
  const report = evaluateRegistryIdentity({
    ...base,
    registryResult: { state: 'published', metadata: { version: '1.32.0', gitHead: 'release-sha' } },
  });
  assert.equal(report.verdict, 'pass');
  assert.equal(report.observedSha, 'release-sha');
});

test('published version owned by another commit fails', () => {
  const report = evaluateRegistryIdentity({
    ...base,
    registryResult: { state: 'published', metadata: { version: '1.32.0', gitHead: 'other-sha' } },
  });
  assert.equal(report.verdict, 'fail');
  assert.match(report.reason, /another commit/);
});

test('published version without gitHead fails closed', () => {
  const report = evaluateRegistryIdentity({
    ...base,
    registryResult: { state: 'published', metadata: { version: '1.32.0' } },
  });
  assert.equal(report.verdict, 'fail');
  assert.match(report.reason, /no gitHead/);
});

test('pre-deploy check allows a version that has not been published', () => {
  const report = evaluateRegistryIdentity({
    ...base,
    allowUnpublished: true,
    registryResult: { state: 'unpublished', metadata: null },
  });
  assert.equal(report.verdict, 'pass');
  assert.equal(report.state, 'unpublished');
});

test('post-publish check retries registry propagation then proves gitHead', async () => {
  let calls = 0;
  const report = await verifyNpmGitHead({
    ...base,
    maxAttempts: 3,
    retryDelayMs: 1,
    queryRegistry() {
      calls += 1;
      return calls < 3
        ? { state: 'unpublished', metadata: null }
        : { state: 'published', metadata: { version: '1.32.0', gitHead: 'release-sha' } };
    },
  });
  assert.equal(report.verdict, 'pass');
  assert.equal(report.attempts, 3);
  assert.equal(calls, 3);
});

test('missing immutable identity fails before querying npm', async () => {
  let calls = 0;
  const report = await verifyNpmGitHead({
    packageName: 'thumbgate',
    version: '',
    expectedSha: '',
    queryRegistry() { calls += 1; return { state: 'registry_error' }; },
  });
  assert.equal(report.verdict, 'fail');
  assert.equal(report.state, 'invalid_input');
  assert.equal(calls, 0);
});
