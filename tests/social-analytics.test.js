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
  const {
    POLLERS,
    LEGACY_POLLERS,
  } = require('../scripts/social-analytics/poll-all');

  // 2026-04-20: POLLERS narrowed to the Zernio-canonical stack (github,
  // plausible, zernio). The 6 direct-API pollers (instagram, tiktok, linkedin,
  // reddit, threads, youtube) moved to LEGACY_POLLERS and only activate
  // via THUMBGATE_USE_DIRECT_POLLERS=1. X/Twitter was retired from distribution
  // 2026-04-20 and is not in either list.
  it('default POLLERS is the Zernio-canonical list (github + plausible + zernio)', () => {
    assert.equal(POLLERS.length, 3);
    const names = POLLERS.map((p) => p.name);
    assert.deepEqual(names.sort(), ['github', 'plausible', 'zernio']);
  });

  it('LEGACY_POLLERS + POLLERS covers the 9 active platforms (X excluded post-retirement)', () => {
    const all = [...POLLERS, ...LEGACY_POLLERS].map((p) => p.name);
    assert.equal(all.length, 9);
    for (const name of [
      'github', 'instagram', 'tiktok', 'linkedin',
      'reddit', 'threads', 'youtube', 'plausible', 'zernio',
    ]) {
      assert.ok(all.includes(name), `missing poller: ${name}`);
    }
    assert.ok(!all.includes('x'), 'X must not appear in any poller list — retired 2026-04-20');
  });

  it('each poller has envRequired array', () => {
    for (const p of [...POLLERS, ...LEGACY_POLLERS]) {
      assert.ok(Array.isArray(p.envRequired), `${p.name} missing envRequired`);
      assert.ok(p.envRequired.length > 0, `${p.name} has empty envRequired`);
    }
  });
});

function buildSkoolFixtureHtml(pagePropsOverride = {}) {
  const pageProps = {
    page: 1,
    sortType: 'newest-cm',
    total: 2,
    currentGroup: {
      id: 'group_1',
      name: 'ai-automation-society',
      metadata: {
        displayName: 'AI Automation Society',
        description: 'Learn to get paid for AI solutions.',
        totalMembers: 356800,
        totalOnlineMembers: 2000,
        totalAdmins: 16,
        totalPosts: 16384,
      },
      labels: [
        {
          id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          displayName: 'Support Needed',
          posts: 2634,
          metadata: {
            description: 'Get automation questions answered.',
          },
        },
        {
          id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          displayName: 'YouTube Resources',
          posts: 233,
          metadata: {},
        },
      ],
    },
    postTrees: [
      {
        post: {
          id: 'post_support',
          name: 'help-im-so-lost',
          labelId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          createdAt: '2026-05-05T10:00:00.000Z',
          updatedAt: '2026-05-05T11:00:00.000Z',
          user: {
            id: 'user_1',
            name: 'Builder One',
            email: 'builder@example.com',
          },
          metadata: {
            title: 'HELP! I am lost with Claude Code, GitHub, Supabase, and Vercel',
            content:
              'Claude Code keeps making risky changes and burning credits before I can ship my automation workflow.',
            upvotes: 12,
            comments: 9,
          },
        },
        children: [],
      },
      {
        post: {
          id: 'post_video',
          name: 'new-video-claude-code-skills',
          labelId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          createdAt: '2026-05-04T10:00:00.000Z',
          updatedAt: '2026-05-04T11:00:00.000Z',
          user: {
            id: 'user_2',
            name: 'Creator Two',
          },
          metadata: {
            title: 'New Video: Claude Code Skills That Agencies Keep Paying For',
            content: 'MCP and agent workflow skills for consultants and clients.',
            upvotes: 300,
            comments: 160,
            pinned: true,
            contributors: '[{"id":"user_3","name":"Contributor Three"}]',
          },
        },
        children: [],
      },
      {
        post: {
          id: 'post_rules',
          name: 'please-read-rules-and-guidelines',
          labelId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          createdAt: '2026-05-03T10:00:00.000Z',
          updatedAt: '2026-05-03T11:00:00.000Z',
          user: {
            id: 'user_4',
            name: 'Admin Four',
          },
          metadata: {
            title: 'Please Read | Rules and Guidelines',
            content: 'Search for help before posting automation questions.',
            upvotes: 4000,
            comments: 2000,
          },
        },
        children: [],
      },
    ],
    ...pagePropsOverride,
  };

  const nextData = {
    props: {
      pageProps,
    },
  };
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></body></html>`;
}

describe('Skool headless reader', () => {
  const {
    buildSkoolDigest,
    buildSkoolUrl,
    extractNextData,
    formatMarkdownDigest,
    isCliEntrypoint,
    loadCookieHeader,
    parseArgs,
    parseSkoolHtml,
    rankSkoolRevenueSignals,
    readSkoolCommunity,
    resolveCategoryId,
  } = require('../scripts/skool-reader');

  it('normalizes community URLs and category parameters', () => {
    const url = buildSkoolUrl({
      community: 'ai-automation-society',
      categoryId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      page: 2,
    });

    assert.equal(url, 'https://www.skool.com/ai-automation-society?c=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&p=2');
  });

  it('rejects Skool lookalike hosts before fetching', () => {
    assert.throws(
      () => buildSkoolUrl({ url: 'https://attackerskool.com/ai-automation-society' }),
      /Expected a skool\.com URL/,
    );

    assert.equal(
      buildSkoolUrl({ url: 'https://www.skool.com/ai-automation-society' }),
      'https://www.skool.com/ai-automation-society',
    );
  });

  it('parses CLI arguments without enabling filesystem cookie reads', () => {
    const args = parseArgs([
      '--community=ai-automation-society',
      '--post-limit',
      '25',
      '--signals',
    ]);

    assert.deepEqual(args, {
      community: 'ai-automation-society',
      postLimit: '25',
      signals: true,
    });

    const oldCookie = process.env.SKOOL_COOKIE;
    const oldCookieFile = process.env.SKOOL_COOKIE_FILE;
    try {
      process.env.SKOOL_COOKIE = 'skool_session=secret';
      process.env.SKOOL_COOKIE_FILE = '/tmp/ignored-cookie-file';

      assert.equal(loadCookieHeader({}), 'skool_session=secret');
      assert.equal(loadCookieHeader({ cookie: 'override=yes' }), 'override=yes');
    } finally {
      if (oldCookie === undefined) {
        delete process.env.SKOOL_COOKIE;
      } else {
        process.env.SKOOL_COOKIE = oldCookie;
      }
      if (oldCookieFile === undefined) {
        delete process.env.SKOOL_COOKIE_FILE;
      } else {
        process.env.SKOOL_COOKIE_FILE = oldCookieFile;
      }
    }
  });

  it('extracts community, labels, and normalized posts from SSR data', () => {
    const parsed = parseSkoolHtml(buildSkoolFixtureHtml(), {
      sourceUrl: 'https://www.skool.com/ai-automation-society',
    });

    assert.equal(parsed.community.name, 'AI Automation Society');
    assert.equal(parsed.community.totalMembers, 356800);
    assert.equal(parsed.labels.length, 2);
    assert.equal(parsed.posts.length, 3);
    assert.equal(parsed.posts[0].category, 'Support Needed');
    assert.equal(parsed.posts[0].author.name, 'Builder One');
    assert.match(parsed.posts[0].url, /\/ai-automation-society\/help-im-so-lost$/);
    assert.equal(parsed.posts[0].content.includes('builder@example.com'), false);
  });

  it('reports missing Skool SSR data clearly', () => {
    assert.throws(() => extractNextData('<html></html>'), /did not include __NEXT_DATA__/);
    assert.throws(
      () => extractNextData('<script id="__NEXT_DATA__" type="application/json">{bad</script>'),
      /Could not parse Skool __NEXT_DATA__/,
    );
  });

  it('resolves category names and ids', () => {
    const parsed = parseSkoolHtml(buildSkoolFixtureHtml(), {
      sourceUrl: 'https://www.skool.com/ai-automation-society',
    });

    assert.equal(resolveCategoryId(parsed, 'support needed'), 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    assert.equal(resolveCategoryId(parsed, 'youtube'), 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    assert.equal(resolveCategoryId(parsed, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    assert.throws(() => resolveCategoryId(parsed, 'not here'), /Available categories/);
  });

  it('prioritizes Support Needed posts and filters administrative posts from revenue ranking', () => {
    const parsed = parseSkoolHtml(buildSkoolFixtureHtml(), {
      sourceUrl: 'https://www.skool.com/ai-automation-society',
    });
    const signals = rankSkoolRevenueSignals(parsed.posts, { limit: 2 });

    assert.equal(signals[0].id, 'post_support');
    assert.ok(signals[0].score > signals[1].score);
    assert.equal(signals.some((signal) => signal.id === 'post_rules'), false);
    assert.ok(signals[0].matchedKeywords.includes('breakage-support'));
    assert.ok(signals[0].matchedKeywords.includes('deployment-stack'));
    assert.match(signals[0].suggestedAction, /ThumbGate/);
  });

  it('resolves category names without browser automation', async () => {
    const requests = [];
    const fetch = async (url) => {
      requests.push(url);
      return {
        ok: true,
        status: 200,
        url,
        text: async () => buildSkoolFixtureHtml(),
      };
    };

    const parsed = await readSkoolCommunity({
      community: 'ai-automation-society',
      category: 'Support Needed',
      limit: 1,
    }, { fetch });

    assert.equal(requests.length, 2);
    assert.match(requests[1], /[?&]c=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
    assert.equal(parsed.posts.length, 1);
  });

  it('surfaces missing inputs and HTTP failures without browser automation', async () => {
    await assert.rejects(
      () => readSkoolCommunity({}, { fetch: async () => ({ ok: true, text: async () => buildSkoolFixtureHtml() }) }),
      /Provide --url or --community/,
    );

    await assert.rejects(
      () => readSkoolCommunity({
        community: 'ai-automation-society',
      }, {
        fetch: async () => ({
          ok: false,
          status: 403,
          text: async () => '',
        }),
      }),
      /status 403/,
    );
  });

  it('normalizes event metadata and post detail pages', () => {
    const parsed = parseSkoolHtml(buildSkoolFixtureHtml({
      currentGroup: {
        id: 'group_1',
        metadata: {
          displayName: 'AI Automation Society',
        },
        labels: [],
      },
      postTrees: [],
      postTree: {
        post: {
          id: 'post_detail',
          name: 'detail-page',
          user: { id: 'user_5', firstName: 'Detail', lastName: 'Author' },
          metadata: {
            title: 'Need client help with n8n automation',
            content: 'Looking to hire an automation consultant.',
          },
        },
        children: [{ id: 'comment_1' }],
      },
      upcomingEvents: [
        {
          id: 'event_1',
          metadata: {
            title: 'Q&A with Nate',
            startsAt: '2026-05-11T15:00:00.000Z',
          },
        },
      ],
    }), {
      sourceUrl: 'https://www.skool.com/ai-automation-society/detail-page',
    });

    assert.equal(parsed.community.slug, 'ai-automation-society');
    assert.equal(parsed.posts.length, 1);
    assert.equal(parsed.posts[0].comments, 1);
    assert.equal(parsed.posts[0].author.name, 'Detail Author');
    assert.equal(parsed.upcomingEvents[0].title, 'Q&A with Nate');
  });

  it('formats Markdown digests without leaking email addresses', () => {
    const parsed = parseSkoolHtml(buildSkoolFixtureHtml(), {
      sourceUrl: 'https://www.skool.com/ai-automation-society',
    });
    const markdown = formatMarkdownDigest(buildSkoolDigest(parsed, { limit: 2 }));

    assert.match(markdown, /Revenue Signals/);
    assert.match(markdown, /ThumbGate/);
    assert.equal(markdown.includes('builder@example.com'), false);
  });

  it('formats empty signal digests and exposes a testable CLI entrypoint guard', () => {
    const markdown = formatMarkdownDigest({
      community: { name: 'Quiet Community', totalMembers: 3 },
      sourceUrl: 'https://www.skool.com/quiet-community',
      posts: [],
      signals: [],
      labels: [],
    });

    assert.match(markdown, /No ranked revenue signals/);
    assert.equal(isCliEntrypoint({ filename: __filename }), false);
  });
});

describe('Skool headless MCP server', () => {
  const {
    TOOLS,
    handleRequest,
  } = require('../adapters/skool/server-stdio');

  const fetch = async (url) => ({
    ok: true,
    status: 200,
    url,
    text: async () => buildSkoolFixtureHtml({
      postTrees: [
        {
          post: {
            id: 'post_support',
            name: 'help-with-claude-code',
            labelId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            user: { id: 'user_1', name: 'Builder One' },
            metadata: {
              title: 'Help with Claude Code and Vercel deployment',
              content: 'Claude Code keeps breaking my GitHub deployment workflow.',
              upvotes: 10,
              comments: 5,
            },
          },
          children: [],
        },
      ],
    }),
  });

  it('exposes only read-only tools', () => {
    assert.deepEqual(
      TOOLS.map((tool) => tool.name),
      ['skool_read_community', 'skool_revenue_signals', 'skool_post_detail'],
    );
    for (const tool of TOOLS) {
      assert.equal(tool.annotations.readOnlyHint, true);
      assert.equal(tool.annotations.destructiveHint, false);
      assert.equal(/comment|message|send|create|update|delete/.test(tool.name), false);
    }
  });

  it('lists Skool tools through MCP', async () => {
    const response = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

    assert.equal(response.id, 1);
    assert.equal(response.result.tools.length, 3);
  });

  it('returns ranked ThumbGate acquisition signals through MCP', async () => {
    const response = await handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'skool_revenue_signals',
        arguments: {
          community: 'ai-automation-society',
          limit: 5,
        },
      },
    }, { fetch });

    assert.equal(response.id, 2);
    assert.equal(response.error, undefined);
    const payload = JSON.parse(response.result.content[0].text);
    assert.equal(payload.community.name, 'AI Automation Society');
    assert.equal(payload.signals.length, 1);
    assert.equal(payload.signals[0].id, 'post_support');
    assert.match(payload.signals[0].suggestedAction, /ThumbGate/);
  });

  it('requires a URL for post detail reads', async () => {
    const response = await handleRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'skool_post_detail',
        arguments: {},
      },
    }, { fetch });

    assert.equal(response.error.code, -32603);
    assert.match(response.error.message, /requires url/);
  });
});
