'use strict';

/**
 * Returns the current UTC timestamp in ISO 8601 format.
 * @returns {string}
 */
function nowIso() {
  return new Date().toISOString();
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
 * Normalizes a raw Instagram Graph API media/insights response into
 * the engagement_metrics schema shape.
 *
 * Expected raw fields (from /{media-id}?fields=... + /{media-id}/insights):
 *   raw.id            — Instagram media ID
 *   raw.permalink     — post URL
 *   raw.timestamp     — ISO publish time
 *   raw.media_type    — IMAGE | VIDEO | CAROUSEL_ALBUM | REELS
 *   raw.impressions   — number
 *   raw.reach         — number
 *   raw.likes_count   — number  (or raw.like_count)
 *   raw.comments_count — number
 *   raw.saved         — number
 *   raw.video_views   — number  (VIDEO / REELS only)
 *   raw.metric_date   — YYYY-MM-DD (caller-supplied or today)
 *
 * @param {object} raw
 * @returns {object} Record matching engagement_metrics schema (minus id/autoincrement).
 */
function normalizeInstagramMetric(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new TypeError('normalizeInstagramMetric: raw must be a non-null object');
  }

  const postId = String(raw.id || raw.media_id || '');
  if (!postId) throw new Error('normalizeInstagramMetric: raw.id is required');

  const metricDate =
    raw.metric_date ||
    (raw.timestamp ? raw.timestamp.slice(0, 10) : null) ||
    new Date().toISOString().slice(0, 10);

  const mediaType = (raw.media_type || 'IMAGE').toUpperCase();
  const contentTypeMap = {
    IMAGE: 'image',
    VIDEO: 'video',
    CAROUSEL_ALBUM: 'carousel',
    REELS: 'reel',
  };
  const contentType = contentTypeMap[mediaType] || 'image';

  const extraPayload = {};
  if (raw.caption) extraPayload.caption = raw.caption;
  if (raw.hashtags) extraPayload.hashtags = raw.hashtags;
  if (raw.location) extraPayload.location = raw.location;

  return {
    platform: 'instagram',
    content_type: contentType,
    post_id: postId,
    post_url: raw.permalink || null,
    published_at: raw.timestamp || null,
    metric_date: metricDate,
    impressions: toInt(raw.impressions),
    reach: toInt(raw.reach),
    likes: toInt(raw.likes_count ?? raw.like_count ?? raw.likes ?? 0),
    comments: toInt(raw.comments_count ?? raw.comments ?? 0),
    shares: toInt(raw.shares ?? 0),
    saves: toInt(raw.saved ?? raw.saves ?? 0),
    clicks: toInt(raw.website_clicks ?? raw.profile_visits ?? 0),
    video_views: toInt(raw.video_views ?? 0),
    followers_delta: toInt(raw.follows ?? raw.followers_delta ?? 0),
    extra_json: Object.keys(extraPayload).length ? JSON.stringify(extraPayload) : null,
    fetched_at: nowIso(),
  };
}

/**
 * Normalizes a raw TikTok Research API / Business API video stats response
 * into the engagement_metrics schema shape.
 *
 * Expected raw fields:
 *   raw.video_id        — TikTok video ID
 *   raw.share_url       — video URL
 *   raw.create_time     — Unix timestamp (seconds) or ISO string
 *   raw.view_count      — number
 *   raw.like_count      — number
 *   raw.comment_count   — number
 *   raw.share_count     — number
 *   raw.reach           — number (if available)
 *   raw.metric_date     — YYYY-MM-DD (caller-supplied or today)
 *
 * @param {object} raw
 * @returns {object}
 */
function normalizeTikTokMetric(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new TypeError('normalizeTikTokMetric: raw must be a non-null object');
  }

  const postId = String(raw.video_id || raw.id || '');
  if (!postId) throw new Error('normalizeTikTokMetric: raw.video_id is required');

  // create_time may be a Unix timestamp (number) or ISO string.
  let publishedAt = null;
  if (raw.create_time) {
    if (typeof raw.create_time === 'number') {
      publishedAt = new Date(raw.create_time * 1000).toISOString();
    } else {
      publishedAt = String(raw.create_time);
    }
  }

  const metricDate =
    raw.metric_date ||
    (publishedAt ? publishedAt.slice(0, 10) : null) ||
    new Date().toISOString().slice(0, 10);

  const extraPayload = {};
  if (raw.music_id) extraPayload.music_id = raw.music_id;
  if (raw.hashtag_names) extraPayload.hashtag_names = raw.hashtag_names;
  if (raw.duration) extraPayload.duration = raw.duration;
  if (raw.cover_image_url) extraPayload.cover_image_url = raw.cover_image_url;

  return {
    platform: 'tiktok',
    content_type: 'video',
    post_id: postId,
    post_url: raw.share_url || raw.video_url || null,
    published_at: publishedAt,
    metric_date: metricDate,
    impressions: toInt(raw.view_count ?? raw.impression_count ?? 0),
    reach: toInt(raw.reach ?? 0),
    likes: toInt(raw.like_count ?? raw.likes ?? 0),
    comments: toInt(raw.comment_count ?? raw.comments ?? 0),
    shares: toInt(raw.share_count ?? raw.shares ?? 0),
    saves: toInt(raw.collect_count ?? raw.saves ?? 0),
    clicks: toInt(raw.profile_deep_view ?? raw.clicks ?? 0),
    video_views: toInt(raw.view_count ?? 0),
    followers_delta: toInt(raw.new_followers ?? raw.followers_delta ?? 0),
    extra_json: Object.keys(extraPayload).length ? JSON.stringify(extraPayload) : null,
    fetched_at: nowIso(),
  };
}

/**
 * Normalizes a raw GitHub repository traffic / releases API response
 * into the engagement_metrics schema shape.
 *
 * Supports two modes depending on raw.content_type:
 *   'repo_traffic'  — raw from GET /repos/{owner}/{repo}/traffic/views
 *   'release'       — raw from GET /repos/{owner}/{repo}/releases/{id}
 *
 * Expected raw fields for repo_traffic:
 *   raw.repo_id         — repository ID or "{owner}/{repo}"
 *   raw.repo_full_name  — "{owner}/{repo}"
 *   raw.html_url        — repo URL
 *   raw.count           — total views for the period
 *   raw.uniques         — unique visitors
 *   raw.metric_date     — YYYY-MM-DD
 *   raw.stars           — stargazers_count
 *   raw.forks           — forks_count
 *   raw.watchers        — watchers_count
 *   raw.clones          — clone count
 *
 * Expected raw fields for release:
 *   raw.id              — release ID
 *   raw.html_url        — release URL
 *   raw.published_at    — ISO datetime
 *   raw.download_count  — total asset downloads
 *   raw.repo_full_name  — "{owner}/{repo}"
 *   raw.metric_date     — YYYY-MM-DD
 *
 * @param {object} raw
 * @returns {object}
 */
function normalizeGitHubMetric(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new TypeError('normalizeGitHubMetric: raw must be a non-null object');
  }

  const contentType = raw.content_type || 'repo_traffic';

  if (contentType === 'release') {
    const postId = String(raw.id || '');
    if (!postId) throw new Error('normalizeGitHubMetric: raw.id is required for release');

    const metricDate =
      raw.metric_date ||
      (raw.published_at ? raw.published_at.slice(0, 10) : null) ||
      new Date().toISOString().slice(0, 10);

    const extraPayload = {};
    if (raw.tag_name) extraPayload.tag_name = raw.tag_name;
    if (raw.name) extraPayload.release_name = raw.name;
    if (raw.prerelease != null) extraPayload.prerelease = raw.prerelease;
    if (raw.repo_full_name) extraPayload.repo = raw.repo_full_name;

    return {
      platform: 'github',
      content_type: 'release',
      post_id: postId,
      post_url: raw.html_url || null,
      published_at: raw.published_at || null,
      metric_date: metricDate,
      impressions: 0,
      reach: 0,
      likes: toInt(raw.reactions?.total_count ?? 0),
      comments: 0,
      shares: 0,
      saves: toInt(raw.stargazers_count ?? 0),
      clicks: toInt(raw.download_count ?? 0),
      video_views: 0,
      followers_delta: 0,
      extra_json: Object.keys(extraPayload).length ? JSON.stringify(extraPayload) : null,
      fetched_at: nowIso(),
    };
  }

  // Default: repo_traffic
  const repoId = String(raw.repo_id || raw.repo_full_name || raw.full_name || '');
  if (!repoId) throw new Error('normalizeGitHubMetric: raw.repo_id or raw.repo_full_name is required');

  const metricDate =
    raw.metric_date || new Date().toISOString().slice(0, 10);

  const extraPayload = {};
  if (raw.forks != null) extraPayload.forks = raw.forks;
  if (raw.watchers != null) extraPayload.watchers = raw.watchers;
  if (raw.clones != null) extraPayload.clones = raw.clones;
  if (raw.open_issues != null) extraPayload.open_issues = raw.open_issues;
  if (raw.language) extraPayload.language = raw.language;

  return {
    platform: 'github',
    content_type: 'repo_traffic',
    post_id: repoId,
    post_url: raw.html_url || `https://github.com/${repoId}`,
    published_at: raw.created_at || null,
    metric_date: metricDate,
    impressions: toInt(raw.count ?? raw.views ?? 0),
    reach: toInt(raw.uniques ?? 0),
    likes: toInt(raw.stars ?? raw.stargazers_count ?? 0),
    comments: toInt(raw.open_issues ?? 0),
    shares: toInt(raw.forks ?? 0),
    saves: toInt(raw.watchers ?? 0),
    clicks: toInt(raw.clones ?? 0),
    video_views: 0,
    followers_delta: toInt(raw.followers_delta ?? 0),
    extra_json: Object.keys(extraPayload).length ? JSON.stringify(extraPayload) : null,
    fetched_at: nowIso(),
  };
}

/**
 * Normalizes a raw LinkedIn Posts API / socialMetadata response.
 *
 * @param {object} raw
 * @returns {object}
 */
function normalizeLinkedInMetric(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new TypeError('normalizeLinkedInMetric: raw must be a non-null object');
  }

  const postId = String(raw.id || raw.urn || '');
  if (!postId) throw new Error('normalizeLinkedInMetric: raw.id is required');

  const metricDate =
    raw.metric_date ||
    (raw.created && raw.created.time
      ? new Date(raw.created.time).toISOString().slice(0, 10)
      : null) ||
    (raw.publishedAt ? raw.publishedAt.slice(0, 10) : null) ||
    new Date().toISOString().slice(0, 10);

  const extraPayload = {};
  if (raw.commentary) extraPayload.commentary = raw.commentary.slice(0, 200);
  if (raw.visibility) extraPayload.visibility = raw.visibility;

  return {
    platform: 'linkedin',
    content_type: raw.content_type || 'post',
    post_id: postId,
    post_url: raw.permalink || null,
    published_at: raw.publishedAt || (raw.created && raw.created.time ? new Date(raw.created.time).toISOString() : null),
    metric_date: metricDate,
    impressions: toInt(raw.impressions ?? raw.totalShareStatistics?.impressionCount ?? 0),
    reach: toInt(raw.uniqueImpressionsCount ?? raw.reach ?? 0),
    likes: toInt(raw.numLikes ?? raw.totalShareStatistics?.likeCount ?? raw.likes ?? 0),
    comments: toInt(raw.numComments ?? raw.totalShareStatistics?.commentCount ?? raw.comments ?? 0),
    shares: toInt(raw.numShares ?? raw.totalShareStatistics?.shareCount ?? raw.shares ?? 0),
    saves: 0,
    clicks: toInt(raw.clickCount ?? raw.totalShareStatistics?.clickCount ?? 0),
    video_views: toInt(raw.videoViews ?? 0),
    followers_delta: toInt(raw.followers_delta ?? 0),
    extra_json: Object.keys(extraPayload).length ? JSON.stringify(extraPayload) : null,
    fetched_at: nowIso(),
  };
}

/**
 * Normalizes a raw X/Twitter API v2 tweet with public_metrics.
 *
 * @param {object} raw
 * @returns {object}
 */
function normalizeXMetric(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new TypeError('normalizeXMetric: raw must be a non-null object');
  }

  const postId = String(raw.id || '');
  if (!postId) throw new Error('normalizeXMetric: raw.id is required');

  const pm = raw.public_metrics || {};
  const metricDate =
    raw.metric_date ||
    (raw.created_at ? raw.created_at.slice(0, 10) : null) ||
    new Date().toISOString().slice(0, 10);

  const extraPayload = {};
  if (raw.text) extraPayload.text = raw.text.slice(0, 280);
  if (pm.quote_count) extraPayload.quote_count = pm.quote_count;

  return {
    platform: 'x',
    content_type: 'tweet',
    post_id: postId,
    post_url: raw.url || (raw.author_id ? `https://x.com/i/status/${postId}` : null),
    published_at: raw.created_at || null,
    metric_date: metricDate,
    impressions: toInt(pm.impression_count ?? raw.impressions ?? 0),
    reach: 0,
    likes: toInt(pm.like_count ?? raw.likes ?? 0),
    comments: toInt(pm.reply_count ?? raw.comments ?? 0),
    shares: toInt((pm.retweet_count ?? 0) + (pm.quote_count ?? 0)),
    saves: toInt(pm.bookmark_count ?? 0),
    clicks: 0,
    video_views: toInt(raw.video_views ?? 0),
    followers_delta: toInt(raw.followers_delta ?? 0),
    extra_json: Object.keys(extraPayload).length ? JSON.stringify(extraPayload) : null,
    fetched_at: nowIso(),
  };
}

/**
 * Normalizes a raw Reddit post from /user/{name}/submitted.
 *
 * @param {object} raw
 * @returns {object}
 */
function normalizeRedditMetric(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new TypeError('normalizeRedditMetric: raw must be a non-null object');
  }

  const postId = String(raw.id || raw.name || '');
  if (!postId) throw new Error('normalizeRedditMetric: raw.id is required');

  const publishedAt = raw.created_utc
    ? new Date(raw.created_utc * 1000).toISOString()
    : raw.created ? new Date(raw.created * 1000).toISOString() : null;

  const metricDate =
    raw.metric_date ||
    (publishedAt ? publishedAt.slice(0, 10) : null) ||
    new Date().toISOString().slice(0, 10);

  const extraPayload = {};
  if (raw.subreddit) extraPayload.subreddit = raw.subreddit;
  if (raw.upvote_ratio != null) extraPayload.upvote_ratio = raw.upvote_ratio;
  if (raw.title) extraPayload.title = raw.title.slice(0, 300);

  return {
    platform: 'reddit',
    content_type: raw.is_self === false ? 'link' : 'post',
    post_id: postId,
    post_url: raw.url || (raw.permalink ? `https://www.reddit.com${raw.permalink}` : null),
    published_at: publishedAt,
    metric_date: metricDate,
    impressions: 0,
    reach: 0,
    likes: toInt(raw.score ?? raw.ups ?? 0),
    comments: toInt(raw.num_comments ?? raw.comments ?? 0),
    shares: toInt(raw.num_crossposts ?? 0),
    saves: 0,
    clicks: 0,
    video_views: 0,
    followers_delta: toInt(raw.followers_delta ?? 0),
    extra_json: Object.keys(extraPayload).length ? JSON.stringify(extraPayload) : null,
    fetched_at: nowIso(),
  };
}

/**
 * Normalizes a raw Threads API post/insights response.
 *
 * @param {object} raw
 * @returns {object}
 */
function normalizeThreadsMetric(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new TypeError('normalizeThreadsMetric: raw must be a non-null object');
  }

  const postId = String(raw.id || '');
  if (!postId) throw new Error('normalizeThreadsMetric: raw.id is required');

  const metricDate =
    raw.metric_date ||
    (raw.timestamp ? raw.timestamp.slice(0, 10) : null) ||
    new Date().toISOString().slice(0, 10);

  const extraPayload = {};
  if (raw.text) extraPayload.text = raw.text.slice(0, 500);
  if (raw.media_type) extraPayload.media_type = raw.media_type;

  return {
    platform: 'threads',
    content_type: 'thread',
    post_id: postId,
    post_url: raw.permalink || null,
    published_at: raw.timestamp || null,
    metric_date: metricDate,
    impressions: toInt(raw.views ?? raw.impressions ?? 0),
    reach: toInt(raw.reach ?? 0),
    likes: toInt(raw.likes ?? raw.like_count ?? 0),
    comments: toInt(raw.replies ?? raw.reply_count ?? 0),
    shares: toInt((raw.reposts ?? 0) + (raw.quotes ?? 0)),
    saves: 0,
    clicks: 0,
    video_views: 0,
    followers_delta: toInt(raw.followers_delta ?? 0),
    extra_json: Object.keys(extraPayload).length ? JSON.stringify(extraPayload) : null,
    fetched_at: nowIso(),
  };
}

/**
 * Normalizes a raw YouTube Data API v3 video statistics response.
 *
 * @param {object} raw
 * @returns {object}
 */
function normalizeYouTubeMetric(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new TypeError('normalizeYouTubeMetric: raw must be a non-null object');
  }

  const postId = String(raw.id || raw.videoId || '');
  if (!postId) throw new Error('normalizeYouTubeMetric: raw.id is required');

  const stats = raw.statistics || {};
  const metricDate =
    raw.metric_date ||
    (raw.publishedAt ? raw.publishedAt.slice(0, 10) : null) ||
    new Date().toISOString().slice(0, 10);

  const isShort = raw.isShort || raw.content_type === 'short';
  const contentType = isShort ? 'short' : 'video';
  const postUrl = isShort
    ? `https://youtube.com/shorts/${postId}`
    : `https://youtube.com/watch?v=${postId}`;

  const extraPayload = {};
  if (raw.title) extraPayload.title = raw.title.slice(0, 200);
  if (raw.duration) extraPayload.duration = raw.duration;
  if (raw.channelId) extraPayload.channelId = raw.channelId;

  return {
    platform: 'youtube',
    content_type: contentType,
    post_id: postId,
    post_url: raw.url || postUrl,
    published_at: raw.publishedAt || null,
    metric_date: metricDate,
    impressions: toInt(stats.viewCount ?? raw.viewCount ?? raw.impressions ?? 0),
    reach: 0,
    likes: toInt(stats.likeCount ?? raw.likeCount ?? raw.likes ?? 0),
    comments: toInt(stats.commentCount ?? raw.commentCount ?? raw.comments ?? 0),
    shares: 0,
    saves: toInt(stats.favoriteCount ?? 0),
    clicks: 0,
    video_views: toInt(stats.viewCount ?? raw.viewCount ?? raw.video_views ?? 0),
    followers_delta: toInt(raw.followers_delta ?? 0),
    extra_json: Object.keys(extraPayload).length ? JSON.stringify(extraPayload) : null,
    fetched_at: nowIso(),
  };
}

module.exports = {
  normalizeInstagramMetric,
  normalizeTikTokMetric,
  normalizeGitHubMetric,
  normalizeLinkedInMetric,
  normalizeXMetric,
  normalizeRedditMetric,
  normalizeThreadsMetric,
  normalizeYouTubeMetric,
};
