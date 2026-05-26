'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  parseArgs,
  ageInDays,
  bucketBacklog,
  classifyWorkflowFailures,
  countBy,
  buildReport,
  renderMarkdown,
} = require('../scripts/ci-cd-hygiene-audit');

const PROJECT_ROOT = path.join(__dirname, '..');

test('GitHub Actions schedules stay limited to security maintenance', () => {
  const workflowsDir = path.join(PROJECT_ROOT, '.github', 'workflows');
  const allowedScheduledWorkflows = new Set(['codeql.yml']);
  const offenders = fs.readdirSync(workflowsDir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .filter((name) => {
      const body = fs.readFileSync(path.join(workflowsDir, name), 'utf8');
      return /^\s{2}schedule:\s*$/m.test(body) && !allowedScheduledWorkflows.has(name);
    });

  assert.deepEqual(offenders, [], 'noncritical recurring loops must run outside GitHub-hosted Actions or via workflow_dispatch');
});

test('parseArgs reads --json, --strict, --repo flags', () => {
  assert.equal(parseArgs(['--json']).json, true);
  assert.equal(parseArgs([]).strict, false);
  assert.equal(parseArgs(['--strict']).strict, true);
  assert.equal(parseArgs(['--repo=foo/bar']).repo, 'foo/bar');
  assert.equal(parseArgs([]).repo, 'IgorGanapolsky/ThumbGate');
});

test('ageInDays returns correct day count from ISO timestamp', () => {
  const now = new Date('2026-05-17T00:00:00Z');
  assert.equal(ageInDays('2026-05-17T00:00:00Z', now), 0);
  assert.equal(ageInDays('2026-05-16T00:00:00Z', now), 1);
  assert.equal(ageInDays('2026-05-10T00:00:00Z', now), 7);
  assert.equal(ageInDays('2026-05-08T12:00:00Z', now), 8);
});

test('bucketBacklog flags CLEAN PRs older than the threshold as merge backlog', () => {
  const now = new Date('2026-05-17T00:00:00Z');
  const prs = [
    { number: 1953, title: 'Session Hygiene', mergeStateStatus: 'CLEAN', createdAt: '2026-05-12T00:00:00Z', commentCount: 0, reviewCount: 0 },
    { number: 2090, title: 'fresh', mergeStateStatus: 'CLEAN', createdAt: '2026-05-16T00:00:00Z', commentCount: 0, reviewCount: 0 },
    { number: 2050, title: 'dirty', mergeStateStatus: 'DIRTY', createdAt: '2026-05-01T00:00:00Z', commentCount: 0, reviewCount: 0 },
  ];
  const buckets = bucketBacklog(prs, { now, staleCleanDays: 2, staleDirtyDays: 5 });
  // 5d old CLEAN → in merge backlog
  assert.equal(buckets.mergeBacklog.length, 1);
  assert.equal(buckets.mergeBacklog[0].number, 1953);
  assert.equal(buckets.mergeBacklog[0].ageDays, 5);
  // 1d old CLEAN → NOT in merge backlog (under threshold)
  assert.ok(!buckets.mergeBacklog.find((pr) => pr.number === 2090));
  // 16d old DIRTY → in stale conflict
  assert.equal(buckets.staleConflict.length, 1);
  assert.equal(buckets.staleConflict[0].number, 2050);
});

test('bucketBacklog flags PRs with zero engagement after 7 days as abandoned', () => {
  const now = new Date('2026-05-17T00:00:00Z');
  const prs = [
    { number: 1842, title: 'orphan', mergeStateStatus: 'UNKNOWN', createdAt: '2026-05-08T00:00:00Z', commentCount: 0, reviewCount: 0 },
    { number: 2000, title: 'engaged', mergeStateStatus: 'CLEAN', createdAt: '2026-05-08T00:00:00Z', commentCount: 5, reviewCount: 1 },
  ];
  const buckets = bucketBacklog(prs, { now });
  const abandoned = buckets.abandoned.find((pr) => pr.number === 1842);
  assert.ok(abandoned, '#1842 has 0 comments + 0 reviews after 9 days → should be flagged abandoned');
  assert.equal(abandoned.ageDays, 9);
  // PR with engagement is NOT abandoned even if old
  assert.ok(!buckets.abandoned.find((pr) => pr.number === 2000));
});

test('classifyWorkflowFailures returns workflows that failed >= threshold times', () => {
  const runs = [
    { name: 'Daily Revenue Loop', conclusion: 'failure' },
    { name: 'Daily Revenue Loop', conclusion: 'success' },
    { name: 'Daily Revenue Loop', conclusion: 'failure' },
    { name: 'Daily Revenue Loop', conclusion: 'failure' },
    { name: 'Other', conclusion: 'failure' },
    { name: 'Other', conclusion: 'success' },
  ];
  const broken = classifyWorkflowFailures(runs, 3);
  assert.equal(broken.length, 1);
  assert.equal(broken[0].workflow, 'Daily Revenue Loop');
  assert.equal(broken[0].failures, 3);
});

test('classifyWorkflowFailures sorts by failure count descending', () => {
  const runs = [
    { name: 'A', conclusion: 'failure' },
    { name: 'A', conclusion: 'failure' },
    { name: 'B', conclusion: 'failure' },
    { name: 'B', conclusion: 'failure' },
    { name: 'B', conclusion: 'failure' },
    { name: 'B', conclusion: 'failure' },
  ];
  const broken = classifyWorkflowFailures(runs, 2);
  assert.equal(broken[0].workflow, 'B');
  assert.equal(broken[0].failures, 4);
  assert.equal(broken[1].workflow, 'A');
});

test('countBy groups items by the provided keyFn', () => {
  assert.deepEqual(
    countBy([{ s: 'X' }, { s: 'Y' }, { s: 'X' }], (i) => i.s),
    { X: 2, Y: 1 }
  );
});

test('buildReport produces a snapshot with all expected sections from injected fixtures', () => {
  const now = new Date('2026-05-17T00:00:00Z');
  // Stub the gh CLI by injecting a fake exec.
  const fakeGh = (args) => {
    const cmd = args.join(' ');
    if (cmd.includes('pr list')) {
      return JSON.stringify([
        { number: 1953, title: 'Ignored CLEAN', createdAt: '2026-05-12T00:00:00Z', mergeStateStatus: 'CLEAN', reviewDecision: null, author: { login: 'a' }, comments: [], reviews: [] },
        { number: 1842, title: 'Old DIRTY', createdAt: '2026-04-25T00:00:00Z', mergeStateStatus: 'DIRTY', reviewDecision: null, author: { login: 'a' }, comments: [], reviews: [] },
      ]);
    }
    if (cmd.includes('run list')) {
      return JSON.stringify([
        { name: 'Daily Revenue Loop', conclusion: 'failure', createdAt: '2026-05-17T13:00:00Z' },
        { name: 'Daily Revenue Loop', conclusion: 'failure', createdAt: '2026-05-15T13:00:00Z' },
        { name: 'Daily Revenue Loop', conclusion: 'failure', createdAt: '2026-05-14T13:00:00Z' },
      ]);
    }
    if (cmd.includes('api graphql')) {
      return JSON.stringify([
        { isResolved: false, comments: { nodes: [{ author: { login: 'chatgpt-codex-connector' } }] } },
        { isResolved: false, comments: { nodes: [{ author: { login: 'sonarqubecloud' } }] } },
      ]);
    }
    return '[]';
  };
  const report = buildReport({ gh: fakeGh, now });
  assert.equal(report.openPrCount, 2);
  assert.equal(report.byMergeState.CLEAN, 1);
  assert.equal(report.byMergeState.DIRTY, 1);
  assert.equal(report.mergeBacklog.length, 1);
  assert.equal(report.mergeBacklog[0].number, 1953);
  assert.equal(report.staleConflict.length, 1);
  assert.equal(report.staleConflict[0].number, 1842);
  assert.equal(report.brokenWorkflows.length, 1);
  assert.equal(report.brokenWorkflows[0].workflow, 'Daily Revenue Loop');
  assert.equal(report.unreadReview.length, 2);
});

test('renderMarkdown produces a complete report with all 5 sections', () => {
  const report = {
    generatedAt: '2026-05-17T00:00:00Z',
    repo: 'foo/bar',
    openPrCount: 3,
    byMergeState: { CLEAN: 1, DIRTY: 1, BLOCKED: 1 },
    mergeBacklog: [{ number: 1953, title: 'Session Hygiene', ageDays: 5 }],
    staleConflict: [{ number: 1842, title: 'Old DIRTY', ageDays: 22 }],
    abandoned: [],
    unreadReview: [{ number: 2097, title: 'Stripe diag', unresolvedCount: 3, byAuthor: { 'chatgpt-codex-connector': 3 } }],
    brokenWorkflows: [{ workflow: 'Daily Revenue Loop', failures: 3 }],
  };
  const md = renderMarkdown(report);
  assert.match(md, /# CI\/CD Hygiene Audit/);
  assert.match(md, /## Merge backlog/);
  assert.match(md, /#1953/);
  assert.match(md, /## Unread review/);
  assert.match(md, /chatgpt-codex-connector\(3\)/);
  assert.match(md, /## Stale conflicts/);
  assert.match(md, /#1842/);
  assert.match(md, /## Broken workflows/);
  assert.match(md, /Daily Revenue Loop/);
  assert.match(md, /## What to do with this/);
});

test('renderMarkdown renders "_Empty_" sections cleanly when everything is fine', () => {
  const report = {
    generatedAt: '2026-05-17T00:00:00Z',
    repo: 'foo/bar',
    openPrCount: 0,
    byMergeState: {},
    mergeBacklog: [],
    staleConflict: [],
    abandoned: [],
    unreadReview: [],
    brokenWorkflows: [],
  };
  const md = renderMarkdown(report);
  assert.match(md, /No CLEAN PRs waiting/);
  assert.match(md, /All review threads resolved/);
  assert.match(md, /No long-running merge conflicts/);
  assert.match(md, /No workflows are repeatedly failing/);
});
