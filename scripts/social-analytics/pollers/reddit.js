'use strict';

/**
 * reddit.js
 * Polls the Reddit API (OAuth2 password flow) for user post engagement data.
 *
 * Required env vars:
 *   REDDIT_CLIENT_ID      — OAuth2 application client ID (required)
 *   REDDIT_CLIENT_SECRET  — OAuth2 application client secret (required)
 *   REDDIT_USERNAME       — Reddit account username (required)
 *   REDDIT_PASSWORD       — Reddit account password (required)
 *   REDDIT_USER_AGENT     — Custom User-Agent string (default: mcp-memory-gateway/1.0 by <username>)
 *
 * Reddit API reference:
 *   POST https://www.reddit.com/api/v1/access_token  — token exchange
 *   GET  https://oauth.reddit.com/user/{username}/submitted
 *   GET  https://oauth.reddit.com/api/info
 *   GET  https://oauth.reddit.com/api/v1/me
 */

const REDDIT_API_BASE = 'https://oauth.reddit.com';
const REDDIT_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';

/**
 * Exchange Reddit credentials for an OAuth2 access token using the password grant flow.
 *
 * @param {string} clientId
 * @param {string} clientSecret
 * @param {string} username
 * @param {string} password
 * @returns {Promise<string>} access_token
 */
async function getRedditToken(clientId, clientSecret, username, password) {
  if (!clientId) throw new Error('clientId is required');
  if (!clientSecret) throw new Error('clientSecret is required');
  if (!username) throw new Error('username is required');
  if (!password) throw new Error('password is required');

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'password',
    username,
    password,
  });

  console.log('[reddit] Fetching access token');

  const res = await fetch(REDDIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': `mcp-memory-gateway/1.0 by ${username}`,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Reddit token endpoint ${res.status}: ${text}`);
  }

  const json = await res.json();

  if (json.error) {
    throw new Error(`Reddit token error: ${json.error} — ${json.message || ''}`);
  }

  const token = json.access_token;
  if (!token) {
    throw new Error(`Reddit token response missing access_token: ${JSON.stringify(json)}`);
  }

  console.log('[reddit] Access token obtained');
  return token;
}

/**
 * Fetch the user's most recent submitted posts (up to 25).
 *
 * @param {string} token - Reddit OAuth2 access token
 * @param {string} username - Reddit username
 * @param {string} userAgent - User-Agent header value
 * @returns {Promise<object[]>} Array of post data objects
 */
async function fetchUserPosts(token, username, userAgent) {
  if (!token) throw new Error('token is required');
  if (!username) throw new Error('username is required');

  const url = `${REDDIT_API_BASE}/user/${encodeURIComponent(username)}/submitted?sort=new&limit=25`;

  console.log(`[reddit] Fetching submitted posts for u/${username}`);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': userAgent,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Reddit API ${res.status} for ${url}: ${text}`);
  }

  const json = await res.json();
  const posts = json.data?.children?.map((child) => child.data) ?? [];

  console.log(`[reddit] Retrieved ${posts.length} posts`);
  return posts;
}

/**
 * Fetch detailed metrics for a single post by its base-36 post ID.
 *
 * @param {string} token - Reddit OAuth2 access token
 * @param {string} postId - Reddit post ID (base-36, e.g. "abc123")
 * @param {string} userAgent - User-Agent header value
 * @returns {Promise<object|null>} Post data object, or null if not found
 */
async function fetchPostDetails(token, postId, userAgent) {
  if (!token) throw new Error('token is required');
  if (!postId) throw new Error('postId is required');

  const url = `${REDDIT_API_BASE}/api/info?id=t3_${postId}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': userAgent,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Reddit API ${res.status} for ${url}: ${text}`);
  }

  const json = await res.json();
  const items = json.data?.children ?? [];
  return items.length > 0 ? items[0].data : null;
}

/**
 * Fetch the authenticated user's karma breakdown from /api/v1/me.
 *
 * @param {string} token - Reddit OAuth2 access token
 * @param {string} userAgent - User-Agent header value
 * @returns {Promise<{ link_karma: number, comment_karma: number, total_karma: number }>}
 */
async function fetchUserKarma(token, userAgent) {
  if (!token) throw new Error('token is required');

  const url = `${REDDIT_API_BASE}/api/v1/me`;

  console.log('[reddit] Fetching user karma from /api/v1/me');

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': userAgent,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Reddit API ${res.status} for ${url}: ${text}`);
  }

  const json = await res.json();

  const linkKarma = json.link_karma ?? 0;
  const commentKarma = json.comment_karma ?? 0;
  const totalKarma = json.total_karma ?? linkKarma + commentKarma;

  console.log(
    `[reddit] Karma: link_karma=${linkKarma} comment_karma=${commentKarma} total=${totalKarma}`
  );

  return { link_karma: linkKarma, comment_karma: commentKarma, total_karma: totalKarma };
}

/**
 * Main polling entry point.
 *
 * Obtains an OAuth2 token, fetches the user's recent posts and karma, normalizes
 * each post record, and upserts into the analytics database. Also records a
 * follower snapshot using total karma as the follower-equivalent metric.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Promise<void>}
 */
async function pollReddit(db) {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  const username = process.env.REDDIT_USERNAME;
  const password = process.env.REDDIT_PASSWORD;
  const userAgent =
    process.env.REDDIT_USER_AGENT || `mcp-memory-gateway/1.0 by ${username}`;

  if (!clientId) throw new Error('REDDIT_CLIENT_ID environment variable is required');
  if (!clientSecret) throw new Error('REDDIT_CLIENT_SECRET environment variable is required');
  if (!username) throw new Error('REDDIT_USERNAME environment variable is required');
  if (!password) throw new Error('REDDIT_PASSWORD environment variable is required');

  const token = await getRedditToken(clientId, clientSecret, username, password);

  const [posts, karma] = await Promise.all([
    fetchUserPosts(token, username, userAgent),
    fetchUserKarma(token, userAgent),
  ]);

  // Lazy-require sibling modules so they can be built/tested independently.
  const { normalizeMetric } = require('../normalizer');
  const { upsertMetric, upsertFollowerSnapshot } = require('../store');

  const fetchedAt = new Date().toISOString();
  const today = fetchedAt.slice(0, 10);

  for (const post of posts) {
    const postId = String(post.id || '');
    if (!postId) continue;

    // created_utc is a Unix timestamp (seconds).
    const publishedAt = post.created_utc
      ? new Date(post.created_utc * 1000).toISOString()
      : null;
    const metricDate = publishedAt ? publishedAt.slice(0, 10) : today;

    const extraPayload = {
      upvote_ratio: post.upvote_ratio ?? null,
      subreddit: post.subreddit ?? null,
    };
    if (post.title) extraPayload.title = post.title;
    if (post.url) extraPayload.url = post.url;

    const raw = {
      platform: 'reddit',
      content_type: post.is_self === false ? 'link' : 'post',
      post_id: postId,
      post_url: post.permalink ? `https://www.reddit.com${post.permalink}` : null,
      published_at: publishedAt,
      metric_date: metricDate,
      // score = upvotes - downvotes (Reddit's net engagement signal)
      likes: post.score ?? 0,
      comments: post.num_comments ?? 0,
      // Reddit does not expose view counts via the API for regular users
      impressions: 0,
      reach: 0,
      shares: 0,
      saves: 0,
      clicks: 0,
      video_views: 0,
      followers_delta: 0,
      extra_json: JSON.stringify(extraPayload),
      fetched_at: fetchedAt,
    };

    const normalized = normalizeMetric(raw);
    upsertMetric(db, normalized);

    console.log(
      `[reddit] Upserted post id=${postId} subreddit=${post.subreddit} ` +
        `score=${post.score} comments=${post.num_comments} ` +
        `upvote_ratio=${post.upvote_ratio} date=${metricDate}`
    );
  }

  console.log(`[reddit] Upserted ${posts.length} post metric records`);

  // Record follower snapshot — total karma serves as Reddit's engagement proxy.
  const totalKarma = karma.total_karma;
  upsertFollowerSnapshot(db, {
    platform: 'reddit',
    follower_count: totalKarma,
    snapshot_date: today,
  });

  console.log(
    `[reddit] Follower snapshot upserted: platform=reddit ` +
      `follower_count(karma)=${totalKarma} date=${today}`
  );
}

module.exports = { getRedditToken, fetchUserPosts, fetchPostDetails, fetchUserKarma, pollReddit };

// ---------------------------------------------------------------------------
// Stand-alone execution
// ---------------------------------------------------------------------------
if (require.main === module) {
  const { initDb } = require('../store');

  const db = initDb();

  pollReddit(db)
    .then(() => {
      console.log('[reddit] Poll complete.');
      db.close();
    })
    .catch((err) => {
      console.error('[reddit] Poll failed:', err.message);
      db.close();
      process.exit(1);
    });
}
