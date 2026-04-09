#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getPrStatus,
  isOpenPr,
  loadManagedPrs,
  managePrs,
  resolveBlockers,
  performMerge,
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

  const runner = createRunner([
    {
      status: 0,
      stdout: JSON.stringify([{ bucket: 'pass', name: 'CI', state: 'SUCCESS' }]),
      stderr: ''
    }
  ]);

  const result = await resolveBlockers(mockPr, runner);
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

  const runner = createRunner([
    {
      status: 0,
      stdout: JSON.stringify([{ bucket: 'fail', name: 'CI/test', state: 'FAILURE' }]),
      stderr: ''
    }
  ]);

  const result = await resolveBlockers(mockPr, runner);
  assert.equal(result.status, 'blocked', 'Failing CI should block the PR');
  assert.equal(result.reason, 'ci_failure');
  assert.deepEqual(result.checks, ['CI/test']);
});

test('PR Manager - Blocks non-required quality failures returned by gh pr checks', async () => {
  const mockPr = {
    number: 650,
    title: 'Sonar failure PR',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    isDraft: false,
    statusCheckRollup: [
      { name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }
    ]
  };
  const runner = createRunner([
    {
      status: 0,
      stdout: JSON.stringify([
        { bucket: 'pass', name: 'test', state: 'SUCCESS' },
        { bucket: 'fail', name: 'SonarCloud Code Analysis', state: 'FAILURE' }
      ]),
      stderr: ''
    }
  ]);

  const result = await resolveBlockers(mockPr, runner);
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'ci_failure');
  assert.equal(result.checkSource, 'gh pr checks');
  assert.deepEqual(result.checks, ['SonarCloud Code Analysis']);
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

  const runner = createRunner([
    {
      status: 0,
      stdout: JSON.stringify([{ bucket: 'pending', name: 'CI/test', state: 'PENDING' }]),
      stderr: ''
    }
  ]);

  const result = await resolveBlockers(mockPr, runner);
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

  const runner = createRunner([
    {
      status: 0,
      stdout: JSON.stringify([{ bucket: 'pass', name: 'CI/test', state: 'SUCCESS' }]),
      stderr: ''
    }
  ]);

  const result = await resolveBlockers(mockPr, runner);
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

test('PR Manager - isOpenPr returns false for merged PR state', () => {
  assert.equal(isOpenPr({ state: 'MERGED' }), false);
  assert.equal(isOpenPr({ state: 'OPEN' }), true);
});

test('PR Manager - loadManagedPrs falls back to open PR list when current branch PR is already merged', () => {
  const openPr = {
    number: 398,
    state: 'OPEN',
    title: 'Repo open PR',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    isDraft: false,
    statusCheckRollup: []
  };
  const runner = createRunner([
    {
      status: 0,
      stdout: JSON.stringify({
        number: 401,
        state: 'MERGED',
        title: 'Merged current-branch PR',
        mergeable: 'UNKNOWN',
        mergeStateStatus: 'UNKNOWN',
        isDraft: false,
        statusCheckRollup: []
      }),
      stderr: ''
    },
    {
      status: 0,
      stdout: JSON.stringify([openPr]),
      stderr: ''
    }
  ]);

  assert.deepEqual(loadManagedPrs('', runner), [openPr]);
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

  const result = await managePrs('', runner, { waitForMerge: false });
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
      stdout: JSON.stringify([{ bucket: 'pass', name: 'CI', state: 'SUCCESS' }]),
      stderr: ''
    },
    {
      status: 0,
      stdout: 'merged',
      stderr: ''
    }
  ]);

  const result = await managePrs('', runner, { waitForMerge: false });
  assert.equal(result.status, 'ok');
  assert.equal(result.prs.length, 1);
  assert.equal(result.prs[0].number, 282);
  assert.equal(result.prs[0].outcome.status, 'ready');
  assert.equal(result.prs[0].outcome.mergeRequested, true);
  assert.match(result.prs[0].outcome.mergeMode, /merged|queued_or_auto/);
  assert.equal(result.prs[0].outcome.mergeCommit, undefined);
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
    },
    {
      status: 0,
      stdout: JSON.stringify([{ bucket: 'pending', name: 'CI', state: 'PENDING' }]),
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

test('PR Manager - performMerge never uses admin bypass', () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    return { status: 0, stdout: 'queued', stderr: '' };
  };

  const result = performMerge(321, runner, { waitForMerge: false });
  assert.equal(result.ok, true);
  assert.deepEqual(calls[0], ['pr', 'merge', '321', '--squash', '--delete-branch', '--auto']);
  assert.ok(!calls[0].includes('--admin'));
});

test('PR Manager - managePrs reports the landed merge commit instead of the PR head SHA', async () => {
  const runner = createRunner([
    {
      status: 0,
      stdout: JSON.stringify({
        number: 644,
        state: 'OPEN',
        title: 'Merge integrity hardening',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        headRefOid: 'c5c695c5cb0065cd42f8d86e9f6686df7407ea09',
        isDraft: false,
        statusCheckRollup: []
      }),
      stderr: ''
    },
    {
      status: 0,
      stdout: JSON.stringify([
        { bucket: 'pass', name: 'test', state: 'SUCCESS' }
      ]),
      stderr: ''
    },
    {
      status: 0,
      stdout: 'merged',
      stderr: ''
    },
    {
      status: 0,
      stdout: JSON.stringify({
        number: 644,
        state: 'MERGED',
        title: 'Merge integrity hardening',
        headRefOid: 'c5c695c5cb0065cd42f8d86e9f6686df7407ea09',
        mergeCommit: { oid: 'fd1aa82164c5a00c374493abea60a46d4f5446db' },
        mergedAt: '2026-04-08T22:50:17Z',
        mergedBy: { login: 'app/trunk-io' }
      }),
      stderr: ''
    }
  ]);

  const result = await managePrs('644', runner, { timeoutMs: 0, intervalMs: 0 });
  const outcome = result.prs[0].outcome;
  assert.equal(outcome.mergeRequested, true);
  assert.equal(outcome.mergeFinalized, true);
  assert.equal(outcome.mergeCommit, 'fd1aa82164c5a00c374493abea60a46d4f5446db');
  assert.notEqual(outcome.mergeCommit, 'c5c695c5cb0065cd42f8d86e9f6686df7407ea09');
});
