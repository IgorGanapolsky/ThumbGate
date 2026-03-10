#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveBlockers } = require('../scripts/pr-manager');

test('PR Manager - Diagnoses Ready state', async (t) => {
  const mockPr = {
    number: 123,
    title: 'Test PR',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    isDraft: false,
    statusCheckRollup: [{ name: 'CI', conclusion: 'SUCCESS' }]
  };

  const result = await resolveBlockers(mockPr);
  assert.equal(result.status, 'ready', 'PR with CLEAN/MERGEABLE state should be ready');
});

test('PR Manager - Detects Draft', async (t) => {
  const mockPr = {
    number: 124,
    isDraft: true
  };

  const result = await resolveBlockers(mockPr);
  assert.equal(result.status, 'skipped', 'Draft PRs should be skipped');
  assert.equal(result.reason, 'draft');
});

test('PR Manager - Detects CI Failure', async (t) => {
  const mockPr = {
    number: 125,
    title: 'Failing CI PR',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'BLOCKED',
    isDraft: false,
    statusCheckRollup: [
      { name: 'CI/test', conclusion: 'FAILURE' }
    ]
  };

  const result = await resolveBlockers(mockPr);
  assert.equal(result.status, 'blocked', 'Failing CI should block the PR');
  assert.equal(result.reason, 'ci_failure');
  assert.deepEqual(result.checks, ['CI/test']);
});

test('PR Manager - Detects Conflicts', async (t) => {
  const mockPr = {
    number: 126,
    title: 'Conflicting PR',
    mergeable: 'CONFLICTING',
    mergeStateStatus: 'DIRTY',
    isDraft: false
  };

  const result = await resolveBlockers(mockPr);
  assert.equal(result.status, 'blocked', 'Dirty state should be blocked');
  assert.equal(result.reason, 'conflicts');
});
