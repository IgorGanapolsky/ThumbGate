'use strict';

/**
 * Coverage for the Instagram publishing fix in scripts/social-analytics/post-video.js.
 *
 * Uses dependency injection through the `context` bag rather than require-cache
 * hacks so this suite doesn't leak mocked modules into other tests when the
 * coverage runner executes all tests/*.test.js files in a single process.
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');

const POST_VIDEO_PATH = require.resolve('../scripts/social-analytics/post-video');

const fakeUploaded = {
  contentType: 'video/mp4',
  key: 'uploads/thumbgate-short.mp4',
  size: 123456,
  type: 'video',
  url: 'https://cdn.zernio.test/uploads/thumbgate-short.mp4',
};

function buildTrackers({ publishImpl } = {}) {
  const state = { uploads: [], publishes: [] };
  state.uploadLocalMedia = async (filePath) => {
    state.uploads.push(filePath);
    return { ...fakeUploaded };
  };
  state.publishPost = async (content, platforms, options) => {
    state.publishes.push({ content, platforms, options });
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
  };
  return state;
}

function baseContext(extra = {}) {
  return {
    apiKey: 'test-key',
    campaign: 'unit',
    dryRun: false,
    mediaItem: null,
    templateId: 'tpl-1',
    videoPath: path.join(os.tmpdir(), 'fake.mp4'),
    // Inject DB stubs so the real marketing-db (backed by better-sqlite3,
    // which isn't always installable in CI) is never touched.
    isDuplicate: () => null,
    record: () => {},
    ...extra,
  };
}

describe('post-video (Instagram presign fix)', () => {
  // NOTE: Intentionally do NOT touch process.env.ZERNIO_API_KEY here.
  // Sibling tests (publish-instagram-thumbgate.test.js,
  // instagram-thumbgate-post.test.js) skip themselves when ZERNIO_API_KEY
  // is unset; polluting the env makes them run and attempt live API calls
  // during the shared-process coverage run. Our code paths inject all
  // dependencies via the `context` bag and never call requireKey().
  before(() => {
    // Force a fresh load so require.main guard stays coherent with coverage runs.
    delete require.cache[POST_VIDEO_PATH];
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

  it('parseArgs maps operator-lab offer to the operator-lab template and campaign', () => {
    const { parseArgs } = require('../scripts/social-analytics/post-video');
    const opts = parseArgs(['--offer=operator-lab', '--platforms=youtube']);

    assert.equal(opts.offer, 'operator-lab');
    assert.equal(opts.template, 'operator-lab');
    assert.equal(opts.campaign, 'operator_lab_launch');
    assert.deepEqual(opts.platforms, ['youtube']);
  });

  it('buildPlatformPlan returns null for unknown platforms', () => {
    const { buildPlatformPlan } = require('../scripts/social-analytics/post-video');
    assert.equal(buildPlatformPlan('unknown', 'base'), null);
  });

  it('buildPlatformPlan converts cooldown hours into days', () => {
    const { buildPlatformPlan } = require('../scripts/social-analytics/post-video');
    const plan = buildPlatformPlan('instagram', 'base');
    assert.equal(plan.platform, 'instagram');
    assert.ok(Math.abs(plan.cooldownDays - (8 / 24)) < 1e-9);
  });

  it('buildPlatformPlan uses operator-lab captions with tracked Skool links', () => {
    const { buildPlatformPlan } = require('../scripts/social-analytics/post-video');
    const plan = buildPlatformPlan('youtube', 'base', 'operator-lab');

    assert.equal(plan.offer, 'operator-lab');
    assert.match(plan.caption, /skool\.com\/thumbgate-operator-lab-6000/);
    assert.match(plan.caption, /utm_source=youtube/);
    assert.match(plan.caption, /utm_medium=short_video/);
    assert.match(plan.caption, /utm_campaign=operator_lab_launch/);
  });

  it('processPlatform uploads via presign flow and publishes via shared publishPost', async () => {
    const { processPlatform, buildPlatformPlan } = require('../scripts/social-analytics/post-video');
    const tr = buildTrackers();
    const plan = buildPlatformPlan('instagram', 'test-hash');
    const context = baseContext({ ...tr });

    const result = await processPlatform(plan, context);

    assert.equal(tr.uploads.length, 1, 'uploaded exactly once');
    assert.equal(tr.uploads[0], context.videoPath);

    assert.equal(tr.publishes.length, 1);
    const mediaItem = tr.publishes[0].options.mediaItems[0];
    assert.equal(mediaItem.url, 'https://cdn.zernio.test/uploads/thumbgate-short.mp4');
    assert.equal(mediaItem.key, 'uploads/thumbgate-short.mp4');
    assert.equal(mediaItem.contentType, 'video/mp4');
    assert.equal(mediaItem.type, 'video', 'type coerced to video for Reels');
    assert.ok(mediaItem.size > 0);
    assert.equal(
      tr.publishes[0].options.title,
      'ThumbGate v1.4.1: Stop AI Agents From Repeating Mistakes #shorts'
    );

    assert.equal(result.platform, 'instagram');
    assert.equal(result.status, 'published');
    assert.ok(result.postUrl.includes('instagram.test'));
  });

  it('processPlatform sends the operator-lab YouTube Shorts title', async () => {
    const { processPlatform, buildPlatformPlan } = require('../scripts/social-analytics/post-video');
    const tr = buildTrackers();
    const plan = buildPlatformPlan('youtube', 'test-hash', 'operator-lab');
    const context = baseContext({ ...tr });

    await processPlatform(plan, context);

    assert.equal(
      tr.publishes[0].options.title,
      'ThumbGate Operator Lab: Stop Repeated AI Agent Mistakes #shorts'
    );
  });

  it('processPlatform reuses the same uploaded media for a second platform', async () => {
    const { processPlatform, buildPlatformPlan } = require('../scripts/social-analytics/post-video');
    const tr = buildTrackers();
    const context = baseContext({ ...tr });

    await processPlatform(buildPlatformPlan('tiktok', 'hash'), context);
    await processPlatform(buildPlatformPlan('instagram', 'hash'), context);

    assert.equal(tr.uploads.length, 1, 'upload reused across platforms');
    assert.equal(tr.publishes.length, 2);
  });

  it('processPlatform surfaces publisher-blocked results without throwing', async () => {
    const { processPlatform, buildPlatformPlan } = require('../scripts/social-analytics/post-video');
    const tr = buildTrackers({
      publishImpl: () => ({ blocked: true, reasons: [{ reason: 'quality_gate' }] }),
    });
    const context = baseContext({ ...tr });

    const result = await processPlatform(buildPlatformPlan('instagram', 'h'), context);

    assert.equal(result.status, 'blocked');
    assert.ok(/quality_gate/.test(result.error));
  });

  it('processPlatform short-circuits on dry-run', async () => {
    const { processPlatform, buildPlatformPlan } = require('../scripts/social-analytics/post-video');
    const tr = buildTrackers();
    const context = baseContext({ ...tr, dryRun: true, apiKey: null });

    const result = await processPlatform(buildPlatformPlan('instagram', 'h'), context);

    assert.equal(result.status, 'dry-run');
    assert.equal(tr.uploads.length, 0);
    assert.equal(tr.publishes.length, 0);
  });

  it('zernioUpload delegates to injected uploadLocalMedia', async () => {
    const { zernioUpload } = require('../scripts/social-analytics/post-video');
    const tr = buildTrackers();

    const result = await zernioUpload('ignored', '/tmp/fake.mp4', { uploadLocalMedia: tr.uploadLocalMedia });
    assert.equal(result.url, fakeUploaded.url);
    assert.equal(result.key, fakeUploaded.key);
    assert.equal(tr.uploads[0], '/tmp/fake.mp4');
  });

  // Funnel-attribution regression guard (2026-04-21): TikTok / YouTube / Instagram
  // captions MUST include the tracked landing page as the primary CTA. An earlier
  // variant pointed only at github.com, which never touches our funnel tracker and
  // produced 0 funnel events across 404 published posts. Do not regress.
  it('video captions link to thumbgate-production for funnel attribution', () => {
    const { CAPTIONS } = require('../scripts/social-analytics/post-video');
    const landingDomain = 'thumbgate-production.up.railway.app';

    // TikTok and YouTube include raw URLs, so they must include the tracked domain.
    assert.ok(
      CAPTIONS.tiktok.includes(landingDomain),
      `tiktok caption must link to ${landingDomain}:\n${CAPTIONS.tiktok}`
    );
    assert.ok(
      CAPTIONS.youtube.includes(landingDomain),
      `youtube caption must link to ${landingDomain}:\n${CAPTIONS.youtube}`
    );

    // Instagram uses "link in bio" (IG strips inline URLs) — no landing-page
    // assertion there, but we still forbid github.com as the only outbound
    // reference. As of 2026-04-21 IG caption contains no outbound URL at all.
    assert.ok(
      !/^https?:\/\/github\.com\/IgorGanapolsky\/ThumbGate/m.test(CAPTIONS.instagram),
      `instagram caption must not use github.com as the sole bare-URL CTA:\n${CAPTIONS.instagram}`
    );
  });
});

describe('generate-slides operator-lab template', () => {
  it('exports a non-numeric operator-lab template for revenue video campaigns', () => {
    const { TEMPLATES, pickTemplate } = require('../scripts/social-analytics/generate-slides');

    assert.equal(pickTemplate('operator-lab'), 'operator-lab');
    assert.ok(TEMPLATES['operator-lab']);
    assert.match(TEMPLATES['operator-lab'].name, /operator-lab/);
    assert.ok(TEMPLATES['operator-lab'].slides.length >= 5);
  });
});
