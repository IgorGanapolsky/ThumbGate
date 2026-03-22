'use strict';

/**
 * LinkedIn engagement poller using the LinkedIn Posts API and related REST endpoints.
 *
 * Required environment variables:
 *   LINKEDIN_ACCESS_TOKEN  — OAuth 2.0 access token with r_liteprofile, r_organization_social,
 *                            and r_1st_connections_size scopes (required)
 *   LINKEDIN_PERSON_URN    — Authenticated member URN, e.g. urn:li:person:XXXXX (required)
 *
 * LinkedIn API references:
 *   Posts API:       https://api.linkedin.com/rest/posts
 *   Social Metadata: https://api.linkedin.com/v2/socialMetadata/{encoded-urn}
 *   Profile:         https://api.linkedin.com/v2/me
 *   Network sizes:   https://api.linkedin.com/v2/networkSizes/{encoded-urn}
 */

const LI_REST_BASE = 'https://api.linkedin.com/rest';
const LI_V2_BASE = 'https://api.linkedin.com/v2';

// Standard headers required by LinkedIn's versioned REST API.
function buildRestHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'LinkedIn-Version': '202401',
    'X-Restli-Protocol-Version': '2.0.0',
  };
}

function buildV2Headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    'X-Restli-Protocol-Version': '2.0.0',
  };
}

/**
 * Safely coerces a value to an integer, returning 0 for null/undefined/NaN.
 * @param {*} v
 * @returns {number}
 */
function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Fetches the most recent posts authored by the authenticated member.
 *
 * Uses the Posts API (LinkedIn-Version: 202401).
 * Returns up to 20 posts sorted by recency.
 *
 * @param {string} token     - LinkedIn OAuth access token.
 * @param {string} personUrn - Member URN, e.g. "urn:li:person:XXXXX".
 * @returns {Promise<object[]>} Array of post objects.
 */
async function fetchLinkedInPosts(token, personUrn) {
  if (!token) throw new Error('fetchLinkedInPosts: token is required');
  if (!personUrn) throw new Error('fetchLinkedInPosts: personUrn is required');

  const url =
    `${LI_REST_BASE}/posts` +
    `?author=${encodeURIComponent(personUrn)}&q=author&count=20`;

  console.log(`[linkedin] Fetching posts for ${personUrn}`);

  const res = await fetch(url, { headers: buildRestHeaders(token) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`fetchLinkedInPosts HTTP ${res.status}: ${body}`);
  }

  const json = await res.json();
  if (json.serviceErrorCode || json.code) {
    throw new Error(`fetchLinkedInPosts API error: ${JSON.stringify(json)}`);
  }

  return json.elements ?? [];
}

/**
 * Fetches share statistics (impressions, likes, comments, shares) for a post.
 *
 * LinkedIn's analytics APIs have significant restrictions for personal accounts vs company pages.
 * Strategy:
 *   1. Try the organizational entity share statistics endpoint (works for company pages).
 *   2. Fall back to /v2/socialMetadata (works for personal member posts).
 *
 * @param {string} token   - LinkedIn OAuth access token.
 * @param {string} postUrn - Post URN, e.g. "urn:li:share:XXXXX" or "urn:li:ugcPost:XXXXX".
 * @returns {Promise<object>} Normalized stats: { impressions, likes, comments, shares }.
 */
async function fetchPostAnalytics(token, postUrn) {
  if (!token) throw new Error('fetchPostAnalytics: token is required');
  if (!postUrn) throw new Error('fetchPostAnalytics: postUrn is required');

  // Attempt 1: Organizational entity share statistics (company pages / pages with analytics).
  const orgStatsUrl =
    `${LI_REST_BASE}/organizationalEntityShareStatistics` +
    `?q=organizationalEntity&shares=List(${encodeURIComponent(postUrn)})`;

  try {
    const res = await fetch(orgStatsUrl, { headers: buildRestHeaders(token) });
    if (res.ok) {
      const json = await res.json();
      const el = (json.elements ?? [])[0];
      if (el) {
        const stats = el.totalShareStatistics ?? {};
        console.log(`[linkedin] Got org share stats for ${postUrn}`);
        return {
          impressions: toInt(stats.impressionCount),
          likes: toInt(stats.likeCount),
          comments: toInt(stats.commentCount),
          shares: toInt(stats.shareCount),
          clicks: toInt(stats.clickCount),
        };
      }
    }
  } catch (err) {
    console.warn(`[linkedin] Org share stats error for ${postUrn} (trying fallback): ${err.message}`);
  }

  // Attempt 2: socialMetadata — available for personal member posts.
  const socialMetaUrl = `${LI_V2_BASE}/socialMetadata/${encodeURIComponent(postUrn)}`;

  try {
    const res = await fetch(socialMetaUrl, { headers: buildV2Headers(token) });
    if (res.ok) {
      const json = await res.json();
      console.log(`[linkedin] Got socialMetadata for ${postUrn}`);
      return {
        impressions: 0, // socialMetadata does not expose impression counts.
        likes: toInt(json.numLikes ?? json.likes?.paging?.total ?? 0),
        comments: toInt(json.numComments ?? json.comments?.paging?.total ?? 0),
        shares: toInt(json.numShares ?? json.shares?.paging?.total ?? 0),
        clicks: 0,
      };
    }
    const body = await res.text().catch(() => '');
    console.warn(`[linkedin] socialMetadata HTTP ${res.status} for ${postUrn}: ${body}`);
  } catch (err) {
    console.warn(`[linkedin] socialMetadata error for ${postUrn}: ${err.message}`);
  }

  // Both endpoints failed — return zeroed stats so polling continues.
  return { impressions: 0, likes: 0, comments: 0, shares: 0, clicks: 0 };
}

/**
 * Fetches the authenticated member's basic profile information.
 *
 * @param {string} token - LinkedIn OAuth access token.
 * @returns {Promise<object>} Profile object with id, localizedFirstName, localizedLastName, etc.
 */
async function fetchLinkedInProfile(token) {
  if (!token) throw new Error('fetchLinkedInProfile: token is required');

  const url = `${LI_V2_BASE}/me`;

  const res = await fetch(url, { headers: buildV2Headers(token) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`fetchLinkedInProfile HTTP ${res.status}: ${body}`);
  }

  const json = await res.json();
  if (json.serviceErrorCode) {
    throw new Error(`fetchLinkedInProfile API error: ${JSON.stringify(json)}`);
  }

  return json;
}

/**
 * Fetches the network/connection size for a member or company.
 *
 * For company pages, uses CompanyFollowedByMember edgeType.
 * For personal accounts the networkSizes endpoint returns connection count
 * using MEMBER_TO_MEMBER_CONNECTION edgeType.
 *
 * LinkedIn limits this to the authenticated member's own network size
 * due to privacy restrictions.
 *
 * @param {string} token     - LinkedIn OAuth access token.
 * @param {string} personUrn - Member or organization URN.
 * @returns {Promise<number>} Follower / connection count.
 */
async function fetchFollowerCount(token, personUrn) {
  if (!token) throw new Error('fetchFollowerCount: token is required');
  if (!personUrn) throw new Error('fetchFollowerCount: personUrn is required');

  // Determine edge type based on URN type.
  const isOrg = personUrn.includes('urn:li:organization:');
  const edgeType = isOrg
    ? 'CompanyFollowedByMember'
    : 'MEMBER_TO_MEMBER_CONNECTION';

  const url =
    `${LI_V2_BASE}/networkSizes/${encodeURIComponent(personUrn)}` +
    `?edgeType=${edgeType}`;

  try {
    const res = await fetch(url, { headers: buildV2Headers(token) });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[linkedin] fetchFollowerCount HTTP ${res.status}: ${body}`);
      return 0;
    }
    const json = await res.json();
    // Response shape: { firstDegreeSize: N } or { followerCount: N }
    return toInt(json.firstDegreeSize ?? json.followerCount ?? 0);
  } catch (err) {
    console.warn(`[linkedin] fetchFollowerCount error: ${err.message}`);
    return 0;
  }
}

/**
 * Main entry point. Polls LinkedIn for recent posts and per-post analytics,
 * normalises the data, and upserts it into the local SQLite database.
 *
 * Also records a follower snapshot for today.
 *
 * @param {import('better-sqlite3').Database} db - Initialised db instance.
 */
async function pollLinkedIn(db) {
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  const personUrn = process.env.LINKEDIN_PERSON_URN;

  if (!token) throw new Error('LINKEDIN_ACCESS_TOKEN is not set');
  if (!personUrn) throw new Error('LINKEDIN_PERSON_URN is not set');

  const { upsertMetric, upsertFollowerSnapshot } = require('../store');

  const fetchedAt = new Date().toISOString();
  const today = fetchedAt.slice(0, 10);

  console.log(`[linkedin] Starting poll for ${personUrn}`);

  const posts = await fetchLinkedInPosts(token, personUrn);
  console.log(`[linkedin] Got ${posts.length} posts`);

  for (const post of posts) {
    // Post URN is at post.id for the Posts API (urn:li:share:... or urn:li:ugcPost:...).
    const postUrn = post.id ?? post.urn ?? '';
    if (!postUrn) {
      console.warn('[linkedin] Post missing id/urn, skipping');
      continue;
    }

    const analytics = await fetchPostAnalytics(token, postUrn);

    // Determine content type: article vs standard post.
    const hasArticle = !!(post.content?.article);
    const contentType = hasArticle ? 'article' : 'post';

    // Published time: Posts API returns createdAt as milliseconds epoch.
    let publishedAt = null;
    if (post.createdAt) {
      publishedAt = new Date(post.createdAt).toISOString();
    }

    const record = {
      platform: 'linkedin',
      content_type: contentType,
      post_id: postUrn,
      post_url: post.content?.article?.source ?? null,
      published_at: publishedAt,
      metric_date: today,
      impressions: analytics.impressions,
      reach: 0,
      likes: analytics.likes,
      comments: analytics.comments,
      shares: analytics.shares,
      saves: 0,
      clicks: analytics.clicks,
      video_views: 0,
      followers_delta: 0,
      extra_json: JSON.stringify({
        commentary_snippet: (post.commentary ?? '').slice(0, 120),
        visibility: post.visibility ?? null,
        lifecycle_state: post.lifecycleState ?? null,
      }),
      fetched_at: fetchedAt,
    };

    upsertMetric(db, record);
    console.log(`[linkedin] Upserted metric for post ${postUrn} (${contentType})`);
  }

  // Follower / connection snapshot.
  try {
    console.log('[linkedin] Fetching follower/connection count…');
    const followerCount = await fetchFollowerCount(token, personUrn);
    upsertFollowerSnapshot(db, {
      platform: 'linkedin',
      follower_count: followerCount,
      snapshot_date: today,
    });
    console.log(`[linkedin] Upserted follower snapshot: ${followerCount}`);
  } catch (err) {
    console.warn(`[linkedin] Follower snapshot error (non-fatal): ${err.message}`);
  }

  console.log('[linkedin] Poll complete.');
}

module.exports = {
  fetchLinkedInPosts,
  fetchPostAnalytics,
  fetchLinkedInProfile,
  fetchFollowerCount,
  pollLinkedIn,
};

// Allow running directly: node scripts/social-analytics/pollers/linkedin.js
if (require.main === module) {
  (async () => {
    const { initDb } = require('../store');
    const db = initDb();
    try {
      await pollLinkedIn(db);
    } catch (err) {
      console.error('[linkedin] Fatal error:', err.message);
      process.exit(1);
    } finally {
      db.close();
    }
  })();
}
