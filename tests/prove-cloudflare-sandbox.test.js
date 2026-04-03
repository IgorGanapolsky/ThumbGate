'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

test('prove-cloudflare-sandbox passes all proof checks', () => {
  const tmpProofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-cloudflare-sandbox-proof-'));
  try {
    const output = execSync('node scripts/prove-cloudflare-sandbox.js', {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, RLHF_PROOF_DIR: tmpProofDir },
    });

    assert.match(output, /Cloudflare sandbox proof written/);
    const report = JSON.parse(fs.readFileSync(path.join(tmpProofDir, 'cloudflare-sandbox-report.json'), 'utf8'));
    assert.equal(report.summary.failed, 0);
    assert.equal(report.summary.passed, 6);
  } finally {
    fs.rmSync(tmpProofDir, { recursive: true, force: true });
  }
});

test('prove-cloudflare-sandbox writes markdown evidence', () => {
  const tmpProofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-cloudflare-sandbox-proof-md-'));
  try {
    execSync('node scripts/prove-cloudflare-sandbox.js', {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, RLHF_PROOF_DIR: tmpProofDir },
    });

    const markdown = fs.readFileSync(path.join(tmpProofDir, 'cloudflare-sandbox-report.md'), 'utf8');
    assert.match(markdown, /CFW-01/);
    assert.match(markdown, /CFW-06/);
    assert.match(markdown, /Passed: 6/);
  } finally {
    fs.rmSync(tmpProofDir, { recursive: true, force: true });
  }
});
