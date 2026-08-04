'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { collectTree } = require('../scripts/install-spend-guard');

test('install tree includes spend guard and financial control plane deps', () => {
  const files = collectTree(['thumbgate-spend-guard.js']);
  assert.ok(files.includes('thumbgate-spend-guard.js'));
  assert.ok(files.includes('financial-control-plane.js'));
  assert.ok(files.includes('feedback-paths.js'));
  for (const f of files) {
    assert.ok(
      fs.existsSync(path.join(__dirname, '..', 'scripts', f)),
      `missing ${f}`,
    );
  }
});

test('dry-run installer exits 0', () => {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'install-spend-guard.js'),
    '--dry-run',
  ], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /dry-run complete/);
});
