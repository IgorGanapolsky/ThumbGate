'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  checkContract,
  proveGlamaMcpStart,
  writeReport,
} = require('../scripts/prove-glama-mcp-start');

test('checkContract passes on current main manifests', () => {
  const r = checkContract();
  assert.equal(r.passed, true, JSON.stringify(r.failed, null, 2));
  assert.ok(r.checks.some((c) => c.id === 'server_package_args_serve' && c.ok));
  assert.ok(r.checks.some((c) => c.id === 'package_ships_manifests' && c.ok));
});

test('proveGlamaMcpStart writes proof artifacts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-glama-proof-'));
  const report = await proveGlamaMcpStart({ smoke: false });
  const paths = writeReport(report, dir);
  assert.ok(fs.existsSync(paths.jsonPath));
  assert.ok(fs.existsSync(paths.mdPath));
  assert.equal(report.passed, true);
});
