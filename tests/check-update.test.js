'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isNewer, getLocalVersion } = require('../scripts/check-update');

test('version comparison helper isNewer', () => {
  // Newer patch
  assert.equal(isNewer('1.27.6', '1.27.7'), true);
  // Newer minor
  assert.equal(isNewer('1.27.6', '1.28.0'), true);
  // Newer major
  assert.equal(isNewer('1.27.6', '2.0.0'), true);

  // Equal versions
  assert.equal(isNewer('1.27.6', '1.27.6'), false);
  // Equal versions with v prefix
  assert.equal(isNewer('v1.27.6', '1.27.6'), false);

  // Older patch
  assert.equal(isNewer('1.27.6', '1.27.5'), false);
  // Older minor
  assert.equal(isNewer('1.27.6', '1.26.9'), false);
  // Older major
  assert.equal(isNewer('1.27.6', '0.99.9'), false);

  // Prerelease versions (ignored suffix comparison for simplicity)
  assert.equal(isNewer('1.27.6-beta.1', '1.27.7'), true);
});

test('getLocalVersion returns current semver', () => {
  const version = getLocalVersion();
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
});
