'use strict';

/**
 * Coverage for the Instagram publishing fix in scripts/social-analytics/post-video.js.
 *
 * We mock publishers/zernio.js via require cache injection so `processPlatform`
 * exercises the presign upload + shared publishPost path without touching the
 * network. This locks in the contract that Reels now post via the same
 * media-item shape Instagram's Zernio validation expects.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');

const ZERNIO_PATH = require.resolve('../scripts/social-analytics/publishers/zernio');
const MARKETING_DB_PATH = require.resolve('../scripts/social-analytics/db/marketing-db');
const POST_VIDEO_PATH = require.resolve('../scripts/social-analytics/post-video');

const uploadCalls = [];
const publishCalls = [];
const recordCalls = [];

const fakeUploaded = {
  contentType: 'video/mp4',
  key: 'uploads/thumbgate-short.mp4',
  size: 123456,
  type: 'video',
  url: 'https://cdn.zernio.test/uploads/thumbgate-short.mp4',
};

function resetMocks() {
  uploadCalls.length = 0;
  publishCalls.length = 0;
  recordCalls.length = 0;
}

function installMocks({ publishImpl } = {}) {
  resetMocks();
  require.cache[ZERNIO_PATH] = {
    id: ZERNIO_PATH,
    filename: ZERNIO_PATH,
    loaded: true,
    exports: {
      uploadLocalMedia: async (filePath) => {
        uploadCalls.push(filePath);
        return { ...fakeUploaded };
      },
      publishPost: async (content, platforms, options) => {
        publishCalls.push({ content, platforms, options });
        if (publishImpl) return publishImpl({ content, platforms, options });
        return {
          id: 'zernio-post-1',
          post: {
            platforms: [{
              platform: platforms[0].platform,
              status: 'published',
              platformPostUrl: `https://${platforms[0].platform}.test/post/1`,
            }],
          },
        };
      },
    },
  };

  require.cache[MARKETING_DB_PATH] = {
    id: MARKETING_DB_PATH,
    filename: MARKETING_DB_PATH,
    loaded: true,
    exports: {
      hashContent: (s) => `hash:${String(s).length}`,
      isDuplicate: () => null,
      record: (row) => { recordCalls.push(row); },
    },
  };
}

function clearPostVideoCache() {
  delete require.cache[POST_VIDEO_PATH];
}

describe('post-video (Instagram presign fix)', () => {
  before(() => {
    // Ensure requireKey() short-circuits to an apiKey during tests
    process.env.ZERNIO_API_KEY = 'test-key';
    installMocks();
    clearPostVideoCache();
  });

  after(() => {
    delete require.cache[ZERNIO_PATH];
    delete require.cache[MARKETING_DB_PATH];
    clearPostVideoCache();
  });

  it('exports ACCOUNTS for tiktok, youtube, and instagram', () => {
    const { ACCOUNTS } = require('../scripts/social-analytics/post-video');
    assert.ok(ACCOUNTS.tiktok, 'tiktok account defined');
    assert.ok(ACCOUNTS.youtube, 'youtube account defined');
    assert.ok(ACCOUNTS.instagram, 'instagram account defined');
  });

  it('defines a caption for every supported platform', () => {
    const { CAPTIONS } = require('../scripts/social-analytics/post-video');
    for (const platform of ['tiktok', 'youtube', 'instagram']) {
      assert.ok(CAPTIONS[platform] && CAPTIONS[platform].length > 0, `${platform} caption`);
    }
  });

  it('enforces the per-platform cooldown table', () => {
    const { PLATFORM_COOLDOWN_HOURS } = require('../scripts/social-analytics/post-video');
    // Instagram cooldown must exist and be ≥ 8h (≤ 3 Reels/day policy).
    assert.ok(PLATFORM_COOLDOWN_HOURS.instagram >= 8, 'instagram cooldown respected');
    assert.ok(PLATFORM_COOLDOWN_HOURS.tiktok <= 6, 'tiktok cooldown allows ≥ 4 posts/day');
  });

  it('parseArgs parses --platforms and --dry-run', () => {
    const { parseArgs } = require('../scripts/social-analytics/post-video');
    const opts = parseArgs(['--platforms=tiktok,instagram', '--dry-run', '--campaign=v1']);
    assert.deepEqual(opts.platforms, ['tiktok', 'instagram']);
    assert.equal(opts.dryRun, true);
    assert.equal(opts.campaign, 'v1');
  });

  it('buildPlatformPlan returns null for unknown platforms', () => {
    const { buildPlatformPlan } = require('../scripts/social-analytics/post-video');
    assert.equal(buildPlatformPlan('unknown', 'base'), null);
  });

  it('buildPlatformPlan converts cooldown hours into days', () => {
    const { buildPlatformPlan } = require('../scripts/social-analytics/post-video');
    const plan = buildPlatformPlan('instagram', 'base');
    assert.equal(plan.platform, 'instagram');
    // 8h / 24 = 0.333...
    assert.ok(Math.abs(plan.cooldownDays - (8 / 24)) < 1e-9);
  });

  it('processPlatform uploads via presign flow and publishes via shared publishPost', async () => {
    installMocks();
    clearPostVideoCache();
    const { processPlatform, buildPlatformPlan } = require('../scripts/social-analytics/post-video');

    const plan = buildPlatformPlan('instagram', 'test-hash');
    const context = {
      apiKey: 'test-key',
      campaign: 'unit',
      dryRun: false,
      mediaItem: null,
      templateId: 'tpl-1',
      videoPath: path.join(os.tmpdir(), 'fake.mp4'),
    };

    const result = await processPlatform(plan, context);

    // Uploaded exactly once via the presign helper.
    assert.equal(uploadCalls.length, 1);
    assert.equal(uploadCalls[0], context.videoPath);

    // publishPost received the full { url, key, size, contentType, type } media item.
    assert.equal(publishCalls.length, 1);
    const mediaItem = publishCalls[0].options.mediaItems[0];
    assert.equal(mediaItem.url, 'https://cdn.zernio.test/uploads/thumbgate-short.mp4');
    assert.equal(mediaItem.key, 'uploads/thumbgate-short.mp4');
    assert.equal(mediaItem.contentType, 'video/mp4');
    assert.equal(mediaItem.type, 'video', 'type coerced to video for Reels');
    assert.ok(mediaItem.size > 0);

    // Caller sees a published result.
    assert.equal(result.platform, 'instagram');
    assert.equal(result.status, 'published');
    assert.ok(result.postUrl.includes('instagram.test'));

    // Successful post recorded for future dedup.
    const successRecord = recordCalls.find(r => r.platform === 'instagram' && r.postUrl);
    assert.ok(successRecord, 'success recorded');
  });

  it('processPlatform reuses the same uploaded media for a second platform', async () => {
    installMocks();
    clearPostVideoCache();
    const { processPlatform, buildPlatformPlan } = require('../scripts/social-analytics/post-video');

    const context = {
      apiKey: 'test-key',
      campaign: 'unit',
      dryRun: false,
      mediaItem: null,
      templateId: 'tpl-1',
      videoPath: path.join(os.tmpdir(), 'fake.mp4'),
    };

    await processPlatform(buildPlatformPlan('tiktok', 'hash'), context);
    await processPlatform(buildPlatformPlan('instagram', 'hash'), context);

    // Upload happens once, publish runs twice.
    assert.equal(uploadCalls.length, 1, 'upload reused across platforms');
    assert.equal(publishCalls.length, 2);
  });

  it('processPlatform surfaces publisher-blocked results without throwing', async () => {
    installMocks({
      publishImpl: () => ({ blocked: true, reasons: [{ reason: 'quality_gate' }] }),
    });
    clearPostVideoCache();
    const { processPlatform, buildPlatformPlan } = require('../scripts/social-analytics/post-video');

    const context = {
      apiKey: 'test-key', campaign: 'u', dryRun: false, mediaItem: null,
      templateId: 't', videoPath: '/tmp/fake.mp4',
    };
    const result = await processPlatform(buildPlatformPlan('instagram', 'h'), context);

    assert.equal(result.status, 'blocked');
    assert.ok(/quality_gate/.test(result.error));
  });

  it('processPlatform short-circuits on dry-run', async () => {
    installMocks();
    clearPostVideoCache();
    const { processPlatform, buildPlatformPlan } = require('../scripts/social-analytics/post-video');

    const context = {
      apiKey: null, campaign: 'u', dryRun: true, mediaItem: null,
      templateId: 't', videoPath: '/tmp/fake.mp4',
    };
    const result = await processPlatform(buildPlatformPlan('instagram', 'h'), context);

    assert.equal(result.status, 'dry-run');
    assert.equal(uploadCalls.length, 0);
    assert.equal(publishCalls.length, 0);
  });

  it('zernioUpload delegates to uploadLocalMedia from the shared publisher', async () => {
    installMocks();
    clearPostVideoCache();
    const { zernioUpload } = require('../scripts/social-analytics/post-video');

    const result = await zernioUpload('ignored', '/tmp/fake.mp4');
    assert.equal(result.url, fakeUploaded.url);
    assert.equal(result.key, fakeUploaded.key);
    assert.equal(uploadCalls[0], '/tmp/fake.mp4');
  });
});
