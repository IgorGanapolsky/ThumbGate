'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const guard = require('../scripts/workos-production-guard');

test('exports stable production client and authkit host constants', () => {
  assert.match(guard.PROD_CLIENT_ID, /^client_/);
  assert.match(guard.STAGING_CLIENT_ID, /^client_/);
  assert.notEqual(guard.PROD_CLIENT_ID, guard.STAGING_CLIENT_ID);
  assert.match(guard.PROD_AUTHKIT_HOST, /authkit\.app$/);
  assert.doesNotMatch(guard.PROD_AUTHKIT_HOST, /staging/i);
});

test('check is a function and EXPECTED_METHODS use lowercase markers', () => {
  assert.equal(typeof guard.check, 'function');
  assert.ok(Array.isArray(guard.EXPECTED_METHODS));
  assert.ok(guard.EXPECTED_METHODS.length > 0);
  for (const method of guard.EXPECTED_METHODS) {
    assert.equal(typeof method.name, 'string');
    assert.equal(method.marker, method.marker.toLowerCase());
  }
  assert.deepEqual(
    guard.EXPECTED_METHODS.map((m) => m.name).sort(),
    ['email', 'google'].sort(),
  );
});

test('module path is scripts/workos-production-guard.js (packaged runtime)', () => {
  const resolved = require.resolve('../scripts/workos-production-guard');
  assert.match(resolved, /scripts[/\\]workos-production-guard\.js$/);
  assert.equal(path.basename(resolved), 'workos-production-guard.js');
});
