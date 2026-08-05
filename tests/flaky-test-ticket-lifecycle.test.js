'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  nextTicketAction,
  planTicketUpdates,
  normalizeStatus,
} = require('../scripts/flaky-test-ticket-lifecycle');

test('normalizeStatus maps common labels', () => {
  assert.equal(normalizeStatus('pass-on-retry'), 'flaky');
  assert.equal(normalizeStatus('GREEN'), 'healthy');
  assert.equal(normalizeStatus('failed'), 'failing');
});

test('nextTicketAction create/reopen/close lifecycle', () => {
  assert.equal(nextTicketAction({ previousStatus: 'healthy', currentStatus: 'flaky' }).action, 'create');
  assert.equal(nextTicketAction({
    previousStatus: 'healthy', currentStatus: 'flaky', ticketExists: true, ticketOpen: false,
  }).action, 'reopen');
  assert.equal(nextTicketAction({
    previousStatus: 'flaky', currentStatus: 'healthy', ticketExists: true, ticketOpen: true,
  }).action, 'close');
  assert.equal(nextTicketAction({
    previousStatus: 'flaky', currentStatus: 'flaky', ticketExists: true, ticketOpen: true,
  }).action, 'none');
});

test('planTicketUpdates buckets actions', () => {
  const plan = planTicketUpdates([
    { testId: 'a', previousStatus: 'none', currentStatus: 'flaky' },
    { testId: 'b', previousStatus: 'flaky', currentStatus: 'healthy', ticketExists: true, ticketOpen: true },
  ]);
  assert.equal(plan.create.length, 1);
  assert.equal(plan.close.length, 1);
});
