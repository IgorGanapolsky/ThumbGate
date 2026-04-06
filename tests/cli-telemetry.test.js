'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getInstallId, classifyInstall, trackEvent } = require('../scripts/cli-telemetry');

test('getInstallId returns a stable string', () => {
  const id1 = getInstallId();
  const id2 = getInstallId();
  assert.equal(typeof id1, 'string');
  assert.ok(id1.length >= 16);
  assert.equal(id1, id2, 'Should return same ID on repeated calls');
});

test('classifyInstall detects CI environment', () => {
  const origCI = process.env.CI;
  process.env.CI = 'true';
  assert.equal(classifyInstall(), 'ci');
  if (origCI) process.env.CI = origCI; else delete process.env.CI;
});

test('classifyInstall detects GitHub Actions', () => {
  const orig = process.env.GITHUB_ACTIONS;
  process.env.GITHUB_ACTIONS = 'true';
  assert.equal(classifyInstall(), 'ci');
  if (orig) process.env.GITHUB_ACTIONS = orig; else delete process.env.GITHUB_ACTIONS;
});

test('classifyInstall returns real_user when not CI or owner', () => {
  const origCI = process.env.CI;
  const origGH = process.env.GITHUB_ACTIONS;
  delete process.env.CI;
  delete process.env.GITHUB_ACTIONS;
  const result = classifyInstall();
  // On a dev machine this might be 'owner' if username is igor, otherwise 'real_user'
  assert.ok(['real_user', 'owner'].includes(result));
  if (origCI) process.env.CI = origCI;
  if (origGH) process.env.GITHUB_ACTIONS = origGH;
});

test('trackEvent does not throw with telemetry disabled', () => {
  const orig = process.env.THUMBGATE_NO_TELEMETRY;
  process.env.THUMBGATE_NO_TELEMETRY = '1';
  assert.doesNotThrow(() => trackEvent('test_event', { foo: 'bar' }));
  if (orig) process.env.THUMBGATE_NO_TELEMETRY = orig; else delete process.env.THUMBGATE_NO_TELEMETRY;
});

test('trackEvent does not throw with DO_NOT_TRACK', () => {
  const orig = process.env.DO_NOT_TRACK;
  process.env.DO_NOT_TRACK = '1';
  assert.doesNotThrow(() => trackEvent('test_event'));
  if (orig) process.env.DO_NOT_TRACK = orig; else delete process.env.DO_NOT_TRACK;
});
