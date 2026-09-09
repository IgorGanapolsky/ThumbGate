'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  DEFAULT_SPECS,
  buildConfigStrictParseReport,
  formatConfigStrictParseReport,
} = require('../scripts/config-strict-parse');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'config-strict-parse.js');
const REPO_ROOT = path.resolve(__dirname, '..');

function writeJson(root, rel, value) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(value, null, 2)}\n`);
}

function validTree(root) {
  writeJson(root, 'config/mcp-allowlists.json', {
    version: 3,
    profiles: { default: ['recall'] },
  });
  writeJson(root, 'config/gates/default.json', {
    version: 1,
    gates: [{ id: 'x' }],
  });
  writeJson(root, 'config/merge-quality-checks.json', {
    requiredStatusCheckContexts: ['test'],
  });
  writeJson(root, 'config/gate-templates.json', {
    version: 1,
    templates: [{ id: 't' }],
  });
}

test('DEFAULT_SPECS cover mcp-allowlists, default gates, merge checks, templates', () => {
  const files = DEFAULT_SPECS.map((s) => s.file).sort();
  assert.deepEqual(files, [
    'config/gate-templates.json',
    'config/gates/default.json',
    'config/mcp-allowlists.json',
    'config/merge-quality-checks.json',
  ]);
});

test('valid JSON tree is ready', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-strict-'));
  validTree(root);
  const report = buildConfigStrictParseReport({ root });
  assert.equal(report.status, 'ready');
  assert.equal(report.kyaml, false);
  assert.equal(report.dialect, 'json-required-keys');
});

test('missing required key fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-strict-'));
  validTree(root);
  writeJson(root, 'config/mcp-allowlists.json', { profiles: { default: [] } });
  const report = buildConfigStrictParseReport({ root });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'required_key_missing' && f.key === 'version'));
});

test('wrong type fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-strict-'));
  validTree(root);
  writeJson(root, 'config/gates/default.json', { version: 1, gates: 'nope' });
  const report = buildConfigStrictParseReport({ root });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'required_key_wrong_type'));
});

test('malformed JSON fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-strict-'));
  validTree(root);
  const abs = path.join(root, 'config', 'merge-quality-checks.json');
  fs.writeFileSync(abs, '{ not-json');
  const report = buildConfigStrictParseReport({ root });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'config_parse_error'));
});

test('YAML dialect path is refused', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-strict-'));
  const report = buildConfigStrictParseReport({
    root,
    specs: [{ file: 'config/thumbgate-config.yaml', required: ['version'] }],
  });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'kyaml_dialect_refused'));
});

test('missing profiles.default fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-strict-'));
  validTree(root);
  writeJson(root, 'config/mcp-allowlists.json', { version: 3, profiles: { locked: [] } });
  const report = buildConfigStrictParseReport({ root });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'required_nested_key_missing'));
});

test('this repo origin configs parse ready', () => {
  const report = buildConfigStrictParseReport({ root: REPO_ROOT });
  assert.equal(report.status, 'ready', JSON.stringify(report.findings, null, 2));
});

test('format names json-required-keys', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-strict-'));
  validTree(root);
  const report = buildConfigStrictParseReport({ root });
  assert.match(formatConfigStrictParseReport(report), /json-required-keys/);
});

test('CLI --json --strict exits 1 on missing config', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-strict-'));
  const result = spawnSync(process.execPath, [
    SCRIPT,
    `--root=${root}`,
    '--strict',
    '--json',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'fail');
});
