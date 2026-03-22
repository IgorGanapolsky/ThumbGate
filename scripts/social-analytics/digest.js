'use strict';

const fs = require('fs');
const path = require('path');

const { initDb, queryMetrics, topContent, getFollowerHistory } = require('./store');

const PLATFORMS = ['instagram', 'tiktok', 'github'];
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, '.artifacts', 'social', 'digests');

/**
 * Formats a Date to YYYY-MM-DD in local time.
 * @param {Date} date
 * @returns {string}
 */
function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Calculates the follower delta for each platform over the given window.
 * Returns the difference between the most recent snapshot and the oldest
 * snapshot within the window. Returns 0 if fewer than 2 snapshots exist.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} days
 * @returns {{ instagram: number, tiktok: number, github: number }}
 */
function buildFollowerDelta(db, days) {
  const delta = {};
  for (const platform of PLATFORMS) {
    const history = getFollowerHistory(db, { platform, days });
    if (history.length >= 2) {
      delta[platform] = history[history.length - 1].follower_count - history[0].follower_count;
    } else if (history.length === 1) {
      delta[platform] = 0;
    } else {
      delta[platform] = 0;
    }
  }
  return delta;
}

/**
 * Builds per-platform aggregated metrics map.
 *
 * @param {object[]} rows - Rows from queryMetrics (all platforms).
 * @returns {object}
 */
function buildByPlatform(rows) {
  const byPlatform = {};
  for (const platform of PLATFORMS) {
    const row = rows.find((r) => r.platform === platform);
    if (row) {
      byPlatform[platform] = {
        post_count: row.post_count,
        total_impressions: row.total_impressions,
        total_reach: row.total_reach,
        total_likes: row.total_likes,
        total_comments: row.total_comments,
        total_shares: row.total_shares,
        total_saves: row.total_saves,
        total_clicks: row.total_clicks,
        total_video_views: row.total_video_views,
        avg_impressions: row.avg_impressions,
        avg_likes: row.avg_likes,
      };
    } else {
      byPlatform[platform] = {
        post_count: 0,
        total_impressions: 0,
        total_reach: 0,
        total_likes: 0,
        total_comments: 0,
        total_shares: 0,
        total_saves: 0,
        total_clicks: 0,
        total_video_views: 0,
        avg_impressions: 0,
        avg_likes: 0,
      };
    }
  }
  return byPlatform;
}

/**
 * Generates a weekly digest object from the SQLite database.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ days?: number }} options
 * @returns {object} digest
 */
function generateDigest(db, { days = 7 } = {}) {
  const end = new Date();
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const allMetrics = queryMetrics(db, { days });
  const top = topContent(db, { days, limit: 10 });
  const followerDelta = buildFollowerDelta(db, days);
  const byPlatform = buildByPlatform(allMetrics);

  // Aggregate totals across all platforms.
  let totalImpressions = 0;
  let totalLikes = 0;
  let totalComments = 0;
  let totalShares = 0;

  for (const row of allMetrics) {
    totalImpressions += row.total_impressions || 0;
    totalLikes += row.total_likes || 0;
    totalComments += row.total_comments || 0;
    totalShares += row.total_shares || 0;
  }

  const engagementRaw =
    totalImpressions > 0
      ? (((totalLikes + totalComments + totalShares) / totalImpressions) * 100).toFixed(1)
      : '0.0';

  const topContent_ = top.map((row) => ({
    platform: row.platform,
    post_id: row.post_id,
    post_url: row.post_url || null,
    total_engagement: row.total_engagement,
    impressions: row.total_impressions,
  }));

  return {
    period: {
      start: toDateString(start),
      end: toDateString(end),
    },
    summary: {
      total_impressions: totalImpressions,
      total_likes: totalLikes,
      total_comments: totalComments,
      total_shares: totalShares,
      engagement_rate: `${engagementRaw}%`,
      follower_delta: followerDelta,
    },
    by_platform: byPlatform,
    top_content: topContent_,
  };
}

/**
 * Converts a digest object to a readable markdown string.
 *
 * @param {object} digest
 * @returns {string}
 */
function renderDigestMarkdown(digest) {
  const { period, summary, by_platform, top_content } = digest;

  const lines = [];

  lines.push(`# Weekly Social Digest: ${period.start} → ${period.end}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Impressions | ${summary.total_impressions.toLocaleString()} |`);
  lines.push(`| Total Likes | ${summary.total_likes.toLocaleString()} |`);
  lines.push(`| Total Comments | ${summary.total_comments.toLocaleString()} |`);
  lines.push(`| Total Shares | ${summary.total_shares.toLocaleString()} |`);
  lines.push(`| Engagement Rate | ${summary.engagement_rate} |`);
  lines.push('');
  lines.push('### Follower Delta');
  lines.push('');
  lines.push(`| Platform | Change |`);
  lines.push(`|----------|--------|`);
  for (const [platform, delta] of Object.entries(summary.follower_delta)) {
    const sign = delta >= 0 ? '+' : '';
    lines.push(`| ${platform} | ${sign}${delta} |`);
  }

  lines.push('');
  lines.push('## By Platform');
  lines.push('');

  for (const [platform, stats] of Object.entries(by_platform)) {
    lines.push(`### ${platform.charAt(0).toUpperCase() + platform.slice(1)}`);
    lines.push('');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Posts | ${stats.post_count} |`);
    lines.push(`| Impressions | ${stats.total_impressions.toLocaleString()} |`);
    lines.push(`| Reach | ${stats.total_reach.toLocaleString()} |`);
    lines.push(`| Likes | ${stats.total_likes.toLocaleString()} |`);
    lines.push(`| Comments | ${stats.total_comments.toLocaleString()} |`);
    lines.push(`| Shares | ${stats.total_shares.toLocaleString()} |`);
    lines.push(`| Saves | ${stats.total_saves.toLocaleString()} |`);
    lines.push(`| Clicks | ${stats.total_clicks.toLocaleString()} |`);
    lines.push(`| Video Views | ${stats.total_video_views.toLocaleString()} |`);
    lines.push('');
  }

  lines.push('## Top Content');
  lines.push('');

  if (top_content.length === 0) {
    lines.push('_No content recorded in this period._');
  } else {
    lines.push(`| # | Platform | Post ID | Engagement | Impressions | URL |`);
    lines.push(`|---|----------|---------|------------|-------------|-----|`);
    top_content.forEach((item, idx) => {
      const url = item.post_url ? `[link](${item.post_url})` : '—';
      lines.push(
        `| ${idx + 1} | ${item.platform} | ${item.post_id} | ${item.total_engagement} | ${item.impressions.toLocaleString()} | ${url} |`
      );
    });
  }

  lines.push('');
  lines.push(`_Generated at ${new Date().toISOString()}_`);

  return lines.join('\n');
}

/**
 * Writes digest.json and digest.md to the given output directory.
 *
 * @param {object} digest
 * @param {string} outputDir
 * @returns {{ jsonPath: string, mdPath: string }}
 */
function writeDigest(digest, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });

  const jsonPath = path.join(outputDir, 'digest.json');
  const mdPath = path.join(outputDir, 'digest.md');

  fs.writeFileSync(jsonPath, JSON.stringify(digest, null, 2), 'utf8');
  fs.writeFileSync(mdPath, renderDigestMarkdown(digest), 'utf8');

  return { jsonPath, mdPath };
}

module.exports = {
  generateDigest,
  renderDigestMarkdown,
  writeDigest,
};

// Run as main: generate and write a 7-day digest.
if (require.main === module) {
  const db = initDb();
  const digest = generateDigest(db, { days: 7 });
  const { jsonPath, mdPath } = writeDigest(digest, DEFAULT_OUTPUT_DIR);
  console.log(`Digest written:\n  JSON: ${jsonPath}\n  MD:   ${mdPath}`);
  console.log(`\nSummary: ${JSON.stringify(digest.summary, null, 2)}`);
  db.close();
}
