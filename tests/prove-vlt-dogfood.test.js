'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'prove-vlt-dogfood.js');

test('prove-vlt-dogfood: --allow-missing exits 0 when vlt absent from PATH', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--json', '--allow-missing'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: '/usr/bin:/bin', VLT_BIN: '/nonexistent/vlt' },
    timeout: 30000,
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const report = JSON.parse(r.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.skipped, true);
});

test('prove-vlt-dogfood: full smoke when vlt is installed', (t) => {
  const which = spawnSync('vlt', ['--version'], { encoding: 'utf8' });
  const npmGlobal = path.join(process.env.HOME || '', '.npm-global', 'bin', 'vlt');
  const hasVlt = which.status === 0
    || require('fs').existsSync(npmGlobal);
  if (!hasVlt) {
    t.skip('vlt not installed in this environment');
    return;
  }
  const bin = which.status === 0 ? 'vlt' : npmGlobal;
  const r = spawnSync(process.execPath, [SCRIPT, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, VLT_BIN: bin, PATH: `${path.dirname(bin)}:${process.env.PATH || ''}` },
    timeout: 180000,
  });
  assert.equal(r.status, 0, `stdout=${r.stdout}\nstderr=${r.stderr}`);
  const report = JSON.parse(r.stdout);
  assert.equal(report.ok, true);
  assert.ok(report.probes.some((p) => p.id === 'install' && p.ok));
  assert.ok(report.probes.some((p) => p.id === 'query-ms' && p.ok));
  assert.ok(report.probes.some((p) => p.id === 'query-vuln-selector' && p.ok));
});
