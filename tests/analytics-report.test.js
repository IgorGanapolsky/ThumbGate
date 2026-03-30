'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  run,
  collectAnalytics,
  formatReport,
  estimateOrganicDownloads,
} = require('../scripts/analytics-report');

test('estimateOrganicDownloads filters publish-day inflation using no-publish baseline', () => {
  const result = estimateOrganicDownloads([
    { day: '2026-03-21', downloads: 10 },
    { day: '2026-03-22', downloads: 12 },
    { day: '2026-03-23', downloads: 20 },
    { day: '2026-03-24', downloads: 200 },
    { day: '2026-03-25', downloads: 18 },
  ], ['2026-03-24']);

  assert.equal(result.organicDailyBaseline, 11);
  assert.equal(result.organicWeekly, 77);
  assert.equal(result.publishDayAvg, 200);
  assert.equal(result.noPublishDayAvg, 15);
  assert.equal(result.totalDownloads, 260);
  assert.equal(result.estimatedOrganic30d, 330);
  assert.equal(result.estimatedInflated, 0);
  assert.equal(result.organicRate, 100);
});

test('collectAnalytics tolerates npm version metadata failures', async () => {
  const data = await collectAnalytics({
    fetchNpmMonthly: async () => ({ downloads: [{ day: '2026-03-24', downloads: 42 }] }),
    fetchNpmWeekly: async () => ({ downloads: 42 }),
    fetchGitHub: async () => ({ stargazers_count: 5, forks_count: 2, open_issues_count: 1, subscribers_count: 3 }),
    fetchNpmVersions: async () => { throw new Error('rate-limited'); },
  });

  assert.equal(data.weekly.downloads, 42);
  assert.equal(data.monthly.downloads.length, 1);
  assert.equal(data.github.stargazers_count, 5);
  assert.equal(data.npmMeta, null);
});

test('formatReport includes honest metrics and share links', () => {
  const report = formatReport(
    {
      downloads: [
        { day: '2026-03-21', downloads: 10 },
        { day: '2026-03-22', downloads: 12 },
        { day: '2026-03-23', downloads: 20 },
        { day: '2026-03-24', downloads: 200 },
        { day: '2026-03-25', downloads: 18 },
      ],
    },
    { downloads: 260 },
    { stargazers_count: 9, forks_count: 3, open_issues_count: 1, subscribers_count: 2 },
    {
      time: {
        created: '2026-03-01T00:00:00.000Z',
        modified: '2026-03-25T00:00:00.000Z',
        '0.8.4': '2026-03-24T10:00:00.000Z',
      },
    }
  );

  assert.match(report, /ThumbGate — Unified Analytics Snapshot/);
  assert.match(report, /ORGANIC ESTIMATE/);
  assert.match(report, /Publish-day avg:\s+200\/day/);
  assert.match(report, /Twitter:\s+https:\/\/rlhf-feedback-loop-production\.up\.railway\.app\?utm_source=twitter/);
  assert.match(report, /Real npm traction:\s+~77 downloads\/week/);
  assert.match(report, /GitHub stars:\s+9/);
});

test('run emits formatted analytics snapshot from injected fetchers without network access', async () => {
  const logs = [];
  const errors = [];
  const exits = [];

  await run({
    log: (message) => logs.push(message),
    error: (...args) => errors.push(args.join(' ')),
    exit: (code) => exits.push(code),
    fetchers: {
      fetchNpmMonthly: async () => ({ downloads: [{ day: '2026-03-24', downloads: 42 }] }),
      fetchNpmWeekly: async () => ({ downloads: 42 }),
      fetchGitHub: async () => ({ stargazers_count: 5, forks_count: 2, open_issues_count: 1, subscribers_count: 3 }),
      fetchNpmVersions: async () => ({
        time: {
          created: '2026-03-01T00:00:00.000Z',
          modified: '2026-03-25T00:00:00.000Z',
        },
      }),
    },
  });

  assert.equal(errors.length, 0);
  assert.deepEqual(exits, []);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /Weekly downloads:\s+42/);
  assert.match(logs[0], /ThumbGate — Unified Analytics Snapshot/);
});

test('run reports fetch failures and exits 1', async () => {
  const logs = [];
  const errors = [];
  const exits = [];

  await run({
    log: (message) => logs.push(message),
    error: (...args) => errors.push(args.join(' ')),
    exit: (code) => exits.push(code),
    fetchers: {
      fetchNpmMonthly: async () => { throw new Error('npm unavailable'); },
      fetchNpmWeekly: async () => ({ downloads: 0 }),
      fetchGitHub: async () => ({ stargazers_count: 0, forks_count: 0, open_issues_count: 0, subscribers_count: 0 }),
      fetchNpmVersions: async () => ({ time: {} }),
    },
  });

  assert.equal(logs.length, 0);
  assert.deepEqual(exits, [1]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Analytics fetch failed: npm unavailable/);
});
