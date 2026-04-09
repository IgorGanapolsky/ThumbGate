'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyCommand,
  compareSemver,
  evaluateOperationalIntegrity,
  findReleaseSensitiveFiles,
  isSafeBranchName,
  isSafeGitRevision,
  isHeadReachableFrom,
  readPackageVersion,
  resolveBaseRef,
  resolveCiBranchName,
  runCli,
} = require('../scripts/operational-integrity');

test('compareSemver orders semantic versions correctly', () => {
  assert.equal(compareSemver('0.9.10', '0.9.9'), 1);
  assert.equal(compareSemver('0.9.9', '0.9.10'), -1);
  assert.equal(compareSemver('1.0.0', '1.0.0'), 0);
  assert.equal(compareSemver('1.0.0-beta.2', '1.0.0-beta.1'), 1);
  assert.equal(compareSemver('1.0.0', '1.0.0-rc.1'), 1);
  assert.equal(compareSemver('1.0.0-beta.1', '1.0.0'), -1);
});

test('findReleaseSensitiveFiles filters release surfaces by glob', () => {
  const files = [
    'package.json',
    'scripts/pr-manager.js',
    'tests/foo.test.js',
  ];

  const result = findReleaseSensitiveFiles(files);
  assert.deepEqual(result, ['package.json', 'scripts/pr-manager.js']);
});

test('evaluateOperationalIntegrity blocks release-sensitive feature work without an open PR', () => {
  const result = evaluateOperationalIntegrity({
    currentBranch: 'feat/thumbgate-hardening',
    baseBranch: 'main',
    changedFiles: ['package.json', 'scripts/publish-decision.js'],
    packageVersion: '0.9.9',
    baseVersion: '0.9.10',
    requirePrForReleaseSensitive: true,
    requireVersionNotBehindBase: true,
    openPr: null,
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((blocker) => blocker.code === 'release_sensitive_changes_require_pr'));
  assert.ok(result.blockers.some((blocker) => blocker.code === 'version_behind_base'));
});

test('evaluateOperationalIntegrity allows release-sensitive feature work with an open PR and up-to-date version', () => {
  const result = evaluateOperationalIntegrity({
    currentBranch: 'feat/thumbgate-hardening',
    baseBranch: 'main',
    changedFiles: ['package.json', 'scripts/publish-decision.js'],
    packageVersion: '0.9.10',
    baseVersion: '0.9.10',
    requirePrForReleaseSensitive: true,
    requireVersionNotBehindBase: true,
    openPr: { number: 999, url: 'https://github.com/IgorGanapolsky/ThumbGate/pull/999' },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.blockers, []);
});

test('evaluateOperationalIntegrity blocks publish from a non-base branch', () => {
  const result = evaluateOperationalIntegrity({
    currentBranch: 'feat/thumbgate-hardening',
    baseBranch: 'main',
    command: 'npm publish',
    packageVersion: '0.9.11',
    baseVersion: '0.9.10',
    headOnBase: false,
    branchGovernance: {
      branchName: 'feat/thumbgate-hardening',
      baseBranch: 'main',
      prRequired: true,
      releaseVersion: '0.9.11',
    },
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((blocker) => blocker.code === 'publish_requires_base_branch'));
  assert.ok(result.blockers.some((blocker) => blocker.code === 'publish_requires_mainline_head'));
});

test('evaluateOperationalIntegrity blocks admin merge bypass without PR context', () => {
  const result = evaluateOperationalIntegrity({
    currentBranch: 'feat/thumbgate-hardening',
    baseBranch: 'main',
    command: 'gh pr merge 999 --admin',
    branchGovernance: {
      branchName: 'feat/thumbgate-hardening',
      baseBranch: 'main',
      prRequired: true,
    },
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((blocker) => blocker.code === 'admin_merge_bypass_forbidden'));
  assert.ok(result.blockers.some((blocker) => blocker.code === 'merge_requires_pr_context'));
});

test('classifyCommand recognizes PR and publish commands', () => {
  const prCreate = classifyCommand('gh pr create --title "thumbgate"');
  const publish = classifyCommand('npm publish');

  assert.equal(prCreate.isPrCreate, true);
  assert.equal(prCreate.isPublish, false);
  assert.equal(publish.isPublish, true);
  assert.equal(publish.isReleaseCreate, false);
});

test('isSafeBranchName rejects branch-shaped injection payloads', () => {
  assert.equal(isSafeBranchName('main'), true);
  assert.equal(isSafeBranchName('release/0.9.10'), true);
  assert.equal(isSafeBranchName('--upload-pack=evil'), false);
  assert.equal(isSafeBranchName('main..evil'), false);
  assert.equal(isSafeBranchName('main@{1}'), false);
});

test('isSafeGitRevision rejects unsafe revision payloads', () => {
  assert.equal(isSafeGitRevision('HEAD'), true);
  assert.equal(isSafeGitRevision('origin/main'), true);
  assert.equal(isSafeGitRevision('a1b2c3d4'), true);
  assert.equal(isSafeGitRevision('--upload-pack=evil'), false);
  assert.equal(isSafeGitRevision('main..evil'), false);
  assert.equal(isSafeGitRevision('main@{1}'), false);
  assert.equal(isSafeGitRevision('HEAD~1'), false);
});

test('resolveBaseRef short-circuits invalid branch names before git operations', () => {
  const baseRef = resolveBaseRef(__dirname, '--upload-pack=evil', { fetchIfMissing: true });
  assert.equal(baseRef, null);
});

test('readPackageVersion rejects unsafe git refs before git execution', () => {
  assert.equal(readPackageVersion(__dirname, '--upload-pack=evil'), null);
  assert.equal(readPackageVersion(__dirname, 'main@{1}'), null);
});

test('isHeadReachableFrom rejects unsafe revision payloads', () => {
  assert.equal(isHeadReachableFrom(__dirname, 'main', '--upload-pack=evil'), false);
  assert.equal(isHeadReachableFrom(__dirname, 'main@{1}', 'HEAD'), false);
});

test('resolveCiBranchName prefers PR head refs over synthetic merge refs', () => {
  assert.equal(resolveCiBranchName({
    GITHUB_HEAD_REF: 'feat/docker-sandbox-story',
    GITHUB_REF_NAME: '634/merge',
  }), 'feat/docker-sandbox-story');
  assert.equal(resolveCiBranchName({ GITHUB_REF_NAME: 'main' }), 'main');
  assert.equal(resolveCiBranchName({}), undefined);
});

test('runCli reports the PR head branch during pull_request CI integrity checks', () => {
  const output = [];
  const originalLog = console.log;
  console.log = (value) => {
    output.push(value);
  };

  try {
    const exitCode = runCli({
      GITHUB_HEAD_REF: 'feat/docker-sandbox-story',
      GITHUB_REF_NAME: '634/merge',
      DEFAULT_BRANCH: 'main',
    }, ['--json', '--repo-path', __dirname]);
    assert.equal(exitCode, 0);
  } finally {
    console.log = originalLog;
  }

  const report = JSON.parse(output[0]);
  assert.equal(report.currentBranch, 'feat/docker-sandbox-story');
});
