'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { AgentReliabilityClient, maskToken } = require('../scripts/agent-reliability-client');

const SCRIPT_PATH = path.join(__dirname, '../scripts/agent-reliability-client.js');

test('agent-reliability: maskToken masks strings safely', () => {
  assert.equal(maskToken('ar_test_1234567890abcdef'), 'ar_test_...cdef');
  assert.equal(maskToken('short_token'), '***');
  assert.equal(maskToken(null), 'N/A');
  assert.equal(maskToken(''), 'N/A');
});

test('agent-reliability: client initializes and resolves token', () => {
  const client = new AgentReliabilityClient();
  const status = client.getStatus();
  assert.equal(status.configured, true);
  assert.equal(status.active, true);
  assert.ok(status.tokenMasked.startsWith('ar_'));
  if (client.token && client.token.length > 20) {
    assert.ok(!status.tokenMasked.includes(client.token.slice(10, 25)), 'Must never leak raw token');
  }
  assert.equal(status.issuer, 'Gaetano Franco <gtnfrnc@gmail.com>');
});

test('agent-reliability: recordTelemetry emits receipt with masked token', () => {
  const client = new AgentReliabilityClient();
  const res = client.recordTelemetry({ action: 'tool_check', status: 'PASS' });
  assert.equal(res.ok, true);
  assert.equal(res.receipt.status, 'PASS');
  assert.ok(res.receipt.tokenMasked.startsWith('ar_'));
  assert.ok(res.receipt.timestamp);
});

test('agent-reliability: CLI runs cleanly with --json', () => {
  const client = new AgentReliabilityClient();
  const run = spawnSync('node', [SCRIPT_PATH, '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  const json = JSON.parse(run.stdout);
  assert.equal(json.status, 'HEALTHY');
  assert.equal(json.details.configured, true);
  if (client.token && client.token.length > 20) {
    assert.ok(!run.stdout.includes(client.token.slice(10, 25)));
  }
});
