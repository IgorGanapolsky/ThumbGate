'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

test('prove-settings: proof gate passes with 6/6 checks', () => {
  const tmpProofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-settings-proof-test-'));
  try {
    const output = execSync('node scripts/prove-settings.js', {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, THUMBGATE_SETTINGS_PROOF_DIR: tmpProofDir },
    });

    assert.ok(output.includes('6 passed, 0 failed'), `Expected 6/6 pass, got: ${output}`);
  } finally {
    fs.rmSync(tmpProofDir, { recursive: true, force: true });
  }
});

test('prove-settings: report.json is valid JSON with all requirements', () => {
  const tmpProofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-settings-proof-json-'));
  try {
    execSync('node scripts/prove-settings.js', {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, THUMBGATE_SETTINGS_PROOF_DIR: tmpProofDir },
    });

    const reportPath = path.join(tmpProofDir, 'settings-report.json');
    assert.ok(fs.existsSync(reportPath), 'settings-report.json must exist');
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(report.phase, '24-settings-hierarchy');
    assert.equal(report.passed, 6);
    assert.equal(report.failed, 0);
    assert.ok(report.requirements['SETTINGS-01']);
    assert.ok(report.requirements['SETTINGS-06']);
  } finally {
    fs.rmSync(tmpProofDir, { recursive: true, force: true });
  }
});

test('prove-settings: report.md contains all requirement checkboxes', () => {
  const tmpProofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-settings-proof-md-'));
  try {
    execSync('node scripts/prove-settings.js', {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, THUMBGATE_SETTINGS_PROOF_DIR: tmpProofDir },
    });

    const markdownPath = path.join(tmpProofDir, 'settings-report.md');
    assert.ok(fs.existsSync(markdownPath), 'settings-report.md must exist');
    const markdown = fs.readFileSync(markdownPath, 'utf8');
    assert.ok(markdown.includes('[x] **SETTINGS-01**'));
    assert.ok(markdown.includes('[x] **SETTINGS-06**'));
    assert.ok(markdown.includes('6 passed, 0 failed'));
  } finally {
    fs.rmSync(tmpProofDir, { recursive: true, force: true });
  }
});
