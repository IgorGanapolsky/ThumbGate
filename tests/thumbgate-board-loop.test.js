'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  classifyPr,
  classifyIssue,
  detectForbidden,
  trunkQueuedNumbers,
  alreadyMarked,
  planBoard,
  applyPlan,
  ciRollup,
  buildReport,
  resolveGhBinary,
  FIXED_GH_BINARIES,
  MARKER,
} = require('../scripts/thumbgate-board-loop');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'thumbgate-board-loop.js');
const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');

test('classifyPr: trunk draft is skip, not merge', () => {
  const row = classifyPr({
    number: 3880,
    isDraft: true,
    headRefName: 'trunk-merge/pr-3874/abc',
    mergeStateStatus: 'BLOCKED',
  });
  assert.equal(row.class, 'trunk_queued');
  assert.equal(row.action, 'skip');
});

test('classifyPr: SUCCESS + BEHIND → update_branch', () => {
  const row = classifyPr({
    number: 3873,
    isDraft: false,
    mergeStateStatus: 'BEHIND',
    mergeable: 'MERGEABLE',
    ciRollup: 'SUCCESS',
  });
  assert.equal(row.class, 'behind');
  assert.equal(row.action, 'update_branch');
});

test('classifyPr: SUCCESS + CLEAN → pr_manage', () => {
  const row = classifyPr({
    number: 10,
    isDraft: false,
    mergeStateStatus: 'CLEAN',
    mergeable: 'MERGEABLE',
    ciRollup: 'SUCCESS',
  });
  assert.equal(row.action, 'pr_manage');
});

test('classifyPr: DIRTY → comment, never close', () => {
  const row = classifyPr({
    number: 3650,
    isDraft: false,
    mergeStateStatus: 'DIRTY',
    mergeable: 'CONFLICTING',
    ciRollup: 'FAILURE',
  });
  assert.equal(row.class, 'dirty');
  assert.equal(row.action, 'comment_needs_rebase');
});

test('classifyPr: green BLOCKED → diagnose threads, never approve', () => {
  const row = classifyPr({
    number: 99,
    isDraft: false,
    mergeStateStatus: 'BLOCKED',
    ciRollup: 'SUCCESS',
  });
  assert.equal(row.class, 'blocked_protection');
  assert.equal(row.action, 'diagnose_threads');
});

test('classifyIssue maps ECI / umbrella / IdeaBrowser', () => {
  assert.equal(classifyIssue({ number: 3687, title: 'Gates engine: LLM adjudicator tier' }).class, 'eci_pause');
  assert.equal(classifyIssue({ number: 3690, title: 'Two-tier guardrails: LLM adjudication' }).class, 'eci_pause');
  assert.equal(classifyIssue({ number: 3693, title: 'Agentic Design Patterns (Gulli) gap map' }).class, 'umbrella');
  assert.equal(classifyIssue({ number: 3823, title: 'IdeaBrowser connector + RO/mutating classification' }).class, 'implement');
});

test('detectForbidden catches approve / admin / --auto', () => {
  assert.ok(detectForbidden('gh pr merge --auto 12').includes('raw_auto_merge'));
  assert.ok(detectForbidden('event: "APPROVE"').includes('approve'));
  assert.ok(detectForbidden('gh pr merge --admin').includes('admin_bypass'));
  assert.deepEqual(detectForbidden('npm run pr:manage -- 12'), []);
});

test('trunkQueuedNumbers extracts parent PR from trunk-merge head', () => {
  const set = trunkQueuedNumbers([
    { number: 3880, headRefName: 'trunk-merge/pr-3874/uuid' },
    { number: 3873, headRefName: 'dependabot/npm_and_yarn/undici-8.10.2' },
  ]);
  assert.ok(set.has(3874));
  assert.equal(set.size, 1);
});

test('alreadyMarked respects board-loop marker', () => {
  assert.equal(alreadyMarked([{ body: `hello ${MARKER}` }]), true);
  assert.equal(alreadyMarked([{ body: 'old triage' }]), false);
});

test('applyPlan update-branches at most one behind PR and never approves', () => {
  const plan = planBoard([
    {
      number: 3873,
      title: 'undici',
      isDraft: false,
      mergeStateStatus: 'BEHIND',
      mergeable: 'MERGEABLE',
      ciRollup: 'SUCCESS',
      headRefName: 'dependabot/npm_and_yarn/undici',
    },
    {
      number: 3872,
      title: 'stripe',
      isDraft: false,
      mergeStateStatus: 'BEHIND',
      mergeable: 'MERGEABLE',
      ciRollup: 'SUCCESS',
      headRefName: 'dependabot/npm_and_yarn/stripe',
    },
  ], []);
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    return { status: 0, stdout: 'ok', stderr: '' };
  };
  const applied = applyPlan(plan, { maxUpdateBranch: 1, maxPrManage: 0, maxComments: 0 }, runner);
  assert.equal(applied.actions.length, 1);
  assert.equal(applied.actions[0].kind, 'update_branch');
  assert.equal(applied.actions[0].number, 3873);
  assert.ok(!JSON.stringify(calls).includes('APPROVE'));
  assert.ok(!JSON.stringify(calls).includes('--admin'));
});

test('script --json classifies without applying', () => {
  const offline = buildReport({ apply: false }, { prs: [], issues: [] });
  assert.equal(offline.name, 'thumbgate-board-loop');
  assert.equal(offline.ok, true);
  assert.deepEqual(offline.applied, []);
  assert.ok(offline.never.some((n) => /approve/i.test(n)));

  const result = spawnSync(process.execPath, [SCRIPT, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, GH_TOKEN: process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '' },
  });
  assert.ok(result.stdout, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.name, 'thumbgate-board-loop');
  assert.deepEqual(payload.applied, []);
  assert.ok(Array.isArray(payload.errors));
  if (payload.ok) {
    assert.equal(result.status, 0);
  } else {
    assert.notEqual(result.status, 0);
    assert.ok(payload.errors.length > 0);
  }
});

test('thumbgate CLI board-loop is wired', () => {
  const result = spawnSync(process.execPath, [CLI, 'board-loop', '--json'], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.name, 'thumbgate-board-loop');
});



test('resolveGhBinary uses fixed executable paths only', () => {
  const accessSync = (candidate) => {
    if (candidate === '/usr/bin/gh') return;
    throw new Error('missing');
  };
  assert.equal(resolveGhBinary({ accessSync }), '/usr/bin/gh');
  for (const candidate of FIXED_GH_BINARIES) {
    assert.equal(path.isAbsolute(candidate), true);
  }
});

test('ciRollup returns UNKNOWN when no checks exist', () => {
  assert.equal(ciRollup({}), 'UNKNOWN');
  assert.equal(ciRollup({ statusCheckRollup: [] }), 'UNKNOWN');
  assert.equal(ciRollup({ ciRollup: 'SUCCESS' }), 'SUCCESS');
});

test('classifyPr: UNKNOWN CI waits instead of merge', () => {
  const row = classifyPr({
    number: 42,
    isDraft: false,
    mergeStateStatus: 'CLEAN',
    mergeable: 'MERGEABLE',
    statusCheckRollup: [],
  });
  assert.equal(row.class, 'pending');
  assert.equal(row.action, 'wait');
  assert.equal(row.ci, 'UNKNOWN');
});

test('applyPlan skips alreadyMarked DIRTY comments', () => {
  const plan = planBoard([
    {
      number: 1,
      isDraft: false,
      mergeStateStatus: 'DIRTY',
      mergeable: 'CONFLICTING',
      comments: [{ body: `x ${MARKER}` }],
      statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }],
    },
  ], []);
  assert.equal(plan.prPlan[0].alreadyMarked, true);
  const calls = [];
  const applied = applyPlan(plan, { maxUpdateBranch: 0, maxPrManage: 0, maxComments: 4 }, (args) => {
    calls.push(args);
    return { status: 0, stdout: '', stderr: '' };
  });
  assert.equal(calls.length, 0);
  assert.equal(applied.actions.length, 0);
});

test('buildReport fails closed when gh board load errors', () => {
  const report = buildReport({ apply: true }, {
    prs: [],
    issues: [],
    prsError: 'gh auth failed',
    issuesError: null,
  });
  assert.equal(report.ok, false);
  assert.deepEqual(report.errors, ['gh auth failed']);
  assert.equal(report.applied.length, 0);
});

test('agent-automerge resolves workflow_run PRs and allows dependabot/*', () => {
  const yml = fs.readFileSync(
    path.join(__dirname, '..', '.github', 'workflows', 'agent-automerge.yml'),
    'utf8'
  );
  assert.match(yml, /dependabot\/\*/);
  assert.match(yml, /workflow_run\.head_sha/);
  assert.match(yml, /thumbgate-board-loop\.js/);
  assert.match(yml, /secrets\.GH_PAT/);
  assert.match(yml, /board-loop --apply skipped/);
  assert.doesNotMatch(yml, /event:\s*"APPROVE"/);
  assert.doesNotMatch(yml, /gh\s+pr\s+merge[^\n]*--auto/);
});
