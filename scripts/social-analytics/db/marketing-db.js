'use strict';

/**
 * marketing-db.js
 * Unified marketing activity database.
 *
 * Tracks every post, video, article, and reply published to any platform
 * so we never double-post and can measure marketing effort over time.
 *
 * DB file: .thumbgate/marketing-analytics.sqlite by default. The schema is
 * tracked in this directory, but runtime SQLite files stay local/ignored.
 *
 * Usage:
 *   const db = require('./marketing-db');
 *   if (db.isDuplicate('twitter', contentHash)) return;
 *   const result = await publish(...);
 *   db.record({ type: 'post', platform: 'twitter', postUrl: result.url, contentHash, campaign: 'v1.4.1' });
 */

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const DB_PATH = process.env.THUMBGATE_ANALYTICS_DB
  ? path.resolve(process.env.THUMBGATE_ANALYTICS_DB)
  : path.join(REPO_ROOT, '.thumbgate', 'marketing-analytics.sqlite');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let _db = null;

function getDb() {
  if (_db) return _db;
  const Database = require('better-sqlite3');
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const isNew = !fs.existsSync(DB_PATH);
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  // Always apply schema (idempotent — CREATE IF NOT EXISTS)
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  _db.exec(schema);
  if (isNew) console.log('[marketing-db] Created new analytics DB at', DB_PATH);
  return _db;
}

/**
 * Hash content deterministically for dedup.
 * Normalises whitespace so minor edits don't bypass dedup.
 */
function hashContent(content) {
  const normalised = String(content).trim().replaceAll(/\s+/g, ' ');
  return crypto.createHash('sha256').update(normalised).digest('hex').slice(0, 32);
}

/**
 * Check whether this content was already published to this platform.
 *
 * @param {string} platform  e.g. 'twitter', 'linkedin', 'youtube'
 * @param {string} contentHash  from hashContent() or a stable identifier
 * @param {number} [windowDays=7]  look-back window in days (0 = all-time)
 * @returns {object|null}  existing row if duplicate, null otherwise
 */
function isDuplicate(platform, contentHash, windowDays = 7) {
  const db = getDb();
  let row;
  if (windowDays > 0) {
    const cutoff = new Date(Date.now() - windowDays * 86_400_000).toISOString();
    row = db.prepare(`
      SELECT id, post_url, published_at, status FROM marketing_posts
      WHERE platform = ? AND content_hash = ? AND published_at >= ? AND status = 'published'
      LIMIT 1
    `).get(platform, contentHash, cutoff);
  } else {
    row = db.prepare(`
      SELECT id, post_url, published_at, status FROM marketing_posts
      WHERE platform = ? AND content_hash = ? AND status = 'published'
      LIMIT 1
    `).get(platform, contentHash);
  }
  return row || null;
}

/**
 * Record a marketing activity.
 *
 * @param {object} opts
 * @param {'post'|'video'|'article'|'reply'|'thread'} opts.type
 * @param {string}  opts.platform      e.g. 'twitter', 'youtube'
 * @param {string}  opts.contentHash   from hashContent()
 * @param {string}  [opts.postUrl]
 * @param {string}  [opts.postId]
 * @param {string}  [opts.accountId]
 * @param {string}  [opts.title]
 * @param {'published'|'failed'|'skipped'|'draft'} [opts.status='published']
 * @param {string[]} [opts.tags]
 * @param {string}  [opts.campaign]
 * @param {object}  [opts.extra]
 * @returns {number} inserted row id
 */
function record(opts) {
  const db = getDb();
  const {
    type, platform, contentHash,
    postUrl = null, postId = null, accountId = null, title = null,
    status = 'published', tags = [], campaign = null, extra = null,
  } = opts;

  const stmt = db.prepare(`
    INSERT INTO marketing_posts
      (type, platform, account_id, post_id, post_url, title,
       content_hash, published_at, status, tags, campaign, extra_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(platform, content_hash) DO UPDATE SET
      post_url    = excluded.post_url,
      post_id     = excluded.post_id,
      status      = excluded.status,
      published_at= excluded.published_at,
      extra_json  = excluded.extra_json
  `);

  const result = stmt.run(
    type, platform, accountId, postId, postUrl, title,
    contentHash,
    new Date().toISOString(),
    status,
    JSON.stringify(tags),
    campaign,
    extra ? JSON.stringify(extra) : null,
  );
  return result.lastInsertRowid;
}

/**
 * List recent marketing posts, optionally filtered.
 *
 * @param {{ platform?: string, type?: string, campaign?: string, limit?: number, days?: number }} opts
 * @returns {object[]}
 */
function list({ platform, type, campaign, limit = 50, days = 30 } = {}) {
  const db = getDb();
  const conditions = [];
  const params = [];

  if (platform) { conditions.push('platform = ?'); params.push(platform); }
  if (type) { conditions.push('type = ?'); params.push(type); }
  if (campaign) { conditions.push('campaign = ?'); params.push(campaign); }
  if (days > 0) {
    conditions.push('published_at >= ?');
    params.push(new Date(Date.now() - days * 86_400_000).toISOString());
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);

  return db.prepare(`
    SELECT * FROM marketing_posts
    ${where}
    ORDER BY published_at DESC
    LIMIT ?
  `).all(...params);
}

/**
 * Return a summary count by platform and type.
 */
function summary() {
  const db = getDb();
  return db.prepare(`
    SELECT platform, type, status, COUNT(*) as count
    FROM marketing_posts
    GROUP BY platform, type, status
    ORDER BY count DESC
  `).all();
}

module.exports = { hashContent, isDuplicate, record, list, summary, getDb };
