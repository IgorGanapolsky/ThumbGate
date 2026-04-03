#!/usr/bin/env node
'use strict';

/**
 * Lesson DB — SQLite + FTS5 backing store for feedback & memories.
 *
 * Dual-written alongside JSONL (source of truth). Provides:
 * - Full-text search via FTS5 (replaces Jaccard token-overlap)
 * - Indexed tag/domain/signal queries
 * - Corrective-action inference from past similar failures
 *
 * @module lesson-db
 */

const path = require('node:path');
const fs = require('node:fs');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_DB_PATH = path.join(PROJECT_ROOT, '.claude', 'memory', 'lessons.sqlite');

/** @returns {import('better-sqlite3').Database} */
function initDB(dbPath) {
  const Database = require('better-sqlite3');
  const resolvedPath = dbPath || process.env.LESSON_DB_PATH || DEFAULT_DB_PATH;

  // Ensure parent directory exists
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(resolvedPath);
  db.pragma('busy_timeout = 3000');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS lessons (
      id TEXT PRIMARY KEY,
      signal TEXT NOT NULL CHECK(signal IN ('positive','negative')),
      context TEXT,
      whatWentWrong TEXT,
      whatToChange TEXT,
      whatWorked TEXT,
      domain TEXT,
      tags TEXT,
      rootCause TEXT,
      importance TEXT DEFAULT 'medium',
      skill TEXT,
      timestamp TEXT NOT NULL,
      sourceFeedbackId TEXT,
      pruned INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_lessons_signal ON lessons(signal);
    CREATE INDEX IF NOT EXISTS idx_lessons_domain ON lessons(domain);
    CREATE INDEX IF NOT EXISTS idx_lessons_importance ON lessons(importance);
    CREATE INDEX IF NOT EXISTS idx_lessons_timestamp ON lessons(timestamp);
    CREATE INDEX IF NOT EXISTS idx_lessons_skill ON lessons(skill);
  `);

  // FTS5 virtual table for full-text search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS lessons_fts USING fts5(
      context, whatWentWrong, whatToChange, whatWorked, rootCause,
      content=lessons,
      content_rowid=rowid
    );
  `);

  // Triggers to keep FTS in sync with lessons table
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS lessons_ai AFTER INSERT ON lessons BEGIN
      INSERT INTO lessons_fts(rowid, context, whatWentWrong, whatToChange, whatWorked, rootCause)
      VALUES (new.rowid, new.context, new.whatWentWrong, new.whatToChange, new.whatWorked, new.rootCause);
    END;

    CREATE TRIGGER IF NOT EXISTS lessons_ad AFTER DELETE ON lessons BEGIN
      INSERT INTO lessons_fts(lessons_fts, rowid, context, whatWentWrong, whatToChange, whatWorked, rootCause)
      VALUES ('delete', old.rowid, old.context, old.whatWentWrong, old.whatToChange, old.whatWorked, old.rootCause);
    END;

    CREATE TRIGGER IF NOT EXISTS lessons_au AFTER UPDATE ON lessons BEGIN
      INSERT INTO lessons_fts(lessons_fts, rowid, context, whatWentWrong, whatToChange, whatWorked, rootCause)
      VALUES ('delete', old.rowid, old.context, old.whatWentWrong, old.whatToChange, old.whatWorked, old.rootCause);
      INSERT INTO lessons_fts(rowid, context, whatWentWrong, whatToChange, whatWorked, rootCause)
      VALUES (new.rowid, new.context, new.whatWentWrong, new.whatToChange, new.whatWorked, new.rootCause);
    END;
  `);

  // Session search table — stores session notes for cross-session recall
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project TEXT,
      branch TEXT,
      summary TEXT,
      content TEXT,
      created_at TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
      summary, content,
      content=sessions,
      content_rowid=rowid
    );

    CREATE TRIGGER IF NOT EXISTS sessions_ai AFTER INSERT ON sessions BEGIN
      INSERT INTO sessions_fts(rowid, summary, content)
      VALUES (new.rowid, new.summary, new.content);
    END;

    CREATE TRIGGER IF NOT EXISTS sessions_ad AFTER DELETE ON sessions BEGIN
      INSERT INTO sessions_fts(sessions_fts, rowid, summary, content)
      VALUES ('delete', old.rowid, old.summary, old.content);
    END;
  `);

  return db;
}

/**
 * Upsert a session note into SQLite for cross-session search.
 */
function upsertSession(db, session) {
  db.prepare(`
    INSERT OR REPLACE INTO sessions (id, project, branch, summary, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    session.id,
    session.project || null,
    session.branch || null,
    session.summary || null,
    session.content || '',
    session.created_at || new Date().toISOString(),
  );
  return session.id;
}

/**
 * Full-text search across past sessions using FTS5.
 */
function searchSessions(db, query, limit = 10) {
  if (!query || !query.trim()) {
    return db.prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?').all(limit);
  }
  const ftsQuery = sanitizeFtsQuery(query);
  try {
    return db.prepare(`
      SELECT s.*, rank
      FROM sessions_fts fts
      JOIN sessions s ON s.rowid = fts.rowid
      WHERE sessions_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, limit);
  } catch {
    return db.prepare(
      'SELECT * FROM sessions WHERE content LIKE ? OR summary LIKE ? ORDER BY created_at DESC LIMIT ?',
    ).all(`%${query}%`, `%${query}%`, limit);
  }
}

/**
 * Upsert a lesson (feedback event + optional memory record) into SQLite.
 * Idempotent — uses INSERT OR REPLACE on the primary key.
 *
 * Dedup rules:
 * 1. Skip pruned records (Bayesian entropy indicates contradictory signal)
 * 2. Skip if an existing lesson has identical whatToChange + overlapping tags
 *    (bumps the existing record's importance instead)
 * 3. Always store if whatToChange is empty (raw feedback, not actionable yet)
 */
function upsertLesson(db, feedbackEvent, memoryRecord) {
  // Rule 1: skip pruned records — they add noise, not signal
  if (memoryRecord?.pruned) {
    return null;
  }

  const id = memoryRecord?.id || feedbackEvent.id;
  const signal = feedbackEvent.signal === 'positive' || feedbackEvent.signal === 'up' ? 'positive' : 'negative';
  const tags = Array.isArray(feedbackEvent.tags) ? feedbackEvent.tags : [];
  const tagsJson = JSON.stringify(tags);
  const domain = feedbackEvent.richContext?.domain || 'general';
  const rootCause = feedbackEvent.diagnosis?.rootCauseCategory || null;
  const importance = memoryRecord?.importance || (signal === 'negative' ? 'high' : 'medium');
  const skill = feedbackEvent.skill || null;
  const whatToChange = feedbackEvent.whatToChange || null;

  // Rule 2: dedup — if an existing lesson has the same whatToChange and shares tags, skip
  if (whatToChange && whatToChange.trim()) {
    const duplicate = findDuplicate(db, whatToChange, tags);
    if (duplicate) {
      // Bump importance if the new one is higher priority
      const PRIORITY = { critical: 4, high: 3, medium: 2, low: 1 };
      if ((PRIORITY[importance] || 0) > (PRIORITY[duplicate.importance] || 0)) {
        db.prepare('UPDATE lessons SET importance = ? WHERE id = ?').run(importance, duplicate.id);
      }
      return null; // deduplicated
    }
  }

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO lessons
      (id, signal, context, whatWentWrong, whatToChange, whatWorked, domain, tags, rootCause, importance, skill, timestamp, sourceFeedbackId, pruned)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    signal,
    feedbackEvent.context || null,
    feedbackEvent.whatWentWrong || memoryRecord?.content || null,
    whatToChange,
    feedbackEvent.whatWorked || null,
    domain,
    tagsJson,
    rootCause,
    importance,
    skill,
    feedbackEvent.timestamp || new Date().toISOString(),
    feedbackEvent.id,
    0, // not pruned (we skip pruned above)
  );

  return id;
}

/**
 * Find an existing lesson with identical whatToChange and overlapping tags.
 * Returns the existing row or null.
 */
function findDuplicate(db, whatToChange, tags) {
  if (!whatToChange || !whatToChange.trim()) return null;

  // Exact match on whatToChange text (normalized)
  const normalized = whatToChange.trim().toLowerCase();
  const candidates = db.prepare(
    `SELECT id, importance, tags FROM lessons WHERE LOWER(TRIM(whatToChange)) = ?`,
  ).all(normalized);

  if (candidates.length === 0) return null;

  // If any candidate shares at least one tag, it's a duplicate
  for (const c of candidates) {
    if (tags.length === 0) return c; // no tags to compare = text match is enough
    const cTags = safeParseTags(c.tags);
    if (tags.some((t) => cTags.includes(t))) return c;
  }

  return null;
}

/**
 * Compact the lesson DB — merge near-duplicate lessons and remove stale entries.
 *
 * Strategy:
 * - Group lessons by normalized whatToChange text
 * - Keep only the most recent + highest importance per group
 * - Delete the rest
 *
 * @returns {{ removed: number, kept: number }}
 */
function compactLessons(db) {
  const all = db.prepare('SELECT id, whatToChange, importance, timestamp, tags FROM lessons ORDER BY timestamp DESC').all();
  const seen = new Map(); // normalized whatToChange → best record
  const toDelete = [];
  const PRIORITY = { critical: 4, high: 3, medium: 2, low: 1 };

  for (const row of all) {
    if (!row.whatToChange || !row.whatToChange.trim()) continue;
    const key = row.whatToChange.trim().toLowerCase();

    if (!seen.has(key)) {
      seen.set(key, row);
    } else {
      const existing = seen.get(key);
      const existingPri = PRIORITY[existing.importance] || 0;
      const newPri = PRIORITY[row.importance] || 0;
      if (newPri > existingPri) {
        toDelete.push(existing.id);
        seen.set(key, row);
      } else {
        toDelete.push(row.id);
      }
    }
  }

  if (toDelete.length > 0) {
    const deleteStmt = db.prepare('DELETE FROM lessons WHERE id = ?');
    const deleteAll = db.transaction(() => {
      for (const id of toDelete) {
        deleteStmt.run(id);
      }
    });
    deleteAll();
  }

  return { removed: toDelete.length, kept: all.length - toDelete.length };
}

/**
 * Full-text search across lessons using FTS5.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} query - Search text (FTS5 query syntax supported)
 * @param {object} [options]
 * @param {number} [options.limit=10]
 * @param {string} [options.signal] - Filter by 'positive' or 'negative'
 * @param {string[]} [options.tags] - Require ALL tags present
 * @param {string} [options.domain] - Filter by domain
 * @returns {Array<object>}
 */
function searchLessons(db, query, options = {}) {
  const limit = Math.min(options.limit || 10, 50);

  if (!query || !query.trim()) {
    // No query — return most recent lessons with optional filters
    let sql = 'SELECT * FROM lessons WHERE 1=1';
    const params = [];

    if (options.signal) {
      sql += ' AND signal = ?';
      params.push(options.signal);
    }
    if (options.domain) {
      sql += ' AND domain = ?';
      params.push(options.domain);
    }

    sql += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(sql).all(...params);
    return rows.map(parseRow);
  }

  // FTS5 search with ranking
  const safeQuery = sanitizeFtsQuery(query);
  let sql = `
    SELECT l.*, rank
    FROM lessons_fts fts
    JOIN lessons l ON l.rowid = fts.rowid
    WHERE lessons_fts MATCH ?
  `;
  const params = [safeQuery];

  if (options.signal) {
    sql += ' AND l.signal = ?';
    params.push(options.signal);
  }
  if (options.domain) {
    sql += ' AND l.domain = ?';
    params.push(options.domain);
  }

  sql += ' ORDER BY rank LIMIT ?';
  params.push(limit);

  let rows;
  try {
    rows = db.prepare(sql).all(...params);
  } catch (_err) {
    // If FTS query syntax is invalid, fall back to LIKE search
    rows = fallbackLikeSearch(db, query, options, limit);
  }

  const parsed = rows.map(parseRow);

  // Post-filter by tags (JSON array stored as text)
  if (options.tags && options.tags.length > 0) {
    return parsed.filter((row) => {
      const rowTags = row.tags || [];
      return options.tags.every((t) => rowTags.includes(t));
    });
  }

  return parsed;
}

/**
 * Find corrective actions for a negative feedback event by matching
 * similar past failures (by tags and domain).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} feedbackEvent
 * @param {number} [limit=3]
 * @returns {string[]} Top corrective actions
 */
function inferCorrectiveActions(db, feedbackEvent, limit = 3) {
  const tags = Array.isArray(feedbackEvent.tags) ? feedbackEvent.tags : [];
  const domain = feedbackEvent.richContext?.domain || 'general';

  // Strategy: find past negative lessons with overlapping tags, ranked by recency
  let candidates = [];

  // 1. Tag overlap search — find lessons sharing tags with this failure
  if (tags.length > 0) {
    const tagPlaceholders = tags.map(() => `l.tags LIKE ?`).join(' OR ');
    const tagParams = tags.map((t) => `%"${t}"%`);

    const sql = `
      SELECT whatToChange, tags, timestamp
      FROM lessons l
      WHERE l.signal = 'negative'
        AND l.whatToChange IS NOT NULL
        AND l.whatToChange != ''
        AND (${tagPlaceholders})
      ORDER BY l.timestamp DESC
      LIMIT 20
    `;

    candidates = db.prepare(sql).all(...tagParams);
  }

  // 2. Domain fallback if no tag matches
  if (candidates.length === 0) {
    const sql = `
      SELECT whatToChange, tags, timestamp
      FROM lessons l
      WHERE l.signal = 'negative'
        AND l.whatToChange IS NOT NULL
        AND l.whatToChange != ''
        AND l.domain = ?
      ORDER BY l.timestamp DESC
      LIMIT 10
    `;

    candidates = db.prepare(sql).all(domain);
  }

  if (candidates.length === 0) return [];

  // Deduplicate and rank by tag overlap count
  const actionMap = new Map();
  for (const c of candidates) {
    const action = c.whatToChange.trim();
    if (actionMap.has(action)) {
      actionMap.get(action).count += 1;
    } else {
      const cTags = safeParseTags(c.tags);
      const overlap = tags.filter((t) => cTags.includes(t)).length;
      actionMap.set(action, { action, count: 1, overlap, timestamp: c.timestamp });
    }
  }

  return Array.from(actionMap.values())
    .sort((a, b) => b.overlap - a.overlap || b.count - a.count)
    .slice(0, limit)
    .map((a) => a.action);
}

/**
 * Get lesson count and signal breakdown.
 */
function getStats(db) {
  const total = db.prepare('SELECT COUNT(*) as count FROM lessons').get();
  const bySignal = db.prepare('SELECT signal, COUNT(*) as count FROM lessons GROUP BY signal').all();
  const byDomain = db.prepare('SELECT domain, COUNT(*) as count FROM lessons GROUP BY domain ORDER BY count DESC LIMIT 10').all();
  return { total: total.count, bySignal, byDomain };
}

/**
 * Fast stats computation from SQLite — replaces slow JSONL scan.
 * Used by feedback_stats MCP tool to prevent 300s timeouts.
 */
function getStatsFromDB(db) {
  const total = db.prepare('SELECT COUNT(*) as count FROM lessons').get().count;
  const positive = db.prepare("SELECT COUNT(*) as count FROM lessons WHERE signal = 'positive'").get().count;
  const negative = db.prepare("SELECT COUNT(*) as count FROM lessons WHERE signal = 'negative'").get().count;
  const byDomain = db.prepare('SELECT domain, COUNT(*) as count FROM lessons GROUP BY domain ORDER BY count DESC').all();
  const byImportance = db.prepare('SELECT importance, COUNT(*) as count FROM lessons GROUP BY importance ORDER BY count DESC').all();
  const recentLessons = db.prepare('SELECT id, signal, context, domain, timestamp FROM lessons ORDER BY timestamp DESC LIMIT 10').all();
  const sessionCount = db.prepare('SELECT COUNT(*) as count FROM sessions').get().count;

  return {
    source: 'sqlite',
    total,
    positive,
    negative,
    positiveRate: total > 0 ? Math.round((positive / total) * 100) : 0,
    byDomain,
    byImportance,
    recentLessons,
    sessionCount,
  };
}

/**
 * Backfill SQLite from existing JSONL files.
 * Reads feedback-log.jsonl and memory-log.jsonl, upserts all records.
 */
function backfillFromJsonl(db, feedbackDir) {
  const feedbackLogPath = path.join(feedbackDir, 'feedback-log.jsonl');
  const memoryLogPath = path.join(feedbackDir, 'memory-log.jsonl');

  const feedbackEntries = readJsonlSafe(feedbackLogPath);
  const memoryEntries = readJsonlSafe(memoryLogPath);

  // Index memories by sourceFeedbackId for joining
  const memoryByFeedbackId = new Map();
  for (const m of memoryEntries) {
    if (m.sourceFeedbackId) {
      memoryByFeedbackId.set(m.sourceFeedbackId, m);
    }
  }

  const insert = db.transaction(() => {
    let count = 0;
    for (const fb of feedbackEntries) {
      if (!fb.id || !fb.signal) continue;
      const mem = memoryByFeedbackId.get(fb.id) || null;
      upsertLesson(db, fb, mem);
      count++;
    }
    return count;
  });

  return insert();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sanitizeFtsQuery(query) {
  // Escape FTS5 special chars, convert to prefix search terms
  return query
    .replace(/[":*()^~]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term}"`)
    .join(' ');
}

function fallbackLikeSearch(db, query, options, limit) {
  const terms = query.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const conditions = terms.map(
    () => `(context LIKE ? OR whatWentWrong LIKE ? OR whatToChange LIKE ? OR whatWorked LIKE ?)`,
  );
  const params = terms.flatMap((t) => {
    const like = `%${t}%`;
    return [like, like, like, like];
  });

  let sql = `SELECT * FROM lessons WHERE ${conditions.join(' AND ')}`;

  if (options.signal) {
    sql += ' AND signal = ?';
    params.push(options.signal);
  }
  if (options.domain) {
    sql += ' AND domain = ?';
    params.push(options.domain);
  }

  sql += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit);

  return db.prepare(sql).all(...params);
}

function parseRow(row) {
  return {
    ...row,
    tags: safeParseTags(row.tags),
    pruned: row.pruned === 1,
  };
}

function safeParseTags(tagsStr) {
  try {
    const parsed = JSON.parse(tagsStr || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readJsonlSafe(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

module.exports = {
  initDB,
  upsertLesson,
  upsertSession,
  searchSessions,
  findDuplicate,
  compactLessons,
  searchLessons,
  inferCorrectiveActions,
  getStats,
  getStatsFromDB,
  backfillFromJsonl,
  DEFAULT_DB_PATH,
};
