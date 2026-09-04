'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  detectLockfiles,
  extractInstallCommands,
  inferCanonicalManager,
  buildPackageManagerHonestyReport,
  formatPackageManagerHonestyReport,
} = require('../scripts/package-manager-honesty-doctor');

const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');
const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'package-manager-honesty-doctor.js');

function makeFixture(layout) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-honesty-'));
  if (layout.packageJson) {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(layout.packageJson, null, 2));
  }
  for (const lock of layout.lockfiles || []) {
    fs.writeFileSync(path.join(root, lock), `${lock}\n`);
  }
  if (layout.workflows) {
    const dir = path.join(root, '.github', 'workflows');
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(layout.workflows)) {
      fs.writeFileSync(path.join(dir, name), body);
    }
  }
  return root;
}

test('detectLockfiles finds npm and pnpm locks', () => {
  const root = makeFixture({ lockfiles: ['package-lock.json', 'pnpm-lock.yaml'] });
  const locks = detectLockfiles(root);
  assert.deepEqual(locks.map((l) => l.manager).sort(), ['npm', 'pnpm']);
});


test('extractInstallCommands splits chained run commands', () => {
  const cmds = extractInstallCommands(`
jobs:
  a:
    steps:
      - run: npm ci && pnpm install --ignore-scripts
`, 'ci.yml');
  assert.equal(cmds.length, 2);
  assert.equal(cmds[0].manager, 'npm');
  assert.equal(cmds[0].ignoreScripts, false);
  assert.equal(cmds[1].manager, 'pnpm');
  assert.equal(cmds[1].ignoreScripts, true);
});

test('extractInstallCommands reads multiline run blocks', () => {
  const cmds = extractInstallCommands(`
jobs:
  a:
    steps:
      - run: |
          npm ci --ignore-scripts
          pnpm install
`, 'ci.yml');
  assert.equal(cmds.length, 2);
  assert.equal(cmds[0].manager, 'npm');
  assert.equal(cmds[0].ignoreScripts, true);
  assert.equal(cmds[1].manager, 'pnpm');
  assert.equal(cmds[1].ignoreScripts, false);
});

test('doctor fails when package.json is malformed', () => {
  const root = makeFixture({
    lockfiles: ['package-lock.json'],
  });
  require('node:fs').writeFileSync(require('node:path').join(root, 'package.json'), '{ not-json');
  const report = buildPackageManagerHonestyReport({ root });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'package_json_parse_error'));
});

test('extractInstallCommands flags ignore-scripts', () => {
  const cmds = extractInstallCommands(`
jobs:
  a:
    steps:
      - run: npm ci --ignore-scripts
      - run: npm ci --onnxruntime-node-install-cuda=skip
      - run: pnpm install
`, 'ci.yml');
  assert.equal(cmds.length, 3);
  assert.equal(cmds[0].ignoreScripts, true);
  assert.equal(cmds[1].ignoreScripts, false);
  assert.equal(cmds[2].manager, 'pnpm');
});

test('inferCanonicalManager prefers sole lockfile', () => {
  assert.equal(inferCanonicalManager([{ manager: 'npm' }], null), 'npm');
  assert.equal(
    inferCanonicalManager([{ manager: 'npm' }, { manager: 'pnpm' }], 'pnpm'),
    'pnpm'
  );
});

test('doctor fails on multiple lockfiles', () => {
  const root = makeFixture({
    packageJson: { name: 'x', packageManager: 'npm@10.0.0' },
    lockfiles: ['package-lock.json', 'pnpm-lock.yaml'],
  });
  const report = buildPackageManagerHonestyReport({ root });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'multiple_lockfiles'));
});

test('doctor fails when CI manager disagrees with lockfile', () => {
  const root = makeFixture({
    packageJson: { name: 'x' },
    lockfiles: ['package-lock.json'],
    workflows: {
      'ci.yml': 'jobs:\n  t:\n    steps:\n      - run: pnpm install\n',
    },
  });
  const report = buildPackageManagerHonestyReport({ root });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'ci_install_manager_mismatch'));
});

test('doctor warns when CI lacks --ignore-scripts', () => {
  const root = makeFixture({
    packageJson: { name: 'x' },
    lockfiles: ['package-lock.json'],
    workflows: {
      'ci.yml': 'jobs:\n  t:\n    steps:\n      - run: npm ci\n',
    },
  });
  const report = buildPackageManagerHonestyReport({ root });
  assert.ok(['actionable', 'fail'].includes(report.status));
  assert.ok(report.findings.some((f) => f.id === 'ci_install_without_ignore_scripts'));
});

test('propose-switch=pnpm fail-closes with pnpm 12 compat warnings', () => {
  const root = makeFixture({
    packageJson: { name: 'x' },
    lockfiles: ['package-lock.json'],
    workflows: {
      'ci.yml': 'jobs:\n  t:\n    steps:\n      - run: npm ci --ignore-scripts\n',
    },
  });
  const report = buildPackageManagerHonestyReport({
    root,
    'propose-switch': 'pnpm',
  });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'switch_without_migration_plan'));
  assert.ok(report.findings.some((f) => f.id === 'pnpm12_resolution-only-removed'));
  assert.match(formatPackageManagerHonestyReport(report), /Refuse silent switch/);
});

test('healthy npm fixture is ready when ignore-scripts present', () => {
  const root = makeFixture({
    packageJson: { name: 'x', packageManager: 'npm@10.9.0' },
    lockfiles: ['package-lock.json'],
    workflows: {
      'ci.yml': 'jobs:\n  t:\n    steps:\n      - run: npm ci --ignore-scripts\n',
    },
  });
  const report = buildPackageManagerHonestyReport({ root });
  assert.equal(report.status, 'ready');
  assert.equal(report.metrics.canonicalManager, 'npm');
});

test('script CLI exits 1 on propose-switch without migration', () => {
  const root = makeFixture({
    packageJson: { name: 'x' },
    lockfiles: ['package-lock.json'],
    workflows: {
      'ci.yml': 'jobs:\n  t:\n    steps:\n      - run: npm ci --ignore-scripts\n',
    },
  });
  const result = spawnSync(process.execPath, [
    SCRIPT,
    `--root=${root}`,
    '--propose-switch=pnpm',
    '--json',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.name, 'thumbgate-package-manager-honesty-doctor');
  assert.equal(payload.status, 'fail');
});

test('thumbgate CLI package-manager-honesty-doctor is wired', () => {
  const result = spawnSync(process.execPath, [
    CLI,
    'package-manager-honesty-doctor',
    '--root=' + path.resolve(__dirname, '..'),
    '--allow-ignore-scripts-gaps',
    '--json',
  ], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.name, 'thumbgate-package-manager-honesty-doctor');
  assert.equal(payload.metrics.canonicalManager, 'npm');
  assert.ok(payload.metrics.lockfiles.includes('package-lock.json'));
});
