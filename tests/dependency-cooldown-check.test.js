'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const scriptPath = path.join(__dirname, '..', 'scripts', 'dependency-cooldown-check.sh');

test('dependency cooldown check: passes when no violations exist', () => {
  const result = spawnSync('bash', [scriptPath], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      THUMBGATE_MOCK_COOLDOWN: '1',
      THUMBGATE_MOCK_VIOLATION: '',
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /SUCCESS: All direct dependencies meet the cooldown security check/);
});

test('dependency cooldown check: fails when a dependency is within risk window', () => {
  const result = spawnSync('bash', [scriptPath], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      THUMBGATE_MOCK_COOLDOWN: '1',
      THUMBGATE_MOCK_VIOLATION: 'dotenv',
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /VIOLATION: package "dotenv@.*" was published only .* hours ago/);
  assert.match(result.stderr, /FAILED: Found 1 dependency violation/);
});
