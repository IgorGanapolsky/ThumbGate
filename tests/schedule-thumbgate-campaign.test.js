'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseArgs, scheduleCampaign } = require('../scripts/social-analytics/schedule-thumbgate-campaign');

test('schedule campaign parseArgs supports dry run, platforms, times, and timezone', () => {
  const parsed = parseArgs([
    '--dry-run',
    '--platforms=twitter,instagram',
    '--times=2026-04-07T10:15:00-04:00,2026-04-07T14:30:00-04:00',
    '--timezone=America/New_York',
  ]);

  assert.equal(parsed.dryRun, true);
  assert.deepEqual(parsed.platforms, ['twitter', 'instagram']);
  assert.deepEqual(parsed.scheduleTimes, [
    '2026-04-07T10:15:00-04:00',
    '2026-04-07T14:30:00-04:00',
  ]);
  assert.equal(parsed.timezone, 'America/New_York');
});

test('scheduleCampaign dry run returns scheduled previews for requested platforms', async () => {
  const fakeApi = {
    getConnectedAccounts: async () => ([
      { platform: 'twitter', accountId: 'acc_t1' },
      { platform: 'linkedin', accountId: 'acc_l1' },
      { platform: 'instagram', accountId: 'acc_i1' },
    ]),
    groupAccountsByPlatform(accounts) {
      const groups = new Map();
      for (const account of accounts) {
        const existing = groups.get(account.platform) || [];
        existing.push(account);
        groups.set(account.platform, existing);
      }
      return groups;
    },
  };

  const result = await scheduleCampaign({
    dryRun: true,
    scheduleTimes: [
      '2026-04-07T10:15:00-04:00',
      '2026-04-07T14:30:00-04:00',
      '2026-04-07T18:45:00-04:00',
    ],
    timezone: 'America/New_York',
  }, fakeApi);

  assert.equal(result.errors.length, 0);
  assert.equal(result.scheduled.length, 9);
  assert.equal(result.scheduled[0].dryRun, true);
  assert.match(result.scheduled[0].content, /ThumbGate/);
});

test('scheduleCampaign uses Instagram media-backed scheduler and platform-specific UTM', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-campaign-state-'));
  const statePath = path.join(tmpDir, 'campaign-state.json');
  const calls = [];
  const fakeApi = {
    getConnectedAccounts: async () => ([
      { platform: 'twitter', accountId: 'acc_t1' },
      { platform: 'instagram', accountId: 'acc_i1' },
    ]),
    groupAccountsByPlatform(accounts) {
      return new Map([
        ['twitter', accounts.filter((account) => account.platform === 'twitter')],
        ['instagram', accounts.filter((account) => account.platform === 'instagram')],
      ]);
    },
    schedulePost: async (content, platforms, scheduledFor, timezone, options) => {
      calls.push({ type: 'standard', content, platforms, scheduledFor, timezone, options });
      return { id: 'sched_x_1' };
    },
    publishInstagramThumbGate: async (options) => {
      calls.push({ type: 'instagram', options });
      return { id: 'sched_ig_1', success: true };
    },
  };

  const result = await scheduleCampaign({
    platforms: ['twitter', 'instagram'],
    scheduleTimes: [
      '2026-04-07T10:15:00-04:00',
      '2026-04-07T14:30:00-04:00',
      '2026-04-07T18:45:00-04:00',
    ],
    statePath,
    timezone: 'America/New_York',
  }, fakeApi);

  assert.equal(result.errors.length, 0);
  assert.equal(result.scheduled.length, 6);
  assert.equal(calls[0].type, 'standard');
  assert.equal(calls[0].options.utm.source, 'x');
  assert.equal(calls[1].type, 'instagram');
  assert.equal(calls[1].options.utm.source, 'instagram');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('scheduleCampaign skips duplicate entries that are already recorded in state', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-campaign-state-'));
  const statePath = path.join(tmpDir, 'campaign-state.json');
  const calls = [];
  const fakeApi = {
    getConnectedAccounts: async () => ([
      { platform: 'twitter', accountId: 'acc_t1' },
    ]),
    groupAccountsByPlatform(accounts) {
      return new Map([['twitter', accounts]]);
    },
    schedulePost: async (content, platforms, scheduledFor) => {
      calls.push({ content, platforms, scheduledFor });
      return { id: `sched_${calls.length}` };
    },
  };

  const options = {
    platforms: ['twitter'],
    scheduleTimes: [
      '2026-04-07T10:15:00-04:00',
      '2026-04-07T14:30:00-04:00',
      '2026-04-07T18:45:00-04:00',
    ],
    statePath,
    timezone: 'America/New_York',
  };

  const firstRun = await scheduleCampaign(options, fakeApi);
  const secondRun = await scheduleCampaign(options, fakeApi);

  assert.equal(firstRun.scheduled.length, 3);
  assert.equal(secondRun.scheduled.length, 0);
  assert.equal(secondRun.skipped.length, 3);
  assert.equal(calls.length, 3);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
