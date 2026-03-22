'use strict';

/**
 * youtube.js
 * Polls the YouTube Data API v3 for channel and video engagement data.
 * Focused on YouTube Shorts (@IgorGanapolsky123).
 *
 * Required env vars:
 *   YOUTUBE_API_KEY      — Data API v3 key (required)
 *   YOUTUBE_CHANNEL_ID   — Channel ID, e.g. UCxxxxxxxxxxxxxxxxxxxxxxxx (required)
 *
 * API reference:
 *   GET /channels?part=statistics&id={channelId}&key={apiKey}
 *   GET /search?part=snippet&channelId={channelId}&order=date&type=video&maxResults={n}&key={apiKey}
 *   GET /videos?part=statistics,contentDetails,snippet&id={ids}&key={apiKey}
 */

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

/**
 * Parses an ISO 8601 duration string (e.g. PT1M30S) into total seconds.
 *
 * @param {string} duration - ISO 8601 duration string
 * @returns {number} Total seconds
 */
function parseDurationSeconds(duration) {
  if (!duration) return 0;
  // Matches optional hours (H), minutes (M), seconds (S)
  const match = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return 0;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Fetch channel-level statistics.
 *
 * @param {string} apiKey    - YouTube Data API v3 key
 * @param {string} channelId - YouTube channel ID
 * @returns {Promise<{ subscriberCount: number, viewCount: number, videoCount: number }>}
 */
async function fetchChannelStats(apiKey, channelId) {
  if (!apiKey) throw new Error('apiKey is required');
  if (!channelId) throw new Error('channelId is required');

  const url =
    `${YOUTUBE_API_BASE}/channels` +
    `?part=statistics&id=${encodeURIComponent(channelId)}&key=${encodeURIComponent(apiKey)}`;

  console.log(`[youtube] Fetching channel stats for channelId=${channelId}`);

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`YouTube API ${res.status} for channels: ${text}`);
  }

  const json = await res.json();
  if (json.error) {
    throw new Error(`YouTube API error: ${json.error.code} — ${json.error.message}`);
  }

  const item = json.items?.[0];
  if (!item) {
    throw new Error(`YouTube channels API returned no items for channelId=${channelId}`);
  }

  const stats = item.statistics || {};
  const result = {
    subscriberCount: parseInt(stats.subscriberCount || '0', 10),
    viewCount: parseInt(stats.viewCount || '0', 10),
    videoCount: parseInt(stats.videoCount || '0', 10),
  };

  console.log(
    `[youtube] Channel stats: subscribers=${result.subscriberCount} ` +
      `views=${result.viewCount} videos=${result.videoCount}`
  );

  return result;
}

/**
 * Fetch the most recent videos for a channel via the Search API.
 *
 * @param {string} apiKey    - YouTube Data API v3 key
 * @param {string} channelId - YouTube channel ID
 * @param {number} [maxResults=20] - Maximum number of results (1–50)
 * @returns {Promise<Array<{ videoId: string, snippet: object }>>}
 */
async function fetchRecentVideos(apiKey, channelId, maxResults) {
  if (!apiKey) throw new Error('apiKey is required');
  if (!channelId) throw new Error('channelId is required');

  const limit = maxResults || 20;
  const url =
    `${YOUTUBE_API_BASE}/search` +
    `?part=snippet` +
    `&channelId=${encodeURIComponent(channelId)}` +
    `&order=date` +
    `&type=video` +
    `&maxResults=${limit}` +
    `&key=${encodeURIComponent(apiKey)}`;

  console.log(`[youtube] Fetching recent videos: channelId=${channelId} maxResults=${limit}`);

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`YouTube API ${res.status} for search: ${text}`);
  }

  const json = await res.json();
  if (json.error) {
    throw new Error(`YouTube API error: ${json.error.code} — ${json.error.message}`);
  }

  const items = json.items ?? [];
  const videos = items.map((item) => ({
    videoId: item.id?.videoId || '',
    snippet: item.snippet || {},
  })).filter((v) => v.videoId);

  console.log(`[youtube] Retrieved ${videos.length} video IDs from search`);
  return videos;
}

/**
 * Fetch per-video statistics, content details, and snippet for a batch of video IDs.
 *
 * @param {string}   apiKey   - YouTube Data API v3 key
 * @param {string[]} videoIds - Array of YouTube video IDs (max 50 per request)
 * @returns {Promise<object[]>} Array of video resource objects with statistics, contentDetails, snippet
 */
async function fetchVideoStats(apiKey, videoIds) {
  if (!apiKey) throw new Error('apiKey is required');
  if (!Array.isArray(videoIds) || videoIds.length === 0) return [];

  const ids = videoIds.join(',');
  const url =
    `${YOUTUBE_API_BASE}/videos` +
    `?part=statistics,contentDetails,snippet` +
    `&id=${encodeURIComponent(ids)}` +
    `&key=${encodeURIComponent(apiKey)}`;

  console.log(`[youtube] Fetching video stats for ${videoIds.length} video(s)`);

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`YouTube API ${res.status} for videos: ${text}`);
  }

  const json = await res.json();
  if (json.error) {
    throw new Error(`YouTube API error: ${json.error.code} — ${json.error.message}`);
  }

  const items = json.items ?? [];

  return items.map((item) => {
    const stats = item.statistics || {};
    const details = item.contentDetails || {};
    const snippet = item.snippet || {};
    const durationSeconds = parseDurationSeconds(details.duration || '');
    const isShort = durationSeconds > 0 && durationSeconds <= 60;

    return {
      videoId: item.id,
      duration: details.duration || null,
      durationSeconds,
      isShort,
      viewCount: parseInt(stats.viewCount || '0', 10),
      likeCount: parseInt(stats.likeCount || '0', 10),
      commentCount: parseInt(stats.commentCount || '0', 10),
      favoriteCount: parseInt(stats.favoriteCount || '0', 10),
      title: snippet.title || '',
      publishedAt: snippet.publishedAt || null,
      channelId: snippet.channelId || '',
      description: snippet.description || '',
      tags: snippet.tags || [],
    };
  });
}

/**
 * Main polling entry point.
 *
 * Fetches recent videos for the configured channel, retrieves per-video stats,
 * identifies Shorts by duration (<= 60s), normalizes each record, and upserts
 * into the analytics database. Also records a channel subscriber snapshot.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Promise<void>}
 */
async function pollYouTube(db) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error('YOUTUBE_API_KEY environment variable is required');
  }

  const channelId = process.env.YOUTUBE_CHANNEL_ID;
  if (!channelId) {
    throw new Error('YOUTUBE_CHANNEL_ID environment variable is required');
  }

  // Lazy-require sibling modules so they can be built/tested independently.
  const { normalizeYouTubeMetric } = require('../normalizer');
  const { upsertMetric, upsertFollowerSnapshot } = require('../store');

  // Fetch channel stats and recent video list in parallel.
  const [channelStats, recentVideos] = await Promise.all([
    fetchChannelStats(apiKey, channelId),
    fetchRecentVideos(apiKey, channelId, 20),
  ]);

  const fetchedAt = new Date().toISOString();
  const today = fetchedAt.slice(0, 10);

  if (recentVideos.length > 0) {
    const videoIds = recentVideos.map((v) => v.videoId);
    const videoStats = await fetchVideoStats(apiKey, videoIds);

    // Build a lookup by videoId for O(1) access.
    const statsById = {};
    for (const stat of videoStats) {
      statsById[stat.videoId] = stat;
    }

    for (const { videoId, snippet } of recentVideos) {
      const stat = statsById[videoId] || {};
      const isShort = stat.isShort || false;
      const publishedAt = stat.publishedAt || snippet.publishedAt || null;
      const metricDate = publishedAt ? publishedAt.slice(0, 10) : today;

      const raw = {
        id: videoId,
        isShort,
        content_type: isShort ? 'short' : 'video',
        publishedAt,
        metric_date: metricDate,
        channelId,
        title: stat.title || snippet.title || '',
        duration: stat.duration || null,
        statistics: {
          viewCount: stat.viewCount ?? 0,
          likeCount: stat.likeCount ?? 0,
          commentCount: stat.commentCount ?? 0,
          favoriteCount: stat.favoriteCount ?? 0,
        },
      };

      const normalized = normalizeYouTubeMetric(raw);
      upsertMetric(db, normalized);

      console.log(
        `[youtube] Upserted ${isShort ? 'Short' : 'video'} id=${videoId} ` +
          `views=${stat.viewCount ?? 0} likes=${stat.likeCount ?? 0} ` +
          `comments=${stat.commentCount ?? 0} date=${metricDate}`
      );
    }

    console.log(`[youtube] Upserted ${recentVideos.length} video metric records`);
  } else {
    console.log('[youtube] No recent videos found');
  }

  // Record channel subscriber snapshot.
  const subscriberCount = channelStats.subscriberCount ?? 0;
  upsertFollowerSnapshot(db, {
    platform: 'youtube',
    follower_count: subscriberCount,
    snapshot_date: today,
  });

  console.log(
    `[youtube] Follower snapshot upserted: platform=youtube ` +
      `subscriber_count=${subscriberCount} date=${today}`
  );
}

module.exports = { fetchChannelStats, fetchRecentVideos, fetchVideoStats, pollYouTube };

// ---------------------------------------------------------------------------
// Stand-alone execution
// ---------------------------------------------------------------------------
if (require.main === module) {
  const { initDb } = require('../store');

  const db = initDb();

  pollYouTube(db)
    .then(() => {
      console.log('[youtube] Poll complete.');
      db.close();
    })
    .catch((err) => {
      console.error('[youtube] Poll failed:', err.message);
      db.close();
      process.exit(1);
    });
}
