'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  buildPatchReadiness,
  buildUpstreamContributionPlan,
  detectCommentSignals,
  issueScore,
  listDirectPackages,
  normalizeRepo,
  renderUpstreamContributionPlan,
  resolvePackageRepo,
  writeUpstreamContributionPlan,
} = require('../scripts/upstream-contribution-engine');

const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');

test('normalizeRepo accepts common GitHub repository URL shapes', () => {
  assert.equal(normalizeRepo('git+https://github.com/stripe/stripe-node.git'), 'stripe/stripe-node');
  assert.equal(normalizeRepo('git@github.com:microsoft/playwright.git'), 'microsoft/playwright');
  assert.equal(normalizeRepo('https://github.com/huggingface/transformers.js'), 'huggingface/transformers.js');
});

test('listDirectPackages reads runtime and dev packages from the current repo', () => {
  const packages = listDirectPackages(path.resolve(__dirname, '..'));
  const names = new Set(packages.map((entry) => entry.name));

  assert.ok(names.has('stripe'));
  assert.ok(names.has('@anthropic-ai/sdk'));
  assert.ok(names.has('@changesets/cli'));
});

test('resolvePackageRepo maps ThumbGate direct dependencies to upstream repos', () => {
  assert.equal(resolvePackageRepo('stripe'), 'stripe/stripe-node');
  assert.equal(resolvePackageRepo('@google/genai'), 'googleapis/js-genai');
  assert.equal(resolvePackageRepo('@huggingface/transformers'), 'huggingface/transformers.js');
});

test('issueScore prioritizes bug bounty and small-patch signals', () => {
  const high = issueScore({
    title: 'Bug bounty: fix flaky TypeScript test failure',
    labels: ['bug', 'help wanted', 'bounty'],
  }, { dependencyType: 'runtime' });
  const low = issueScore({
    title: 'Large roadmap feature',
    labels: ['enhancement'],
  }, { dependencyType: 'dev' });

  assert.ok(high > low + 40);
});

test('buildPatchReadiness does not treat vague help-wanted crashes as autonomous PRs', () => {
  const readiness = buildPatchReadiness({
    title: 'Getting an Electron crash, not sure how to further debug - help needed!',
    labels: ['help wanted'],
  }, { name: 'better-sqlite3' });

  assert.equal(readiness.canAutofix, false);
  assert.equal(readiness.evidenceGate, 'triage-before-pr');
});

test('detectCommentSignals blocks issues that are claimed or already have PRs', () => {
  const signals = detectCommentSignals([
    "I'd like to work on this.",
    'I opened a PR that addresses the docs gap.',
  ]);

  assert.equal(signals.claimed, true);
  assert.equal(signals.existingPr, true);
  assert.equal(signals.blocked, true);
});

test('buildPatchReadiness blocks public PRs for already claimed issues', () => {
  const readiness = buildPatchReadiness({
    title: 'docs: add missing configuration example',
    labels: ['docs', 'good first issue'],
    commentSignals: { claimed: true, existingPr: false, blocked: true },
  }, { name: '@changesets/cli' });

  assert.equal(readiness.canAutofix, false);
  assert.equal(readiness.evidenceGate, 'claimed-or-existing-pr');
  assert.deepEqual(readiness.blockers, ['issue appears claimed in comments']);
});

test('buildPatchReadiness keeps security-sensitive issues out of autonomous PR mode', () => {
  const readiness = buildPatchReadiness({
    title: 'security: add Sigstore attestations for release artifacts',
    labels: ['help wanted'],
  }, { name: '@lancedb/lancedb' });

  assert.equal(readiness.canAutofix, false);
  assert.equal(readiness.evidenceGate, 'triage-before-pr');
});

test('buildPatchReadiness allows small test and type fixes after evidence gates', () => {
  const readiness = buildPatchReadiness({
    title: 'Fix flaky TypeScript test failure on Node 22',
    labels: ['bug', 'good first issue'],
  }, { name: '@anthropic-ai/sdk' });

  assert.equal(readiness.canAutofix, true);
  assert.equal(readiness.evidenceGate, 'autonomous-patch-ready');
});

test('buildUpstreamContributionPlan ranks dependency issues and keeps PR guardrails explicit', () => {
  const plan = buildUpstreamContributionPlan({
    root: path.resolve(__dirname, '..'),
    maxRepos: 3,
    issuesByRepo: {
      'stripe/stripe-node': [
        {
          number: 123,
          title: 'Bug bounty: flaky type test fails on Node 22',
          url: 'https://github.com/stripe/stripe-node/issues/123',
          labels: ['bug', 'help wanted', 'bounty'],
        },
      ],
    },
  });

  assert.equal(plan.name, 'thumbgate-upstream-contribution-engine');
  assert.equal(plan.status, 'actionable');
  assert.ok(plan.guardrails.some((line) => /Do not create promotional PRs/.test(line)));
  assert.ok(plan.autonomousWorkflow.some((line) => /Open a public PR only/.test(line)));
  assert.equal(plan.opportunities[0].repo, 'stripe/stripe-node');
  assert.equal(plan.opportunities[0].canAutofix, true);
  assert.match(plan.opportunities[0].suggestedBranch, /^codex\/upstream-stripe-123/);
});

test('render and write upstream contribution plan artifacts', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-upstream-contrib-'));
  try {
    const plan = buildUpstreamContributionPlan({
      root: path.resolve(__dirname, '..'),
      maxRepos: 1,
      issuesByRepo: {},
    });
    const markdown = renderUpstreamContributionPlan(plan);
    const paths = writeUpstreamContributionPlan(plan, tmpDir);

    assert.match(markdown, /Upstream Contribution Engine/);
    assert.match(markdown, /Repo Search Queries/);
    assert.ok(fs.existsSync(paths.jsonPath));
    assert.ok(fs.existsSync(paths.mdPath));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('upstream-contributions CLI emits JSON without network by default', () => {
  const result = spawnSync(process.execPath, [
    CLI,
    'upstream-contributions',
    '--max-repos=2',
    '--json',
  ], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      THUMBGATE_NO_NUDGE: '1',
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.name, 'thumbgate-upstream-contribution-engine');
  assert.ok(payload.summary.repoCount <= 2);
  assert.ok(payload.repos.every((repo) => repo.searchQueries.length > 0));
});
