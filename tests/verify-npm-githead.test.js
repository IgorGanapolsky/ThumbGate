'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseArgs,
  queryRegistry,
  evaluateRegistryIdentity,
  resolveAncestryLocally,
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

test('registry lookup uses HTTPS directly instead of an ambient PATH executable', async () => {
  const calls = [];
  const published = await queryRegistry('thumbgate', '1.33.0', async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() { return { version: '1.33.0', gitHead: 'release-sha' }; },
    };
  });
  assert.deepEqual(published, {
    state: 'published',
    metadata: { version: '1.33.0', gitHead: 'release-sha' },
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/registry\.npmjs\.org\/thumbgate\/1\.33\.0$/);
  assert.equal(calls[0].options.headers.accept, 'application/json');

  const unpublished = await queryRegistry('thumbgate', '9.9.9', async () => ({ ok: false, status: 404 }));
  assert.deepEqual(unpublished, { state: 'unpublished', metadata: null });
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

const published = (gitHead, version = '1.32.0') => ({
  state: 'published',
  metadata: { version, gitHead },
});

test('main being ahead of the last published release is not drift', () => {
  const report = evaluateRegistryIdentity({
    ...base,
    registryResult: published('older-release-sha'),
    ancestry: 'ancestor',
  });
  assert.equal(report.verdict, 'pass');
  assert.equal(report.observedSha, 'older-release-sha');
  assert.match(report.reason, /ancestor/);
});

test('a published release from a divergent commit is still drift', () => {
  const report = evaluateRegistryIdentity({
    ...base,
    registryResult: published('divergent-sha'),
    ancestry: 'unrelated',
  });
  assert.equal(report.verdict, 'fail');
  assert.equal(report.reason, 'published version belongs to another commit');
});

test('unprovable ancestry fails closed rather than passing', () => {
  const report = evaluateRegistryIdentity({
    ...base,
    registryResult: published('shallow-clone-sha'),
    ancestry: 'unknown',
  });
  assert.equal(report.verdict, 'fail', 'unknown ancestry must never pass');
});

test('resolveAncestryLocally distinguishes ancestor, unrelated and unknown', () => {
  const fake = (results) => {
    const calls = [...results];
    return () => calls.shift();
  };
  assert.equal(resolveAncestryLocally('a', 'a'), 'ancestor', 'identical SHAs are trivially ancestors');
  assert.equal(resolveAncestryLocally('', 'b'), 'unknown');
  // both objects present, merge-base says yes
  assert.equal(
    resolveAncestryLocally('a', 'b', { spawnSync: fake([{ status: 0 }, { status: 0 }, { status: 0 }]) }),
    'ancestor'
  );
  // both objects present, merge-base says no
  assert.equal(
    resolveAncestryLocally('a', 'b', { spawnSync: fake([{ status: 0 }, { status: 0 }, { status: 1 }]) }),
    'unrelated'
  );
  // object missing (shallow clone) -> unknown, never a pass
  assert.equal(
    resolveAncestryLocally('a', 'b', { spawnSync: fake([{ status: 128 }]) }),
    'unknown'
  );
});

test('verifyNpmGitHead passes when the published release is an ancestor of HEAD', async () => {
  const report = await verifyNpmGitHead({
    packageName: 'thumbgate',
    version: '1.34.3',
    expectedSha: 'head-sha',
    queryRegistry: async () => published('release-sha', '1.34.3'),
    resolveAncestry: async () => 'ancestor',
  });
  assert.equal(report.verdict, 'pass');
});

test('verifyNpmGitHead still fails when HEAD does not descend from the release', async () => {
  const report = await verifyNpmGitHead({
    packageName: 'thumbgate',
    version: '1.34.3',
    expectedSha: 'head-sha',
    queryRegistry: async () => published('release-sha', '1.34.3'),
    resolveAncestry: async () => 'unrelated',
  });
  assert.equal(report.verdict, 'fail');
});
