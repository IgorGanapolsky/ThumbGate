'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateChecks,
  REQUIRED_CHECKS,
  BOT_REVIEW_AUTHORS,
} = require('../scripts/autonomous-pr-orchestrator');

test('evaluateChecks: recognizes all passing checks as green', () => {
  const rollup = [
    { name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'CodeQL', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'Verify changeset', status: 'COMPLETED', conclusion: 'SUCCESS' },
  ];
  const res = evaluateChecks(rollup);
  assert.equal(res.isGreen, true);
  assert.equal(res.passing.length, 3);
  assert.equal(res.failing.length, 0);
  assert.equal(res.pending.length, 0);
});

test('evaluateChecks: flags failing checks accurately', () => {
  const rollup = [
    { name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' },
    { name: 'CodeQL', status: 'COMPLETED', conclusion: 'SUCCESS' },
  ];
  const res = evaluateChecks(rollup);
  assert.equal(res.isGreen, false);
  assert.deepEqual(res.failing, ['test']);
});

test('evaluateChecks: flags in-progress checks as pending', () => {
  const rollup = [
    { name: 'test', status: 'IN_PROGRESS' },
    { name: 'CodeQL', status: 'COMPLETED', conclusion: 'SUCCESS' },
  ];
  const res = evaluateChecks(rollup);
  assert.equal(res.isGreen, false);
  assert.deepEqual(res.pending, ['test']);
});

test('BOT_REVIEW_AUTHORS contains known review bots', () => {
  assert.ok(BOT_REVIEW_AUTHORS.has('coderabbitai'));
  assert.ok(BOT_REVIEW_AUTHORS.has('socket-security'));
  assert.ok(BOT_REVIEW_AUTHORS.has('github-actions'));
});
