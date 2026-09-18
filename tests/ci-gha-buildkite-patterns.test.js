'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  firstFailedStep,
  missingRequiredContexts,
  auditWorkflowText,
  renderAnnotation,
  buildCiGhaBuildkitePatternsReport,
  parseArgs,
} = require('../scripts/ci-gha-buildkite-patterns');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'ci-gha-buildkite-patterns.js');
const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');
const CI_YML = path.resolve(__dirname, '..', '.github', 'workflows', 'ci.yml');
const E2E_YML = path.resolve(__dirname, '..', '.github', 'workflows', 'e2e.yml');

function writeTemp(name, contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-bk-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, contents);
  return file;
}

test('map-only is ready and names GitHub Actions as vendor', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--json', '--map-only'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.vendor, 'github-actions');
  assert.equal(report.clone, false);
  assert.ok(report.railMap.length >= 5);
});

test('firstFailedStep names the first red step not a later one', () => {
  const jobs = [
    {
      name: 'test',
      conclusion: 'failure',
      steps: [
        { name: 'Checkout', conclusion: 'success', number: 1 },
        { name: 'Run tests', conclusion: 'failure', number: 2 },
        { name: 'Upload proof artifacts', conclusion: 'skipped', number: 3 },
      ],
    },
  ];
  const fail = firstFailedStep(jobs);
  assert.equal(fail.job, 'test');
  assert.equal(fail.step, 'Run tests');
  assert.equal(fail.number, 2);
});

test('missing required contexts point at GitHub Status not code', () => {
  const missing = missingRequiredContexts([{ name: 'test' }], ['test', 'audit', 'CodeQL']);
  assert.deepEqual(missing, ['audit', 'CodeQL']);
  const report = buildCiGhaBuildkitePatternsReport({
    jobsJson: writeTemp('jobs.json', JSON.stringify({ jobs: [{ name: 'test', conclusion: 'success', steps: [] }] })),
  });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'missing_required'));
  assert.match(report.findings.find((f) => f.id === 'missing_required').message, /githubstatus\.com/);
});

test('clone / migrate / quarantine / rerun-queued fail closed', () => {
  for (const flag of ['cloneBuildkite', 'migrate', 'quarantine', 'rerunQueued']) {
    const report = buildCiGhaBuildkitePatternsReport({ [flag]: true, mapOnly: false });
    assert.equal(report.status, 'fail', flag);
  }
});

test('auditWorkflowText wants concurrency and refuses cancel-all-including-main', () => {
  const bare = auditWorkflowText('name: x\non: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n');
  assert.ok(bare.some((f) => f.id === 'missing_concurrency'));
  const cancelMain = auditWorkflowText('concurrency:\n  group: x\n  cancel-in-progress: true\n');
  assert.ok(cancelMain.some((f) => f.id === 'cancel_main'));
  const ok = auditWorkflowText(
    "concurrency:\n  group: ci\n  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}\n",
  );
  assert.equal(ok.length, 0);
});

test('live ci.yml already has PR cancel-in-progress excluding main', () => {
  const yaml = fs.readFileSync(CI_YML, 'utf8');
  assert.match(yaml, /concurrency:/);
  assert.match(yaml, /cancel-in-progress:\s*\$\{\{\s*github\.ref != 'refs\/heads\/main'\s*\}\}/);
  assert.match(yaml, /Annotate first failed step/);
  const findings = auditWorkflowText(yaml);
  assert.equal(findings.length, 0, JSON.stringify(findings));
});

test('e2e shards keep fail-fast false so merge-reports can annotate (wait continue_on_failure)', () => {
  const yaml = fs.readFileSync(E2E_YML, 'utf8');
  assert.match(yaml, /fail-fast:\s*false/);
  assert.match(yaml, /needs:\s*\[e2e\]/);
  assert.match(yaml, /if:\s*\$\{\{\s*!cancelled\(\)\s*\}\}/);
});

test('renderAnnotation tells operators not to dump logs first', () => {
  const md = renderAnnotation({ job: 'test', step: 'Run tests', conclusion: 'failure' });
  assert.match(md, /Do not dump logs first/);
  assert.match(md, /Run tests/);
  assert.doesNotMatch(md, /buildkite-agent/);
});

test('parseArgs reads jobs-json and annotate', () => {
  const a = parseArgs(['--json', '--jobs-json=x.json', '--annotate', '--workflow=ci.yml']);
  assert.equal(a.json, true);
  assert.equal(a.jobsJson, 'x.json');
  assert.equal(a.annotate, true);
  assert.equal(a.workflow, 'ci.yml');
});

test('bin/cli.js ci-gha-buildkite-patterns is wired', () => {
  const result = spawnSync(process.execPath, [CLI, 'ci-gha-buildkite-patterns', '--json', '--map-only'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.name, 'thumbgate-ci-gha-buildkite-patterns');
});

test('skill refuses Buildkite clone', () => {
  const skill = fs.readFileSync(
    path.join(__dirname, '..', '.agents', 'skills', 'ci-gha-buildkite-patterns-not-clone', 'SKILL.md'),
    'utf8',
  );
  assert.match(skill, /not a\s+Buildkite clone/i);
  assert.match(skill, /Never.*migrate/i);
});
