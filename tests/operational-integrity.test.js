'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  assertSafeGitObjectId,
  classifyCommand,
  compareSemver,
  evaluateOperationalIntegrity,
  findReleaseSensitiveFiles,
  getCurrentBranch,
  gitVerifyRef,
  isSafeBranchName,
  isSafeGitObjectId,
  isSafeGitRevision,
  isHeadReachableFrom,
  listChangedFilesAgainstBase,
  readPackageVersion,
  resolveGitBinary,
  resolveBaseRef,
  resolveCiBranchName,
  resolveRepoRoot,
  runCli,
} = require('../scripts/operational-integrity');

function createTempGitRepo() {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-ops-'));
  execFileSync('git', ['init', '--initial-branch=main'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'ThumbGate Test'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'thumbgate@example.com'], { cwd: repoDir, stdio: 'ignore' });
  fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({ name: 'thumbgate-temp', version: '1.0.0' }, null, 2));
  execFileSync('git', ['add', 'package.json'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['branch', 'feature/test'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['pack-refs', '--all', '--prune'], { cwd: repoDir, stdio: 'ignore' });
  return repoDir;
}

test('compareSemver orders semantic versions correctly', () => {
  assert.equal(compareSemver('0.9.10', '0.9.9'), 1);
  assert.equal(compareSemver('0.9.9', '0.9.10'), -1);
  assert.equal(compareSemver('1.0.0', '1.0.0'), 0);
  assert.equal(compareSemver('1.0.0-beta.2', '1.0.0-beta.1'), 1);
  assert.equal(compareSemver('1.0.0', '1.0.0-rc.1'), 1);
  assert.equal(compareSemver('1.0.0-beta.1', '1.0.0'), -1);
});

test('resolveGitBinary returns null when no configured git binary is executable', () => {
  assert.equal(resolveGitBinary({
    candidates: ['/definitely/missing/git'],
    allowPathLookup: false,
  }), null);
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

test('evaluateOperationalIntegrity requires governance and release metadata for publish flows', () => {
  const result = evaluateOperationalIntegrity({
    currentBranch: 'main',
    baseBranch: 'main',
    command: 'npm publish',
    headOnBase: true,
    packageVersion: '1.0.0',
    baseVersion: '1.0.0',
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((blocker) => blocker.code === 'missing_branch_governance'));
  assert.ok(result.blockers.some((blocker) => blocker.code === 'missing_release_version'));
});

test('evaluateOperationalIntegrity blocks governance-marked local-only release actions', () => {
  const result = evaluateOperationalIntegrity({
    currentBranch: 'main',
    baseBranch: 'main',
    command: 'gh pr create --title "release"',
    branchGovernance: {
      branchName: 'main',
      baseBranch: 'main',
      localOnly: true,
    },
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((blocker) => blocker.code === 'local_only_branch'));
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

test('isSafeGitObjectId only allows full commit hashes', () => {
  assert.equal(isSafeGitObjectId('0123456789abcdef0123456789abcdef01234567'), true);
  assert.equal(isSafeGitObjectId('0123456789abcdef'), false);
  assert.equal(isSafeGitObjectId('not-a-sha'), false);
});

test('assertSafeGitObjectId normalizes valid shas and rejects invalid values', () => {
  assert.equal(
    assertSafeGitObjectId('0123456789ABCDEF0123456789ABCDEF01234567'),
    '0123456789abcdef0123456789abcdef01234567'
  );
  assert.throws(() => assertSafeGitObjectId('not-a-sha'), /Unsafe git object id/);
});

test('gitVerifyRef resolves loose and packed refs to commit shas', () => {
  const repoDir = createTempGitRepo();
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();

  assert.equal(gitVerifyRef(repoDir, 'HEAD'), headSha);
  assert.equal(gitVerifyRef(repoDir, 'main'), headSha);
  assert.equal(gitVerifyRef(repoDir, 'feature/test'), headSha);
  assert.equal(gitVerifyRef(repoDir, 'refs/heads/feature/test'), headSha);
});

test('getCurrentBranch reads the symbolic HEAD branch without git exec', () => {
  const repoDir = createTempGitRepo();
  assert.equal(getCurrentBranch(repoDir), 'main');
});

test('getCurrentBranch reports HEAD for detached checkouts', () => {
  const repoDir = createTempGitRepo();
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();
  execFileSync('git', ['checkout', '--detach', headSha], { cwd: repoDir, stdio: 'ignore' });

  assert.equal(getCurrentBranch(repoDir), 'HEAD');
});

test('resolveBaseRef short-circuits invalid branch names before git operations', () => {
  const baseRef = resolveBaseRef(__dirname, '--upload-pack=evil', { fetchIfMissing: true });
  assert.equal(baseRef, null);
});

test('resolveBaseRef and changed-file helpers work on temporary repos', () => {
  const repoDir = createTempGitRepo();
  execFileSync('git', ['checkout', 'feature/test'], { cwd: repoDir, stdio: 'ignore' });
  fs.mkdirSync(path.join(repoDir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'scripts', 'publish-decision.js'), 'module.exports = {};\n');
  execFileSync('git', ['add', 'scripts/publish-decision.js'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'feature change'], { cwd: repoDir, stdio: 'ignore' });

  assert.equal(resolveBaseRef(repoDir, 'main'), 'main');
  assert.deepEqual(listChangedFilesAgainstBase(repoDir, 'main'), ['scripts/publish-decision.js']);
  assert.equal(isHeadReachableFrom(repoDir, 'main'), false);
});

test('readPackageVersion rejects unsafe git refs before git execution', () => {
  assert.equal(readPackageVersion(__dirname, '--upload-pack=evil'), null);
  assert.equal(readPackageVersion(__dirname, 'main@{1}'), null);
});

test('readPackageVersion resolves package.json from packed refs', () => {
  const repoDir = createTempGitRepo();
  assert.equal(readPackageVersion(repoDir, 'main'), '1.0.0');
  assert.equal(readPackageVersion(repoDir, 'feature/test'), '1.0.0');
});

test('readPackageVersion resolves package.json from explicit commit shas', () => {
  const repoDir = createTempGitRepo();
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();
  assert.equal(readPackageVersion(repoDir, headSha), '1.0.0');
});

test('isHeadReachableFrom rejects unsafe revision payloads', () => {
  assert.equal(isHeadReachableFrom(__dirname, 'main', '--upload-pack=evil'), false);
  assert.equal(isHeadReachableFrom(__dirname, 'main@{1}', 'HEAD'), false);
});

test('resolveRepoRoot handles nested file paths and non-repos safely', () => {
  const repoDir = createTempGitRepo();
  const nestedDir = path.join(repoDir, 'nested');
  const nestedFile = path.join(nestedDir, 'note.txt');
  fs.mkdirSync(nestedDir, { recursive: true });
  fs.writeFileSync(nestedFile, 'hello');

  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-nonrepo-'));

  assert.equal(resolveRepoRoot(nestedFile), repoDir);
  assert.equal(resolveRepoRoot(outsideDir), null);
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
