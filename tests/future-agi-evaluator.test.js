'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const {
  evaluatePayload,
  handleDoctor,
  mainCli,
} = require('../scripts/future-agi-evaluator.js');
const { selectHarness, selectHarnessName } = require('../scripts/harness-selector.js');

test('Future AGI Evaluator - doctor output passes cleanly', () => {
  let captured = '';
  const mockStdout = {
    write: (msg) => {
      captured += msg;
    },
  };
  const exitCode = handleDoctor(mockStdout);
  assert.equal(exitCode, 0);
  assert.ok(captured.includes('Future AGI Bridge Doctor Check'));
  assert.ok(captured.includes('OpenTelemetry span exporter loaded'));
});

test('Future AGI Evaluator - CLI simulation command execution', () => {
  let captured = '';
  const mockStdout = {
    write: (msg) => {
      captured += msg;
    },
  };
  const code = mainCli(['--simulate', 'npm run build'], mockStdout);
  assert.equal(code, 0);
  const parsed = JSON.parse(captured);
  assert.equal(parsed.passed, true);
  assert.equal(parsed.receipt, 'simulation_passed=true');
});

test('Future AGI Harness Selector - routes future-agi patterns to future-agi-guardrails harness', () => {
  const harnessPath = selectHarness('Bash', { command: 'node scripts/futureagi-evaluator.js --simulate' });
  assert.ok(harnessPath);
  assert.ok(harnessPath.endsWith('future-agi-guardrails.json'));

  const gateConfig = JSON.parse(fs.readFileSync(harnessPath, 'utf8'));
  assert.equal(gateConfig.harness, 'future-agi-guardrails');
  assert.equal(gateConfig.gates.length, 3);
});
