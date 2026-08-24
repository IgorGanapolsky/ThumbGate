#!/usr/bin/env node
'use strict';

/**
 * Lesson Graph — typed-edge knowledge layer over the flat lesson store.
 *
 * The flat store (memory-log.jsonl / feedback-log.jsonl / lessons.sqlite)
 * records every capture as an independent row. That produces three failure
 * modes at retrieval time:
 *   1. The same lesson recorded N times surfaces as N contradictory-looking
 *      siblings and inflates recurring-pattern counters.
 *   2. Correction chains (original mistake → CORRECTION → REFINEMENT) are
 *      retrieved as three unrelated records with mixed signals, which drives
 *      retrieval entropy over the knowledge-conflict threshold on nearly
 *      every call.
 *   3. There is no way to answer "what is the CURRENT fact?" for a topic.
 *
 * This module adds a traversable graph alongside the existing store —
 * SQLite (better-sqlite3, same engine as lesson-db.js), separate file
 * `lesson-graph.sqlite` in the feedback dir so the existing lessons.sqlite
 * schema is untouched. The JSONL logs remain the source of truth for lesson
 * CONTENT; the graph is an overlay that records identity and lineage.
 *
 * Nodes reference existing lesson ids (mem_*, fb_*, lesson_*).
 * Edge types (src → dst):
 *   - supersedes    src is a CORRECTION of dst (dst is no longer current)
 *   - refines       src REFINES dst (dst is folded into src)
 *   - duplicate_of  src is a near-duplicate of canonical dst
 *   - contradicts   src and dst disagree; src is the newer record
 *
 * Bitemporal fields on both nodes and edges:
 *   - valid_from    when the fact became true (lesson timestamp)
 *   - valid_to      when it stopped being current (NULL = still current)
 *   - ingested_at   when this row was recorded in the graph
 *
 * All SQL uses prepared statements with bound parameters exclusively.
 *
 * @module lesson-graph
 */

const path = require('node:path');
const fs = require('node:fs');

const EDGE_TYPES = ['supersedes', 'contradicts', 'duplicate_of', 'refines'];
const LINEAGE_EDGE_TYPES = new Set(['supersedes', 'refines']);
const MAX_TRAVERSAL_HOPS = 32;

// High-confidence duplicate threshold on character-bigram Jaccard of the
// canonicalized text. 0.9 is deliberately stricter than the 0.82 retrieval
// heuristic in lesson-retrieval.dedupeSupersededLessons: incrementing a
// counter instead of storing a record is destructive-ish, so only collapse
// when the texts are essentially the same sentence.
const DUPLICATE_SIMILARITY_THRESHOLD = 0.9;

// Same-topic threshold used to flag contradictions (opposite signal on the
// same topic). Mirrors dedupeSupersededLessons' similarityThreshold.
const CONTRADICTION_SIMILARITY_THRESHOLD = 0.82;

function resolveDefaultGraphDbPath(options = {}) {
  if (options.graphDbPath) return options.graphDbPath;
  if (process.env.THUMBGATE_LESSON_GRAPH_DB_PATH) {
    return process.env.THUMBGATE_LESSON_GRAPH_DB_PATH;
  }
  const { resolveFeedbackDir } = require('./feedback-paths');
  const dir = options.feedbackDir || resolveFeedbackDir(options);
  return path.join(dir, 'lesson-graph.sqlite');
}

/** @returns {import('better-sqlite3').Database} */
function initGraphDB(dbPath) {
  const Database = require('better-sqlite3');
  const resolvedPath = dbPath || resolveDefaultGraphDbPath();

  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(resolvedPath);
  db.pragma('busy_timeout = 3000');
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS lesson_nodes (
      id TEXT PRIMARY KEY,
      source_feedback_id TEXT,
      canonical_id TEXT,
      title TEXT,
      signal TEXT,
      canonical_hash TEXT,
      canonical_text TEXT,
      duplicate_count INTEGER NOT NULL DEFAULT 1,
      valid_from TEXT NOT NULL,
      valid_to TEXT,
      ingested_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_lesson_nodes_source_feedback
      ON lesson_nodes(source_feedback_id);
    CREATE INDEX IF NOT EXISTS idx_lesson_nodes_canonical_hash
      ON lesson_nodes(canonical_hash);
    CREATE INDEX IF NOT EXISTS idx_lesson_nodes_canonical_id
      ON lesson_nodes(canonical_id);

    CREATE TABLE IF NOT EXISTS lesson_edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      src TEXT NOT NULL,
      dst TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('supersedes','contradicts','duplicate_of','refines')),
      valid_from TEXT NOT NULL,
      valid_to TEXT,
      ingested_at TEXT NOT NULL,
      UNIQUE(src, dst, type)
    );

    CREATE INDEX IF NOT EXISTS idx_lesson_edges_src ON lesson_edges(src);
    CREATE INDEX IF NOT EXISTS idx_lesson_edges_dst ON lesson_edges(dst);
  `);

  return db;
}

/**
 * Open the graph DB only when its file already exists. The retrieval hot
 * path (PreToolUse hook) must never create new files in a feedback dir that
 * was never migrated — absence of the graph means "graph layer disabled".
 *
 * @returns {import('better-sqlite3').Database|null}
 */
function openGraphDBIfExists(options = {}) {
  try {
    const dbPath = resolveDefaultGraphDbPath(options);
    if (!fs.existsSync(dbPath)) return null;
    return initGraphDB(dbPath);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Node / edge primitives
// ---------------------------------------------------------------------------

function nowIso() {
  return new Date().toISOString();
}

function lessonSignal(lesson) {
  if (!lesson || typeof lesson !== 'object') return 'positive';
  if (lesson.signal === 'negative' || lesson.signal === 'positive') return lesson.signal;
  if (Array.isArray(lesson.tags) && lesson.tags.includes('negative')) return 'negative';
  if (lesson.feedback === 'down' || lesson.signal === 'down') return 'negative';
  return 'positive';
}

function lessonText(lesson) {
  if (!lesson || typeof lesson !== 'object') return '';
  return [lesson.title, lesson.content, lesson.whatWentWrong, lesson.whatToChange, lesson.context]
    .filter(Boolean)
    .map(String)
    .join(' ')
    .trim();
}

/**
 * Upsert a node. Preserves duplicate_count / canonical_id / valid_to on
 * conflict so re-registering a lesson never resets graph state (idempotent).
 */
function upsertNode(db, node) {
  if (!node || !node.id) return null;
  const { canonicalizeText } = require('./lesson-canonical');
  const canonicalText = node.canonicalText != null
    ? node.canonicalText
    : canonicalizeText(node.title || '');
  db.prepare(`
    INSERT INTO lesson_nodes
      (id, source_feedback_id, canonical_id, title, signal, canonical_hash, canonical_text,
       duplicate_count, valid_from, valid_to, ingested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      signal = excluded.signal,
      canonical_hash = COALESCE(excluded.canonical_hash, lesson_nodes.canonical_hash),
      canonical_text = COALESCE(excluded.canonical_text, lesson_nodes.canonical_text),
      source_feedback_id = COALESCE(excluded.source_feedback_id, lesson_nodes.source_feedback_id),
      duplicate_count = MAX(lesson_nodes.duplicate_count, excluded.duplicate_count)
  `).run(
    node.id,
    node.sourceFeedbackId || null,
    node.canonicalId || null,
    node.title != null ? String(node.title).slice(0, 500) : null,
    node.signal || 'positive',
    node.canonicalHash || null,
    canonicalText != null ? String(canonicalText).slice(0, 2000) : null,
    Number.isFinite(node.duplicateCount) && node.duplicateCount > 0 ? Math.floor(node.duplicateCount) : 1,
    node.validFrom || nowIso(),
    node.validTo || null,
    node.ingestedAt || nowIso(),
  );
  return node.id;
}

function getNode(db, id) {
  if (!id) return null;
  return db.prepare('SELECT * FROM lesson_nodes WHERE id = ?').get(id) || null;
}

/**
 * Resolve a lesson reference to a node id. References in correction text are
 * frequently truncated ("fb_1780589059204" for "fb_1780589059204_abc123"),
 * so fall back to a unique prefix match on id / source_feedback_id.
 */
function resolveNodeRef(db, ref) {
  if (!ref) return null;
  const exact = db.prepare(
    'SELECT id FROM lesson_nodes WHERE id = ? OR source_feedback_id = ? LIMIT 1',
  ).get(ref, ref);
  if (exact) return exact.id;

  const prefixPattern = String(ref) + '%';
  const prefixed = db.prepare(
    'SELECT id FROM lesson_nodes WHERE id LIKE ? OR source_feedback_id LIKE ? LIMIT 2',
  ).all(prefixPattern, prefixPattern);
  if (prefixed.length === 1) return prefixed[0].id;
  return null;
}

/**
 * Close a node's validity interval (it is no longer the current fact).
 * Only sets valid_to when currently open, preserving the first closure.
 */
function closeNodeValidity(db, id, at) {
  if (!id) return false;
  const result = db.prepare(
    'UPDATE lesson_nodes SET valid_to = ? WHERE id = ? AND valid_to IS NULL',
  ).run(at || nowIso(), id);
  return result.changes > 0;
}

/**
 * Add a typed edge src → dst. Idempotent (UNIQUE(src,dst,type) + OR IGNORE).
 * For supersedes/refines the old fact's valid_to is closed at the edge's
 * valid_from — the bitemporal contract of a correction.
 */
function addEdge(db, edge) {
  const { src, dst, type } = edge || {};
  if (!src || !dst || src === dst) return false;
  if (!EDGE_TYPES.includes(type)) {
    throw new Error('lesson-graph: unknown edge type "' + type + '"');
  }
  const validFrom = edge.validFrom || nowIso();
  const result = db.prepare(`
    INSERT OR IGNORE INTO lesson_edges (src, dst, type, valid_from, valid_to, ingested_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(src, dst, type, validFrom, edge.validTo || null, edge.ingestedAt || nowIso());

  if (LINEAGE_EDGE_TYPES.has(type)) {
    closeNodeValidity(db, dst, validFrom);
  }
  if (type === 'duplicate_of') {
    // The duplicate row is suppressed from day one; the canonical carries it.
    closeNodeValidity(db, src, validFrom);
  }
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Traversal
// ---------------------------------------------------------------------------

function canonicalOf(db, id) {
  const node = getNode(db, id);
  if (node && node.canonical_id && node.canonical_id !== id) return node.canonical_id;
  const dup = db.prepare(
    "SELECT dst FROM lesson_edges WHERE src = ? AND type = 'duplicate_of' LIMIT 1",
  ).get(id);
  return dup ? dup.dst : id;
}

function newestSuccessor(db, id) {
  const row = db.prepare(`
    SELECT src FROM lesson_edges
     WHERE dst = ? AND type IN ('supersedes','refines')
     ORDER BY valid_from DESC, id DESC
     LIMIT 1
  `).get(id);
  return row ? row.src : null;
}

/**
 * Follow duplicate_of → canonical, then supersedes/refines chains forward to
 * the CURRENT fact. Cycle-safe; bounded by MAX_TRAVERSAL_HOPS.
 *
 * @returns {{id: string, path: string[], hops: number}}
 */
function resolveCurrentId(db, id, options = {}) {
  const maxHops = Number.isFinite(options.maxHops) ? options.maxHops : MAX_TRAVERSAL_HOPS;
  const visited = new Set();
  let current = id;
  const chain = [id];

  for (let hop = 0; hop < maxHops; hop++) {
    if (visited.has(current)) break;
    visited.add(current);

    const canonical = canonicalOf(db, current);
    if (canonical !== current && !visited.has(canonical)) {
      current = canonical;
      chain.push(current);
      continue;
    }

    const successor = newestSuccessor(db, current);
    if (successor && !visited.has(successor)) {
      current = successor;
      chain.push(current);
      continue;
    }

    break;
  }

  return { id: current, path: chain, hops: chain.length - 1 };
}

/**
 * Lineage of a lesson: ordered chain from the referenced id to the current
 * fact, with the edge type taken at each hop.
 */
function getLineage(db, id, options = {}) {
  const { path: chain } = resolveCurrentId(db, id, options);
  const steps = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const edge = db.prepare(`
      SELECT type FROM lesson_edges
       WHERE ((src = ? AND dst = ?) OR (src = ? AND dst = ?))
         AND type IN ('supersedes','refines','duplicate_of')
       ORDER BY id DESC LIMIT 1
    `).get(chain[i + 1], chain[i], chain[i], chain[i + 1]);
    steps.push({ from: chain[i], to: chain[i + 1], type: edge ? edge.type : 'supersedes' });
  }
  return { currentId: chain[chain.length - 1], steps };
}

/**
 * A lesson is suppressed when it is not the current fact for its chain, or
 * its validity interval is closed in the past (bitemporal expiry).
 */
function isSuppressed(db, id, options = {}) {
  const node = getNode(db, id);
  if (!node) return false;
  const now = options.now ? new Date(options.now).getTime() : Date.now();
  const current = resolveCurrentId(db, id, options);
  if (current.id !== id) return true;
  if (node.valid_to) {
    const closedAt = new Date(node.valid_to).getTime();
    if (Number.isFinite(closedAt) && closedAt <= now) return true;
  }
  return false;
}

function contradictionBetween(db, aId, bId) {
  return db.prepare(`
    SELECT * FROM lesson_edges
     WHERE type = 'contradicts'
       AND ((src = ? AND dst = ?) OR (src = ? AND dst = ?))
     LIMIT 1
  `).get(aId, bId, bId, aId) || null;
}

// ---------------------------------------------------------------------------
// Ingest-time resolution
// ---------------------------------------------------------------------------

const CORRECTION_PATTERN = /\b(CORRECTION|REFINEMENT)\s+to\b/i;
const LESSON_ID_PATTERN = /\b((?:fb|mem|lesson)_[A-Za-z0-9]+(?:_[A-Za-z0-9]+)?)\b/;

/**
 * Detect "CORRECTION to <id>" / "REFINEMENT to <id>" markers. The referenced
 * id may follow immediately or appear in parentheses later in the sentence
 * ("REFINEMENT to the 2026-06-04 fix (fb_1780589059204)"), so scan a bounded
 * window after the marker for the first lesson-id token.
 *
 * @returns {{edgeType: 'supersedes'|'refines', targetRef: string}|null}
 */
function extractCorrectionTarget(text) {
  const scanned = String(text || '').slice(0, 600);
  const marker = scanned.match(CORRECTION_PATTERN);
  if (!marker) return null;
  const window = scanned.slice(marker.index, marker.index + 260);
  const idMatch = window.match(LESSON_ID_PATTERN);
  if (!idMatch) return null;
  return {
    edgeType: marker[1].toUpperCase() === 'CORRECTION' ? 'supersedes' : 'refines',
    targetRef: idMatch[1],
  };
}

function bigramSet(text) {
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const set = new Set();
  for (let i = 0; i < normalized.length - 1; i++) {
    set.add(normalized.slice(i, i + 2));
  }
  return set;
}

function bigramJaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Find the canonical current node this lesson duplicates, if any.
 * Two-layer match, both against OPEN canonical nodes of the same signal:
 *   1. canonical-hash equality (lesson-canonical.js — cross-schema, wording-drift safe)
 *   2. bigram Jaccard of canonicalized text >= DUPLICATE_SIMILARITY_THRESHOLD
 * An optional options.similarityFn(textA, textB) → 0..1 (e.g. cosine over
 * lancedb embeddings) is consulted as layer 3 when provided.
 */
function findDuplicateNode(db, lesson, options = {}) {
  const { canonicalHash, canonicalizeText } = require('./lesson-canonical');
  const signal = lessonSignal(lesson);
  const hash = canonicalHash(lesson) || null;

  if (hash) {
    const byHash = db.prepare(`
      SELECT * FROM lesson_nodes
       WHERE canonical_hash = ? AND signal = ? AND valid_to IS NULL
         AND (canonical_id IS NULL OR canonical_id = id)
       LIMIT 1
    `).get(hash, signal);
    if (byHash && byHash.id !== lesson.id) return byHash;
  }

  const text = canonicalizeText(lessonText(lesson));
  if (!text) return null;
  const grams = bigramSet(text);
  const threshold = Number.isFinite(options.similarityThreshold)
    ? options.similarityThreshold
    : DUPLICATE_SIMILARITY_THRESHOLD;

  const candidates = db.prepare(`
    SELECT * FROM lesson_nodes
     WHERE signal = ? AND valid_to IS NULL
       AND (canonical_id IS NULL OR canonical_id = id)
     ORDER BY ingested_at DESC
     LIMIT 500
  `).all(signal);

  for (const candidate of candidates) {
    if (candidate.id === lesson.id) continue;
    const candidateText = candidate.canonical_text || '';
    if (!candidateText) continue;
    if (bigramJaccard(grams, bigramSet(candidateText)) >= threshold) return candidate;
    if (typeof options.similarityFn === 'function') {
      try {
        const score = options.similarityFn(text, candidateText);
        if (Number.isFinite(score) && score >= threshold) return candidate;
      } catch {
        // best-effort external similarity — never break ingest
      }
    }
  }
  return null;
}

/**
 * Ingest-time entry point: register a newly captured lesson in the graph.
 *
 *   - CORRECTION/REFINEMENT markers → supersedes/refines edge to the target,
 *     closing the target's valid_to (the chain now resolves to this lesson).
 *   - High-confidence near-duplicate → increment the canonical node's
 *     duplicate_count and record a duplicate_of edge; NO new current fact.
 *   - Otherwise → plain new node.
 *
 * @returns {{status: 'superseding'|'refining'|'duplicate'|'new',
 *            id: string, canonicalId?: string, targetId?: string,
 *            duplicateCount?: number}}
 */
function registerLesson(db, lesson, options = {}) {
  if (!lesson || !lesson.id) return { status: 'new', id: null };
  const { canonicalHash, canonicalizeText } = require('./lesson-canonical');
  const validFrom = lesson.timestamp || nowIso();
  const ingestedAt = options.ingestedAt || nowIso();
  const baseNode = {
    id: lesson.id,
    sourceFeedbackId: lesson.sourceFeedbackId || null,
    title: lesson.title || lesson.context || null,
    signal: lessonSignal(lesson),
    canonicalHash: canonicalHash(lesson) || null,
    canonicalText: canonicalizeText(lessonText(lesson)),
    validFrom,
    ingestedAt,
  };

  const correction = extractCorrectionTarget(lessonText(lesson));
  if (correction) {
    const targetId = resolveNodeRef(db, correction.targetRef);
    if (targetId && targetId !== lesson.id) {
      upsertNode(db, baseNode);
      addEdge(db, {
        src: lesson.id,
        dst: targetId,
        type: correction.edgeType,
        validFrom,
        ingestedAt,
      });
      return {
        status: correction.edgeType === 'supersedes' ? 'superseding' : 'refining',
        id: lesson.id,
        targetId,
      };
    }
  }

  const duplicate = findDuplicateNode(db, lesson, options);
  if (duplicate) {
    db.prepare(
      'UPDATE lesson_nodes SET duplicate_count = duplicate_count + 1 WHERE id = ?',
    ).run(duplicate.id);
    upsertNode(db, { ...baseNode, canonicalId: duplicate.id, validTo: validFrom });
    addEdge(db, {
      src: lesson.id,
      dst: duplicate.id,
      type: 'duplicate_of',
      validFrom,
      ingestedAt,
    });
    const updated = getNode(db, duplicate.id);
    return {
      status: 'duplicate',
      id: lesson.id,
      canonicalId: duplicate.id,
      duplicateCount: updated ? updated.duplicate_count : null,
    };
  }

  upsertNode(db, baseNode);
  return { status: 'new', id: lesson.id };
}

// ---------------------------------------------------------------------------
// Retrieval-side resolution
// ---------------------------------------------------------------------------

function formatShortDate(iso) {
  const t = iso ? String(iso).slice(0, 10) : '';
  return t || 'unknown-date';
}

/**
 * Resolve a retrieved lesson list through the graph:
 *   (a) follow supersedes/refines edges to the CURRENT fact and return only
 *       that, with a one-line lineage note;
 *   (b) suppress superseded / expired / duplicate lessons;
 *   (c) when two retrieved lessons carry a contradicts edge, keep the newer
 *       valid one and note the conflict in ONE line instead of showing both.
 *
 * Content for a substituted current fact is looked up via options.lookup
 * (a Map<id, memoryRecord>) when available; otherwise the graph node's
 * stored title stands in.
 *
 * Pure with respect to its input list (returns new objects); never throws —
 * on any internal error callers fall back to the original list.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {Array<object>} lessons - retrieval hits (id/title/content/signal/timestamp)
 * @param {object} [options]
 * @param {Map<string, object>} [options.lookup] - id → full memory record
 * @param {string|number} [options.now]
 * @returns {Array<object>}
 */
function annotateAndFilterLessons(db, lessons, options = {}) {
  if (!Array.isArray(lessons) || lessons.length === 0) return [];

  const lookup = options.lookup instanceof Map ? options.lookup : null;
  const resolved = [];
  const seenCurrent = new Map(); // currentId → index in resolved

  for (const lesson of lessons) {
    if (!lesson || !lesson.id || !getNode(db, lesson.id)) {
      // Unknown to the graph — pass through untouched.
      resolved.push({ ...lesson });
      continue;
    }

    const { id: currentId, path: chain } = resolveCurrentId(db, lesson.id, options);
    const currentNode = getNode(db, currentId);

    // Expired current fact with no successor → suppress entirely.
    if (currentNode && currentNode.valid_to) {
      const closedAt = new Date(currentNode.valid_to).getTime();
      const now = options.now ? new Date(options.now).getTime() : Date.now();
      if (Number.isFinite(closedAt) && closedAt <= now) continue;
    }

    if (seenCurrent.has(currentId)) {
      // Another retrieved hit already collapsed onto this fact.
      const survivor = resolved[seenCurrent.get(currentId)];
      if (survivor && chain.length > 1 && !(survivor.lessonGraph && survivor.lessonGraph.lineageNote)) {
        survivor.lessonGraph = {
          ...(survivor.lessonGraph || {}),
          lineageNote: buildLineageNote(chain, currentNode),
        };
      }
      continue;
    }

    let shaped;
    if (currentId === lesson.id) {
      shaped = { ...lesson };
    } else {
      // Substitute the CURRENT fact for the stale hit.
      const record = lookup ? lookup.get(currentId) : null;
      shaped = record
        ? {
          ...lesson,
          id: record.id,
          title: record.title,
          content: record.content,
          signal: lessonSignal(record),
          timestamp: record.timestamp || lesson.timestamp,
          rule: record.structuredRule || null,
        }
        : {
          ...lesson,
          id: currentId,
          title: currentNode ? currentNode.title : lesson.title,
          content: currentNode ? currentNode.title : lesson.content,
          signal: currentNode ? currentNode.signal : lesson.signal,
          timestamp: currentNode ? currentNode.valid_from : lesson.timestamp,
        };
      shaped.lessonGraph = {
        ...(shaped.lessonGraph || {}),
        lineageNote: buildLineageNote(chain, currentNode),
      };
    }

    if (currentNode && currentNode.duplicate_count > 1) {
      shaped.lessonGraph = {
        ...(shaped.lessonGraph || {}),
        duplicateCount: currentNode.duplicate_count,
      };
    }

    // Mark the lesson as graph-vetted: it went through supersession/duplicate
    // resolution, so a mixed-signal result set is topic diversity, not an
    // unresolved knowledge conflict. gates-engine uses this to skip the
    // entropy-based conflict warning for fully vetted sets.
    shaped.lessonGraph = { ...(shaped.lessonGraph || {}), resolved: true };

    seenCurrent.set(currentId, resolved.length);
    resolved.push(shaped);
  }

  // Contradiction pass: for any surviving pair with a contradicts edge, keep
  // the newer valid lesson and fold the conflict into one line.
  const kept = [];
  const droppedByConflict = new Set();
  for (let i = 0; i < resolved.length; i++) {
    if (droppedByConflict.has(i)) continue;
    const a = resolved[i];
    if (!a.id || !getNode(db, a.id)) {
      kept.push(a);
      continue;
    }
    let aDropped = false;
    for (let j = i + 1; j < resolved.length; j++) {
      if (droppedByConflict.has(j)) continue;
      const b = resolved[j];
      if (!b.id || !getNode(db, b.id)) continue;
      if (!contradictionBetween(db, a.id, b.id)) continue;

      const aTime = a.timestamp ? new Date(a.timestamp).getTime() : -Infinity;
      const bTime = b.timestamp ? new Date(b.timestamp).getTime() : -Infinity;
      const winnerIsA = aTime >= bTime;
      const winner = winnerIsA ? a : b;
      const loser = winnerIsA ? b : a;
      winner.lessonGraph = {
        ...(winner.lessonGraph || {}),
        conflictNote: 'conflicts with ' + loser.id + ' (' + formatShortDate(loser.timestamp)
          + '); newer lesson kept',
      };
      if (winnerIsA) {
        droppedByConflict.add(j);
      } else {
        droppedByConflict.add(i);
        aDropped = true;
        break;
      }
    }
    if (!aDropped) kept.push(a);
  }

  return kept;
}

function buildLineageNote(chain, currentNode) {
  const hops = Math.max(1, chain.length - 1);
  const origin = chain[0];
  const currentId = chain[chain.length - 1];
  const since = currentNode ? formatShortDate(currentNode.valid_from) : 'unknown-date';
  return 'current fact (supersedes ' + hops + ' earlier version' + (hops === 1 ? '' : 's')
    + ': ' + origin + ' → ' + currentId + ', since ' + since + ')';
}

module.exports = {
  EDGE_TYPES,
  DUPLICATE_SIMILARITY_THRESHOLD,
  CONTRADICTION_SIMILARITY_THRESHOLD,
  initGraphDB,
  openGraphDBIfExists,
  resolveDefaultGraphDbPath,
  upsertNode,
  getNode,
  resolveNodeRef,
  closeNodeValidity,
  addEdge,
  resolveCurrentId,
  getLineage,
  isSuppressed,
  contradictionBetween,
  extractCorrectionTarget,
  findDuplicateNode,
  registerLesson,
  annotateAndFilterLessons,
  lessonSignal,
  lessonText,
};
