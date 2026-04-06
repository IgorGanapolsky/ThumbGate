'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  getSetting,
  getSettingOrigin,
  getSettingsStatus,
  resolveSettingsHierarchy,
  resolveSettingsPaths,
} = require('../scripts/settings-hierarchy');

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

test('resolveSettingsPaths returns managed, user, project, and local paths', () => {
  const projectRoot = '/tmp/thumbgate-project';
  const homeDir = '/tmp/thumbgate-home';
  const paths = resolveSettingsPaths({ projectRoot, homeDir });

  assert.equal(paths.managed, '/tmp/thumbgate-project/config/thumbgate-settings.managed.json');
  assert.equal(paths.user, '/tmp/thumbgate-home/.thumbgate/settings.json');
  assert.equal(paths.project, '/tmp/thumbgate-project/.thumbgate/settings.json');
  assert.equal(paths.local, '/tmp/thumbgate-project/.thumbgate/settings.local.json');
});

test('resolveSettingsHierarchy applies managed > local > project > user > defaults precedence', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-settings-precedence-'));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-settings-home-'));

  writeJson(path.join(homeDir, '.thumbgate', 'settings.json'), {
    mcp: { defaultProfile: 'commerce' },
  });
  writeJson(path.join(projectRoot, '.thumbgate', 'settings.json'), {
    mcp: { defaultProfile: 'dispatch' },
  });
  writeJson(path.join(projectRoot, '.thumbgate', 'settings.local.json'), {
    mcp: { defaultProfile: 'readonly' },
  });
  writeJson(path.join(projectRoot, 'config', 'thumbgate-settings.managed.json'), {
    mcp: { defaultProfile: 'locked' },
  });

  const hierarchy = resolveSettingsHierarchy({ projectRoot, homeDir });
  assert.equal(hierarchy.resolvedSettings.mcp.defaultProfile, 'locked');
  assert.equal(hierarchy.originsByPath['mcp.defaultProfile'].scope, 'managed');

  fs.rmSync(projectRoot, { recursive: true, force: true });
  fs.rmSync(homeDir, { recursive: true, force: true });
});

test('getSetting and getSettingOrigin resolve repo defaults when files are absent', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-settings-defaults-'));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-settings-home-defaults-'));

  assert.equal(getSetting('mcp.defaultProfile', { projectRoot, homeDir }), 'essential');
  assert.equal(getSettingOrigin('mcp.defaultProfile', { projectRoot, homeDir }).scope, 'defaults');

  fs.rmSync(projectRoot, { recursive: true, force: true });
  fs.rmSync(homeDir, { recursive: true, force: true });
});

test('getSettingsStatus returns active layers, warnings, and origin metadata', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-settings-status-'));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-settings-home-status-'));

  writeJson(path.join(projectRoot, 'config', 'thumbgate-settings.managed.json'), {
    dashboard: { showPolicyOrigins: true },
  });

  const status = getSettingsStatus({ projectRoot, homeDir });
  assert.ok(Array.isArray(status.activeLayers));
  assert.ok(Array.isArray(status.origins));
  assert.ok(status.origins.some((entry) => entry.path === 'dashboard.showPolicyOrigins'));
  assert.ok(status.warnings.some((line) => line.includes('.thumbgate/settings.json')));

  fs.rmSync(projectRoot, { recursive: true, force: true });
  fs.rmSync(homeDir, { recursive: true, force: true });
});
