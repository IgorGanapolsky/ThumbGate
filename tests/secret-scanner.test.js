'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.THUMBGATE_SECRET_SCAN_PROVIDER = 'heuristic';

const {
  redactText,
  scanText,
  scanFile,
  scanBashCommand,
  scanHookInput,
} = require('../scripts/secret-scanner');

function buildAnthropicKey() {
  return ['sk', '-ant-', 'api03-', 'abcdefghijklmnopqrstuvwxyz1234567890'].join('');
}

function buildStripeKey() {
  return ['sk', '_live_', '1234567890abcdefghijklmnopqrstuvwxyz'].join('');
}

function buildOpenAiKey() {
  return ['sk', '-', 'abcdefghijklmnopqrstuvwxyz123456'].join('');
}

function buildGitHubPat() {
  return ['gh', 'p_', 'abcdefghijklmnopqrstuvwxyz1234'].join('');
}

test('scanText detects inline API keys and redacts them', () => {
  const key = buildAnthropicKey();
  const result = scanText(`Use ${key} to call the provider.`);
  assert.equal(result.detected, true);
  assert.ok(result.findings.some((finding) => finding.id === 'anthropic_api_key'));
  const redacted = redactText(`Use ${key} to call the provider.`);
  assert.ok(!redacted.includes(key));
  assert.ok(redacted.includes('[REDACTED:anthropic_api_key]'));
});

test('scanFile detects secrets in environment files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-secret-scan-file-'));
  const filePath = path.join(tmpDir, '.env');
  fs.writeFileSync(filePath, `STRIPE_SECRET_KEY=${buildStripeKey()}\n`);
  try {
    const result = scanFile(filePath);
    assert.equal(result.detected, true);
    assert.ok(result.findings.some((finding) => finding.id === 'env_file'));
    assert.ok(result.findings.some((finding) => finding.id === 'stripe_live_secret'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('scanBashCommand detects command reads of secret-bearing files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-secret-scan-command-'));
  const filePath = path.join(tmpDir, '.env.local');
  fs.writeFileSync(filePath, `OPENAI_API_KEY=${buildOpenAiKey()}\n`);
  try {
    const result = scanBashCommand(`cat ${filePath}`, { cwd: tmpDir });
    assert.equal(result.detected, true);
    assert.ok(result.findings.some((finding) => finding.path === filePath));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('scanHookInput detects risky read and edit payloads', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-secret-scan-hook-'));
  const filePath = path.join(tmpDir, '.npmrc');
  const gitHubPat = buildGitHubPat();
  fs.writeFileSync(filePath, `//registry.npmjs.org/:_authToken=${gitHubPat}\n`);
  try {
    const readResult = scanHookInput({
      tool_name: 'Read',
      tool_input: { file_path: filePath },
      cwd: tmpDir,
    });
    assert.equal(readResult.detected, true);

    const editResult = scanHookInput({
      tool_name: 'Edit',
      tool_input: { file_path: path.join(tmpDir, 'src/app.js'), new_string: `const token = "${gitHubPat}";` },
      cwd: tmpDir,
    });
    assert.equal(editResult.detected, true);
    assert.ok(editResult.findings.some((finding) => finding.id.includes('github')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
