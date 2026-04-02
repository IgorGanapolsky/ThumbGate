'use strict';

/**
 * github.js
 * Polls GitHub REST API for repository traffic data.
 *
 * IMPORTANT: GitHub only retains traffic data for 14 days.
 * This poller must run at least daily to avoid gaps.
 *
 * Required env vars:
 *   GITHUB_TOKEN  — personal access token with repo scope (required)
 *   GITHUB_REPO   — owner/repo slug (default: IgorGanapolsky/ThumbGate)
 */

const path = require('path');

const GITHUB_API_BASE = 'https://api.github.com';
const DEFAULT_REPO = 'IgorGanapolsky/ThumbGate';

/**
 * Build standard GitHub API request headers.
 * @param {string} token
 * @returns {Record<string, string>}
 */
function buildHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'social-analytics-poller/1.0',
  };
}

/**
 * Fetch a single GitHub API endpoint and return parsed JSON.
 * Throws on non-2xx responses.
 * @param {string} url
 * @param {string} token
 * @returns {Promise<unknown>}
 */
async function ghFetch(url, token) {
  const res = await fetch(url, { headers: buildHeaders(token) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub API ${res.status} for ${url}: ${body}`);
  }
  return res.json();
}

/**
 * Fetch all traffic data for a repository.
 *
 * @param {string} token  - GitHub personal access token
 * @param {string} [repo] - owner/repo slug
 * @returns {Promise<{
 *   views: object,
 *   clones: object,
 *   referrers: object[],
 *   repoStats: object
 * }>}
 */
async function fetchGitHubTraffic(token, repo) {
  if (!token) {
    throw new Error('GITHUB_TOKEN is required');
  }
  const slug = repo || DEFAULT_REPO;
  const base = `${GITHUB_API_BASE}/repos/${slug}`;

  console.log(`[github] Fetching traffic for ${slug}`);

  const [views, clones, referrers, repoStats] = await Promise.all([
    ghFetch(`${base}/traffic/views`, token),
    ghFetch(`${base}/traffic/clones`, token),
    ghFetch(`${base}/traffic/popular/referrers`, token),
    ghFetch(base, token),
  ]);

  console.log(
    `[github] views=${views.count} uniques=${views.uniques} ` +
      `clones=${clones.count} stars=${repoStats.stargazers_count} ` +
      `forks=${repoStats.forks_count}`
  );

  return { views, clones, referrers, repoStats };
}

/**
 * Main polling entry point.
 *
 * Fetches GitHub traffic, normalizes each daily view entry, and upserts
 * into the analytics database. Also records a follower_snapshot using
 * stargazers_count as the follower-count equivalent.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Promise<void>}
 */
async function pollGitHub(db) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN environment variable is required');
  }
  const repo = process.env.GITHUB_REPO || DEFAULT_REPO;

  const { views, clones, referrers, repoStats } = await fetchGitHubTraffic(token, repo);

  // Lazy-require sibling modules so they can be built/tested independently.
  const { normalizeGitHubMetric: normalizeMetric } = require('../normalizer');
  const { upsertMetric, upsertFollowerSnapshot } = require('../store');

  const repoName = repo.split('/').pop();
  const fetchedAt = new Date().toISOString();

  // Build a date-keyed map of clone counts for merge into view records.
  const clonesByDate = {};
  if (Array.isArray(clones.views)) {
    for (const entry of clones.views) {
      const date = entry.timestamp.slice(0, 10);
      clonesByDate[date] = (clonesByDate[date] || 0) + entry.count;
    }
  }

  const upsertedDates = [];

  for (const entry of views.views || []) {
    const metricDate = entry.timestamp.slice(0, 10);
    const cloneCount = clonesByDate[metricDate] || 0;

    const record = {
      platform: 'github',
      content_type: 'repo',
      post_id: repoName,
      post_url: `https://github.com/${repo}`,
      metric_date: metricDate,
      impressions: entry.count,
      reach: entry.uniques,
      clicks: cloneCount,
      likes: repoStats.stargazers_count,
      shares: repoStats.forks_count,
      comments: 0,
      saves: 0,
      video_views: 0,
      followers_delta: 0,
      extra_json: JSON.stringify({ referrers }),
      fetched_at: fetchedAt,
    };

    upsertMetric(db, record);
    upsertedDates.push(metricDate);
  }

  console.log(`[github] Upserted ${upsertedDates.length} daily metric records: ${upsertedDates.join(', ')}`);

  // Record follower snapshot (stars as follower-count equivalent).
  const snapshotDate = fetchedAt.slice(0, 10);
  upsertFollowerSnapshot(db, {
    platform: 'github',
    follower_count: repoStats.stargazers_count,
    snapshot_date: snapshotDate,
  });

  console.log(
    `[github] Follower snapshot upserted: platform=github ` +
      `follower_count=${repoStats.stargazers_count} date=${snapshotDate}`
  );
}

module.exports = { fetchGitHubTraffic, pollGitHub };

// ---------------------------------------------------------------------------
// Stand-alone execution
// ---------------------------------------------------------------------------
if (require.main === module) {
  const Database = require('better-sqlite3');
  const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
  const dbPath = path.join(__dirname, '..', 'db', 'social-analytics.db');
  const fs = require('fs');

  const db = new Database(dbPath);
  db.pragma('busy_timeout = 3000');
  db.pragma('journal_mode = WAL');

  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);

  pollGitHub(db)
    .then(() => {
      console.log('[github] Poll complete.');
      db.close();
    })
    .catch((err) => {
      console.error('[github] Poll failed:', err.message);
      db.close();
      process.exit(1);
    });
}
