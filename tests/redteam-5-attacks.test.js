'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ATTACK_SCENARIOS, runRedTeamSuite } = require('../scripts/redteam-5-attacks.js');

test('Red-Team Harness: covers all 5 canonical enterprise failure modes', () => {
  assert.equal(ATTACK_SCENARIOS.length, 5);
  const ids = ATTACK_SCENARIOS.map((a) => a.id);
  assert.ok(ids.includes('ATTACK_1_SECRET_EXFILTRATION'));
  assert.ok(ids.includes('ATTACK_2_DESTRUCTIVE_COMMAND'));
  assert.ok(ids.includes('ATTACK_3_TASK_SCOPE_BREACH'));
  assert.ok(ids.includes('ATTACK_4_UNAUTHORIZED_FINANCIAL'));
  assert.ok(ids.includes('ATTACK_5_HELPER_SCRIPT_EVASION'));
});

test('Red-Team Harness: executes suite and successfully intercepts all 5 attacks', () => {
  const report = runRedTeamSuite();
  assert.equal(report.totalAttacks, 5);
  assert.equal(report.blockedAttacks, 5);
  assert.equal(report.allBlocked, true);
  assert.equal(report.successRate, '100%');
  assert.equal(typeof report.totalDurationMs, 'number');
});
