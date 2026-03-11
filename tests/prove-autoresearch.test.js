'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

test('prove-autoresearch: proof gate passes with 5/5 checks', () => {
  const tmpProofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-autoresearch-proof-test-'));
  try {
    const output = execSync('node scripts/prove-autoresearch.js', {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, RLHF_PROOF_DIR: tmpProofDir },
    });

    assert.ok(output.includes('5 passed, 0 failed'), `Expected 5/5 pass, got: ${output}`);
  } finally {
    fs.rmSync(tmpProofDir, { recursive: true, force: true });
  }
});

test('prove-autoresearch: report.json is valid JSON with all requirements', () => {
  const tmpProofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-autoresearch-proof-json-'));
  try {
    execSync('node scripts/prove-autoresearch.js', {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, RLHF_PROOF_DIR: tmpProofDir },
    });

    const reportPath = path.join(tmpProofDir, 'autoresearch-report.json');
    assert.ok(fs.existsSync(reportPath), 'report.json must exist');
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    assert.equal(report.phase, '09-autoresearch');
    assert.equal(report.passed, 5);
    assert.equal(report.failed, 0);
    assert.ok(report.requirements['AUTORESEARCH-01']);
    assert.ok(report.requirements['AUTORESEARCH-05']);
  } finally {
    fs.rmSync(tmpProofDir, { recursive: true, force: true });
  }
});

test('prove-autoresearch: report.md contains all requirement checkboxes', () => {
  const tmpProofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-autoresearch-proof-md-'));
  try {
    execSync('node scripts/prove-autoresearch.js', {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, RLHF_PROOF_DIR: tmpProofDir },
    });

    const mdPath = path.join(tmpProofDir, 'autoresearch-report.md');
    assert.ok(fs.existsSync(mdPath), 'report.md must exist');
    const md = fs.readFileSync(mdPath, 'utf-8');
    assert.ok(md.includes('[x] **AUTORESEARCH-01**'));
    assert.ok(md.includes('[x] **AUTORESEARCH-05**'));
    assert.ok(md.includes('5/5 passed'));
  } finally {
    fs.rmSync(tmpProofDir, { recursive: true, force: true });
  }
});
