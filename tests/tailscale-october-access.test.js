'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateTailscaleOctoberAccess } = require('../scripts/tailscale-october-access');

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-tailscale-october-'));
process.env.THUMBGATE_STATE_DIR = stateDir;
process.env.THUMBGATE_NO_NUDGE = '1';

const gates = require('../scripts/gates-engine');

function bash(command) {
  return { toolName: 'Bash', toolInput: { command }, command };
}

test('tailscale funnel is denied', () => {
  const result = evaluateTailscaleOctoberAccess(bash('tailscale funnel 443'));
  assert.equal(result.decision, 'deny');
  assert.equal(result.gate, 'tailscale-october-access');
  assert.equal(result.severity, 'critical');
  assert.equal(result.failureReason, 'public_agent_node');
});

test('tailscale serve stays on the tailnet and is allowed', () => {
  assert.equal(evaluateTailscaleOctoberAccess(bash('tailscale serve 443')), null);
  assert.equal(evaluateTailscaleOctoberAccess(bash('tailscale status')), null);
});

test('Tailscale SSH is denied and a normal ssh binary is allowed', () => {
  assert.equal(
    evaluateTailscaleOctoberAccess(bash('tailscale ssh root@db')).failureReason,
    'tailscale_ssh',
  );
  assert.equal(
    evaluateTailscaleOctoberAccess(bash('tailscale up --ssh --hostname agent')).failureReason,
    'tailscale_ssh',
  );
  assert.equal(evaluateTailscaleOctoberAccess(bash('tailscale set --ssh=false')), null);
  assert.equal(evaluateTailscaleOctoberAccess(bash('ssh ubuntu@10.0.0.4')), null);
});

test('a database password in the command is denied, including a read', () => {
  const commands = [
    'PGPASSWORD=pg-local-pass psql -c "SELECT 1"',
    'mysql -uroot -ppg-local-pass -e "SELECT 1"',
    'psql "postgres://app:pg-local-pass@db.internal/app" -c "DELETE FROM users"',
    'DATABASE_URL=postgres://app:pg-local-pass@db.internal/app npm start',
  ];
  for (const command of commands) {
    const result = evaluateTailscaleOctoberAccess(bash(command));
    assert.equal(result && result.failureReason, 'shared_db_password', command);
  }
});

test('a read or a write without a pasted password is allowed', () => {
  assert.equal(evaluateTailscaleOctoberAccess(bash('psql -c "SELECT 1"')), null);
  assert.equal(
    evaluateTailscaleOctoberAccess(bash('psql -c "DELETE FROM users WHERE id = 1"')),
    null,
  );
  assert.equal(evaluateTailscaleOctoberAccess(bash('psql -p 5432 -c "SELECT 1"')), null);
  assert.equal(evaluateTailscaleOctoberAccess(bash('git apply -p1 patch.diff')), null);
  assert.equal(evaluateTailscaleOctoberAccess(bash('ls -print')), null);
});

test('a shell comment does not carry a funnel or a password', () => {
  assert.equal(
    evaluateTailscaleOctoberAccess(bash('tailscale status # tailscale funnel 443')),
    null,
  );
  assert.equal(
    evaluateTailscaleOctoberAccess(bash('psql -c "SELECT 1" # PGPASSWORD=pg-local-pass')),
    null,
  );
});

test('an accept grant without a name and expiry is denied', () => {
  const result = evaluateTailscaleOctoberAccess({
    toolName: 'Edit',
    toolInput: {
      file_path: 'acl.hujson',
      old_string: '{ "grants": [] }',
      new_string: '{ "action": "accept", "src": ["oncall"] }',
    },
  });
  assert.equal(result.failureReason, 'grant_not_removable');
});

test('a named accept grant with an expiry is allowed, and so is removing the accept', () => {
  assert.equal(evaluateTailscaleOctoberAccess({
    toolName: 'search_replace',
    toolInput: {
      file_path: 'adapters/tailscale/grants.json',
      old_string: '{ "grants": [] }',
      new_string: '{ "name": "oncall-write", "expiry": "2026-11-05", "action": "accept" }',
    },
  }), null);
  assert.equal(evaluateTailscaleOctoberAccess({
    toolName: 'Edit',
    toolInput: {
      file_path: 'policy.hujson',
      old_string: '{ "name": "oncall-write", "expiry": "2026-11-05", "action": "accept" }',
      new_string: '{ "grants": [] }',
    },
  }), null);
});

test('an accept outside a Tailscale policy file is not this gate', () => {
  assert.equal(evaluateTailscaleOctoberAccess({
    toolName: 'Edit',
    toolInput: {
      file_path: 'config/gates/default.json',
      old_string: '{}',
      new_string: '{ "action": "accept" }',
    },
  }), null);
});

test('the hard floor denies tailscale funnel', () => {
  const input = { tool_name: 'Bash', tool_input: { command: 'tailscale funnel 443' } };
  const body = JSON.parse(gates.runHardFloor(input));
  assert.equal(body.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(body.hookSpecificOutput.permissionDecisionReason, /\[GATE:tailscale-october-access\]/);
  assert.match(body.hookSpecificOutput.permissionDecisionReason, /open web/);
});
