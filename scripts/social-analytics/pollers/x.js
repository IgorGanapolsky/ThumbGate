'use strict';

/**
 * x.js
 * Polls X (Twitter) API v2 for tweet engagement data and profile metrics.
 *
 * Required env vars:
 *   X_BEARER_TOKEN  — App-only Bearer Token (required)
 *   X_USER_ID       — Numeric X user ID to poll (required)
 *
 * Rate limits (Basic tier):
 *   User tweet timeline: 10 requests / 15 minutes per app.
 *   User lookup: 300 requests / 15 minutes per app.
 *   Exceeding these limits returns HTTP 429; callers should implement
 *   exponential backoff or schedule polls no more frequently than every
 *   2 minutes to stay within the Basic tier ceiling.
 *
 * X API v2 reference:
 *   GET /2/users/:id/tweets
 *   GET /2/users/:id
 */

const X_API_BASE = 'https://api.twitter.com/2';

/**
 * Fetches the most recent 20 tweets for a user.
 *
 * @param {string} token  - X Bearer Token
 * @param {string} userId - Numeric X user ID
 * @returns {Promise<{ data: object[], includes?: object }>}
 */
async function fetchUserTweets(token, userId) {
  if (!token) throw new Error('X_BEARER_TOKEN is required');
  if (!userId) throw new Error('X_USER_ID is required');

  const params = new URLSearchParams({
    max_results: '20',
    'tweet.fields': 'public_metrics,created_at,text',
    expansions: 'attachments.media_keys',
    'media.fields': 'preview_image_url,type,url',
  });

  const url = `${X_API_BASE}/users/${userId}/tweets?${params}`;

  console.log(`[x:poller] Fetching tweets for user_id=${userId}`);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`X API ${res.status} for ${url}: ${text}`);
  }

  const json = await res.json();

  if (json.errors && !json.data) {
    throw new Error(`X API errors: ${JSON.stringify(json.errors)}`);
  }

  const tweets = json.data ?? [];
  console.log(`[x:poller] Retrieved ${tweets.length} tweets`);
  return { data: tweets, includes: json.includes ?? {} };
}

/**
 * Fetches the public profile metrics for a user.
 *
 * Returns an object with:
 *   followers_count, following_count, tweet_count, listed_count
 *
 * @param {string} token  - X Bearer Token
 * @param {string} userId - Numeric X user ID
 * @returns {Promise<object>} User object including public_metrics field
 */
async function fetchUserProfile(token, userId) {
  if (!token) throw new Error('X_BEARER_TOKEN is required');
  if (!userId) throw new Error('X_USER_ID is required');

  const params = new URLSearchParams({
    'user.fields': 'public_metrics,description,profile_image_url',
  });

  const url = `${X_API_BASE}/users/${userId}?${params}`;

  console.log(`[x:poller] Fetching profile for user_id=${userId}`);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`X API ${res.status} for ${url}: ${text}`);
  }

  const json = await res.json();

  if (json.errors && !json.data) {
    throw new Error(`X API errors: ${JSON.stringify(json.errors)}`);
  }

  const user = json.data ?? {};
  const metrics = user.public_metrics ?? {};
  console.log(
    `[x:poller] Profile: followers=${metrics.followers_count} ` +
      `following=${metrics.following_count} tweets=${metrics.tweet_count} ` +
      `listed=${metrics.listed_count}`
  );
  return user;
}

/**
 * Main polling entry point.
 *
 * Fetches recent tweets and the user profile, normalizes each tweet record,
 * and upserts into the analytics database. Also records a follower snapshot.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Promise<void>}
 */
async function pollX(db) {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) throw new Error('X_BEARER_TOKEN environment variable is required');

  const userId = process.env.X_USER_ID;
  if (!userId) throw new Error('X_USER_ID environment variable is required');

  const [tweetsResult, profile] = await Promise.all([
    fetchUserTweets(token, userId),
    fetchUserProfile(token, userId),
  ]);

  // Lazy-require sibling modules so they can be built/tested independently.
  const { normalizeXMetric: normalizeMetric } = require('../normalizer');
  const { upsertMetric, upsertFollowerSnapshot } = require('../store');

  const fetchedAt = new Date().toISOString();
  const today = fetchedAt.slice(0, 10);
  const tweets = tweetsResult.data;

  for (const tweet of tweets) {
    const metrics = tweet.public_metrics ?? {};

    // Metric mapping per spec:
    //   impressions  = impression_count
    //   likes        = like_count
    //   comments     = reply_count
    //   shares       = retweet_count + quote_count
    //   saves        = bookmark_count
    const raw = {
      id: tweet.id,
      platform: 'x',
      content_type: 'tweet',
      post_id: tweet.id,
      post_url: `https://x.com/i/web/status/${tweet.id}`,
      published_at: tweet.created_at ?? null,
      metric_date: tweet.created_at ? tweet.created_at.slice(0, 10) : today,
      impressions: metrics.impression_count ?? 0,
      reach: 0,
      likes: metrics.like_count ?? 0,
      comments: metrics.reply_count ?? 0,
      shares: (metrics.retweet_count ?? 0) + (metrics.quote_count ?? 0),
      saves: metrics.bookmark_count ?? 0,
      clicks: metrics.url_link_clicks ?? 0,
      video_views: metrics.video_view_count ?? 0,
      followers_delta: 0,
      extra_json: JSON.stringify({ text: (tweet.text ?? '').slice(0, 280) }),
      fetched_at: fetchedAt,
    };

    const normalized = normalizeMetric(raw);
    upsertMetric(db, normalized);

    console.log(
      `[x:poller] Upserted tweet id=${tweet.id} ` +
        `impressions=${metrics.impression_count ?? 0} ` +
        `likes=${metrics.like_count ?? 0} ` +
        `replies=${metrics.reply_count ?? 0} ` +
        `retweets=${metrics.retweet_count ?? 0} ` +
        `bookmarks=${metrics.bookmark_count ?? 0} ` +
        `date=${raw.metric_date}`
    );
  }

  console.log(`[x:poller] Upserted ${tweets.length} tweet metric records`);

  // Record follower snapshot.
  const followersCount = profile.public_metrics?.followers_count ?? 0;
  upsertFollowerSnapshot(db, {
    platform: 'x',
    follower_count: followersCount,
    snapshot_date: today,
  });

  console.log(
    `[x:poller] Follower snapshot upserted: platform=x ` +
      `follower_count=${followersCount} date=${today}`
  );
}

module.exports = { fetchUserTweets, fetchUserProfile, pollX };

// ---------------------------------------------------------------------------
// Stand-alone execution
// ---------------------------------------------------------------------------
if (require.main === module) {
  const { initDb } = require('../store');

  const db = initDb();

  pollX(db)
    .then(() => {
      console.log('[x:poller] Poll complete.');
      db.close();
    })
    .catch((err) => {
      console.error('[x:poller] Poll failed:', err.message);
      db.close();
      process.exit(1);
    });
}
