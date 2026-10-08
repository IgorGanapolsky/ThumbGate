#!/usr/bin/env node
'use strict';

// Rebuild the optional graph from JSONL without modifying source records.
// Existing SQLite state is backed up with VACUUM INTO before the atomic rebuild.
// Only complete, equal scopes can cluster or acquire lineage/contradiction edges.

const fs = require('node:fs');
const path = require('node:path');
const { readJsonl } = require('./fs-utils');
const { canonicalHash, canonicalizeText } = require('./lesson-canonical');
const {
  initGraphDB,
  upsertNode,
  addEdge,
  scopeKey, sameScope, sameScopeIdentity,
  extractCorrectionTarget,
  lessonSignal,
  lessonText,
  DUPLICATE_SIMILARITY_THRESHOLD,
  CONTRADICTION_SIMILARITY_THRESHOLD,
} = require('./lesson-graph');

// Bound the O(n^2) fuzzy passes. At the observed store sizes (hundreds to a
// few thousand rows) this completes in seconds; beyond the cap we keep the
// exact-hash clustering (which is O(n)) and skip only the fuzzy pass.
const MAX_FUZZY_RECORDS = 5000;

function parseArgs(argv) {
  const args = { dryRun: false, json: false, feedbackDir: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--feedback-dir') args.feedbackDir = argv[++i];
    else if (arg.startsWith('--feedback-dir=')) args.feedbackDir = arg.split('=')[1];
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function bigramSet(text) {
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const set = new Set();
  for (let i = 0; i < normalized.length - 1; i++) set.add(normalized.slice(i, i + 2));
  return set;
}

function bigramJaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Normalize one store record (memory record OR feedback event) into the
 * planning shape. Feedback events have no title; their context is the text.
 */
function toPlanRecord(record, source) {
  if (!record || !record.id) return null;
  const text = lessonText(record);
  return {
    id: record.id,
    ...require('./memory-scope-readiness').normalizeScope(record),
    source, // 'memory' | 'feedback'
    sourceFeedbackId: record.sourceFeedbackId || null,
    title: record.title || record.context || null,
    signal: lessonSignal(record),
    text,
    canonicalText: canonicalizeText(text),
    hash: canonicalHash(record) || null,
    timestamp: record.timestamp || record.receivedAt || null,
    occurrences: Number.isFinite(record.occurrences) && record.occurrences > 0
      ? Math.floor(record.occurrences)
      : 1,
  };
}

/**
 * Cluster records into duplicate groups: union by canonical hash first, then
 * merge near-identical canonical texts (>= DUPLICATE_SIMILARITY_THRESHOLD)
 * within the same signal. Canonical member = earliest timestamp (the store's
 * first sighting), matching the existing merge semantics in feedback-loop.
 */
function clusterDuplicates(records) {
  const parent = new Map();
  const find = (x) => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    let cursor = x;
    while (parent.get(cursor) !== cursor) {
      const next = parent.get(cursor);
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const rec of records) parent.set(rec.id, rec.id);

  // Pass 1 — exact canonical-hash groups (per signal).
  const byHash = new Map();
  for (const rec of records) {
    if (!rec.hash) continue;
    if (!scopeKey(rec)) continue;
    const key = scopeKey(rec) + ':' + rec.signal + ':' + rec.hash;
    if (byHash.has(key)) union(rec.id, byHash.get(key));
    else byHash.set(key, rec.id);
  }

  // Pass 1b — exact canonical-text groups (hash can differ across schemas).
  const byText = new Map();
  for (const rec of records) {
    if (!rec.canonicalText) continue;
    if (!scopeKey(rec)) continue;
    const key = scopeKey(rec) + ':' + rec.signal + ':' + rec.canonicalText;
    if (byText.has(key)) union(rec.id, byText.get(key));
    else byText.set(key, rec.id);
  }

  // Pass 2 — fuzzy near-duplicates within the same signal (bounded).
  if (records.length <= MAX_FUZZY_RECORDS) {
    const withGrams = records
      .filter((r) => r.canonicalText && r.canonicalText.length >= 8)
      .map((r) => ({ rec: r, grams: bigramSet(r.canonicalText) }));
    for (let i = 0; i < withGrams.length; i++) {
      for (let j = i + 1; j < withGrams.length; j++) {
        const a = withGrams[i];
        const b = withGrams[j];
        if (a.rec.signal !== b.rec.signal || !sameScope(a.rec, b.rec)) continue;
        if (find(a.rec.id) === find(b.rec.id)) continue;
        if (bigramJaccard(a.grams, b.grams) >= DUPLICATE_SIMILARITY_THRESHOLD) {
          union(a.rec.id, b.rec.id);
        }
      }
    }
  }

  const byId = new Map(records.map((r) => [r.id, r]));
  const clusters = new Map();
  for (const rec of records) {
    const root = find(rec.id);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(rec);
  }

  const result = [];
  for (const members of clusters.values()) {
    members.sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : Infinity;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : Infinity;
      return ta - tb;
    });
    // Prefer a memory record as canonical when the cluster mixes sources —
    // memory records carry the promoted content retrieval actually uses.
    const canonical = members.find((m) => m.source === 'memory') || members[0];
    result.push({ canonical, members });
  }
  return { clusters: result, byId };
}

/**
 * Build the full migration plan (pure — no writes).
 */
function buildPlan(feedbackDir) {
  const memoryLogPath = path.join(feedbackDir, 'memory-log.jsonl');
  const feedbackLogPath = path.join(feedbackDir, 'feedback-log.jsonl');

  const memoryRecords = readJsonl(memoryLogPath)
    .map((r) => toPlanRecord(r, 'memory'))
    .filter(Boolean);
  const memoryFeedbackIds = new Set(
    memoryRecords.filter(r => r.sourceFeedbackId && scopeKey(r)).map(r => scopeKey(r) + ':' + r.sourceFeedbackId),
  );
  // Feedback events already promoted into a memory record are represented by
  // that record; only unpromoted events need their own nodes for clustering.
  const feedbackRecords = readJsonl(feedbackLogPath)
    .filter((r) => r && r.id && !memoryFeedbackIds.has(scopeKey(r) + ':' + r.id))
    .map((r) => toPlanRecord(r, 'feedback'))
    .filter(Boolean);

  const byIdentity = new Map();
  for (const record of [...memoryRecords, ...feedbackRecords]) {
    const existing = byIdentity.get(record.id);
    if (existing && !sameScopeIdentity(existing, record)) throw new Error('lesson-graph: duplicate id across scopes');
    if (!existing) byIdentity.set(record.id, record);
  }
  const all = [...byIdentity.values()];
  const { clusters, byId } = clusterDuplicates(all);

  const duplicateEdges = [];
  const canonicalById = new Map();
  let collapsedRecords = 0;
  let largestCluster = { size: 0, title: null };
  for (const { canonical, members } of clusters) {
    const clusterCount = members.reduce((sum, m) => sum + m.occurrences, 0);
    canonical.duplicateCount = clusterCount;
    if (clusterCount > largestCluster.size) {
      largestCluster = {
        size: clusterCount,
        title: (canonical.title || canonical.text || '').slice(0, 80),
      };
    }
    for (const member of members) {
      canonicalById.set(member.id, canonical.id);
      if (member.id === canonical.id) continue;
      collapsedRecords += 1;
      duplicateEdges.push({
        src: member.id,
        dst: canonical.id,
        type: 'duplicate_of',
        validFrom: member.timestamp || canonical.timestamp || new Date().toISOString(),
      });
    }
  }

  // Supersession chains from CORRECTION/REFINEMENT markers.
  const lineageEdges = [];
  const unresolvedRefs = [];
  const resolveRef = (ref, selfId) => {
    if (byId.has(ref) && ref !== selfId && sameScope(byId.get(ref), byId.get(selfId))) return ref;
    const matches = [];
    for (const rec of all) {
      if (rec.id === selfId || !sameScope(rec, byId.get(selfId))) continue;
      if (rec.id.startsWith(ref) || (rec.sourceFeedbackId && rec.sourceFeedbackId.startsWith(ref))) {
        matches.push(rec.id);
        if (matches.length > 1) break;
      }
    }
    return matches.length === 1 ? matches[0] : null;
  };
  for (const rec of all) {
    const correction = extractCorrectionTarget(rec.text);
    if (!correction) continue;
    const targetId = canonicalById.get(resolveRef(correction.targetRef, rec.id));
    if (!targetId) {
      unresolvedRefs.push({ id: rec.id, ref: correction.targetRef });
      continue;
    }
    lineageEdges.push({
      src: rec.id,
      dst: targetId,
      type: correction.edgeType,
      validFrom: rec.timestamp || new Date().toISOString(),
    });
  }

  // Contradiction candidates among cluster canonicals: same topic, opposite
  // signal, not already related through lineage or duplication.
  const related = new Set();
  for (const e of [...duplicateEdges, ...lineageEdges]) {
    related.add(e.src + '|' + e.dst);
    related.add(e.dst + '|' + e.src);
  }
  const contradictionEdges = [];
  const canonicals = clusters
    .map((c) => c.canonical)
    .filter((r) => r.canonicalText && r.canonicalText.length >= 8);
  if (canonicals.length <= MAX_FUZZY_RECORDS) {
    const withGrams = canonicals.map((r) => ({ rec: r, grams: bigramSet(r.canonicalText) }));
    for (let i = 0; i < withGrams.length; i++) {
      for (let j = i + 1; j < withGrams.length; j++) {
        const a = withGrams[i].rec;
        const b = withGrams[j].rec;
        if (a.signal === b.signal || !sameScope(a, b)) continue;
        if (related.has(a.id + '|' + b.id)) continue;
        const sim = bigramJaccard(withGrams[i].grams, withGrams[j].grams);
        if (sim < CONTRADICTION_SIMILARITY_THRESHOLD) continue;
        const aTime = a.timestamp ? new Date(a.timestamp).getTime() : -Infinity;
        const bTime = b.timestamp ? new Date(b.timestamp).getTime() : -Infinity;
        const newer = aTime >= bTime ? a : b;
        const older = aTime >= bTime ? b : a;
        contradictionEdges.push({
          src: newer.id,
          dst: older.id,
          type: 'contradicts',
          validFrom: newer.timestamp || new Date().toISOString(),
        });
      }
    }
  }

  return {
    feedbackDir,
    memoryLogPath,
    feedbackLogPath,
    records: all,
    clusters,
    stats: {
      memoryRecords: memoryRecords.length,
      feedbackEvents: feedbackRecords.length,
      totalRecords: all.length,
      clusters: clusters.length,
      duplicateClustersCollapsed: clusters.filter((c) => c.members.length > 1).length,
      recordsCollapsedIntoCanonicals: collapsedRecords,
      largestCluster,
      supersessionEdges: lineageEdges.filter((e) => e.type === 'supersedes').length,
      refinementEdges: lineageEdges.filter((e) => e.type === 'refines').length,
      contradictionEdges: contradictionEdges.length,
      unresolvedCorrectionRefs: unresolvedRefs.length,
    },
    duplicateEdges,
    lineageEdges,
    contradictionEdges,
    unresolvedRefs,
  };
}

function backupExistingGraph(graphDbPath) {
  if (!fs.existsSync(graphDbPath)) return null;
  const backupPath = graphDbPath + '.bak-' + require('node:crypto').randomUUID();
  const Database = require('better-sqlite3');
  const db = new Database(graphDbPath, { fileMustExist: true });
  try {
    db.prepare('VACUUM INTO ?').run(backupPath);
  } finally {
    db.close();
  }
  return backupPath;
}

function applyPlan(plan, graphDbPath) {
  const backupPath = backupExistingGraph(graphDbPath);
  const db = initGraphDB(graphDbPath);
  const ingestedAt = new Date().toISOString();

  const canonicalIds = new Map();
  for (const { canonical, members } of plan.clusters) {
    for (const member of members) {
      if (member.id !== canonical.id) canonicalIds.set(member.id, canonical.id);
    }
  }

  const run = db.transaction(() => {
    db.exec('DELETE FROM lesson_edges; DELETE FROM lesson_nodes;');
    for (const rec of plan.records) {
      upsertNode(db, {
        id: rec.id,
        ...require('./memory-scope-readiness').normalizeScope(rec),
        sourceFeedbackId: rec.sourceFeedbackId,
        canonicalId: canonicalIds.get(rec.id) || null,
        title: rec.title || (rec.text || '').slice(0, 200),
        signal: rec.signal,
        canonicalHash: rec.hash,
        canonicalText: rec.canonicalText,
        duplicateCount: rec.duplicateCount || 1,
        validFrom: rec.timestamp || ingestedAt,
        ingestedAt,
      });
    }
    for (const edge of plan.duplicateEdges) addEdge(db, { ...edge, ingestedAt });
    for (const edge of plan.lineageEdges) addEdge(db, { ...edge, ingestedAt });
    for (const edge of plan.contradictionEdges) addEdge(db, { ...edge, ingestedAt });
  });
  run();

  const nodeCount = db.prepare('SELECT COUNT(*) AS c FROM lesson_nodes').get().c;
  const edgeCounts = db.prepare(
    'SELECT type, COUNT(*) AS c FROM lesson_edges GROUP BY type ORDER BY type',
  ).all();
  db.close();

  return { backupPath, graphDbPath, nodeCount, edgeCounts };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/migrate-lesson-graph.js [--dry-run] [--feedback-dir <dir>] [--json]');
    return 0;
  }

  const { resolveFeedbackDir } = require('./feedback-paths');
  const feedbackDir = args.feedbackDir || resolveFeedbackDir({});
  if (!fs.existsSync(path.join(feedbackDir, 'memory-log.jsonl'))
    && !fs.existsSync(path.join(feedbackDir, 'feedback-log.jsonl'))) {
    console.error('migrate-lesson-graph: no lesson store found in ' + feedbackDir);
    return 1;
  }

  const plan = buildPlan(feedbackDir);
  const graphDbPath = path.join(feedbackDir, 'lesson-graph.sqlite');

  if (args.dryRun) {
    const output = {
      mode: 'dry-run',
      feedbackDir,
      graphDbPath,
      wouldWrite: [graphDbPath],
      stats: plan.stats,
      sampleChains: plan.lineageEdges.slice(0, 5),
      sampleContradictions: plan.contradictionEdges.slice(0, 5),
    };
    console.log(args.json ? JSON.stringify(output) : JSON.stringify(output, null, 2));
    return 0;
  }

  const applied = applyPlan(plan, graphDbPath);
  const output = {
    mode: 'apply',
    feedbackDir,
    graphDbPath: applied.graphDbPath,
    backupPath: applied.backupPath,
    stats: plan.stats,
    graph: {
      nodes: applied.nodeCount,
      edges: applied.edgeCounts,
    },
  };
  console.log(args.json ? JSON.stringify(output) : JSON.stringify(output, null, 2));
  return 0;
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  process.exitCode = main();
}

module.exports = { buildPlan, applyPlan, clusterDuplicates, toPlanRecord, parseArgs };
