'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildDependabotChangeset,
  buildDependabotSummary,
  defaultOutputPath,
  isDirectCliExecution,
  parseDependabotTitle,
  runCli,
  slugify,
} = require('../scripts/dependabot-changeset');

test('parseDependabotTitle extracts package metadata from dependabot titles', () => {
  const parsed = parseDependabotTitle('chore(deps): bump stripe from 22.0.1 to 22.0.2');

  assert.equal(parsed.matched, true);
  assert.equal(parsed.updateType, 'deps');
  assert.equal(parsed.dependencyName, 'stripe');
  assert.equal(parsed.fromVersion, '22.0.1');
  assert.equal(parsed.toVersion, '22.0.2');
});

test('buildDependabotSummary distinguishes runtime and build dependency bumps', () => {
  const runtimeSummary = buildDependabotSummary('chore(deps): bump stripe from 22.0.1 to 22.0.2');
  const buildSummary = buildDependabotSummary('chore(deps-dev): bump @changesets/cli from 2.30.0 to 2.31.0');

  assert.match(runtimeSummary, /runtime dependency/i);
  assert.match(runtimeSummary, /stripe/);
  assert.match(buildSummary, /build and test dependency/i);
  assert.match(buildSummary, /@changesets\/cli/);
});

test('buildDependabotSummary falls back cleanly for unrecognized titles', () => {
  const summary = buildDependabotSummary('docs: refresh onboarding text');

  assert.match(summary, /Keep ThumbGate release automation current/i);
});

test('buildDependabotChangeset creates a valid thumbgate patch changeset', () => {
  const changeset = buildDependabotChangeset('chore(deps): bump @google/genai from 1.49.0 to 1.50.1');

  assert.match(changeset, /^---\n'thumbgate': patch\n---/);
  assert.match(changeset, /@google\/genai/);
  assert.match(changeset, /1\.49\.0/);
  assert.match(changeset, /1\.50\.1/);
  assert.match(changeset, /audited release flow/i);
});

test('buildDependabotChangeset accepts explicit package and release options', () => {
  const changeset = buildDependabotChangeset('docs: refresh onboarding text', {
    packageName: 'thumbgate-core',
    releaseType: 'minor',
  });

  assert.match(changeset, /^---\n'thumbgate-core': minor\n---/);
  assert.match(changeset, /Keep ThumbGate release automation current/i);
});

test('defaultOutputPath slugifies scoped packages safely', () => {
  const outputPath = defaultOutputPath('chore(deps-dev): bump @changesets/cli from 2.30.0 to 2.31.0');
  assert.equal(outputPath, path.join('.changeset', 'dependabot-changesets-cli.md'));
});

test('defaultOutputPath falls back to the title when no dependency is parsed', () => {
  const outputPath = defaultOutputPath('docs: refresh onboarding text');
  assert.equal(outputPath, path.join('.changeset', 'dependabot-docs-refresh-onboarding-text.md'));
});

test('slugify removes repeated separators and trims trailing dashes', () => {
  assert.equal(slugify('  @scope/pkg___name  '), 'scope-pkg-name');
  assert.equal(slugify('!!!'), 'dependabot-update');
});

test('parseDependabotTitle reports unmatched titles without partial metadata', () => {
  const parsed = parseDependabotTitle('chore(deps): bump stripe');

  assert.equal(parsed.matched, false);
  assert.equal(parsed.dependencyName, '');
  assert.equal(parsed.fromVersion, '');
  assert.equal(parsed.toVersion, '');
});

test('runCli writes the generated changeset file', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-dependabot-changeset-'));
  const outputPath = path.join(tempDir, '.changeset', 'dependabot-pr-976.md');

  const writtenPath = runCli([
    '--title',
    'chore(deps): bump stripe from 22.0.1 to 22.0.2',
    '--output',
    outputPath,
  ]);

  assert.equal(writtenPath, outputPath);
  assert.equal(fs.existsSync(outputPath), true);
  const content = fs.readFileSync(outputPath, 'utf8');
  assert.match(content, /^---\n'thumbgate': patch\n---/);
  assert.match(content, /stripe/);
});

test('runCli derives the default output path and validates missing title input', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-dependabot-default-path-'));
  const originalCwd = process.cwd();
  let writtenPath;
  try {
    process.chdir(tempDir);
    writtenPath = runCli([
      '--title',
      'chore(deps-dev): bump @changesets/cli from 2.30.0 to 2.31.0',
      '--package-name',
      'thumbgate-core',
      '--release-type',
      'minor',
    ]);
  } finally {
    process.chdir(originalCwd);
  }

  const expectedPath = path.join('.changeset', 'dependabot-changesets-cli.md');
  assert.equal(writtenPath, expectedPath);
  const content = fs.readFileSync(path.join(tempDir, expectedPath), 'utf8');
  assert.match(content, /^---\n'thumbgate-core': minor\n---/);
  assert.throws(() => runCli([]), /--title is required/);
});

test('isDirectCliExecution only returns true for the script entrypoint', () => {
  assert.equal(isDirectCliExecution(['node', '/tmp/other.js']), false);
  assert.equal(isDirectCliExecution(['node', path.resolve(__dirname, '../scripts/dependabot-changeset.js')]), true);
  assert.equal(isDirectCliExecution(['node']), false);
});
