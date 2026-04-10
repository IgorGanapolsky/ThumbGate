'use strict';

/**
 * Filesystem Search — Embedding-Free Knowledge Retrieval
 *
 * Replaces LanceDB vector similarity search with deterministic filesystem
 * operations (grep, token matching, recency weighting) over existing JSONL
 * and ContextFS data. Inspired by Vercel's "knowledge agents without embeddings"
 * approach: give the agent a filesystem and bash instead of vectors.
 *
 * Advantages over vector-store.js:
 * - Zero binary dependencies (no LanceDB, no HuggingFace ONNX)
 * - Deterministic, inspectable, debuggable retrieval
 * - Works immediately without embedding model download
 * - ~75% cheaper (no embedding compute)
 * - Data is always the JSONL source of truth (no sync drift)
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveFeedbackDir } = require('./feedback-paths');
const { readJsonl } = require('./fs-utils');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_FEEDBACK_DIR = resolveFeedbackDir();
const DEFAULT_CONTEXTFS_DIR = path.join(DEFAULT_FEEDBACK_DIR, 'contextfs');

// ---------------------------------------------------------------------------
// Core utilities
// ---------------------------------------------------------------------------

function getFeedbackDir() {
  return resolveFeedbackDir();
}

function getContextFsDir() {
  return process.env.THUMBGATE_CONTEXTFS_DIR || path.join(getFeedbackDir(), 'contextfs');
}

function listJsonFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  const results = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...listJsonFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      results.push(full);
    }
  }
  return results;
}

function tokenize(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function unique(arr) {
  return [...new Set(arr)];
}

// ---------------------------------------------------------------------------
// Scoring: token overlap + recency boost + signal weighting
// ---------------------------------------------------------------------------

function jaccardSimilarity(tokensA, tokensB) {
  const setA = new Set(unique(tokensA));
  const setB = new Set(unique(tokensB));
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function substringBoost(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return 0.3;
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  const matched = words.filter((w) => t.includes(w)).length;
  return words.length > 0 ? (matched / words.length) * 0.2 : 0;
}

function recencyScore(timestamp) {
  if (!timestamp) return 0;
  const ms = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
  if (!Number.isFinite(ms)) return 0;
  const ageHours = (Date.now() - ms) / (1000 * 60 * 60);
  if (ageHours <= 24) return 0.15;
  if (ageHours <= 168) return 0.1;
  if (ageHours <= 720) return 0.05;
  return 0;
}

function scoreRecord(queryTokens, queryText, record) {
  const recordText = [
    record.context || '',
    record.whatWentWrong || record.what_went_wrong || '',
    record.whatWorked || record.what_worked || '',
    record.whatToChange || record.what_to_change || '',
    (record.tags || []).join(' '),
    record.pattern || '',
    record.message || '',
    record.query || '',
    record.outcome || '',
  ].filter(Boolean).join(' ');

  const recordTokens = tokenize(recordText);
  const jaccard = jaccardSimilarity(queryTokens, recordTokens);
  const substr = substringBoost(queryText, recordText);
  const recency = recencyScore(record.timestamp);
  const signalBoost = record.signal === 'down' ? 0.05 : 0;

  return {
    score: jaccard + substr + recency + signalBoost,
    record,
    matchedTokens: unique(queryTokens).filter((t) => new Set(recordTokens).has(t)),
  };
}

// ---------------------------------------------------------------------------
// Search functions (drop-in replacements for vector-store.js exports)
// ---------------------------------------------------------------------------

function searchFeedbackLog(queryText, limit = 5, options = {}) {
  const logPath = path.join(getFeedbackDir(), 'feedback-log.jsonl');
  let records = readJsonl(logPath);

  // SQLite fallback: if JSONL is empty/tiny, pull records from the lesson DB
  if (records.length <= 1) {
    try {
      const { initDB } = require('./lesson-db');
      const db = initDB();
      const rows = db.prepare('SELECT * FROM lessons ORDER BY timestamp DESC LIMIT 500').all();
      if (rows.length > records.length) {
        records = rows.map((r) => ({
          id: r.id,
          signal: r.signal,
          context: r.context,
          title: r.title || r.context,
          tags: r.tags ? JSON.parse(r.tags) : [],
          timestamp: r.timestamp,
          whatWentWrong: r.what_went_wrong,
          whatWorked: r.what_worked,
          whatToChange: r.what_to_change,
        }));
      }
    } catch { /* lesson-db not available */ }
  }

  // Wildcard query: return all records sorted by recency
  const isWildcard = queryText === '*' || queryText === '';
  const queryTokens = isWildcard ? [] : tokenize(queryText);

  let scored = isWildcard
    ? records.map((r) => ({ score: recencyScore(r.timestamp) || 0.01, record: r, matchedTokens: [] }))
    : records.map((r) => scoreRecord(queryTokens, queryText, r));

  if (options.where) {
    scored = scored.filter((s) => {
      if (options.where.signal && s.record.signal !== options.where.signal) return false;
      if (options.where.tags) {
        const requiredTags = options.where.tags.split(',').map((t) => t.trim());
        const recordTags = s.record.tags || [];
        if (!requiredTags.some((rt) => recordTags.includes(rt))) return false;
      }
      return true;
    });
  }

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => ({
      ...s.record,
      _score: s.score,
      _matchedTokens: s.matchedTokens,
    }));
}

function searchContextFs(queryText, limit = 5, options = {}) {
  const contextDir = getContextFsDir();
  const namespaces = options.namespaces || ['memory/error', 'memory/learning', 'rules', 'raw_history'];
  const queryTokens = tokenize(queryText);
  const scored = [];

  for (const ns of namespaces) {
    const nsDir = path.join(contextDir, ns);
    const files = listJsonFiles(nsDir);

    for (const filePath of files) {
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const record = JSON.parse(raw);
        record._source = path.relative(contextDir, filePath);
        record._namespace = ns;
        const result = scoreRecord(queryTokens, queryText, record);
        if (result.score > 0) {
          scored.push(result);
        }
      } catch {
        // Skip malformed files
      }
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => ({
      ...s.record,
      _score: s.score,
      _matchedTokens: s.matchedTokens,
    }));
}

function searchPreventionRules(queryText, limit = 5) {
  const rulesPath = path.join(getFeedbackDir(), 'prevention-rules.md');
  if (!fs.existsSync(rulesPath)) return [];

  const content = fs.readFileSync(rulesPath, 'utf-8');
  const queryTokens = tokenize(queryText);
  const blocks = content.split(/^#{1,3}\s+/m).filter(Boolean);

  return blocks
    .map((block) => {
      const lines = block.trim().split('\n');
      const title = lines[0] || '';
      const body = lines.slice(1).join('\n').trim();
      const tokens = tokenize(`${title} ${body}`);
      const jaccard = jaccardSimilarity(queryTokens, tokens);
      const substr = substringBoost(queryText, `${title} ${body}`);
      return { title, body, score: jaccard + substr };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => ({ ...r, _score: r.score }));
}

// ---------------------------------------------------------------------------
// Unified search — searches all sources and merges results
// ---------------------------------------------------------------------------

function searchAll(queryText, limit = 10, options = {}) {
  const feedbackResults = searchFeedbackLog(queryText, limit, options);
  const contextResults = searchContextFs(queryText, limit, options);
  const ruleResults = searchPreventionRules(queryText, limit);

  const merged = [
    ...feedbackResults.map((r) => ({ ...r, _source_type: 'feedback' })),
    ...contextResults.map((r) => ({ ...r, _source_type: 'contextfs' })),
    ...ruleResults.map((r) => ({ ...r, _source_type: 'prevention_rule' })),
  ];

  return merged
    .sort((a, b) => (b._score || 0) - (a._score || 0))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Drop-in compatibility with vector-store.js interface
// ---------------------------------------------------------------------------

async function searchSimilar(queryText, limit = 5, options = {}) {
  return searchAll(queryText, limit, options);
}

async function upsertFeedback(feedbackEvent) {
  // No-op: feedback is already written to JSONL by feedback-loop.js.
  // The filesystem IS the index. No separate upsert needed.
  // Yield to microtask queue so trackBackgroundSideEffect captures a pending promise.
  await Promise.resolve();
  return feedbackEvent;
}

async function upsertPreventionRule(_rule) {
  // No-op: prevention rules are already in prevention-rules.md
  return _rule;
}

async function upsertContextPack(_pack) {
  // No-op: context packs are already in contextfs/
  return _pack;
}

async function searchPreventionRulesCompat(queryText, limit = 5, _options = {}) {
  return searchPreventionRules(queryText, limit);
}

async function searchContextPacks(queryText, limit = 5, options = {}) {
  return searchContextFs(queryText, limit, {
    ...options,
    namespaces: options.namespaces || ['session'],
  });
}

function getEmbeddingConfig() {
  return {
    selectedProfile: { id: 'filesystem', model: 'none', quantized: false, maxChars: Infinity },
    fallbackProfile: { id: 'filesystem', model: 'none', quantized: false, maxChars: Infinity },
    reason: 'Filesystem search — no embeddings needed',
  };
}

function getLastEmbeddingProfile() {
  return {
    activeProfile: { id: 'filesystem', model: 'none', quantized: false },
    fallbackUsed: false,
    reason: 'Filesystem search — no embeddings needed',
  };
}

function getVersionSnapshot() {
  return Promise.resolve({
    thumbgate_memories: null,
    prevention_rules: null,
    context_packs: null,
    engine: 'filesystem-search',
  });
}

// ---------------------------------------------------------------------------
// Stats / diagnostics
// ---------------------------------------------------------------------------

function getSearchStats() {
  const feedbackPath = path.join(getFeedbackDir(), 'feedback-log.jsonl');
  const contextDir = getContextFsDir();
  const rulesPath = path.join(getFeedbackDir(), 'prevention-rules.md');

  return {
    engine: 'filesystem-search',
    feedbackEntries: readJsonl(feedbackPath).length,
    contextFsFiles: listJsonFiles(contextDir).length,
    preventionRulesExist: fs.existsSync(rulesPath),
    feedbackDir: getFeedbackDir(),
    contextFsDir: contextDir,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (require.main === module) {
  const query = process.argv.slice(2).join(' ') || 'test failure';
  console.log(`Searching for: "${query}"`);
  console.log('');

  const stats = getSearchStats();
  console.log('Search stats:', JSON.stringify(stats, null, 2));
  console.log('');

  const results = searchAll(query, 5);
  console.log(`Found ${results.length} results:`);
  results.forEach((r, i) => {
    console.log(`  ${i + 1}. [${r._source_type}] score=${r._score?.toFixed(3)} tokens=${(r._matchedTokens || []).join(',')}`);
    if (r.context) console.log(`     context: ${r.context.slice(0, 120)}`);
    if (r.title) console.log(`     rule: ${r.title}`);
  });
}

module.exports = {
  // Primary search API
  searchFeedbackLog,
  searchContextFs,
  searchPreventionRulesSync: searchPreventionRules,
  searchAll,
  getSearchStats,

  // Drop-in vector-store.js compatibility
  searchSimilar,
  upsertFeedback,
  upsertPreventionRule,
  searchPreventionRules: searchPreventionRulesCompat,
  upsertContextPack,
  searchContextPacks,
  getEmbeddingConfig,
  getLastEmbeddingProfile,
  getVersionSnapshot,
  TABLE_NAME: 'thumbgate_memories',
  TABLE_PREVENTION_RULES: 'prevention_rules',
  TABLE_CONTEXT_PACKS: 'context_packs',

  // Test helpers (no-ops — no pipeline to mock)
  setPipelineLoaderForTests: () => {},
  setLanceLoaderForTests: () => {},
  truncateForEmbedding: (text) => String(text || ''),
};
