'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { scanInstallCommand } = require('../scripts/slopsquat-guard');

test('Stress Case 1: Command Prefixes (sudo, time, env)', () => {
  const commands = [
    'sudo npm install expres',
    'time pip install flaskk',
    'env DEBUG=1 npm install reactt',
  ];
  for (const cmd of commands) {
    const result = scanInstallCommand(cmd);
    assert.ok(result.detected, `Should detect typosquat in: ${cmd}`);
  }
});

test('Stress Case 2: Quoted Package Names', () => {
  const result = scanInstallCommand('npm install "expres"');
  assert.ok(result.detected, 'Should detect typosquat in quotes');
});

test('Stress Case 3: Chained Commands', () => {
  const result = scanInstallCommand('cd some-dir && npm install expres');
  assert.ok(result.detected, 'Should detect typosquat in chained command');
});

test('Stress Case 4: Subshells', () => {
  const result = scanInstallCommand('(npm install expres)');
  assert.ok(result.detected, 'Should detect typosquat in subshell');
});
