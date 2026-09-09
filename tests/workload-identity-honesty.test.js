'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  scanWorkflowText,
  buildWorkloadIdentityHonestyReport,
  formatWorkloadIdentityHonestyReport,
} = require('../scripts/workload-identity-honesty');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'workload-identity-honesty.js');

function makeFixture(workflows) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wif-honesty-'));
  const dir = path.join(root, '.github', 'workflows');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(workflows)) {
    fs.writeFileSync(path.join(dir, name), body);
  }
  return root;
}

test('PAT with github.token fallback is ready', () => {
  const root = makeFixture({
    'ci.yml': `jobs:
  t:
    steps:
      - env:
          GH_TOKEN: \${{ secrets.GH_PAT || github.token }}
        run: echo ok
`,
  });
  const report = buildWorkloadIdentityHonestyReport({ root });
  assert.equal(report.status, 'ready');
  assert.equal(report.metrics.patWithoutFallback, 0);
});

test('PAT without fallback is actionable by default, fail with --fail-pat-only', () => {
  const yaml = `jobs:
  t:
    env:
      GITHUB_TOKEN: \${{ secrets.GH_PAT }}
    steps:
      - run: echo sync
`;
  const root = makeFixture({ 'about.yml': yaml });
  const warn = buildWorkloadIdentityHonestyReport({ root });
  assert.equal(warn.status, 'actionable');
  assert.ok(warn.findings.some((f) => f.id === 'pat_without_token_fallback'));

  const fail = buildWorkloadIdentityHonestyReport({ root, failPatOnly: true });
  assert.equal(fail.status, 'fail');
});

test('credentials_json fails closed as a long-lived cloud key', () => {
  const root = makeFixture({
    'deploy.yml': `jobs:
  d:
    steps:
      - uses: google-github-actions/auth@v2
        with:
          credentials_json: \${{ secrets.GCP_SA_KEY }}
`,
  });
  const report = buildWorkloadIdentityHonestyReport({ root });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'long_lived_cloud_key'));
});

test('WIF without id-token: write fails', () => {
  const root = makeFixture({
    'oidc.yml': `jobs:
  d:
    permissions:
      contents: read
    steps:
      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: projects/1/locations/global/workloadIdentityPools/p/providers/github
          service_account: sa@example.iam.gserviceaccount.com
`,
  });
  const report = buildWorkloadIdentityHonestyReport({ root });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'wif_without_id_token'));
});

test('unrelated job id-token write does not cover a WIF job', () => {
  const root = makeFixture({
    'oidc.yml': `jobs:
  other:
    permissions:
      id-token: write
    steps:
      - run: echo
  d:
    permissions:
      contents: read
    steps:
      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: projects/1/locations/global/workloadIdentityPools/p/providers/github
`,
  });
  const report = buildWorkloadIdentityHonestyReport({ root });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'wif_without_id_token' && f.job === 'd'));
});

test('folded PAT scalar with github.token fallback is ready', () => {
  const root = makeFixture({
    'ci.yml': `jobs:
  t:
    steps:
      - env:
          GH_TOKEN: >
            \${{ secrets.GH_PAT || github.token }}
        run: echo ok
`,
  });
  const report = buildWorkloadIdentityHonestyReport({ root });
  assert.equal(report.status, 'ready');
  assert.equal(report.metrics.patWithoutFallback, 0);
});

test('WIF plus id-token write is ready', () => {
  const root = makeFixture({
    'oidc.yml': `permissions:
  id-token: write
  contents: read
jobs:
  d:
    steps:
      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: projects/1/locations/global/workloadIdentityPools/p/providers/github
`,
  });
  const report = buildWorkloadIdentityHonestyReport({ root });
  assert.equal(report.status, 'ready');
  assert.equal(report.metrics.wif, 1);
});

test('scanWorkflowText flags AWS secret literals', () => {
  const scan = scanWorkflowText(
    'AWS_SECRET_ACCESS_KEY: NOTAREALSECRET/0000\n',
    'aws.yml',
  );
  assert.ok(scan.findings.some((f) => f.id === 'aws_secret_literal'));
});

test('missing workflows fail closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wif-empty-'));
  const report = buildWorkloadIdentityHonestyReport({ root });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'workflows_missing'));
});

test('format report names the source', () => {
  const root = makeFixture({
    'ok.yml': 'jobs:\n  t:\n    steps:\n      - run: echo\n',
  });
  const report = buildWorkloadIdentityHonestyReport({ root });
  assert.match(formatWorkloadIdentityHonestyReport(report), /Workload Identity/);
});

test('CLI --json --fail-pat-only exits 1', () => {
  const root = makeFixture({
    'pat.yml': 'env:\n  GH_TOKEN: ${{ secrets.GH_PAT }}\n',
  });
  const result = spawnSync(process.execPath, [
    SCRIPT,
    `--root=${root}`,
    '--fail-pat-only',
    '--json',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'fail');
});
