#!/usr/bin/env node
'use strict';

/**
 * Pragmatic hybrid search (Stage 1 of the defended RAG pipeline).
 *
 * Combines:
 *   - keyword / token overlap (BM25-ish via lesson-retrieval scoreRelevance)
 *   - character bigram-Jaccard (fuzzy paraphrase signal)
 * Optional:
 *   - SQLite FTS5 ranks when lesson-db is available (honest degrade if not)
 *
 * NOT a dense vector store. Name is intentional: practical hybrid without
 * requiring embeddings for the PreToolUse hot path.
 */

const {
  scoreRelevance,
  buildActionSignature,
  textBigrams,
  bigramJaccard,
  selectRetrievalMemories,
} = require('./lesson-retrieval');

const DEFAULT_LEXICAL_THRESHOLD = 0.6;
const DEFAULT_MAX_VARIANTS = 3;

/**
 * Generate up to maxVariants query strings. Multi-query is only used when the
 * caller's top lexical score is below threshold (see searchWithMultiQuery).
 *
 * Variants are deterministic — no LLM:
 *   1. original context
 *   2. synonym-expanded nouns (force-push ↔ push --force, etc.)
 *   3. tool-name + top content tokens
 */
function buildQueryVariants(toolName, actionContext, { maxVariants = DEFAULT_MAX_VARIANTS } = {}) {
  const original = String(actionContext || '').trim();
  const variants = [];
  if (original) variants.push(original);

  // Synonym expansion (mirror lesson-reranker clusters, keep small).
  const synonymGroups = [
    ['force-push', 'force push', 'push --force', 'git push --force'],
    ['main', 'main branch', 'master'],
    ['env', '.env', 'environment variable', 'secret'],
    ['deploy', 'deployment', 'release', 'publish'],
    ['delete', 'remove', 'rm', 'drop'],
    ['test', 'tests', 'spec', 'npm test'],
  ];
  let expanded = original.toLowerCase();
  for (const group of synonymGroups) {
    for (const term of group) {
      if (expanded.includes(term) && group[0] !== term) {
        expanded = expanded.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), group[0]);
        break;
      }
    }
  }
  if (expanded && expanded !== original.toLowerCase()) {
    variants.push(expanded);
  }

  // Tool-focused: "Bash: git push --force origin main"
  const tokens = original
    .toLowerCase()
    .replace(/[^\w\s./-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .slice(0, 8);
  if (toolName && tokens.length) {
    variants.push(`${toolName} ${tokens.join(' ')}`);
  }

  // Dedup preserve order, cap.
  const seen = new Set();
  const out = [];
  for (const v of variants) {
    const key = v.toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= maxVariants) break;
  }
  return out.length ? out : [original || String(toolName || 'action')];
}

/**
 * Score one memory against one query (keyword + bigram Jaccard blend).
 * Returns { relevanceScore, keywordScore, bigramScore }.
 */
function scoreLexical(memory, toolName, query) {
  const actionSig = buildActionSignature(toolName, query);
  const keywordScore = scoreRelevance(memory, toolName, query, actionSig);
  const memText = `${memory.title || ''} ${memory.content || ''}`.toLowerCase();
  const bigramScore = bigramJaccard(textBigrams(query), textBigrams(memText));
  // Blend: keyword carries structured tool/path signal; bigram catches paraphrase.
  const relevanceScore = keywordScore * 0.65 + bigramScore * 0.35;
  return { relevanceScore, keywordScore, bigramScore };
}

/**
 * Lexical hybrid search over an in-memory lesson list.
 *
 * @returns {{ results: Array, topScore: number, method: string }}
 */
function pragmaticHybridSearch(toolName, actionContext, memories, options = {}) {
  const maxResults = Number(options.maxResults) || 20;
  const minScore = Number.isFinite(options.minScore) ? options.minScore : 0.05;
  const list = selectRetrievalMemories(memories || [], options);

  const scored = list
    .map((mem) => {
      const scores = scoreLexical(mem, toolName, actionContext);
      return { ...mem, ...scores };
    })
    .filter((m) => m.relevanceScore > minScore)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, maxResults);

  return {
    results: scored,
    topScore: scored[0]?.relevanceScore || 0,
    method: 'pragmatic-hybrid:keyword+bigram-jaccard',
  };
}

/**
 * Multi-query wrapper: if top lexical < threshold, re-search with up to 3
 * variants and RRF-merge ranks.
 */
function searchWithMultiQuery(toolName, actionContext, memories, options = {}) {
  const threshold = Number.isFinite(options.lexicalThreshold)
    ? options.lexicalThreshold
    : DEFAULT_LEXICAL_THRESHOLD;
  const maxVariants = Number(options.maxVariants) || DEFAULT_MAX_VARIANTS;
  const maxResults = Number(options.maxResults) || 20;

  const primary = pragmaticHybridSearch(toolName, actionContext, memories, options);
  if (primary.topScore >= threshold || primary.results.length === 0) {
    return {
      ...primary,
      multiQuery: false,
      variants: [actionContext],
      threshold,
    };
  }

  const variants = buildQueryVariants(toolName, actionContext, { maxVariants });
  // Reciprocal rank fusion across variant result lists.
  const k = 60;
  const scores = new Map();
  const byId = new Map();
  for (const variant of variants) {
    const hit = pragmaticHybridSearch(toolName, variant, memories, {
      ...options,
      maxResults,
    });
    hit.results.forEach((row, index) => {
      const id = row.id || `${row.title}|${index}`;
      byId.set(id, row);
      const rank = index + 1;
      scores.set(id, (scores.get(id) || 0) + 1 / (k + rank));
    });
  }

  const fused = [...scores.entries()]
    .map(([id, score]) => {
      const row = byId.get(id);
      return {
        ...row,
        relevanceScore: Math.max(row.relevanceScore || 0, score),
        fusionScore: score,
      };
    })
    .sort((a, b) => (b.fusionScore || 0) - (a.fusionScore || 0))
    .slice(0, maxResults);

  return {
    results: fused,
    topScore: fused[0]?.relevanceScore || 0,
    method: 'pragmatic-hybrid:multi-query-rrf',
    multiQuery: true,
    variants,
    threshold,
  };
}

/**
 * Optional FTS5 boost: when lesson-db is available, merge FTS ranks via RRF.
 * Never required — PreToolUse stays fast without sqlite.
 */
function tryFtsBoost(query, feedbackDir) {
  try {
    const path = require('path');
    const fs = require('fs');
    const lessonDb = require('./lesson-db');
    const dbPath = feedbackDir
      ? path.join(feedbackDir, 'lessons.sqlite')
      : path.join(require('./feedback-paths').resolveFeedbackDir({}), 'lessons.sqlite');
    if (!fs.existsSync(dbPath)) return null;
    const db = lessonDb.initDB(dbPath);
    try {
      const rows = lessonDb.searchLessons(db, query, { limit: 20 });
      return rows.map((r) => r.id).filter(Boolean);
    } finally {
      if (typeof db.close === 'function') db.close();
    }
  } catch {
    return null;
  }
}

module.exports = {
  DEFAULT_LEXICAL_THRESHOLD,
  DEFAULT_MAX_VARIANTS,
  buildQueryVariants,
  scoreLexical,
  pragmaticHybridSearch,
  searchWithMultiQuery,
  tryFtsBoost,
  textBigrams,
  bigramJaccard,
};
