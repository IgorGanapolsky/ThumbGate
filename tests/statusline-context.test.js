'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  inferWorkItemLabel,
  isFreshCache,
} = require('../scripts/statusline-context');

test('inferWorkItemLabel preserves explicit AB identifiers', () => {
  assert.equal(inferWorkItemLabel('bugfix/AB#1663699-account-profile-hardening'), 'AB#1663699');
});

test('inferWorkItemLabel infers Azure-style work item labels from numeric branch tokens', () => {
  assert.equal(inferWorkItemLabel('bugfix/1663699-account-profile-hardening'), 'AB#1663699');
  assert.equal(inferWorkItemLabel('feature/checkout-1234567-hardening'), 'AB#1234567');
});

test('inferWorkItemLabel returns empty string when no work item token is present', () => {
  assert.equal(inferWorkItemLabel('feature/thumbgate-statusline'), '');
});

test('isFreshCache only accepts recently updated caches', () => {
  const now = Date.parse('2026-04-19T23:58:00.000Z');
  assert.equal(isFreshCache({ updatedAt: '2026-04-19T23:57:30.000Z' }, now), true);
  assert.equal(isFreshCache({ updatedAt: '2026-04-19T23:55:30.000Z' }, now), false);
  assert.equal(isFreshCache(null, now), false);
});
