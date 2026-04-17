'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  installedRuntimeBin,
  publishedCliShellCommand,
  runtimePrefixDir,
} = require('../scripts/published-cli');

test('publishedCliShellCommand prefers the installed runtime binary before npm exec fallback', () => {
  const prefixDir = runtimePrefixDir('/tmp/thumbgate-runtime');
  const command = publishedCliShellCommand('1.1.0', ['statusline-render'], { prefixDir });

  assert.match(command, /\[ -x /);
  assert.match(command, /node_modules\/\.bin\/thumbgate/);
  assert.match(command, /statusline-render/);
  assert.match(command, /npm "exec"/);
});

test('publishedCliShellCommand can bypass the installed runtime for latest-resolving launchers', () => {
  const prefixDir = runtimePrefixDir('/tmp/thumbgate-runtime');
  const command = publishedCliShellCommand('latest', ['serve'], {
    prefixDir,
    preferInstalled: false,
  });

  assert.doesNotMatch(command, /\[ -x /);
  assert.match(command, /thumbgate@latest/);
  assert.match(command, /npm "install"/);
  assert.match(command, /node_modules\/\.bin\/thumbgate/);
  assert.match(command, /serve/);
});

test('installedRuntimeBin resolves within the runtime prefix directory', () => {
  const binPath = installedRuntimeBin('/tmp/thumbgate-runtime');
  assert.match(binPath, /\/tmp\/thumbgate-runtime\/node_modules\/\.bin\/thumbgate$/);
});
