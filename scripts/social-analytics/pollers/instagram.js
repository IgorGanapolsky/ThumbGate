'use strict';

/**
 * Instagram engagement poller using the Instagram Graph API v21.0.
 *
 * Required environment variables:
 *   INSTAGRAM_ACCESS_TOKEN  — long-lived page/user access token
 *   INSTAGRAM_USER_ID       — Instagram business/creator account user ID
 */

const { normalize } = require('../normalizer');
const { upsertMetric, upsertFollowerSnapshot, initDb } = require('../store');

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';

// Map Instagram media_type to our normalised content_type.
const MEDIA_TYPE_MAP = {
  CAROUSEL_ALBUM: 'carousel',
  IMAGE: 'image',
  VIDEO: 'reel',
};

/**
 * Fetches the most recent 25 media items for a user.
 *
 * @param {string} token  - Instagram access token.
 * @param {string} userId - Instagram user ID.
 * @returns {Promise<object[]>} Array of media objects.
 */
async function fetchInstagramMedia(token, userId) {
  const fields = [
    'id',
    'caption',
    'media_type',
    'permalink',
    'timestamp',
    'like_count',
    'comments_count',
    'children{media_type,media_url}',
  ].join(',');

  const url =
    `${GRAPH_BASE}/${userId}/media` +
    `?fields=${fields}&limit=25&access_token=${token}`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fetchInstagramMedia HTTP ${res.status}: ${body}`);
  }

  const json = await res.json();
  if (json.error) {
    throw new Error(`fetchInstagramMedia API error: ${JSON.stringify(json.error)}`);
  }

  return json.data ?? [];
}

/**
 * Fetches insights for a single media item.
 * Some media types (e.g. stories) do not support all metrics — errors are
 * caught and logged so polling continues for other posts.
 *
 * @param {string} token   - Instagram access token.
 * @param {string} mediaId - Instagram media ID.
 * @returns {Promise<object>} Map of metric name -> value (defaults to 0 on error).
 */
async function fetchMediaInsights(token, mediaId) {
  const metrics = 'impressions,reach,saved,shares';
  const url =
    `${GRAPH_BASE}/${mediaId}/insights` +
    `?metric=${metrics}&access_token=${token}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      console.warn(`fetchMediaInsights HTTP ${res.status} for ${mediaId}: ${body}`);
      return {};
    }

    const json = await res.json();
    if (json.error) {
      // Some media types (Reels, Stories older than 24 h, etc.) return errors
      // for certain metrics. Log and return an empty result rather than throw.
      console.warn(
        `fetchMediaInsights API warning for ${mediaId}: ${JSON.stringify(json.error)}`
      );
      return {};
    }

    // Reshape array of { name, values } -> flat { name: value }
    const result = {};
    for (const item of json.data ?? []) {
      // Instagram returns period-scoped values; take the first value entry.
      const val = Array.isArray(item.values) ? item.values[0]?.value : item.value;
      result[item.name] = typeof val === 'number' ? val : 0;
    }
    return result;
  } catch (err) {
    console.warn(`fetchMediaInsights error for ${mediaId}: ${err.message}`);
    return {};
  }
}

/**
 * Fetches account-level insights: reach, impressions, follower_count.
 *
 * @param {string} token  - Instagram access token.
 * @param {string} userId - Instagram user ID.
 * @param {string} since  - Unix timestamp string (start of window).
 * @param {string} until  - Unix timestamp string (end of window).
 * @returns {Promise<object[]>} Raw data array from the API response.
 */
async function fetchAccountInsights(token, userId, since, until) {
  const metrics = 'reach,impressions,follower_count';
  const url =
    `${GRAPH_BASE}/${userId}/insights` +
    `?metric=${metrics}&period=day&since=${since}&until=${until}&access_token=${token}`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fetchAccountInsights HTTP ${res.status}: ${body}`);
  }

  const json = await res.json();
  if (json.error) {
    throw new Error(
      `fetchAccountInsights API error: ${JSON.stringify(json.error)}`
    );
  }

  return json.data ?? [];
}

/**
 * Main entry point. Polls Instagram for recent media and account insights,
 * normalises the data, and upserts it into the local SQLite database.
 *
 * @param {import('better-sqlite3').Database} db - Initialised db instance.
 */
async function pollInstagram(db) {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  const userId = process.env.INSTAGRAM_USER_ID;

  if (!token) throw new Error('INSTAGRAM_ACCESS_TOKEN is not set');
  if (!userId) throw new Error('INSTAGRAM_USER_ID is not set');

  const fetchedAt = new Date().toISOString();
  const today = fetchedAt.slice(0, 10);

  console.log(`[instagram] Fetching media for user ${userId}…`);
  const mediaItems = await fetchInstagramMedia(token, userId);
  console.log(`[instagram] Got ${mediaItems.length} media items`);

  for (const item of mediaItems) {
    const mediaId = item.id;

    // Fetch per-post insights (best-effort; some types may not support all).
    const insights = await fetchMediaInsights(token, mediaId);

    const rawContentType = MEDIA_TYPE_MAP[item.media_type] ?? 'image';

    // Build a raw record compatible with the normalizer contract.
    const raw = {
      platform: 'instagram',
      content_type: rawContentType,
      post_id: mediaId,
      post_url: item.permalink ?? null,
      published_at: item.timestamp ?? null,
      metric_date: today,
      impressions: insights.impressions ?? 0,
      reach: insights.reach ?? 0,
      likes: item.like_count ?? 0,
      comments: item.comments_count ?? 0,
      shares: insights.shares ?? 0,
      saves: insights.saved ?? 0,
      clicks: 0,
      video_views: 0,
      followers_delta: 0,
      fetched_at: fetchedAt,
      extra_json: {
        media_type: item.media_type,
        caption_snippet: (item.caption ?? '').slice(0, 120),
        children_count: item.children?.data?.length ?? null,
      },
    };

    const normalised = normalize(raw);
    upsertMetric(db, normalised);
    console.log(`[instagram] Upserted metric for post ${mediaId} (${rawContentType})`);
  }

  // Fetch account-level follower count for today's snapshot.
  const nowTs = Math.floor(Date.now() / 1000);
  const dayAgoTs = nowTs - 86400;

  try {
    console.log('[instagram] Fetching account insights for follower snapshot…');
    const accountData = await fetchAccountInsights(
      token,
      userId,
      String(dayAgoTs),
      String(nowTs)
    );

    // Find the follower_count series and take the latest value.
    const followerSeries = accountData.find((d) => d.name === 'follower_count');
    if (followerSeries) {
      const latestEntry = (followerSeries.values ?? []).slice(-1)[0];
      const followerCount = latestEntry?.value ?? 0;

      upsertFollowerSnapshot(db, {
        platform: 'instagram',
        follower_count: followerCount,
        snapshot_date: today,
      });
      console.log(`[instagram] Upserted follower snapshot: ${followerCount} followers`);
    } else {
      console.warn('[instagram] follower_count not found in account insights response');
    }
  } catch (err) {
    // Account insights failure should not abort per-post metric storage.
    console.warn(`[instagram] Account insights error (non-fatal): ${err.message}`);
  }

  console.log('[instagram] Poll complete.');
}

module.exports = {
  fetchInstagramMedia,
  fetchMediaInsights,
  fetchAccountInsights,
  pollInstagram,
};

// Allow running directly: node scripts/social-analytics/pollers/instagram.js
if (require.main === module) {
  (async () => {
    const { initDb } = require('../store');
    const db = initDb();
    try {
      await pollInstagram(db);
    } catch (err) {
      console.error('[instagram] Fatal error:', err.message);
      process.exit(1);
    } finally {
      db.close();
    }
  })();
}
