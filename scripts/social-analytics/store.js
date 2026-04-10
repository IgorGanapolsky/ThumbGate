'use strict';

const path = require('path');
const fs = require('fs');
let Database = null;
try {
  Database = require('better-sqlite3');
} catch (_) {
  Database = null;
}

const DEFAULT_DB_PATH = path.join(__dirname, 'db', 'social-analytics.db');
const SCHEMA_PATH = path.join(__dirname, 'db', 'schema.sql');

class MemoryStatement {
  constructor(handler) {
    this.handler = handler;
  }

  run(params) {
    return this.handler.run(params);
  }

  all(params) {
    return this.handler.all(params);
  }
}

class MemoryDatabase {
  constructor() {
    this.tables = {
      engagement_metrics: [],
      follower_snapshots: [],
    };
  }

  pragma() {}

  exec() {}

  close() {}

  prepare(sql) {
    const normalized = sql.replace(/\s+/g, ' ').trim();

    if (normalized.includes('INSERT OR REPLACE INTO engagement_metrics')) {
      return new MemoryStatement({
        run: (params) => {
          const index = this.tables.engagement_metrics.findIndex(
            (row) =>
              row.platform === params.platform &&
              row.post_id === params.post_id &&
              row.metric_date === params.metric_date
          );
          const row = { ...params };
          if (index >= 0) {
            this.tables.engagement_metrics[index] = row;
          } else {
            this.tables.engagement_metrics.push(row);
          }
          return { changes: 1 };
        },
      });
    }

    if (normalized.includes('INSERT OR REPLACE INTO follower_snapshots')) {
      return new MemoryStatement({
        run: (params) => {
          const index = this.tables.follower_snapshots.findIndex(
            (row) => row.platform === params.platform && row.snapshot_date === params.snapshot_date
          );
          const row = { ...params };
          if (index >= 0) {
            this.tables.follower_snapshots[index] = row;
          } else {
            this.tables.follower_snapshots.push(row);
          }
          return { changes: 1 };
        },
      });
    }

    if (normalized.includes('SELECT * FROM engagement_metrics WHERE platform = ?')) {
      return new MemoryStatement({
        all: (platform) =>
          this.tables.engagement_metrics.filter((row) => row.platform === platform),
      });
    }

    const literalPlatformMatch = normalized.match(
      /^SELECT \* FROM engagement_metrics WHERE platform = '([^']+)'$/i
    );
    if (literalPlatformMatch) {
      const [, platform] = literalPlatformMatch;
      return new MemoryStatement({
        all: () =>
          this.tables.engagement_metrics.filter((row) => row.platform === platform),
      });
    }

    if (normalized.includes('FROM engagement_metrics') && normalized.includes('GROUP BY platform')) {
      return new MemoryStatement({
        all: (params = {}) => {
          const rows = this.tables.engagement_metrics.filter((row) => {
            if (row.metric_date < params.cutoff) return false;
            if (params.platform && row.platform !== params.platform) return false;
            return true;
          });
          const grouped = new Map();
          for (const row of rows) {
            const bucket = grouped.get(row.platform) || {
              platform: row.platform,
              post_count: 0,
              total_impressions: 0,
              total_reach: 0,
              total_likes: 0,
              total_comments: 0,
              total_shares: 0,
              total_saves: 0,
              total_clicks: 0,
              total_video_views: 0,
              _postIds: new Set(),
              _rows: 0,
            };
            bucket._postIds.add(row.post_id);
            bucket.total_impressions += row.impressions || 0;
            bucket.total_reach += row.reach || 0;
            bucket.total_likes += row.likes || 0;
            bucket.total_comments += row.comments || 0;
            bucket.total_shares += row.shares || 0;
            bucket.total_saves += row.saves || 0;
            bucket.total_clicks += row.clicks || 0;
            bucket.total_video_views += row.video_views || 0;
            bucket._rows += 1;
            grouped.set(row.platform, bucket);
          }
          return [...grouped.values()]
            .map((bucket) => ({
              platform: bucket.platform,
              post_count: bucket._postIds.size,
              total_impressions: bucket.total_impressions,
              total_reach: bucket.total_reach,
              total_likes: bucket.total_likes,
              total_comments: bucket.total_comments,
              total_shares: bucket.total_shares,
              total_saves: bucket.total_saves,
              total_clicks: bucket.total_clicks,
              total_video_views: bucket.total_video_views,
              avg_impressions: Number((bucket.total_impressions / bucket._rows).toFixed(2)),
              avg_likes: Number((bucket.total_likes / bucket._rows).toFixed(2)),
            }))
            .sort((a, b) => b.total_impressions - a.total_impressions);
        },
      });
    }

    if (normalized.includes('FROM engagement_metrics') && normalized.includes('GROUP BY platform, post_id')) {
      return new MemoryStatement({
        all: ({ cutoff, limit }) => {
          const rows = this.tables.engagement_metrics.filter((row) => row.metric_date >= cutoff);
          const grouped = new Map();
          for (const row of rows) {
            const key = `${row.platform}::${row.post_id}`;
            const bucket = grouped.get(key) || {
              platform: row.platform,
              content_type: row.content_type,
              post_id: row.post_id,
              post_url: row.post_url ?? null,
              published_at: row.published_at ?? null,
              total_engagement: 0,
              total_impressions: 0,
              total_likes: 0,
              total_comments: 0,
              total_shares: 0,
              total_saves: 0,
              total_video_views: 0,
            };
            bucket.total_engagement +=
              (row.likes || 0) + (row.comments || 0) + (row.shares || 0) + (row.saves || 0);
            bucket.total_impressions += row.impressions || 0;
            bucket.total_likes += row.likes || 0;
            bucket.total_comments += row.comments || 0;
            bucket.total_shares += row.shares || 0;
            bucket.total_saves += row.saves || 0;
            bucket.total_video_views += row.video_views || 0;
            grouped.set(key, bucket);
          }
          return [...grouped.values()]
            .sort((a, b) => b.total_engagement - a.total_engagement)
            .slice(0, limit);
        },
      });
    }

    if (normalized.includes('FROM follower_snapshots')) {
      return new MemoryStatement({
        all: ({ platform, cutoff }) =>
          this.tables.follower_snapshots
            .filter((row) => row.platform === platform && row.snapshot_date >= cutoff)
            .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date)),
      });
    }

    throw new Error(`MemoryDatabase does not support query: ${normalized}`);
  }
}

/**
 * Opens the SQLite database, applies the schema, and returns the db instance.
 * Idempotent — safe to call multiple times; schema uses IF NOT EXISTS guards.
 *
 * @param {string} [dbPath] - Absolute path to the .db file. Defaults to DEFAULT_DB_PATH.
 * @returns {import('better-sqlite3').Database}
 */
function initDb(dbPath = DEFAULT_DB_PATH) {
  const isInMemoryDatabase = dbPath === ':memory:';
  const resolvedPath = isInMemoryDatabase ? dbPath : path.resolve(dbPath);
  const dir = isInMemoryDatabase ? null : path.dirname(resolvedPath);

  if (dir && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = Database ? new Database(resolvedPath) : new MemoryDatabase();
  db.pragma('busy_timeout = 3000');

  // Enable WAL mode for better concurrent read performance.
  if (!isInMemoryDatabase) {
    db.pragma('journal_mode = WAL');
  }
  db.pragma('foreign_keys = ON');

  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);

  return db;
}

/**
 * Upserts a single engagement metric record.
 * Uses INSERT OR REPLACE to handle the UNIQUE(platform, post_id, metric_date) constraint.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} record - Fields matching the engagement_metrics schema.
 * @param {string} record.platform
 * @param {string} record.content_type
 * @param {string} record.post_id
 * @param {string} [record.post_url]
 * @param {string} [record.published_at]
 * @param {string} record.metric_date
 * @param {number} [record.impressions]
 * @param {number} [record.reach]
 * @param {number} [record.likes]
 * @param {number} [record.comments]
 * @param {number} [record.shares]
 * @param {number} [record.saves]
 * @param {number} [record.clicks]
 * @param {number} [record.video_views]
 * @param {number} [record.followers_delta]
 * @param {string|object} [record.extra_json]
 * @param {string} record.fetched_at
 * @returns {import('better-sqlite3').RunResult}
 */
function upsertMetric(db, record) {
  if (!record.platform) throw new Error('upsertMetric: record.platform is required');
  if (!record.content_type) throw new Error('upsertMetric: record.content_type is required');
  if (!record.post_id) throw new Error('upsertMetric: record.post_id is required');
  if (!record.metric_date) throw new Error('upsertMetric: record.metric_date is required');
  if (!record.fetched_at) throw new Error('upsertMetric: record.fetched_at is required');

  const extraJson =
    record.extra_json && typeof record.extra_json === 'object'
      ? JSON.stringify(record.extra_json)
      : record.extra_json ?? null;

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO engagement_metrics (
      platform, content_type, post_id, post_url, published_at, metric_date,
      impressions, reach, likes, comments, shares, saves, clicks,
      video_views, followers_delta, extra_json, fetched_at
    ) VALUES (
      @platform, @content_type, @post_id, @post_url, @published_at, @metric_date,
      @impressions, @reach, @likes, @comments, @shares, @saves, @clicks,
      @video_views, @followers_delta, @extra_json, @fetched_at
    )
  `);

  return stmt.run({
    platform: record.platform,
    content_type: record.content_type,
    post_id: record.post_id,
    post_url: record.post_url ?? null,
    published_at: record.published_at ?? null,
    metric_date: record.metric_date,
    impressions: record.impressions ?? 0,
    reach: record.reach ?? 0,
    likes: record.likes ?? 0,
    comments: record.comments ?? 0,
    shares: record.shares ?? 0,
    saves: record.saves ?? 0,
    clicks: record.clicks ?? 0,
    video_views: record.video_views ?? 0,
    followers_delta: record.followers_delta ?? 0,
    extra_json: extraJson,
    fetched_at: record.fetched_at,
  });
}

/**
 * Upserts a follower snapshot.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ platform: string, follower_count: number, snapshot_date: string }} snapshot
 * @returns {import('better-sqlite3').RunResult}
 */
function upsertFollowerSnapshot(db, { platform, follower_count, snapshot_date }) {
  if (!platform) throw new Error('upsertFollowerSnapshot: platform is required');
  if (follower_count == null) throw new Error('upsertFollowerSnapshot: follower_count is required');
  if (!snapshot_date) throw new Error('upsertFollowerSnapshot: snapshot_date is required');

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO follower_snapshots (platform, follower_count, snapshot_date)
    VALUES (@platform, @follower_count, @snapshot_date)
  `);

  return stmt.run({ platform, follower_count, snapshot_date });
}

/**
 * Returns aggregated engagement metrics grouped by platform for the last N days.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ platform?: string, days?: number }} options
 * @returns {object[]}
 */
function queryMetrics(db, { platform, days = 30 } = {}) {
  if (days <= 0) throw new Error('queryMetrics: days must be a positive integer');

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const params = { cutoff };
  let platformClause = '';

  if (platform) {
    platformClause = 'AND platform = @platform';
    params.platform = platform;
  }

  return db
    .prepare(
      `
      SELECT
        platform,
        COUNT(DISTINCT post_id)    AS post_count,
        SUM(impressions)           AS total_impressions,
        SUM(reach)                 AS total_reach,
        SUM(likes)                 AS total_likes,
        SUM(comments)              AS total_comments,
        SUM(shares)                AS total_shares,
        SUM(saves)                 AS total_saves,
        SUM(clicks)                AS total_clicks,
        SUM(video_views)           AS total_video_views,
        ROUND(AVG(impressions), 2) AS avg_impressions,
        ROUND(AVG(likes), 2)       AS avg_likes
      FROM engagement_metrics
      WHERE metric_date >= @cutoff
        ${platformClause}
      GROUP BY platform
      ORDER BY total_impressions DESC
    `
    )
    .all(params);
}

/**
 * Returns top content by total engagement (likes + comments + shares + saves)
 * for the last N days.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ days?: number, limit?: number }} options
 * @returns {object[]}
 */
function topContent(db, { days = 30, limit = 10 } = {}) {
  if (days <= 0) throw new Error('topContent: days must be a positive integer');
  if (limit <= 0) throw new Error('topContent: limit must be a positive integer');

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  return db
    .prepare(
      `
      SELECT
        platform,
        content_type,
        post_id,
        post_url,
        published_at,
        SUM(likes + comments + shares + saves) AS total_engagement,
        SUM(impressions)                        AS total_impressions,
        SUM(likes)                              AS total_likes,
        SUM(comments)                           AS total_comments,
        SUM(shares)                             AS total_shares,
        SUM(saves)                              AS total_saves,
        SUM(video_views)                        AS total_video_views
      FROM engagement_metrics
      WHERE metric_date >= @cutoff
      GROUP BY platform, post_id
      ORDER BY total_engagement DESC
      LIMIT @limit
    `
    )
    .all({ cutoff, limit });
}

/**
 * Returns follower snapshots for a platform for the last N days.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ platform: string, days?: number }} options
 * @returns {object[]}
 */
function getFollowerHistory(db, { platform, days = 30 } = {}) {
  if (!platform) throw new Error('getFollowerHistory: platform is required');
  if (days <= 0) throw new Error('getFollowerHistory: days must be a positive integer');

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  return db
    .prepare(
      `
      SELECT platform, follower_count, snapshot_date
      FROM follower_snapshots
      WHERE platform = @platform
        AND snapshot_date >= @cutoff
      ORDER BY snapshot_date ASC
    `
    )
    .all({ platform, cutoff });
}

module.exports = {
  DEFAULT_DB_PATH,
  initDb,
  upsertMetric,
  upsertFollowerSnapshot,
  queryMetrics,
  topContent,
  getFollowerHistory,
};
