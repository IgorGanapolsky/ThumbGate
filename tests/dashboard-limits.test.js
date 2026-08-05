'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  isDashboardDataLimitError,
  formatDashboardLimitDetail,
} = require('../scripts/dashboard-limits');

test('isDashboardDataLimitError detects V8 string / heap messages', () => {
  assert.equal(
    isDashboardDataLimitError(new Error('Cannot create a string longer than 0x1fffffe8 characters')),
    true,
  );
  assert.equal(isDashboardDataLimitError(new Error('JavaScript heap out of memory')), true);
  assert.equal(isDashboardDataLimitError(new Error('ENOMEM')), true);
  assert.equal(isDashboardDataLimitError(new Error('Invalid analytics window')), false);
  assert.equal(isDashboardDataLimitError(null), false);
});

test('formatDashboardLimitDetail distinguishes assembly vs stringify phases', () => {
  const err = new Error('Cannot create a string longer than 0x1fffffe8 characters');
  const assembly = formatDashboardLimitDetail(err, { phase: 'assembly' });
  const stringify = formatDashboardLimitDetail(err, { phase: 'stringify' });
  assert.match(assembly, /tail-capped|Feedback\/memory/i);
  assert.match(stringify, /JSON exceeded|stringify|bounded feedback/i);
  assert.match(assembly, /0x1fffffe8/);
});
