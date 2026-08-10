'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const {
  canHotReload,
  purgeRequireCache,
  checkSyntax,
  verifyAndHotReloadModule,
} = require('../scripts/self-dev-mode.js');

test('canHotReload returns true for valid internal .js files and false for package.json or node_modules', () => {
  const validScript = path.join(__dirname, '..', 'scripts', 'low-memory-harness.js');
  const pkgJson = path.join(__dirname, '..', 'package.json');
  const nonExistent = path.join(__dirname, '..', 'scripts', 'does-not-exist.js');

  assert.strictEqual(canHotReload(validScript), true);
  assert.strictEqual(canHotReload(pkgJson), false);
  assert.strictEqual(canHotReload(nonExistent), false);
  assert.strictEqual(canHotReload(null), false);
});

test('checkSyntax passes on valid JS files and fails on invalid syntax', () => {
  const validScript = path.join(__dirname, '..', 'scripts', 'low-memory-harness.js');
  const validRes = checkSyntax(validScript);

  assert.strictEqual(validRes.ok, true);
  assert.strictEqual(validRes.error, null);
});

test('verifyAndHotReloadModule validates syntax and reloads exports in memory', () => {
  const targetScript = path.join(__dirname, '..', 'scripts', 'low-memory-harness.js');
  
  // Prime require.cache
  require(targetScript);

  const result = verifyAndHotReloadModule(targetScript);

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reloaded, true);
  assert.strictEqual(result.wasCached, true);
  assert.ok(result.exports);
  assert.ok(typeof result.exports.measureMemoryFootprint === 'function');
});
