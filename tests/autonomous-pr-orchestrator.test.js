'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateChecks,
  listOpenPrs,
  getPrReviewThreads,
  resolveReviewThread,
  updatePrBranch,
  submitTrunkMerge,
  orchestrateCycle,
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

test('listOpenPrs: parses PR list or throws on failure', () => {
  const mockRunnerSuccess = (args) => ({
    status: 0,
    stdout: JSON.stringify([{ number: 101, title: 'test pr' }]),
  });
  const prs = listOpenPrs(mockRunnerSuccess);
  assert.equal(prs.length, 1);
  assert.equal(prs[0].number, 101);

  const mockRunnerFail = () => ({ status: 1, stderr: 'gh error' });
  assert.throws(() => listOpenPrs(mockRunnerFail), /Failed to list PRs/);
});

test('getPrReviewThreads: parses GraphQL review threads', () => {
  const mockSuccess = () => ({
    status: 0,
    stdout: JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                {
                  id: 'thread_1',
                  isResolved: false,
                  comments: { nodes: [{ author: { login: 'coderabbitai' }, body: 'note' }] },
                },
              ],
            },
          },
        },
      },
    }),
  });
  const threads = getPrReviewThreads(101, mockSuccess);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].id, 'thread_1');

  const mockFail = () => ({ status: 1 });
  assert.deepEqual(getPrReviewThreads(101, mockFail), []);
});

test('resolveReviewThread & updatePrBranch & submitTrunkMerge: execute actions', () => {
  const mockSuccess = () => ({ status: 0, stdout: 'ok' });
  assert.equal(resolveReviewThread('thread_1', mockSuccess), true);

  const updateRes = updatePrBranch(101, mockSuccess);
  assert.equal(updateRes.ok, true);

  const mergeRes = submitTrunkMerge(101, mockSuccess);
  assert.equal(mergeRes.ok, true);
});

test('orchestrateCycle E2E: executes full sweep across conflicting, behind, failing, and ready PRs', async () => {
  const mockPrs = [
    // 1. Conflicting PR
    {
      number: 201,
      title: 'feat: conflicting PR',
      mergeable: 'CONFLICTING',
      mergeStateStatus: 'DIRTY',
      statusCheckRollup: [],
      comments: [],
    },
    // 2. Behind PR
    {
      number: 202,
      title: 'chore: behind main',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'BEHIND',
      statusCheckRollup: [],
      comments: [],
    },
    // 3. Failing Checks PR
    {
      number: 203,
      title: 'fix: failing test',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'BLOCKED',
      statusCheckRollup: [
        { name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' },
      ],
      comments: [],
    },
    // 4. Ready PR with unresolved bot thread
    {
      number: 204,
      title: 'feat: green ready PR',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      statusCheckRollup: [
        { name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { name: 'CodeQL', status: 'COMPLETED', conclusion: 'SUCCESS' },
      ],
      comments: [],
    },
  ];

  const mockRunner = (args) => {
    const cmd = args.join(' ');
    if (cmd.startsWith('pr list')) {
      return { status: 0, stdout: JSON.stringify(mockPrs) };
    }
    if (cmd.includes('reviewThreads')) {
      return {
        status: 0,
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  nodes: [
                    {
                      id: 'thread_bot_1',
                      isResolved: false,
                      comments: { nodes: [{ author: { login: 'coderabbitai' } }] },
                    },
                  ],
                },
              },
            },
          },
        }),
      };
    }
    if (cmd.includes('resolveReviewThread')) {
      return { status: 0, stdout: JSON.stringify({ data: { resolveReviewThread: { thread: { id: 'thread_bot_1', isResolved: true } } } }) };
    }
    if (cmd.startsWith('pr update-branch')) {
      return { status: 0, stdout: 'PR branch updated' };
    }
    if (cmd.startsWith('pr comment')) {
      return { status: 0, stdout: 'commented' };
    }
    return { status: 0, stdout: '' };
  };

  // Run live simulation
  const result = await orchestrateCycle({ dryRun: false }, mockRunner);
  assert.equal(result.summary.total, 4);
  assert.deepEqual(result.summary.conflicts, [201]);
  assert.deepEqual(result.summary.updatedBehind, [202]);
  assert.equal(result.summary.blockedChecks.length, 1);
  assert.equal(result.summary.blockedChecks[0].number, 203);
  assert.deepEqual(result.summary.trunkQueued, [204]);
  assert.equal(result.summary.threadsResolved.length, 3); // 3 non-conflicting PRs had threads resolved
  assert.ok(result.trace.traceId);
  assert.equal(result.trace.status, 'SUCCESS');

  // Dry run test
  const dryResult = await orchestrateCycle({ dryRun: true }, mockRunner);
  assert.equal(dryResult.summary.updatedBehind.length, 0);
  assert.equal(dryResult.summary.trunkQueued.length, 0);

  // Discovery failure test
  const failingRunner = () => ({ status: 1, stderr: 'gh down' });
  await assert.rejects(async () => {
    await orchestrateCycle({}, failingRunner);
  }, /Failed to list PRs/);
});
