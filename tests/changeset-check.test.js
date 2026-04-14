'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  MIN_SUMMARY_LENGTH,
  collectChangesets,
  evaluateChangesetRequirement,
  isReleaseRelevantFile,
  isVersionedReleaseChangeSet,
  parseChangesetMarkdown,
} = require('../scripts/changeset-check');

test('isReleaseRelevantFile requires changesets for runtime and landing changes', () => {
  assert.equal(isReleaseRelevantFile('scripts/workflow-sentinel.js'), true);
  assert.equal(isReleaseRelevantFile('public/index.html'), true);
  assert.equal(isReleaseRelevantFile('README.md'), true);
});

test('isReleaseRelevantFile skips docs, tests, and changeset files', () => {
  assert.equal(isReleaseRelevantFile('docs/SEMVER_POLICY.md'), false);
  assert.equal(isReleaseRelevantFile('tests/workflow-sentinel.test.js'), false);
  assert.equal(isReleaseRelevantFile('.changeset/example.md'), false);
});

test('parseChangesetMarkdown extracts thumbgate release type and summary', () => {
  const parsed = parseChangesetMarkdown([
    '---',
    '\'thumbgate\': minor',
    '---',
    '',
    'Add a structured release note with enough detail for customers to understand the impact.',
  ].join('\n'));

  assert.equal(parsed.releases.thumbgate, 'minor');
  assert.equal(parsed.errors.length, 0, `unexpected errors: ${parsed.errors}`);
});

test('parseChangesetMarkdown flags missing or short summaries', () => {
  const parsed = parseChangesetMarkdown([
    '---',
    '\'thumbgate\': patch',
    '---',
    '',
    'Too short',
  ].join('\n'));

  assert.ok(parsed.errors.some((error) => error.includes(String(MIN_SUMMARY_LENGTH))));
});

test('collectChangesets validates thumbgate entries from disk', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-changeset-'));
  const goodFile = path.join(tempDir, 'good.md');
  const badFile = path.join(tempDir, 'bad.md');

  fs.writeFileSync(goodFile, [
    '---',
    '\'thumbgate\': patch',
    '---',
    '',
    'Document a patch-level fix with enough context for release notes consumers.',
  ].join('\n'));
  fs.writeFileSync(badFile, [
    '---',
    '\'other-package\': patch',
    '---',
    '',
    'This note is long enough but targets the wrong package.',
  ].join('\n'));

  const changesets = collectChangesets({ dir: tempDir });
  const good = changesets.find((entry) => entry.file.endsWith('good.md'));
  const bad = changesets.find((entry) => entry.file.endsWith('bad.md'));

  assert.equal(good.validForPackage, true);
  assert.equal(good.releaseType, 'patch');
  assert.equal(bad.validForPackage, false);
  assert.ok(bad.errors.some((error) => error.includes('missing thumbgate release entry')));
});

test('collectChangesets can restrict validation to changesets changed by the PR', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-changeset-filter-'));
  fs.writeFileSync(path.join(tempDir, 'old-valid.md'), [
    '---',
    '\'thumbgate\': patch',
    '---',
    '',
    'Existing pending release note that should not satisfy a separate PR.',
  ].join('\n'));
  fs.writeFileSync(path.join(tempDir, 'new-valid.md'), [
    '---',
    '\'thumbgate\': patch',
    '---',
    '',
    'New release note attached to this pull request and valid for ThumbGate.',
  ].join('\n'));

  const changesets = collectChangesets({
    dir: tempDir,
    files: ['.changeset/new-valid.md', 'scripts/workflow-sentinel.js'],
  });

  assert.deepEqual(changesets.map((entry) => entry.file), ['.changeset/new-valid.md']);
});

test('evaluateChangesetRequirement ignores unrelated existing changesets', () => {
  const result = evaluateChangesetRequirement({
    changedFiles: ['scripts/workflow-sentinel.js'],
    changesets: [],
  });

  assert.equal(result.ok, false);
  assert.equal(result.required, true);
  assert.match(result.reason, /require at least one valid \.changeset/i);
});

test('evaluateChangesetRequirement skips non-release changes', () => {
  const result = evaluateChangesetRequirement({
    changedFiles: ['docs/SEMVER_POLICY.md', 'tests/publish-decision.test.js'],
    changesets: [],
  });

  assert.equal(result.ok, true);
  assert.equal(result.required, false);
});

test('evaluateChangesetRequirement blocks release-relevant changes without a changeset', () => {
  const result = evaluateChangesetRequirement({
    changedFiles: ['scripts/workflow-sentinel.js'],
    changesets: [],
  });

  assert.equal(result.ok, false);
  assert.equal(result.required, true);
  assert.deepEqual(result.relevantFiles, ['scripts/workflow-sentinel.js']);
});

test('evaluateChangesetRequirement allows release-relevant changes with a valid changeset', () => {
  const result = evaluateChangesetRequirement({
    changedFiles: ['scripts/workflow-sentinel.js', 'public/index.html'],
    changesets: [{
      file: '.changeset/example.md',
      releaseType: 'minor',
      summary: 'Add a release note that explains the new execution isolation guidance in the runtime and landing page.',
      errors: [],
      validForPackage: true,
    }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.required, true);
  assert.equal(result.validChangesets.length, 1);
});

test('isVersionedReleaseChangeSet detects a release PR that already consumed its changesets', () => {
  assert.equal(isVersionedReleaseChangeSet([
    '.changeset/fix-clickable-statusline-affordances.md',
    'CHANGELOG.md',
    'package.json',
  ]), true);
  assert.equal(isVersionedReleaseChangeSet([
    'CHANGELOG.md',
    'package.json',
  ]), false);
});

test('evaluateChangesetRequirement allows release-relevant changes when a release PR already consumed changesets', () => {
  const result = evaluateChangesetRequirement({
    changedFiles: [
      '.changeset/fix-clickable-statusline-affordances.md',
      'CHANGELOG.md',
      'package.json',
      'scripts/statusline-links.js',
    ],
    changesets: [],
  });

  assert.equal(result.ok, true);
  assert.equal(result.required, true);
  assert.match(result.reason, /already consumed pending changesets/i);
});

test('release confidence docs keep the buyer-facing changeset story explicit', () => {
  const strategy = fs.readFileSync(path.join(__dirname, '..', 'docs', 'CHANGESET_STRATEGY.md'), 'utf8');
  const semver = fs.readFileSync(path.join(__dirname, '..', 'docs', 'SEMVER_POLICY.md'), 'utf8');
  const confidence = fs.readFileSync(path.join(__dirname, '..', 'docs', 'RELEASE_CONFIDENCE.md'), 'utf8');

  assert.match(strategy, /customers|buyers|investors/i);
  assert.match(strategy, /changeset:check/i);
  assert.match(semver, /exact `main` merge commit/i);
  assert.match(confidence, /Verification Evidence/i);
  assert.match(confidence, /version-sync/i);
});

test('changeset workflow delegates release relevance to the tested checker', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'changeset-check.yml'), 'utf8');

  assert.match(workflow, /name:\s*Changeset Check/);
  assert.match(workflow, /permissions:\s+contents:\s+read\s+pull-requests:\s+read/s);
  assert.match(workflow, /group:\s*changeset-check-\$\{\{\s*github\.event\.pull_request\.number \|\| github\.ref\s*\}\}/);
  assert.match(workflow, /cache:\s*'npm'/);
  assert.match(workflow, /git fetch --no-tags --prune origin '\+refs\/heads\/main:refs\/remotes\/origin\/main'/);
  assert.match(workflow, /npm ci --ignore-scripts --onnxruntime-node-install-cuda=skip/);
  assert.match(workflow, /CHANGESET_BASE_REF:\s*refs\/remotes\/origin\/main/);
  assert.match(workflow, /run:\s*npm run changeset:check/);
  assert.doesNotMatch(workflow, /PR_TITLE/);
  assert.doesNotMatch(workflow, /feat\/fix PRs require a changeset/);
});
