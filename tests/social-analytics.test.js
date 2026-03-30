'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

describe('social-analytics normalizer', () => {
  const {
    normalizeInstagramMetric,
    normalizeTikTokMetric,
    normalizeGitHubMetric,
    normalizeLinkedInMetric,
    normalizeXMetric,
    normalizeRedditMetric,
    normalizeThreadsMetric,
    normalizeYouTubeMetric,
  } = require('../scripts/social-analytics/normalizer');

  it('normalizes Instagram carousel metric', () => {
    const result = normalizeInstagramMetric({
      id: '123456',
      permalink: 'https://instagram.com/p/abc',
      timestamp: '2026-03-21T10:00:00Z',
      media_type: 'CAROUSEL_ALBUM',
      impressions: 500,
      reach: 300,
      like_count: 42,
      comments_count: 5,
      saved: 10,
      shares: 3,
    });

    assert.equal(result.platform, 'instagram');
    assert.equal(result.content_type, 'carousel');
    assert.equal(result.post_id, '123456');
    assert.equal(result.impressions, 500);
    assert.equal(result.likes, 42);
    assert.equal(result.comments, 5);
    assert.equal(result.saves, 10);
    assert.equal(result.shares, 3);
    assert.ok(result.fetched_at);
  });

  it('normalizes TikTok video metric', () => {
    const result = normalizeTikTokMetric({
      video_id: 'tt_789',
      create_time: 1711018800,
      view_count: 1000,
      like_count: 80,
      comment_count: 12,
      share_count: 5,
      duration: 30,
    });

    assert.equal(result.platform, 'tiktok');
    assert.equal(result.content_type, 'video');
    assert.equal(result.post_id, 'tt_789');
    assert.equal(result.video_views, 1000);
    assert.equal(result.likes, 80);
    assert.equal(result.comments, 12);
    assert.equal(result.shares, 5);
  });

  it('normalizes GitHub repo traffic metric', () => {
    const result = normalizeGitHubMetric({
      repo_full_name: 'IgorGanapolsky/ThumbGate',
      content_type: 'repo_traffic',
      count: 200,
      uniques: 50,
      stars: 45,
      forks: 10,
      clones: 30,
    });

    assert.equal(result.platform, 'github');
    assert.equal(result.content_type, 'repo_traffic');
    assert.equal(result.impressions, 200);
    assert.equal(result.reach, 50);
    assert.equal(result.likes, 45);
    assert.equal(result.shares, 10);
    assert.equal(result.clicks, 30);
  });

  it('normalizes LinkedIn post metric', () => {
    const result = normalizeLinkedInMetric({
      id: 'urn:li:share:123',
      impressions: 800,
      numLikes: 25,
      numComments: 3,
      numShares: 2,
    });

    assert.equal(result.platform, 'linkedin');
    assert.equal(result.post_id, 'urn:li:share:123');
    assert.equal(result.impressions, 800);
    assert.equal(result.likes, 25);
    assert.equal(result.comments, 3);
    assert.equal(result.shares, 2);
  });

  it('normalizes X tweet metric', () => {
    const result = normalizeXMetric({
      id: 'tw_456',
      created_at: '2026-03-20T15:00:00Z',
      public_metrics: {
        impression_count: 2000,
        like_count: 50,
        reply_count: 8,
        retweet_count: 15,
        quote_count: 3,
        bookmark_count: 7,
      },
    });

    assert.equal(result.platform, 'x');
    assert.equal(result.content_type, 'tweet');
    assert.equal(result.impressions, 2000);
    assert.equal(result.likes, 50);
    assert.equal(result.comments, 8);
    assert.equal(result.shares, 18); // 15 retweets + 3 quotes
    assert.equal(result.saves, 7);
  });

  it('normalizes Reddit post metric', () => {
    const result = normalizeRedditMetric({
      id: 'reddit_abc',
      created_utc: 1711018800,
      score: 42,
      num_comments: 7,
      subreddit: 'ClaudeCode',
      upvote_ratio: 0.95,
      is_self: true,
    });

    assert.equal(result.platform, 'reddit');
    assert.equal(result.content_type, 'post');
    assert.equal(result.likes, 42);
    assert.equal(result.comments, 7);
    assert.ok(result.extra_json.includes('ClaudeCode'));
  });

  it('normalizes Threads post metric', () => {
    const result = normalizeThreadsMetric({
      id: 'threads_xyz',
      timestamp: '2026-03-21T12:00:00Z',
      permalink: 'https://threads.net/@igor.ganapolsky/post/abc',
      views: 600,
      likes: 35,
      replies: 4,
      reposts: 2,
      quotes: 1,
    });

    assert.equal(result.platform, 'threads');
    assert.equal(result.content_type, 'thread');
    assert.equal(result.impressions, 600);
    assert.equal(result.likes, 35);
    assert.equal(result.comments, 4);
    assert.equal(result.shares, 3); // 2 reposts + 1 quote
  });

  it('normalizes YouTube Shorts metric', () => {
    const result = normalizeYouTubeMetric({
      id: 'yt_abc123',
      publishedAt: '2026-03-21T14:00:00Z',
      isShort: true,
      title: 'ThumbGate in 60s',
      statistics: {
        viewCount: '5000',
        likeCount: '120',
        commentCount: '15',
        favoriteCount: '3',
      },
    });

    assert.equal(result.platform, 'youtube');
    assert.equal(result.content_type, 'short');
    assert.equal(result.post_id, 'yt_abc123');
    assert.ok(result.post_url.includes('/shorts/'));
    assert.equal(result.video_views, 5000);
    assert.equal(result.likes, 120);
    assert.equal(result.comments, 15);
  });

  it('throws on null input for all normalizers', () => {
    assert.throws(() => normalizeInstagramMetric(null), /non-null object/);
    assert.throws(() => normalizeTikTokMetric(null), /non-null object/);
    assert.throws(() => normalizeGitHubMetric(null), /non-null object/);
    assert.throws(() => normalizeLinkedInMetric(null), /non-null object/);
    assert.throws(() => normalizeXMetric(null), /non-null object/);
    assert.throws(() => normalizeRedditMetric(null), /non-null object/);
    assert.throws(() => normalizeThreadsMetric(null), /non-null object/);
    assert.throws(() => normalizeYouTubeMetric(null), /non-null object/);
  });
});

describe('social-analytics store', () => {
  const { initDb, upsertMetric, upsertFollowerSnapshot, queryMetrics, topContent, getFollowerHistory } = require('../scripts/social-analytics/store');
  const strayMemoryPath = path.resolve(':memory:');

  it('initializes an in-memory database and performs CRUD', () => {
    if (fs.existsSync(strayMemoryPath)) {
      fs.unlinkSync(strayMemoryPath);
    }

    const db = initDb(':memory:');

    const today = new Date().toISOString().slice(0, 10);
    upsertMetric(db, {
      platform: 'instagram',
      content_type: 'carousel',
      post_id: 'test_post_1',
      post_url: 'https://instagram.com/p/test',
      published_at: `${today}T10:00:00Z`,
      metric_date: today,
      impressions: 100,
      reach: 50,
      likes: 10,
      comments: 2,
      shares: 1,
      saves: 3,
      clicks: 0,
      video_views: 0,
      followers_delta: 0,
      extra_json: null,
      fetched_at: new Date().toISOString(),
    });

    const metrics = queryMetrics(db, { platform: 'instagram', days: 7 });
    assert.ok(Array.isArray(metrics));
    assert.ok(metrics.length > 0);

    upsertFollowerSnapshot(db, {
      platform: 'instagram',
      follower_count: 150,
      snapshot_date: today,
    });

    const history = getFollowerHistory(db, { platform: 'instagram', days: 7 });
    assert.ok(Array.isArray(history));
    assert.ok(history.length > 0);
    assert.equal(history[0].follower_count, 150);

    const top = topContent(db, { days: 7, limit: 5 });
    assert.ok(Array.isArray(top));

    db.close();
    assert.equal(fs.existsSync(strayMemoryPath), false);
  });

  it('upserts are idempotent (no duplicates)', () => {
    const db = initDb(':memory:');
    const record = {
      platform: 'github',
      content_type: 'repo_traffic',
      post_id: 'IgorGanapolsky/ThumbGate',
      metric_date: '2026-03-21',
      impressions: 100,
      reach: 50,
      likes: 45,
      comments: 0,
      shares: 10,
      saves: 0,
      clicks: 30,
      video_views: 0,
      followers_delta: 0,
      fetched_at: new Date().toISOString(),
    };

    upsertMetric(db, record);
    upsertMetric(db, { ...record, impressions: 200 });

    const rows = db.prepare('SELECT * FROM engagement_metrics WHERE platform = ?').all('github');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].impressions, 200);

    db.close();
  });

  it('does not create a literal :memory: database file in the repo root', () => {
    if (fs.existsSync(strayMemoryPath)) {
      fs.unlinkSync(strayMemoryPath);
    }

    const db = initDb(':memory:');
    db.close();

    assert.equal(fs.existsSync(strayMemoryPath), false);
  });
});

describe('social-analytics UTM builder', () => {
  const { buildUTMLink, buildSocialLinks } = require('../scripts/social-analytics/utm');

  it('builds UTM links with all parameters', () => {
    const url = buildUTMLink('https://example.com', {
      source: 'instagram',
      medium: 'social',
      campaign: 'launch-2026',
      content: 'carousel-1',
    });

    assert.ok(url.includes('utm_source=instagram'));
    assert.ok(url.includes('utm_medium=social'));
    assert.ok(url.includes('utm_campaign=launch-2026'));
    assert.ok(url.includes('utm_content=carousel-1'));
  });

  it('builds social links for all platforms', () => {
    const links = buildSocialLinks('https://example.com', 'test-campaign');
    assert.ok(links.instagram);
    assert.ok(links.tiktok);
    assert.ok(links.x);
    assert.ok(links.github);
    assert.ok(links.instagram.includes('utm_source=instagram'));
    assert.ok(links.x.includes('utm_source=x'));
  });
});

describe('social-analytics poll-all', () => {
  const { POLLERS } = require('../scripts/social-analytics/poll-all');

  it('registers all 10 platform pollers', () => {
    assert.equal(POLLERS.length, 10);
    const names = POLLERS.map((p) => p.name);
    assert.ok(names.includes('github'));
    assert.ok(names.includes('instagram'));
    assert.ok(names.includes('tiktok'));
    assert.ok(names.includes('linkedin'));
    assert.ok(names.includes('x'));
    assert.ok(names.includes('reddit'));
    assert.ok(names.includes('threads'));
    assert.ok(names.includes('youtube'));
    assert.ok(names.includes('plausible'));
    assert.ok(names.includes('zernio'));
  });

  it('each poller has envRequired array', () => {
    for (const p of POLLERS) {
      assert.ok(Array.isArray(p.envRequired), `${p.name} missing envRequired`);
      assert.ok(p.envRequired.length > 0, `${p.name} has empty envRequired`);
    }
  });
});
