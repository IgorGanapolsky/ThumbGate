'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { AgentReliabilityClient, maskToken } = require('../scripts/agent-reliability-client');

const SCRIPT_PATH = path.join(__dirname, '../scripts/agent-reliability-client.js');

const TEST_TOKEN = 'ar_trial_igor_thumbgate_1234567890abcdef';

test('agent-reliability: maskToken masks strings safely', () => {
  assert.equal(maskToken('ar_test_1234567890abcdef'), 'ar_test_...cdef');
  assert.equal(maskToken('short_token'), '***');
  assert.equal(maskToken(null), 'N/A');
  assert.equal(maskToken(''), 'N/A');
});

test('agent-reliability: client initializes and resolves token', () => {
  const client = new AgentReliabilityClient({ token: TEST_TOKEN });
  const status = client.getStatus();
  assert.equal(status.configured, true);
  assert.equal(status.active, true);
  assert.ok(status.tokenMasked.startsWith('ar_'));
  assert.ok(!status.tokenMasked.includes(TEST_TOKEN.slice(10, 25)), 'Must never leak raw token');
  assert.equal(status.issuer, 'Gaetano Franco <gtnfrnc@gmail.com>');
});

test('agent-reliability: client handles unconfigured token gracefully', () => {
  const client = new AgentReliabilityClient({ token: null });
  const status = client.getStatus();
  assert.equal(status.configured, false);
  assert.equal(status.active, false);
  assert.equal(status.tokenMasked, 'N/A');
});

test('agent-reliability: recordTelemetry emits receipt with masked token', () => {
  const client = new AgentReliabilityClient({ token: TEST_TOKEN });
  const res = client.recordTelemetry({ action: 'tool_check', status: 'PASS' });
  assert.equal(res.ok, true);
  assert.equal(res.receipt.status, 'PASS');
  assert.ok(res.receipt.tokenMasked.startsWith('ar_'));
  assert.ok(res.receipt.timestamp);
});

test('agent-reliability: CLI runs cleanly with --json when configured', () => {
  const run = spawnSync('node', [SCRIPT_PATH, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, AGENT_RELIABILITY_TOKEN: TEST_TOKEN },
  });
  assert.equal(run.status, 0);
  const json = JSON.parse(run.stdout);
  assert.equal(json.status, 'HEALTHY');
  assert.equal(json.details.configured, true);
  assert.ok(!run.stdout.includes(TEST_TOKEN.slice(10, 25)));
});

test('agent-reliability: CLI reports UNCONFIGURED cleanly when token absent', () => {
  const envWithoutToken = { ...process.env };
  delete envWithoutToken.AGENT_RELIABILITY_TOKEN;
  const run = spawnSync('node', [SCRIPT_PATH, '--json'], {
    encoding: 'utf8',
    env: { ...envWithoutToken, HOME: '/tmp/nonexistent-home-for-clean-test' },
  });
  assert.equal(run.status, 0);
  const json = JSON.parse(run.stdout);
  assert.equal(json.status, 'UNCONFIGURED');
  assert.equal(json.details.configured, false);
});
