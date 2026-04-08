'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ---------------------------------------------------------------------------
// normalizeZernioMetric tests
// ---------------------------------------------------------------------------

describe('normalizeZernioMetric', () => {
  const { normalizeZernioMetric } = require('../scripts/social-analytics/normalizer');

  it('normalizes a basic Zernio post metric', () => {
    const raw = {
      postId: 'z_post_001',
      platform: 'twitter',
      impressions: 1500,
      reach: 800,
      likes: 45,
      comments: 7,
      shares: 12,
      saves: 3,
      clicks: 20,
      videoViews: 0,
    };

    const result = normalizeZernioMetric(raw);

    assert.equal(result.platform, 'twitter');
    assert.equal(result.post_id, 'z_post_001');
    assert.equal(result.impressions, 1500);
    assert.equal(result.reach, 800);
    assert.equal(result.likes, 45);
    assert.equal(result.comments, 7);
    assert.equal(result.shares, 12);
    assert.equal(result.saves, 3);
    assert.equal(result.clicks, 20);
    assert.equal(result.video_views, 0);
    assert.ok(result.fetched_at, 'fetched_at should be set');
    assert.equal(result.content_type, 'post');
  });

  it('throws on null input', () => {
    assert.throws(() => normalizeZernioMetric(null), /non-null object/);
  });

  it('throws on undefined input', () => {
    assert.throws(() => normalizeZernioMetric(undefined), /non-null object/);
  });

  it('throws on missing postId', () => {
    assert.throws(() => normalizeZernioMetric({ platform: 'twitter', impressions: 100 }), /postId/);
  });

  it('defaults metric_date to today when not provided', () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = normalizeZernioMetric({ postId: 'p1', platform: 'instagram' });
    assert.equal(result.metric_date, today);
  });

  it('uses provided metricDate when present', () => {
    const result = normalizeZernioMetric({ postId: 'p2', platform: 'instagram', metricDate: '2026-03-01' });
    assert.equal(result.metric_date, '2026-03-01');
  });

  it('maps videoViews to video_views field', () => {
    const result = normalizeZernioMetric({ postId: 'p3', platform: 'instagram', videoViews: 9999 });
    assert.equal(result.video_views, 9999);
  });

  it('stores accountId and platformPostId in extra_json', () => {
    const result = normalizeZernioMetric({
      postId: 'p4',
      platform: 'twitter',
      accountId: 'acc_xyz',
      platformPostId: 'tw_abc',
    });
    assert.ok(result.extra_json);
    const extra = JSON.parse(result.extra_json);
    assert.equal(extra.accountId, 'acc_xyz');
    assert.equal(extra.platformPostId, 'tw_abc');
  });

  it('accepts raw.id as fallback for postId', () => {
    const result = normalizeZernioMetric({ id: 'fallback_id', platform: 'linkedin' });
    assert.equal(result.post_id, 'fallback_id');
  });

  it('uses contentType for content_type', () => {
    const result = normalizeZernioMetric({ postId: 'p5', platform: 'instagram', contentType: 'reel' });
    assert.equal(result.content_type, 'reel');
  });
});

// ---------------------------------------------------------------------------
// zernio publisher tests
// ---------------------------------------------------------------------------

describe('zernio publisher', () => {
  const publisher = require('../scripts/social-analytics/publishers/zernio');
  const {
    getConnectedAccounts,
    publishPost,
    publishToAllPlatforms,
    schedulePost,
    uploadLocalMedia,
  } = publisher;

  let originalFetch;
  let originalApiKey;
  let originalDedupPath;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalApiKey = process.env.ZERNIO_API_KEY;
    originalDedupPath = process.env.THUMBGATE_DEDUP_LOG_PATH;
    process.env.ZERNIO_API_KEY = 'test_key_abc123';
    // Use a temp dedup log so tests don't interfere with each other
    process.env.THUMBGATE_DEDUP_LOG_PATH = path.join(os.tmpdir(), `zernio-dedup-test-${Date.now()}.json`);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.ZERNIO_API_KEY;
    } else {
      process.env.ZERNIO_API_KEY = originalApiKey;
    }
    // Clean up temp dedup log
    try { fs.unlinkSync(process.env.THUMBGATE_DEDUP_LOG_PATH); } catch { /* ignore */ }
    if (originalDedupPath === undefined) {
      delete process.env.THUMBGATE_DEDUP_LOG_PATH;
    } else {
      process.env.THUMBGATE_DEDUP_LOG_PATH = originalDedupPath;
    }
  });

  it('publishPost throws when ZERNIO_API_KEY is not set', async () => {
    delete process.env.ZERNIO_API_KEY;
    await assert.rejects(
      () => publishPost('Hello world this is a long enough string to pass the quality gate', [{ platform: 'twitter', accountId: 'acc_1' }]),
      /ZERNIO_API_KEY/
    );
  });

  it('publishPost sends correct POST body and auth header', async () => {
    let capturedUrl, capturedOptions;

    global.fetch = async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return {
        ok: true,
        json: async () => ({ data: { id: 'post_123', status: 'published' } }),
      };
    };

    const platforms = [{ platform: 'twitter', accountId: 'acc_xyz' }];
    const result = await publishPost('This is test content long enough to pass the social quality gate check', platforms);

    assert.ok(capturedUrl.includes('/posts'), 'should hit /posts endpoint');
    assert.equal(capturedOptions.method, 'POST');
    assert.equal(capturedOptions.headers.Authorization, 'Bearer test_key_abc123');

    const body = JSON.parse(capturedOptions.body);
    assert.equal(body.content, 'This is test content long enough to pass the social quality gate check');
    assert.equal(body.publishNow, true);
    assert.deepEqual(body.platforms, platforms);

    assert.equal(result.id, 'post_123');
  });

  it('publishPost throws content required error', async () => {
    await assert.rejects(() => publishPost('', [{ platform: 'twitter', accountId: 'acc_1' }]), /content is required/);
  });

  it('publishPost throws platforms required error', async () => {
    await assert.rejects(() => publishPost('Hello', []), /platforms must be a non-empty array/);
  });

  it('getConnectedAccounts sends correct GET request', async () => {
    let capturedUrl, capturedOptions;

    global.fetch = async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return {
        ok: true,
        json: async () => ({
          data: [
            { platform: 'twitter', _id: 'acc_t1', name: 'Twitter Account' },
            { platform: 'instagram', id: 'acc_i1', name: 'Instagram Account' },
          ],
        }),
      };
    };

    const accounts = await getConnectedAccounts();

    assert.ok(capturedUrl.includes('/accounts'), 'should hit /accounts endpoint');
    assert.equal(capturedOptions.method, 'GET');
    assert.equal(capturedOptions.headers.Authorization, 'Bearer test_key_abc123');
    assert.equal(accounts.length, 2);
    assert.equal(accounts[0].platform, 'twitter');
    assert.equal(accounts[0].accountId, 'acc_t1');
    assert.equal(accounts[1].accountId, 'acc_i1');
  });

  it('publishToAllPlatforms groups by platform and tags each publish separately', async () => {
    let fetchCallCount = 0;
    const publishedBodies = [];

    global.fetch = async (url, options) => {
      fetchCallCount++;
      if (url.includes('/accounts')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { platform: 'twitter', _id: 'acc_t1', name: 'Twitter' },
              { platform: 'twitter', accountId: 'acc_t2', name: 'Twitter Backup' },
              { platform: 'instagram', accountId: 'acc_i1', name: 'Instagram' },
            ],
          }),
        };
      }
      if (url.includes('/posts')) {
        publishedBodies.push(JSON.parse(options.body));
        return {
          ok: true,
          json: async () => ({ data: { id: 'bulk_post_456', status: 'published' } }),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await publishToAllPlatforms(
      'Hello from all platforms with enough characters to pass the quality gate https://thumbgate-production.up.railway.app/?utm_content=bulk_publish_test'
    );

    assert.equal(result.published.length, 2);
    assert.equal(result.errors.length, 0);
    assert.equal(fetchCallCount, 3, 'should make exactly 3 fetch calls: /accounts then one /posts per platform');
    assert.equal(publishedBodies[0].platforms.length, 2);
    assert.equal(publishedBodies[0].platforms[0].platform, 'twitter');
    assert.match(publishedBodies[0].content, /utm_source=twitter/);
    assert.equal(publishedBodies[1].platforms.length, 1);
    assert.equal(publishedBodies[1].platforms[0].platform, 'instagram');
    assert.match(publishedBodies[1].content, /utm_source=instagram/);
  });

  it('schedulePost includes scheduledFor and timezone in body', async () => {
    let capturedBody;

    global.fetch = async (url, options) => {
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({ data: { id: 'sched_789', status: 'scheduled' } }),
      };
    };

    await schedulePost(
      'Scheduled content',
      [{ platform: 'linkedin', accountId: 'acc_l1' }],
      '2026-04-01T10:00:00Z',
      'America/New_York'
    );

    assert.equal(capturedBody.publishNow, false);
    assert.equal(capturedBody.scheduledFor, '2026-04-01T10:00:00Z');
    assert.equal(capturedBody.timezone, 'America/New_York');
    assert.equal(capturedBody.content, 'Scheduled content');
  });

  it('schedulePost throws when scheduledFor is missing', async () => {
    await assert.rejects(
      () => schedulePost('Content', [{ platform: 'twitter', accountId: 'acc_1' }], '', 'UTC'),
      /scheduledFor is required/
    );
  });

  it('schedulePost throws when timezone is missing', async () => {
    await assert.rejects(
      () => schedulePost('Content', [{ platform: 'twitter', accountId: 'acc_1' }], '2026-04-01T10:00:00Z', ''),
      /timezone is required/
    );
  });

  it('uploadLocalMedia presigns then uploads a local file', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-zernio-'));
    const filePath = path.join(tmpDir, 'card.png');
    fs.writeFileSync(filePath, Buffer.from('test-image'));

    const calls = [];
    global.fetch = async (url, options) => {
      calls.push({ url, options });
      if (url.includes('/media/presign')) {
        return {
          ok: true,
          json: async () => ({
            data: {
              uploadUrl: 'https://uploads.example.com/card.png',
              publicUrl: 'https://cdn.example.com/card.png',
              key: 'uploads/card.png',
              type: 'image',
            },
          }),
        };
      }

      if (url === 'https://uploads.example.com/card.png') {
        return {
          ok: true,
          text: async () => '',
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await uploadLocalMedia(filePath);

    assert.equal(calls.length, 2);
    assert.ok(calls[0].url.includes('/media/presign'));
    assert.equal(calls[1].url, 'https://uploads.example.com/card.png');
    assert.equal(calls[1].options.method, 'PUT');
    assert.equal(result.url, 'https://cdn.example.com/card.png');
    assert.equal(result.type, 'image');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// zernio poller tests
// ---------------------------------------------------------------------------

describe('zernio poller', () => {
  const { pollZernio, fetchDailyMetrics, fetchPostAnalytics } = require('../scripts/social-analytics/pollers/zernio');
  const { initDb } = require('../scripts/social-analytics/store');

  let originalFetch;
  let originalApiKey;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalApiKey = process.env.ZERNIO_API_KEY;
    process.env.ZERNIO_API_KEY = 'test_key_poller';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.ZERNIO_API_KEY;
    } else {
      process.env.ZERNIO_API_KEY = originalApiKey;
    }
  });

  it('pollZernio fetches daily metrics and upserts to db', async () => {
    const db = initDb(':memory:');

    global.fetch = async (url) => {
      if (url.includes('/accounts')) {
        return {
          ok: true,
          json: async () => ({
            data: [{ platform: 'twitter', accountId: 'acc_tw1', name: 'Twitter Test' }],
          }),
        };
      }
      if (url.includes('/analytics/daily-metrics')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                postId: 'tw_post_abc',
                platform: 'twitter',
                impressions: 500,
                reach: 200,
                likes: 30,
                comments: 5,
                shares: 8,
                saves: 2,
                clicks: 15,
                videoViews: 0,
                metricDate: '2026-03-23',
              },
            ],
          }),
        };
      }
      if (url.includes('/analytics')) {
        return {
          ok: true,
          json: async () => ({
            data: {
              postId: 'tw_post_abc',
              platform: 'twitter',
              impressions: 550,
              reach: 220,
              likes: 32,
              comments: 6,
              shares: 9,
              saves: 2,
              clicks: 16,
              videoViews: 0,
              metricDate: '2026-03-23',
            },
          }),
        };
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    await pollZernio(db);

    const rows = db.prepare("SELECT * FROM engagement_metrics WHERE platform = 'twitter'").all();
    assert.ok(rows.length >= 1, 'should have at least one twitter metric row');
    assert.equal(rows[0].platform, 'twitter');
    assert.equal(rows[0].post_id, 'tw_post_abc');

    db.close();
  });

  it('pollZernio throws when ZERNIO_API_KEY is not set', async () => {
    delete process.env.ZERNIO_API_KEY;
    const db = initDb(':memory:');
    await assert.rejects(() => pollZernio(db), /ZERNIO_API_KEY/);
    db.close();
  });

  it('pollZernio handles empty accounts list gracefully', async () => {
    global.fetch = async (url) => {
      if (url.includes('/accounts')) {
        return {
          ok: true,
          json: async () => ({ data: [] }),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const db = initDb(':memory:');
    // Should resolve without error
    await pollZernio(db);
    db.close();
  });

  it('fetchDailyMetrics sends correct URL with accountId', async () => {
    let capturedUrl;

    global.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({ data: [] }),
      };
    };

    await fetchDailyMetrics('acc_test_123');

    assert.ok(capturedUrl.includes('/analytics/daily-metrics'), 'URL should include /analytics/daily-metrics');
    assert.ok(capturedUrl.includes('accountId=acc_test_123'), 'URL should include the accountId query param');
  });

  it('fetchPostAnalytics sends correct URL with postId', async () => {
    let capturedUrl;

    global.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({ data: {} }),
      };
    };

    await fetchPostAnalytics('post_xyz_789');

    assert.ok(capturedUrl.includes('/analytics'), 'URL should include /analytics');
    assert.ok(capturedUrl.includes('postId=post_xyz_789'), 'URL should include the postId query param');
  });

  it('fetchDailyMetrics throws when accountId is missing', async () => {
    await assert.rejects(() => fetchDailyMetrics(''), /accountId is required/);
  });

  it('fetchPostAnalytics throws when postId is missing', async () => {
    await assert.rejects(() => fetchPostAnalytics(''), /postId is required/);
  });
});
