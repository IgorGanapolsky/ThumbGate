'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.join(__dirname, '..');
const TESTS_DIR = path.join(PROJECT_ROOT, 'tests');
const pkg = require(path.join(PROJECT_ROOT, 'package.json'));

function listRepoTests(dir = TESTS_DIR) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listRepoTests(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.test.js')) {
      files.push(path.relative(PROJECT_ROOT, fullPath));
    }
  }

  return files.sort();
}

function collectReachableScriptCommands(scriptName = 'test', seen = new Set()) {
  if (seen.has(scriptName)) {
    return '';
  }

  seen.add(scriptName);
  const command = pkg.scripts[scriptName] || '';
  const nested = [];
  const runPattern = /npm run ([a-z0-9:-]+)/gi;
  let match;

  while ((match = runPattern.exec(command)) !== null) {
    nested.push(collectReachableScriptCommands(match[1], seen));
  }

  return [command, ...nested].join(' ');
}

function listNpmTestFiles() {
  const reachableCommands = collectReachableScriptCommands();
  const matches = reachableCommands.match(/tests\/[^\s'"]+\.test\.js/g) || [];
  return new Set(matches);
}

test('npm test includes every repository test file', () => {
  const repoTests = listRepoTests();
  const npmTestFiles = listNpmTestFiles();
  const missing = repoTests.filter((file) => !npmTestFiles.has(file));

  assert.deepEqual(missing, []);
});

test('listRepoTests handles directories recursively', () => {
  const results = listRepoTests(TESTS_DIR);
  assert.ok(results.length > 0, 'should find test files');
  for (const f of results) {
    assert.ok(f.endsWith('.test.js'), `${f} should end with .test.js`);
  }
});

test('collectReachableScriptCommands handles seen set', () => {
  const seen = new Set();
  const result = collectReachableScriptCommands('test', seen);
  assert.ok(seen.has('test'), 'should mark test as seen');
  const result2 = collectReachableScriptCommands('test', seen);
  assert.equal(result2, '', 'should return empty for already-seen script');
});

test('collectReachableScriptCommands returns empty for nonexistent script', () => {
  const seen = new Set();
  const result = collectReachableScriptCommands('nonexistent-script-xyz', seen);
  assert.equal(result, '', 'nonexistent script should return empty');
});

test('listNpmTestFiles returns a set', () => {
  const files = listNpmTestFiles();
  assert.ok(files instanceof Set, 'should return a Set');
  assert.ok(files.size > 0, 'should find at least one test file');
});
