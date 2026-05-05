'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_LAUNCH_PLATFORMS,
  LAUNCH_CAMPAIGN,
  OPERATOR_LAB_MEDIA_PATHS,
  OPERATOR_LAB_CAMPAIGN,
  buildPlatformPost,
  parseArgs,
  publishLaunchCampaign,
  resolveOperatorLabMediaPath,
} = require('../scripts/social-analytics/publish-thumbgate-launch');

test('buildPlatformPost creates tracked launch copy for X', () => {
  const post = buildPlatformPost('twitter');
  assert.match(post, /ThumbGate/);
  assert.match(post, /utm_source=x/);
  assert.match(post, /utm_campaign=first_customer_push/);
  assert.match(post, /utm_content=launch_post_twitter/);
});

test('parseArgs supports dry run, schedule, timezone, and platform filters', () => {
  const parsed = parseArgs([
    '--dry-run',
    '--platforms=twitter,linkedin',
    '--schedule=2026-04-06T16:00:00-04:00',
    '--timezone=America/New_York',
    '--offer=operator-lab',
  ]);

  assert.equal(parsed.dryRun, true);
  assert.deepEqual(parsed.platforms, ['twitter', 'linkedin']);
  assert.equal(parsed.schedule, '2026-04-06T16:00:00-04:00');
  assert.equal(parsed.timezone, 'America/New_York');
  assert.equal(parsed.offer, 'operator-lab');
});

test('buildPlatformPost can create Skool operator lab copy', () => {
  const post = buildPlatformPost('linkedin', 'operator-lab');
  const xPost = buildPlatformPost('twitter', 'operator-lab');

  assert.match(post, /ThumbGate Operator Lab/);
  assert.match(post, /skool\.com\/thumbgate-operator-lab-6000/);
  assert.match(post, /utm_medium=community_course/);
  assert.match(post, /utm_campaign=operator_lab_launch/);
  assert.match(post, /utm_content=operator_lab_linkedin/);
  assert.ok(xPost.length <= 280, `X operator-lab post should fit 280 chars; got ${xPost.length}`);
  assert.match(xPost, /utm_content=operator_lab_twitter/);
});

test('resolveOperatorLabMediaPath maps platform creative assets', () => {
  assert.equal(resolveOperatorLabMediaPath('linkedin', 'operator-lab'), OPERATOR_LAB_MEDIA_PATHS.landscape);
  assert.equal(resolveOperatorLabMediaPath('instagram', 'operator-lab'), OPERATOR_LAB_MEDIA_PATHS.square);
  assert.equal(resolveOperatorLabMediaPath('threads', 'operator-lab'), OPERATOR_LAB_MEDIA_PATHS.square);
  assert.equal(resolveOperatorLabMediaPath('tiktok', 'operator-lab'), OPERATOR_LAB_MEDIA_PATHS.verticalVideo);
  assert.equal(resolveOperatorLabMediaPath('youtube', 'operator-lab'), OPERATOR_LAB_MEDIA_PATHS.verticalVideo);
  assert.equal(resolveOperatorLabMediaPath('linkedin'), '');
});

test('publishLaunchCampaign previews default platforms in dry run mode', async () => {
  const fakePublisher = {
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

  const result = await publishLaunchCampaign({ dryRun: true }, fakePublisher);

  assert.equal(result.dryRun, true);
  assert.deepEqual(result.platforms, DEFAULT_LAUNCH_PLATFORMS);
  assert.equal(result.previews.length, 2);
  assert.equal(result.published.length, 0);
  assert.equal(result.errors.length, 0);
  assert.match(result.previews[0].content, /ThumbGate/);
});

test('publishLaunchCampaign uses operator lab UTM settings when requested', async () => {
  const calls = [];
  const fakePublisher = {
    getConnectedAccounts: async () => ([
      { platform: 'linkedin', accountId: 'acc_l1' },
    ]),
    groupAccountsByPlatform(accounts) {
      return new Map([['linkedin', accounts]]);
    },
    publishPost: async (content, platforms, options) => {
      calls.push({ content, platforms, options });
      return { id: 'linkedin_post_1' };
    },
    uploadLocalMedia: async (mediaPath) => ({
      type: mediaPath.endsWith('.mp4') ? 'video' : 'image',
      url: `https://cdn.example.test/${mediaPath.split('/').pop()}`,
    }),
  };

  const result = await publishLaunchCampaign({
    platforms: ['linkedin'],
    offer: 'operator-lab',
  }, fakePublisher);

  assert.equal(result.published.length, 1);
  assert.equal(calls[0].options.utm.source, 'linkedin');
  assert.equal(calls[0].options.utm.medium, 'community_course');
  assert.equal(calls[0].options.utm.campaign, OPERATOR_LAB_CAMPAIGN);
  assert.deepEqual(calls[0].options.mediaItems, [
    {
      type: 'image',
      url: 'https://cdn.example.test/thumbgate-operator-lab-social-landscape.png',
    },
  ]);
  assert.match(calls[0].content, /skool\.com\/thumbgate-operator-lab-6000/);
});

test('publishLaunchCampaign includes operator lab media paths in dry-run previews', async () => {
  const fakePublisher = {
    getConnectedAccounts: async () => ([
      { platform: 'linkedin', accountId: 'acc_l1' },
      { platform: 'youtube', accountId: 'acc_y1' },
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

  const result = await publishLaunchCampaign({
    dryRun: true,
    platforms: ['linkedin', 'youtube'],
    offer: 'operator-lab',
  }, fakePublisher);

  assert.equal(result.previews[0].mediaPath, OPERATOR_LAB_MEDIA_PATHS.landscape);
  assert.equal(result.previews[1].mediaPath, OPERATOR_LAB_MEDIA_PATHS.verticalVideo);
  assert.equal(result.published.length, 0);
});

test('publishLaunchCampaign can preview dry-run posts when Zernio key is missing', async () => {
  const fakePublisher = {
    getConnectedAccounts: async () => {
      throw new Error('ZERNIO_API_KEY environment variable is required');
    },
    groupAccountsByPlatform() {
      return new Map();
    },
  };

  const result = await publishLaunchCampaign({
    dryRun: true,
    platforms: ['linkedin'],
    offer: 'operator-lab',
  }, fakePublisher);

  assert.equal(result.previews.length, 1);
  assert.match(result.accountLookupError, /ZERNIO_API_KEY/);
  assert.equal(result.previews[0].mediaPath, OPERATOR_LAB_MEDIA_PATHS.landscape);
  assert.equal(result.skipped.length, 0);
});

test('creator platform promo workflow defaults to full operator lab media channels', () => {
  const workflowPath = path.resolve(__dirname, '..', '.github/workflows/thumbgate-creator-platform-promo.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /default: 'twitter,linkedin,instagram,reddit,tiktok,youtube,threads,bluesky'/);
  assert.match(workflow, /--offer=operator-lab/);
});

test('publishLaunchCampaign passes operator lab image to Instagram workflow', async () => {
  const calls = [];
  const fakePublisher = {
    getConnectedAccounts: async () => ([
      { platform: 'instagram', accountId: 'acc_i1' },
    ]),
    groupAccountsByPlatform(accounts) {
      return new Map([['instagram', accounts]]);
    },
    publishInstagramThumbGate: async (options) => {
      calls.push(options);
      return { success: true, postId: 'ig_operator_lab_1' };
    },
  };

  const result = await publishLaunchCampaign({
    platforms: ['instagram'],
    offer: 'operator-lab',
  }, fakePublisher);

  assert.equal(result.published.length, 1);
  assert.equal(calls[0].imagePath, OPERATOR_LAB_MEDIA_PATHS.square);
  assert.equal(calls[0].postOnly, true);
  assert.equal(calls[0].utm.medium, 'community_course');
});

test('publishLaunchCampaign publishes requested platforms with per-platform UTM settings', async () => {
  const calls = [];
  const fakePublisher = {
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
    publishPost: async (content, platforms, options) => {
      calls.push({ content, platforms, options });
      return { id: `${platforms[0].platform}_post_1` };
    },
  };

  const result = await publishLaunchCampaign({ platforms: ['twitter', 'linkedin'] }, fakePublisher);

  assert.equal(result.published.length, 2);
  assert.equal(result.scheduled.length, 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.utm.source, 'x');
  assert.equal(calls[0].options.utm.medium, 'organic_social');
  assert.equal(calls[0].options.utm.campaign, LAUNCH_CAMPAIGN);
  assert.equal(calls[1].options.utm.source, 'linkedin');
  assert.match(calls[0].content, /utm_content=launch_post_twitter/);
});

test('publishLaunchCampaign schedules instead of publishing when schedule is provided', async () => {
  const fakePublisher = {
    getConnectedAccounts: async () => ([
      { platform: 'twitter', accountId: 'acc_t1' },
    ]),
    groupAccountsByPlatform(accounts) {
      return new Map([['twitter', accounts]]);
    },
    schedulePost: async (content, platforms, scheduledFor, timezone, options) => ({
      content,
      platforms,
      scheduledFor,
      timezone,
      utm: options.utm,
    }),
  };

  const result = await publishLaunchCampaign({
    platforms: ['twitter'],
    schedule: '2026-04-06T16:00:00-04:00',
    timezone: 'America/New_York',
  }, fakePublisher);

  assert.equal(result.published.length, 0);
  assert.equal(result.scheduled.length, 1);
  assert.equal(result.scheduled[0].result.scheduledFor, '2026-04-06T16:00:00-04:00');
  assert.equal(result.scheduled[0].result.timezone, 'America/New_York');
  assert.equal(result.scheduled[0].result.utm.source, 'x');
});

test('publishLaunchCampaign routes Instagram through the media-backed workflow', async () => {
  const fakePublisher = {
    getConnectedAccounts: async () => ([
      { platform: 'instagram', accountId: 'acc_i1' },
    ]),
    groupAccountsByPlatform(accounts) {
      return new Map([['instagram', accounts]]);
    },
    publishInstagramThumbGate: async ({ caption }) => ({
      success: true,
      postId: 'ig_post_1',
      caption,
    }),
  };

  const result = await publishLaunchCampaign({ platforms: ['instagram'] }, fakePublisher);

  assert.equal(result.published.length, 1);
  assert.equal(result.published[0].platform, 'instagram');
  assert.equal(result.published[0].result.success, true);
  assert.match(result.published[0].result.caption, /utm_content=launch_post_instagram/);
});
