'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  buildColabComputeHonestyReport,
  formatColabComputeHonestyReport,
  PLANS,
} = require('../scripts/colab-compute-honesty');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'colab-compute-honesty.js');
const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');

const LIVE_SNAPSHOT = {
  account: 'iganapolsky@gmail.com',
  paygDisabled: true,
  proSubscribeVisible: true,
  proPlusSubscribeVisible: true,
};

test('map-only is ready and lists CU packs from the signup page', () => {
  const report = buildColabComputeHonestyReport({ mapOnly: true });
  assert.equal(report.status, 'ready');
  assert.equal(report.ok, true);
  assert.deepEqual(PLANS.payg.packs, [[9.99, 100], [49.99, 500]]);
  assert.equal(PLANS.pro.monthlyUsd, 9.99);
  assert.equal(PLANS.proplus.monthlyUsd, 49.99);
  assert.equal(PLANS.proplus.backgroundHours, 24);
});

test('Pro+ / A100 claim without plan-proof fails', () => {
  const report = buildColabComputeHonestyReport({
    claim: 'Offload gate evals to Colab Pro+ A100',
  });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'paid_feature_without_plan_proof'));
});

test('Subscribe still visible on /signup is not a Pro+ receipt', () => {
  const report = buildColabComputeHonestyReport({
    claim: 'Account is on Colab Pro+',
    planProof: 'proplus',
    snapshot: JSON.stringify(LIVE_SNAPSHOT),
  });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'subscribe_button_is_not_receipt'));
});

test('24h background requires Pro+ proof', () => {
  const report = buildColabComputeHonestyReport({
    claim: 'notebook keeps running 24 hours in the background',
    planProof: 'pro',
  });
  assert.ok(report.findings.some((f) => f.id === 'background_requires_proplus'));
});

test('clone / buy flags fail closed', () => {
  assert.ok(buildColabComputeHonestyReport({ cloneColab: true }).findings.some((f) => f.id === 'colab_sku_clone'));
  assert.ok(buildColabComputeHonestyReport({ buyPro: true }).findings.some((f) => f.id === 'colab_spend_refused'));
  assert.ok(buildColabComputeHonestyReport({ claim: 'run colab-cli --gpu a100' }).findings.some((f) => f.id === 'colab_sku_clone'));
});

test('format includes disclaimer', () => {
  const text = formatColabComputeHonestyReport(buildColabComputeHonestyReport({ mapOnly: true }));
  assert.match(text, /Compute-Honesty Doctor/);
  assert.match(text, /not affiliated with Google Colab/i);
});

test('CLI --json --map-only exits 0', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--json', '--map-only'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.name, 'thumbgate-colab-compute-honesty');
});

test('CLI paid claim exits 1', () => {
  const result = spawnSync(process.execPath, [
    SCRIPT, '--json', '--claim=Colab Pro+ A100 eval sweep',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 1);
});

test('bin/cli.js colab-compute-honesty is wired', () => {
  const result = spawnSync(process.execPath, [CLI, 'colab-compute-honesty', '--json', '--map-only'], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('gate templates and skill refuse Colab SKU clones', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'gate-templates.json'), 'utf8'));
  const ids = config.templates.map((t) => t.id);
  assert.ok(ids.includes('require-compute-unit-proof'));
  assert.ok(ids.includes('refuse-colab-sku-clone'));

  const skill = fs.readFileSync(
    path.join(__dirname, '..', '.agents', 'skills', 'colab-compute-honesty-not-clone', 'SKILL.md'),
    'utf8'
  );
  for (const heading of ['## Goal', '## Constraints', '## Reference', '## Examples', '## Procedures', '## Rubric']) {
    assert.ok(skill.includes(heading), `missing ${heading}`);
  }
  assert.match(skill, /Weak:/);
  assert.match(skill, /Gold:/);
  assert.match(skill, /Do NOT/);
  assert.match(skill, /colab\.research\.google\.com\/signup/);
});
