'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_LAUNCH_PLATFORMS,
  LAUNCH_CAMPAIGN,
  OPERATOR_LAB_CAMPAIGN,
  PAID_SPRINT_CAMPAIGN,
  PAID_SPRINT_DIAGNOSTIC_PAYMENT_URL,
  PAID_SPRINT_IMPLEMENTATION_PAYMENT_URL,
  buildPaidSprintCheckoutUrls,
  buildPlatformPost,
  getPlatformFailures,
  parseArgs,
  publishLaunchCampaign,
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

test('buildPlatformPost creates paid sprint copy with direct checkout links', () => {
  const linkedInPost = buildPlatformPost('linkedin', 'paid-sprint');
  const xPost = buildPlatformPost('twitter', 'paid-sprint');
  const threadsPost = buildPlatformPost('threads', 'paid-sprint');
  const links = buildPaidSprintCheckoutUrls('linkedin', 'paid_sprint_linkedin');

  assert.match(linkedInPost, /\$499 diagnostic/);
  assert.match(linkedInPost, /\$1500 sprint/);
  assert.ok(linkedInPost.includes(PAID_SPRINT_DIAGNOSTIC_PAYMENT_URL));
  assert.ok(linkedInPost.includes(PAID_SPRINT_IMPLEMENTATION_PAYMENT_URL));
  assert.ok(linkedInPost.includes(links.diagnostic));
  assert.ok(linkedInPost.includes(links.sprint));
  assert.match(linkedInPost, /utm_campaign=paid_workflow_sprint/);
  assert.match(linkedInPost, /utm_content=paid_sprint_linkedin_diagnostic/);
  assert.match(xPost, /buy\.stripe\.com/);
  assert.ok(xPost.length <= 280, `X paid-sprint post should fit 280 chars; got ${xPost.length}`);
  assert.match(threadsPost, /buy\.stripe\.com/);
  assert.ok(threadsPost.length <= 500, `Threads paid-sprint post should fit 500 chars; got ${threadsPost.length}`);
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
  assert.equal(result.offer, 'launch');
  assert.deepEqual(result.platforms, DEFAULT_LAUNCH_PLATFORMS);
  assert.equal(result.previews.length, 3);
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
    uploadLocalMedia: async () => ({
      url: 'https://example.test/operator-lab.png',
      type: 'image',
      key: 'operator-lab.png',
      size: 1234,
      contentType: 'image/png',
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
  assert.ok(Array.isArray(calls[0].options.mediaItems));
  assert.equal(calls[0].options.mediaItems.length, 1);
  assert.match(calls[0].content, /skool\.com\/thumbgate-operator-lab-6000/);
});

test('publishLaunchCampaign uses paid sprint UTM settings when requested', async () => {
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
  };

  const result = await publishLaunchCampaign({
    platforms: ['linkedin'],
    offer: 'paid-sprint',
  }, fakePublisher);

  assert.equal(result.published.length, 1);
  assert.equal(calls[0].options.utm.source, 'linkedin');
  assert.equal(calls[0].options.utm.medium, 'organic_social');
  assert.equal(calls[0].options.utm.campaign, PAID_SPRINT_CAMPAIGN);
  assert.match(calls[0].content, /buy\.stripe\.com/);
  assert.match(calls[0].content, /utm_campaign=paid_workflow_sprint/);
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

test('getPlatformFailures extracts Zernio platform-level publish failures', () => {
  const failures = getPlatformFailures({
    post: {
      status: 'failed',
      platforms: [
        {
          platform: 'reddit',
          status: 'failed',
          errorMessage: "Reddit submit failed with API errors: NO_SELFS: This community doesn't allow text posts: sr",
        },
      ],
    },
    platformResults: [
      {
        platform: 'reddit',
        status: 'failed',
        error: "Reddit submit failed with API errors: NO_SELFS: This community doesn't allow text posts: sr",
      },
    ],
  });

  assert.equal(failures.length, 1);
  assert.equal(failures[0].platform, 'reddit');
  assert.match(failures[0].error, /NO_SELFS/);
});

test('publishLaunchCampaign reports Zernio platform failures as errors', async () => {
  const fakePublisher = {
    getConnectedAccounts: async () => ([
      { platform: 'reddit', accountId: 'acc_r1' },
    ]),
    groupAccountsByPlatform(accounts) {
      return new Map([['reddit', accounts]]);
    },
    publishPost: async () => ({
      post: {
        status: 'failed',
        platforms: [
          {
            platform: 'reddit',
            status: 'failed',
            errorMessage: "Reddit submit failed with API errors: NO_SELFS: This community doesn't allow text posts: sr",
          },
        ],
      },
      platformResults: [
        {
          platform: 'reddit',
          status: 'failed',
          error: "Reddit submit failed with API errors: NO_SELFS: This community doesn't allow text posts: sr",
        },
      ],
    }),
  };

  const result = await publishLaunchCampaign({ platforms: ['reddit'], offer: 'paid-sprint' }, fakePublisher);

  assert.equal(result.published.length, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].platform, 'reddit');
  assert.match(result.errors[0].error, /NO_SELFS/);
});
