'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildNativeMessagingAudit,
  formatNativeMessagingAudit,
  normalizePlatform,
} = require('../scripts/native-messaging-audit');

function makeManifestHome() {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-native-messaging-'));
  const manifestDir = path.join(
    homeDir,
    'Library',
    'Application Support',
    'Google',
    'Chrome',
    'NativeMessagingHosts'
  );
  fs.mkdirSync(manifestDir, { recursive: true });
  const hostDir = path.join(homeDir, 'Library', 'Application Support', 'Claude');
  fs.mkdirSync(hostDir, { recursive: true });
  const hostPath = path.join(hostDir, 'claude-native-host');
  fs.writeFileSync(hostPath, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(hostPath, 0o755);

  const manifestPath = path.join(manifestDir, 'com.anthropic.claude_browser_extension.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    name: 'com.anthropic.claude_browser_extension',
    description: 'Claude browser bridge',
    path: hostPath,
    type: 'stdio',
    allowed_origins: [
      'chrome-extension://abcdefghijklmnopabcdefghijklmnop/',
      'chrome-extension://qrstuvwxyzabcdefqrstuvwxyzabcdef/',
    ],
  }, null, 2));

  return { homeDir, hostPath, manifestPath };
}

test('normalizePlatform accepts common aliases', () => {
  assert.equal(normalizePlatform('macos'), 'darwin');
  assert.equal(normalizePlatform('windows'), 'win32');
  assert.equal(normalizePlatform('linux'), 'linux');
});

test('buildNativeMessagingAudit flags dormant AI browser bridges on macOS', () => {
  const { homeDir, manifestPath } = makeManifestHome();

  try {
    const report = buildNativeMessagingAudit({
      platform: 'darwin',
      homeDir,
    });

    assert.equal(report.name, 'thumbgate-native-messaging-audit');
    assert.equal(report.summary.manifestCount, 1);
    assert.equal(report.summary.aiBridgeCount, 1);
    assert.equal(report.status, 'review');
    assert.equal(report.manifests[0].manifestPath, manifestPath);
    assert.equal(report.manifests[0].vendor, 'Anthropic');
    assert.equal(report.manifests[0].browserInstalledGuess, false);
    assert.ok(report.findings.some((finding) => finding.code === 'dormant_ai_browser_bridge'));
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test('buildNativeMessagingAudit can filter to AI-only bridges', () => {
  const { homeDir } = makeManifestHome();
  const otherDir = path.join(
    homeDir,
    'Library',
    'Application Support',
    'Microsoft Edge',
    'NativeMessagingHosts'
  );
  fs.mkdirSync(otherDir, { recursive: true });
  fs.writeFileSync(path.join(otherDir, 'com.example.password_manager.json'), JSON.stringify({
    name: 'com.example.password_manager',
    path: '/tmp/password-manager-host',
    type: 'stdio',
    allowed_origins: ['chrome-extension://bridgebridgebridgebridgebridgebrid/'],
  }, null, 2));

  try {
    const report = buildNativeMessagingAudit({
      platform: 'darwin',
      homeDir,
      aiOnly: true,
    });

    assert.equal(report.summary.manifestCount, 1);
    assert.equal(report.manifests[0].vendor, 'Anthropic');
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test('formatNativeMessagingAudit emits a readable summary', () => {
  const { homeDir } = makeManifestHome();

  try {
    const report = buildNativeMessagingAudit({
      platform: 'darwin',
      homeDir,
    });
    const text = formatNativeMessagingAudit(report);

    assert.match(text, /ThumbGate Native Messaging Audit/);
    assert.match(text, /Status : review/);
    assert.match(text, /Anthropic browser bridge detected/);
    assert.match(text, /Recommendations:/);
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

