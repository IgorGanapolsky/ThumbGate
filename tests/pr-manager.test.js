#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getPrStatus,
  loadManagedPrs,
  managePrs,
  resolveBlockers,
} = require('../scripts/pr-manager');

function createRunner(results) {
  const queue = [...results];
  return (args) => {
    if (queue.length === 0) {
      throw new Error(`Unexpected GH CLI call: ${args.join(' ')}`);
    }

    return queue.shift();
  };
}

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

test('PR Manager - Detects Draft', async () => {
  const mockPr = {
    number: 124,
    isDraft: true
  };

  const result = await resolveBlockers(mockPr);
  assert.equal(result.status, 'skipped', 'Draft PRs should be skipped');
  assert.equal(result.reason, 'draft');
});

test('PR Manager - Detects CI Failure', async () => {
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

test('PR Manager - Detects Pending Checks', async () => {
  const mockPr = {
    number: 127,
    title: 'Pending CI PR',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    isDraft: false,
    statusCheckRollup: [
      { name: 'CI/test', status: 'IN_PROGRESS', conclusion: null }
    ]
  };

  const result = await resolveBlockers(mockPr);
  assert.equal(result.status, 'blocked', 'Pending CI should block the PR');
  assert.equal(result.reason, 'ci_pending');
  assert.deepEqual(result.checks, ['CI/test']);
});

test('PR Manager - Detects Conflicts', async () => {
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

test('PR Manager - Detects Required Review', async () => {
  const mockPr = {
    number: 128,
    title: 'Awaiting review PR',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'BLOCKED',
    isDraft: false,
    reviewDecision: 'REVIEW_REQUIRED',
    statusCheckRollup: [
      { name: 'CI/test', status: 'COMPLETED', conclusion: 'SUCCESS' }
    ]
  };

  const result = await resolveBlockers(mockPr);
  assert.equal(result.status, 'blocked', 'Required review should block the PR');
  assert.equal(result.reason, 'review_required');
});

test('PR Manager - getPrStatus returns null when current branch has no PR', () => {
  const runner = createRunner([
    {
      status: 1,
      stdout: '',
      stderr: 'no pull requests found for branch "codex/tech-debt-audit-20260320"\n'
    }
  ]);

  assert.equal(getPrStatus('', runner), null);
});

test('PR Manager - loadManagedPrs falls back to open PR list when branch has no PR', () => {
  const mockPr = {
    number: 281,
    title: 'Merged-ready PR',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    isDraft: false,
    statusCheckRollup: []
  };
  const runner = createRunner([
    {
      status: 1,
      stdout: '',
      stderr: 'no pull requests found for branch "codex/tech-debt-audit-20260320"\n'
    },
    {
      status: 0,
      stdout: JSON.stringify([mockPr]),
      stderr: ''
    }
  ]);

  assert.deepEqual(loadManagedPrs('', runner), [mockPr]);
});

test('PR Manager - managePrs returns noop when there are no open PRs', async () => {
  const runner = createRunner([
    {
      status: 1,
      stdout: '',
      stderr: 'no pull requests found for branch "codex/tech-debt-audit-20260320"\n'
    },
    {
      status: 0,
      stdout: '[]',
      stderr: ''
    }
  ]);

  const result = await managePrs('', runner);
  assert.equal(result.status, 'noop');
  assert.deepEqual(result.prs, []);
});

test('PR Manager - managePrs merges ready open PRs discovered from the repo list', async () => {
  const mockPr = {
    number: 282,
    title: 'Repo-wide ready PR',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    isDraft: false,
    statusCheckRollup: [{ name: 'CI', conclusion: 'SUCCESS' }]
  };
  const runner = createRunner([
    {
      status: 1,
      stdout: '',
      stderr: 'no pull requests found for branch "codex/tech-debt-audit-20260320"\n'
    },
    {
      status: 0,
      stdout: JSON.stringify([mockPr]),
      stderr: ''
    },
    {
      status: 0,
      stdout: 'merged',
      stderr: ''
    }
  ]);

  const result = await managePrs('', runner);
  assert.equal(result.status, 'ok');
  assert.equal(result.prs.length, 1);
  assert.equal(result.prs[0].number, 282);
  assert.equal(result.prs[0].outcome.status, 'ready');
  assert.equal(result.prs[0].outcome.merged, true);
});

test('PR Manager - managePrs leaves pending-check PRs unmerged', async () => {
  const mockPr = {
    number: 283,
    title: 'Repo-wide pending PR',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    isDraft: false,
    statusCheckRollup: [{ name: 'CI', status: 'IN_PROGRESS', conclusion: null }]
  };
  const runner = createRunner([
    {
      status: 1,
      stdout: '',
      stderr: 'no pull requests found for branch "codex/tech-debt-audit-20260320"\n'
    },
    {
      status: 0,
      stdout: JSON.stringify([mockPr]),
      stderr: ''
    }
  ]);

  const result = await managePrs('', runner);
  assert.equal(result.status, 'ok');
  assert.equal(result.prs.length, 1);
  assert.equal(result.prs[0].number, 283);
  assert.equal(result.prs[0].outcome.status, 'blocked');
  assert.equal(result.prs[0].outcome.reason, 'ci_pending');
});
