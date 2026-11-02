'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  collectCheckin,
  findRecentRelease,
  formatCheckin,
  parseArgs,
  readWeeklyDownloads,
} = require('../scripts/weekly-shipping-checkin');

test('findRecentRelease selects the newest npm publish within the trailing week', () => {
  const now = new Date('2026-11-02T12:00:00.000Z');
  const release = findRecentRelease({
    time: {
      created: '2026-01-01T00:00:00.000Z',
      modified: '2026-11-02T10:00:00.000Z',
      '1.38.0': '2026-10-25T12:00:00.000Z',
      '1.39.0': '2026-10-29T12:00:00.000Z',
      '1.40.0': '2026-11-03T12:00:00.000Z',
    },
  }, now);

  assert.deepEqual(release, {
    status: 'published',
    version: '1.39.0',
    publishedAt: '2026-10-29T12:00:00.000Z',
  });
});

test('findRecentRelease distinguishes missing registry data from no recent release', () => {
  assert.deepEqual(findRecentRelease(null), { status: 'unavailable' });
  assert.deepEqual(findRecentRelease({ time: {} }), { status: 'none' });
});

test('readWeeklyDownloads preserves measured zero and marks absent metrics unavailable', () => {
  assert.equal(readWeeklyDownloads({ downloads: 0 }), 0);
  assert.equal(readWeeklyDownloads({ downloads: 19 }), 19);
  assert.equal(readWeeklyDownloads({}), null);
  assert.equal(readWeeklyDownloads({ downloads: '0' }), null);
});

test('formatCheckin produces three evidence-labeled lines and sanitizes the manual next step', () => {
  const checkin = formatCheckin({
    npmMetadata: { time: { '1.39.0': '2026-10-29T12:00:00.000Z' } },
    weeklyDownloads: 0,
    nextStep: 'Validate the release\nthen review feedback',
    now: new Date('2026-11-02T12:00:00.000Z'),
  });

  assert.deepEqual(checkin.split('\n'), [
    'What shipped: ThumbGate npm v1.39.0 (published 2026-10-29T12:00:00.000Z)',
    'The number: 0 npm downloads (npm last-week window); users/subscribers unavailable from this source',
    "What's next: Validate the release then review feedback",
  ]);
});

test('formatCheckin labels unavailable metrics instead of converting them to zero', () => {
  const checkin = formatCheckin({
    npmMetadata: null,
    weeklyDownloads: null,
    now: new Date('2026-11-02T12:00:00.000Z'),
  });

  assert.match(checkin, /What shipped: unavailable/);
  assert.match(checkin, /The number: weekly npm downloads unavailable/);
  assert.match(checkin, /What's next: Not recorded/);
});

test('parseArgs accepts a human-written next step and rejects unknown options', () => {
  assert.deepEqual(parseArgs(['--next=Ship the validated change']), {
    nextStep: 'Ship the validated change',
  });
  assert.throws(() => parseArgs(['--publish']), /Unknown argument: --publish/);
});

test('collectCheckin uses injected sources without network access', async () => {
  const data = await collectCheckin({
    fetchNpmMetadata: async () => ({ time: {} }),
    fetchNpmWeeklyDownloads: async () => ({ downloads: 23 }),
  });

  assert.deepEqual(data, { npmMetadata: { time: {} }, weeklyDownloads: 23 });
});
