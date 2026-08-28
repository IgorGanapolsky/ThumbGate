'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { inspectAction, getInspectorStatus } = require('../scripts/dashboard-debugger');

describe('Dashboard Live Debugger & Inspector Bridge', () => {
  test('inspectAction evaluates safe commands and returns structured performance metrics', () => {
    // Warm up engine
    inspectAction({ tool: 'Bash', command: 'git status' });

    const result = inspectAction({
      tool: 'Bash',
      command: 'git status',
    });

    assert.equal(result.ok, true);
    assert.equal(result.toolName, 'Bash');
    assert.equal(result.verdict, 'ALLOW');
    assert.equal(result.decision, 'allow');
    assert.equal(typeof result.performanceBudget.meetsSla, 'boolean');
    assert.ok(typeof result.latencyMs === 'number');
    assert.equal(result.steps.length, 4);
    assert.equal(result.steps[0].passed, true);
  });

  test('inspectAction intercepts destructive actions with detailed step trace', () => {
    const result = inspectAction({
      tool: 'Bash',
      command: 'rm -rf /',
    });

    assert.equal(result.ok, true);
    assert.equal(result.verdict, 'DENY');
    assert.equal(result.decision, 'deny');
    assert.ok(result.gate, 'Expected a gate identifier to be populated');
    assert.ok(result.reason.length > 0);
    assert.equal(result.steps[2].passed, false);
    assert.match(result.steps[2].detail, /Matched gate rule/);
  });

  test('inspectAction supports file Edit tools and paths', () => {
    const result = inspectAction({
      tool: 'Edit',
      filePath: 'src/index.js',
      content: 'console.log("hello world");',
    });

    assert.equal(result.ok, true);
    assert.equal(result.toolName, 'Edit');
    assert.ok(result.steps.length >= 4);
    assert.ok(typeof result.latencyMs === 'number');
  });

  test('getInspectorStatus returns runtime metadata and ndb/DevTools launch recipes', () => {
    const status = getInspectorStatus();

    assert.ok(typeof status.active === 'boolean');
    assert.ok(typeof status.pid === 'number');
    assert.ok(typeof status.nodeVersion === 'string');
    assert.ok(status.memory && typeof status.memory.heapUsedMb === 'number');
    assert.ok(status.launchCommands.ndb.includes('ndb'));
    assert.ok(status.launchCommands.chromeInspect === 'chrome://inspect');
    assert.ok(status.vscodeConfig.request === 'attach');
  });
});
