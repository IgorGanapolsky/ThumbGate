'use strict';

/**
 * Storage Adapter Layer
 *
 * Dynamically routes all lesson, rule, brain memory, and operational log writes/queries
 * to either:
 * - 'local': Local zero-config SQLite + JSONL + LanceDB (default)
 * - 'postgres': Hosted/Enterprise Postgres + pgvector
 */

const { initDB, upsertLesson: upsertLessonSqlite, searchLessons: searchLessonsSqlite } = require('./lesson-db');
const { upsertFeedback: upsertLanceDb, searchSimilar: searchLanceDb, embed } = require('./vector-store');
const { recordMemory: recordMemoryLocal, scanMemoryFiles } = require('./brain');

const STORAGE_MODE = (process.env.THUMBGATE_STORAGE || '').toLowerCase() === 'postgres' || process.env.THUMBGATE_DATABASE_URL
  ? 'postgres'
  : 'local';

async function initStorage() {
  if (STORAGE_MODE === 'postgres') {
    const { initPostgresDB } = require('./postgres-db');
    await initPostgresDB();
  } else {
    // Zero-config local SQLite init
    initDB();
  }
}

async function upsertLesson(feedbackEvent, memoryRecord) {
  if (STORAGE_MODE === 'postgres') {
    const { upsertLessonPg } = require('./postgres-db');
    const textForEmbedding = [
      feedbackEvent.context || '',
      (feedbackEvent.tags || []).join(' '),
      feedbackEvent.whatWentWrong || '',
      feedbackEvent.whatWorked || '',
    ].filter(Boolean).join('. ');

    let embedding = null;
    try {
      embedding = await embed(textForEmbedding, {
        kind: 'document',
        task: 'code retrieval',
        title: feedbackEvent.id || 'thumbgate feedback',
      });
    } catch (_) {
      // Best effort embedding
    }

    return upsertLessonPg(feedbackEvent, memoryRecord, embedding);
  } else {
    // 1. Dual-write to local SQLite FTS index
    const db = initDB();
    upsertLessonSqlite(db, feedbackEvent, memoryRecord);

    // 2. Dual-write to local LanceDB vector store
    try {
      await upsertLanceDb(feedbackEvent);
    } catch (_) {
      // Best-effort local vector indexing
    }

    return feedbackEvent.id;
  }
}

async function searchLessonsSimilar(queryText, options = {}) {
  if (STORAGE_MODE === 'postgres') {
    const { searchLessonsSimilarPg } = require('./postgres-db');
    let embedding = null;
    try {
      embedding = await embed(queryText, {
        kind: 'query',
        task: 'code retrieval',
      });
    } catch (_) {
      // Best effort
    }
    return searchLessonsSimilarPg(embedding, options);
  } else {
    // 1. FTS5 exact search
    const db = initDB();
    const ftsResults = searchLessonsSqlite(db, queryText, options);
    if (ftsResults.length > 0) return ftsResults;

    // 2. Fallback to LanceDB vector similarity search
    try {
      return await searchLanceDb(queryText, options.limit || 5);
    } catch (_) {
      return [];
    }
  }
}

async function upsertBrainMemory(entry) {
  if (STORAGE_MODE === 'postgres') {
    const { upsertBrainMemoryPg } = require('./postgres-db');
    const textForEmbedding = [
      entry.title || '',
      entry.content || '',
      entry.reason || '',
    ].filter(Boolean).join('. ');

    let embedding = null;
    try {
      embedding = await embed(textForEmbedding, {
        kind: 'document',
        task: 'code retrieval',
        title: entry.title || 'brain memory',
      });
    } catch (_) {
      // Best effort
    }

    return upsertBrainMemoryPg(entry, embedding);
  } else {
    // Write locally to Markdown structure
    const result = recordMemoryLocal(process.cwd(), entry);
    if (!result.ok) throw new Error(result.error);
    return result.path;
  }
}

async function searchBrainMemorySimilar(queryText, limit = 5, type = null) {
  if (STORAGE_MODE === 'postgres') {
    const { searchBrainMemorySimilarPg } = require('./postgres-db');
    let embedding = null;
    try {
      embedding = await embed(queryText, {
        kind: 'query',
        task: 'code retrieval',
      });
    } catch (_) {
      // Best effort
    }
    return searchBrainMemorySimilarPg(embedding, limit, type);
  } else {
    const query = String(queryText || '').toLowerCase();
    return scanMemoryFiles(process.cwd())
      .filter((file) => !type || file.type === type)
      .filter((file) => !query || file.content.toLowerCase().includes(query) || file.relative.toLowerCase().includes(query))
      .slice(0, limit)
      .map((file) => ({
        id: file.relative,
        type: file.type,
        title: (file.content.match(/^#\s+(.+)$/m) || [null, file.relative])[1],
        content: file.content,
        source: 'local-brain',
        path: file.relative,
      }));
  }
}

async function recordActionReceipt(receipt) {
  if (STORAGE_MODE === 'postgres') {
    const { recordActionReceiptPg } = require('./postgres-db');
    return recordActionReceiptPg(receipt);
  } else {
    // Local: SQLite backing store
    const db = initDB();
    db.prepare(`
      INSERT OR REPLACE INTO sessions (id, project, branch, summary, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      receipt.id,
      receipt.project || 'local-cli',
      receipt.actionType || 'action-receipt',
      receipt.status || 'success',
      JSON.stringify(receipt),
      receipt.timestamp || new Date().toISOString()
    );
    return receipt.id;
  }
}

async function recordGateFiring(firing) {
  if (STORAGE_MODE === 'postgres') {
    const { recordGateFiringPg } = require('./postgres-db');
    return recordGateFiringPg(firing);
  } else {
    // Local: log to telemetry/console
  }
}

function getStorageMode() {
  return STORAGE_MODE;
}

module.exports = {
  initStorage,
  upsertLesson,
  searchLessonsSimilar,
  upsertBrainMemory,
  searchBrainMemorySimilar,
  recordActionReceipt,
  recordGateFiring,
  getStorageMode,
};
