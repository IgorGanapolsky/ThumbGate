'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

let sharedProofDir;
let sharedOutput;
let sharedReport;
let sharedMarkdown;

function ensureProofRun() {
  if (sharedOutput) {
    return;
  }
  sharedProofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-runtime-proof-test-'));
  sharedOutput = execSync('node scripts/prove-runtime.js', {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, THUMBGATE_RUNTIME_PROOF_DIR: sharedProofDir },
  });
  sharedReport = JSON.parse(fs.readFileSync(path.join(sharedProofDir, 'runtime-report.json'), 'utf8'));
  sharedMarkdown = fs.readFileSync(path.join(sharedProofDir, 'runtime-report.md'), 'utf8');
}

test.after(() => {
  if (sharedProofDir) {
    fs.rmSync(sharedProofDir, { recursive: true, force: true });
  }
});

test('prove-runtime: proof gate passes with 7/7 checks', () => {
  ensureProofRun();
  assert.ok(sharedOutput.includes('7 passed, 0 failed'), `Expected 7/7 pass, got: ${sharedOutput}`);
});

test('prove-runtime: report.json is valid JSON with all requirements', () => {
  ensureProofRun();
  assert.equal(sharedReport.phase, '12-interruptible-runtime');
  assert.equal(sharedReport.passed, 7);
  assert.equal(sharedReport.failed, 0);
  assert.ok(sharedReport.requirements['RUNTIME-01']);
  assert.ok(sharedReport.requirements['RUNTIME-06']);
  assert.ok(sharedReport.requirements['RUNTIME-07']);
});

test('prove-runtime: report.md contains all requirement checkboxes', () => {
  ensureProofRun();
  assert.ok(sharedMarkdown.includes('[x] **RUNTIME-01**'));
  assert.ok(sharedMarkdown.includes('[x] **RUNTIME-06**'));
  assert.ok(sharedMarkdown.includes('[x] **RUNTIME-07**'));
  assert.ok(sharedMarkdown.includes('7 passed, 0 failed'));
});
