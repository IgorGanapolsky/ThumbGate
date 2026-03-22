'use strict';

/**
 * Threads engagement poller using the Threads API (Meta, launched June 2024).
 *
 * Threads API base: https://graph.threads.net/v1.0
 * Authentication: Meta OAuth (Threads Login). Long-lived tokens last 60 days.
 *
 * Required environment variables:
 *   THREADS_ACCESS_TOKEN — long-lived Threads user access token
 *   THREADS_USER_ID      — Threads user ID (numeric string)
 *
 * Handle: @igor.ganapolsky
 */

const { upsertMetric, upsertFollowerSnapshot, initDb } = require('../store');

const THREADS_BASE = 'https://graph.threads.net/v1.0';

/**
 * Fetches the most recent 25 threads for a user.
 *
 * @param {string} token  - Threads access token.
 * @param {string} userId - Threads user ID.
 * @returns {Promise<object[]>} Array of thread objects.
 */
async function fetchThreadsPosts(token, userId) {
  const fields = [
    'id',
    'text',
    'timestamp',
    'media_type',
    'permalink',
    'is_reply',
    'likes',
    'replies',
    'reposts',
    'quotes',
  ].join(',');

  const url =
    `${THREADS_BASE}/${userId}/threads` +
    `?fields=${fields}&limit=25&access_token=${token}`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fetchThreadsPosts HTTP ${res.status}: ${body}`);
  }

  const json = await res.json();
  if (json.error) {
    throw new Error(`fetchThreadsPosts API error: ${JSON.stringify(json.error)}`);
  }

  return json.data ?? [];
}

/**
 * Fetches insights for a single thread (post-level metrics).
 * Errors are caught and logged so polling continues for other threads.
 *
 * @param {string} token   - Threads access token.
 * @param {string} mediaId - Threads post ID.
 * @returns {Promise<object>} Map of metric name -> value (defaults to 0 on error).
 */
async function fetchThreadsInsights(token, mediaId) {
  const url =
    `${THREADS_BASE}/${mediaId}/insights` +
    `?metric=views,likes,replies,reposts,quotes&access_token=${token}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      console.warn(`fetchThreadsInsights HTTP ${res.status} for ${mediaId}: ${body}`);
      return {};
    }

    const json = await res.json();
    if (json.error) {
      console.warn(
        `fetchThreadsInsights API warning for ${mediaId}: ${JSON.stringify(json.error)}`
      );
      return {};
    }

    // Reshape array of { name, values } -> flat { name: value }
    const result = {};
    for (const item of json.data ?? []) {
      const val = Array.isArray(item.values) ? item.values[0]?.value : item.value;
      result[item.name] = typeof val === 'number' ? val : 0;
    }
    return result;
  } catch (err) {
    console.warn(`fetchThreadsInsights error for ${mediaId}: ${err.message}`);
    return {};
  }
}

/**
 * Fetches the Threads user profile including follower count.
 *
 * @param {string} token  - Threads access token.
 * @param {string} userId - Threads user ID.
 * @returns {Promise<object>} Profile object with id, username, followers_count, etc.
 */
async function fetchThreadsProfile(token, userId) {
  const url =
    `${THREADS_BASE}/${userId}` +
    `?fields=id,username,threads_profile_picture_url,threads_biography,followers_count` +
    `&access_token=${token}`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fetchThreadsProfile HTTP ${res.status}: ${body}`);
  }

  const json = await res.json();
  if (json.error) {
    throw new Error(`fetchThreadsProfile API error: ${JSON.stringify(json.error)}`);
  }

  return json;
}

/**
 * Main entry point. Polls Threads for recent posts and profile data,
 * normalises the data, and upserts it into the local SQLite database.
 *
 * @param {import('better-sqlite3').Database} db - Initialised db instance.
 */
async function pollThreads(db) {
  const token = process.env.THREADS_ACCESS_TOKEN;
  const userId = process.env.THREADS_USER_ID;

  if (!token) throw new Error('THREADS_ACCESS_TOKEN is not set');
  if (!userId) throw new Error('THREADS_USER_ID is not set');

  const fetchedAt = new Date().toISOString();
  const today = fetchedAt.slice(0, 10);

  console.log(`[threads] Fetching posts for user ${userId}…`);
  const posts = await fetchThreadsPosts(token, userId);
  console.log(`[threads] Got ${posts.length} thread posts`);

  for (const post of posts) {
    const postId = post.id;

    // Fetch per-post insights (best-effort; not all post types support all metrics).
    const insights = await fetchThreadsInsights(token, postId);

    // Threads API returns likes/replies/reposts/quotes both on the post object
    // and via insights. Prefer insights values when available; fall back to
    // the top-level fields returned by the posts endpoint.
    const likes = insights.likes ?? post.likes ?? 0;
    const replies = insights.replies ?? post.replies ?? 0;
    const reposts = insights.reposts ?? post.reposts ?? 0;
    const quotes = insights.quotes ?? post.quotes ?? 0;
    const views = insights.views ?? 0;

    const raw = {
      platform: 'threads',
      content_type: 'thread',
      post_id: postId,
      post_url: post.permalink ?? null,
      published_at: post.timestamp ?? null,
      metric_date: today,
      impressions: views,
      reach: 0,
      likes: likes,
      comments: replies,
      shares: reposts + quotes,
      saves: 0,
      clicks: 0,
      video_views: 0,
      followers_delta: 0,
      fetched_at: fetchedAt,
      extra_json: JSON.stringify({
        media_type: post.media_type ?? null,
        is_reply: post.is_reply ?? false,
        text_snippet: (post.text ?? '').slice(0, 120),
        reposts,
        quotes,
      }),
    };

    upsertMetric(db, raw);
    console.log(`[threads] Upserted metric for post ${postId}`);
  }

  // Fetch profile for follower snapshot.
  try {
    console.log('[threads] Fetching profile for follower snapshot…');
    const profile = await fetchThreadsProfile(token, userId);
    const followerCount = profile.followers_count ?? 0;

    upsertFollowerSnapshot(db, {
      platform: 'threads',
      follower_count: followerCount,
      snapshot_date: today,
    });
    console.log(`[threads] Upserted follower snapshot: ${followerCount} followers`);
  } catch (err) {
    // Profile failure should not abort per-post metric storage.
    console.warn(`[threads] Profile fetch error (non-fatal): ${err.message}`);
  }

  console.log('[threads] Poll complete.');
}

module.exports = {
  fetchThreadsPosts,
  fetchThreadsInsights,
  fetchThreadsProfile,
  pollThreads,
};

// Allow running directly: node scripts/social-analytics/pollers/threads.js
if (require.main === module) {
  (async () => {
    const db = initDb();
    try {
      await pollThreads(db);
    } catch (err) {
      console.error('[threads] Fatal error:', err.message);
      process.exit(1);
    } finally {
      db.close();
    }
  })();
}
