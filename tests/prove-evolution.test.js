'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

test('prove-evolution: proof gate passes with 6/6 checks', () => {
  const tmpProofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-evolution-proof-test-'));
  try {
    const output = execSync('node scripts/prove-evolution.js', {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, THUMBGATE_PROOF_DIR: tmpProofDir },
    });

    assert.ok(output.includes('6 passed, 0 failed'), `Expected 6/6 pass, got: ${output}`);
  } finally {
    fs.rmSync(tmpProofDir, { recursive: true, force: true });
  }
});

test('prove-evolution: report.json is valid JSON with all requirements', () => {
  const tmpProofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-evolution-proof-json-'));
  try {
    execSync('node scripts/prove-evolution.js', {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, THUMBGATE_PROOF_DIR: tmpProofDir },
    });

    const reportPath = path.join(tmpProofDir, 'evolution-report.json');
    assert.ok(fs.existsSync(reportPath), 'evolution-report.json must exist');
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(report.phase, '17-agent-workspace-evolution');
    assert.equal(report.passed, 6);
    assert.equal(report.failed, 0);
    assert.ok(report.requirements['EVOLVE-01']);
    assert.ok(report.requirements['EVOLVE-06']);
  } finally {
    fs.rmSync(tmpProofDir, { recursive: true, force: true });
  }
});

test('prove-evolution: report.md contains all requirement checkboxes', () => {
  const tmpProofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-evolution-proof-md-'));
  try {
    execSync('node scripts/prove-evolution.js', {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, THUMBGATE_PROOF_DIR: tmpProofDir },
    });

    const markdownPath = path.join(tmpProofDir, 'evolution-report.md');
    assert.ok(fs.existsSync(markdownPath), 'evolution-report.md must exist');
    const markdown = fs.readFileSync(markdownPath, 'utf8');
    assert.ok(markdown.includes('[x] **EVOLVE-01**'));
    assert.ok(markdown.includes('[x] **EVOLVE-06**'));
    assert.ok(markdown.includes('6 passed, 0 failed'));
  } finally {
    fs.rmSync(tmpProofDir, { recursive: true, force: true });
  }
});
