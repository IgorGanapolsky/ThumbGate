'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SCHEDULE_ID,
  buildRevenueTruthSchedule,
  installRevenueTruthAutomation,
} = require('../scripts/install-revenue-truth-automation');

test('dedicated revenue truth schedule is hourly, read-only, and independent of social tooling', () => {
  const schedule = buildRevenueTruthSchedule();

  assert.equal(schedule.id, SCHEDULE_ID);
  assert.equal(schedule.schedule, 'hourly');
  assert.match(schedule.command, /money-watcher\.js/);
  assert.match(schedule.command, /--once/);
  assert.doesNotMatch(schedule.command, /zernio|publish|post|send|message/i);
  assert.match(schedule.description, /No posting, messaging, billing mutation, or paid lead access/);
});

test('installer registers exactly one zero-spend local schedule', () => {
  const calls = [];
  const manager = {
    createSchedule(schedule) {
      calls.push(schedule);
      return { success: true, schedule };
    },
    listSchedules() {
      return calls;
    },
  };

  const result = installRevenueTruthAutomation(manager);

  assert.equal(calls.length, 1);
  assert.equal(result.installed.success, true);
  assert.equal(result.schedule.id, SCHEDULE_ID);
  assert.equal(result.externalActionAuthorized, false);
  assert.equal(result.zeroSpendStatus, 'proceed_zero_cost_local_existing_machine');
});
