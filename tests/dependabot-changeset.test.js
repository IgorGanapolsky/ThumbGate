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
  parseDependabotTitle,
  runCli,
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

test('buildDependabotChangeset creates a valid thumbgate patch changeset', () => {
  const changeset = buildDependabotChangeset('chore(deps): bump @google/genai from 1.49.0 to 1.50.1');

  assert.match(changeset, /^---\n'thumbgate': patch\n---/);
  assert.match(changeset, /@google\/genai/);
  assert.match(changeset, /1\.49\.0/);
  assert.match(changeset, /1\.50\.1/);
  assert.match(changeset, /audited release flow/i);
});

test('defaultOutputPath slugifies scoped packages safely', () => {
  const outputPath = defaultOutputPath('chore(deps-dev): bump @changesets/cli from 2.30.0 to 2.31.0');
  assert.equal(outputPath, path.join('.changeset', 'dependabot-changesets-cli.md'));
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
