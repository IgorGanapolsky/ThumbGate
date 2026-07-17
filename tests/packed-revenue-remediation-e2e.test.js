'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const NOW = '2026-07-16T12:00:00.000Z';
const REQUIRED_MODULES = [
  'scripts/revenue-action-eligibility.js',
  'scripts/revenue-evidence-remediation.js',
];

test('packed npm remediation command is executable, read-only, and fail-closed', { timeout: 120_000 }, (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-packed-revenue-remediation-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const packDir = path.join(tempRoot, 'pack');
  const installDir = path.join(tempRoot, 'install');
  const homeDir = path.join(tempRoot, 'home');
  const statePath = path.join(tempRoot, 'sales-pipeline.jsonl');
  const targetsPath = path.join(tempRoot, 'targets.jsonl');
  fs.mkdirSync(packDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });

  const packResult = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', packDir], {
    cwd: ROOT,
    encoding: 'utf8',
  }));
  const tarballPath = path.join(packDir, packResult[0].filename);
  execFileSync('npm', ['install', '--prefix', installDir, '--ignore-scripts', '--no-audit', '--no-fund', tarballPath], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  const installedRoot = path.join(installDir, 'node_modules', 'thumbgate');
  for (const modulePath of REQUIRED_MODULES) {
    assert.equal(fs.existsSync(path.join(installedRoot, modulePath)), true, `${modulePath} missing after npm install`);
  }
  const installedPackage = require(path.join(installedRoot, 'package.json'));
  assert.match(installedPackage.scripts['revenue:remediate'], /revenue-evidence-remediation\.js/);

  const lead = {
    leadId: 'packed_marketplace_route',
    createdAt: NOW,
    updatedAt: NOW,
    stage: 'targeted',
    source: 'marketplace',
    channel: 'marketplace',
    history: [{
      fromStage: null,
      toStage: 'targeted',
      at: NOW,
      actor: 'fixture',
      channel: 'marketplace',
      evidence: {},
    }],
  };
  fs.writeFileSync(statePath, `${JSON.stringify(lead)}\n`, 'utf8');
  fs.writeFileSync(targetsPath, `${JSON.stringify({
    leadId: lead.leadId,
    source: 'reddit',
    channel: 'reddit_comment',
  })}\n`, 'utf8');
  const before = fs.readFileSync(statePath);

  const result = spawnSync('npm', [
    'run', 'revenue:remediate', '--',
    '--state', statePath,
    '--targets', targetsPath,
    '--now', NOW,
    '--json',
  ], {
    cwd: installedRoot,
    env: {
      ...process.env,
      HOME: homeDir,
      THUMBGATE_NO_TELEMETRY: '1',
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const jsonStart = result.stdout.indexOf('{');
  assert.ok(jsonStart >= 0, result.stdout);
  const queue = JSON.parse(result.stdout.slice(jsonStart));
  assert.equal(queue.summary.total, 1);
  assert.equal(queue.summary.remediationRequired, 1);
  assert.equal(queue.summary.approvalReady, 0);
  assert.equal(queue.rows[0].zeroSpendStatus, 'hold_unverified_cost');
  assert.equal(queue.rows[0].readyForOutbound, false);
  assert.equal(queue.primaryAction.externalSideEffectAuthorized, false);
  assert.deepEqual(fs.readFileSync(statePath), before);
});
