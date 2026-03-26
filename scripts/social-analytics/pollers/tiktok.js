'use strict';

/**
 * tiktok.js
 * Polls TikTok Content Posting API v2 for video engagement data.
 *
 * Required env vars:
 *   TIKTOK_ACCESS_TOKEN  — OAuth 2.0 access token with required scopes (required)
 *
 * Scopes needed: video.list, user.info.basic, user.info.stats
 */

const path = require('path');

const TIKTOK_API_BASE = 'https://open.tiktokapis.com';

/**
 * Fetch the authenticated user's recent videos.
 *
 * @param {string} token - TikTok OAuth access token
 * @returns {Promise<object[]>} Array of video objects
 */
async function fetchTikTokVideos(token) {
  if (!token) {
    throw new Error('TIKTOK_ACCESS_TOKEN is required');
  }

  const url = `${TIKTOK_API_BASE}/v2/video/list/`;
  const body = {
    max_count: 20,
    fields: ['id', 'title', 'view_count', 'like_count', 'comment_count', 'share_count', 'create_time', 'duration'],
  };

  console.log('[tiktok] Fetching video list');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`TikTok API ${res.status} for ${url}: ${text}`);
  }

  const json = await res.json();

  if (json.error && json.error.code !== 'ok') {
    throw new Error(`TikTok API error: ${json.error.code} — ${json.error.message}`);
  }

  const videos = json.data?.videos ?? [];
  console.log(`[tiktok] Retrieved ${videos.length} videos`);
  return videos;
}

/**
 * Fetch the authenticated user's profile stats.
 *
 * @param {string} token - TikTok OAuth access token
 * @returns {Promise<object>} User info object with follower_count, likes_count, video_count
 */
async function fetchTikTokUserInfo(token) {
  if (!token) {
    throw new Error('TIKTOK_ACCESS_TOKEN is required');
  }

  const url = `${TIKTOK_API_BASE}/v2/user/info/?fields=follower_count,likes_count,video_count`;

  console.log('[tiktok] Fetching user info');

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`TikTok API ${res.status} for ${url}: ${text}`);
  }

  const json = await res.json();

  if (json.error && json.error.code !== 'ok') {
    throw new Error(`TikTok API error: ${json.error.code} — ${json.error.message}`);
  }

  const userInfo = json.data?.user ?? {};
  console.log(
    `[tiktok] User info: follower_count=${userInfo.follower_count} ` +
      `likes_count=${userInfo.likes_count} video_count=${userInfo.video_count}`
  );
  return userInfo;
}

/**
 * Main polling entry point.
 *
 * Fetches TikTok videos and user info, normalizes each video record,
 * and upserts into the analytics database. Also records a follower snapshot.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Promise<void>}
 */
async function pollTikTok(db) {
  const token = process.env.TIKTOK_ACCESS_TOKEN;
  if (!token) {
    throw new Error('TIKTOK_ACCESS_TOKEN environment variable is required');
  }

  const [videos, userInfo] = await Promise.all([
    fetchTikTokVideos(token),
    fetchTikTokUserInfo(token),
  ]);

  // Lazy-require sibling modules so they can be built/tested independently.
  const { normalizeTikTokMetric: normalizeMetric } = require('../normalizer');
  const { upsertMetric, upsertFollowerSnapshot } = require('../store');

  const fetchedAt = new Date().toISOString();
  const today = fetchedAt.slice(0, 10);

  for (const video of videos) {
    // create_time is a Unix timestamp (seconds); convert to ISO date string.
    const publishedDate = video.create_time
      ? new Date(video.create_time * 1000).toISOString()
      : null;
    const metricDate = publishedDate ? publishedDate.slice(0, 10) : today;

    const raw = {
      platform: 'tiktok',
      content_type: 'video',
      post_id: video.id,
      post_url: null,
      published_at: publishedDate,
      metric_date: metricDate,
      video_views: video.view_count ?? 0,
      likes: video.like_count ?? 0,
      comments: video.comment_count ?? 0,
      shares: video.share_count ?? 0,
      impressions: 0,
      reach: 0,
      saves: 0,
      clicks: 0,
      followers_delta: 0,
      extra_json: JSON.stringify({ title: video.title ?? '', duration: video.duration ?? 0 }),
      fetched_at: fetchedAt,
    };

    const normalized = normalizeMetric(raw);
    upsertMetric(db, normalized);

    console.log(
      `[tiktok] Upserted video id=${video.id} ` +
        `views=${video.view_count} likes=${video.like_count} ` +
        `comments=${video.comment_count} shares=${video.share_count} ` +
        `date=${metricDate}`
    );
  }

  console.log(`[tiktok] Upserted ${videos.length} video metric records`);

  // Record follower snapshot.
  const followerCount = userInfo.follower_count ?? 0;
  upsertFollowerSnapshot(db, {
    platform: 'tiktok',
    follower_count: followerCount,
    snapshot_date: today,
  });

  console.log(
    `[tiktok] Follower snapshot upserted: platform=tiktok ` +
      `follower_count=${followerCount} date=${today}`
  );
}

module.exports = { fetchTikTokVideos, fetchTikTokUserInfo, pollTikTok };

// ---------------------------------------------------------------------------
// Stand-alone execution
// ---------------------------------------------------------------------------
if (require.main === module) {
  const { initDb } = require('../store');

  const db = initDb();

  pollTikTok(db)
    .then(() => {
      console.log('[tiktok] Poll complete.');
      db.close();
    })
    .catch((err) => {
      console.error('[tiktok] Poll failed:', err.message);
      db.close();
      process.exit(1);
    });
}
