#!/usr/bin/env node
'use strict';

/**
 * Per-action lesson retrieval.
 * v3: bi-encoder retrieval → cross-encoder reranking
 *
 * Stage 1 (bi-encoder): score all memories independently using token overlap,
 *   bigram Jaccard, tool-name matching, and recency decay.  Retrieve top-50.
 * Stage 2 (cross-encoder): rerank the top-50 candidates by computing a
 *   field-weighted BM25 score that processes (query, lesson) jointly, then
 *   blend with the original bi-encoder score.  Return top-maxResults.
 */

const RECENCY_DECAY_DAYS = 30;
const RERANK_CANDIDATE_POOL = 50; // bi-encoder retrieves this many; reranker picks topK
const MIN_QUALITY_SCORE = 2.5; // lessons scoring below this in G-Eval are excluded from retrieval

function retrieveRelevantLessons(toolName, actionContext, options = {}) {
  const { maxResults = 5, feedbackDir, skipQualityFilter } = options;
  const { getFeedbackPaths, readJSONL } = require('./feedback-loop');
  const { rerankLessons } = require('./lesson-reranker');
  const pathMod = require('path');
  const paths = feedbackDir
    ? { MEMORY_LOG_PATH: pathMod.join(feedbackDir, 'memory-log.jsonl') }
    : getFeedbackPaths();

  const memories = readJSONL(paths.MEMORY_LOG_PATH, { maxLines: 200 });
  if (memories.length === 0) return [];

  // Quality gate: exclude lessons that scored below the threshold in G-Eval.
  // Scores are indexed by lesson ID in quality-eval-log.jsonl.
  if (!skipQualityFilter) {
    const qualityScores = loadQualityScores(feedbackDir);
    if (qualityScores.size > 0) {
      const before = memories.length;
      const filtered = memories.filter((mem) => {
        // Match by lesson content text (eval log indexes by item.lesson)
        const score = qualityScores.get(mem.content || mem.lesson);
        // Keep lessons that haven't been evaluated yet (no score) or pass the threshold
        return score === undefined || score >= MIN_QUALITY_SCORE;
      });
      // Only apply filter if it doesn't eliminate everything
      if (filtered.length > 0) {
        memories.length = 0;
        memories.push(...filtered);
      }
    }
  }

  const actionSig = buildActionSignature(toolName, actionContext);

  // Stage 1 — bi-encoder: score all memories independently, take top-50 candidates
  const candidates = memories
    .map((mem) => ({
      ...mem,
      relevanceScore: scoreRelevance(mem, toolName, actionContext, actionSig),
    }))
    .filter((m) => m.relevanceScore > 0.1)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, RERANK_CANDIDATE_POOL);

  if (candidates.length === 0) return [];

  // Stage 2 — cross-encoder reranker: rerank candidates by joint (query, lesson) score
  const reranked = rerankLessons(actionContext, candidates, {
    topK: maxResults,
    toolName,
  });

  return reranked.map((m) => ({
    id: m.id,
    title: m.title,
    content: m.content,
    signal: m.tags?.includes('negative') ? 'negative' : 'positive',
    rule: m.structuredRule || null,
    relevanceScore: m.rerankedScore ?? m.relevanceScore,
    timestamp: m.timestamp,
  }));
}

function buildActionSignature(toolName, actionContext) {
  const toolLower = (toolName || '').toLowerCase();
  const contextLower = (actionContext || '').toLowerCase();
  const sigPaths = extractPaths(actionContext);
  const tokens = tokenize(contextLower);
  const ngramSet = textBigrams(contextLower);
  return { toolLower, contextLower, paths: sigPaths, tokens, ngramSet };
}

function textBigrams(text) {
  const normalized = (text || '')
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

function bigramJaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function scoreRelevance(memory, toolName, actionContext, actionSig) {
  const sig = actionSig || buildActionSignature(toolName, actionContext);
  let score = 0;

  const memText = ((memory.title || '') + ' ' + (memory.content || '') + ' ' + (memory.tags || []).join(' ')).toLowerCase();

  if (memory.metadata?.toolsUsed?.some((t) => t.toLowerCase() === sig.toolLower)) score += 0.4;
  if (memText.includes(sig.toolLower)) score += 0.2;

  const memPaths = memory.metadata?.filesInvolved || extractPaths(memText);
  const pathOverlap = sig.paths.filter((p) =>
    memPaths.some((mp) => mp.includes(p) || p.includes(mp)),
  );
  if (pathOverlap.length > 0) score += 0.3;

  const memTokens = tokenize(memText);
  const overlap = sig.tokens.filter((t) => memTokens.includes(t));
  score += Math.min(overlap.length * 0.05, 0.3);

  // Fuzzy n-gram matching (only when there is already signal)
  if (score > 0) {
    const memBigrams = textBigrams(memText);
    const fuzzyScore = bigramJaccard(sig.ngramSet, memBigrams);
    score += fuzzyScore * 0.2;
  }

  if (memory.tags?.includes('negative')) score += 0.1;

  if (memory.timestamp) {
    const ageMs = Date.now() - new Date(memory.timestamp).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const decay = Math.max(0, 1 - ageDays / RECENCY_DECAY_DAYS);
    score *= 0.5 + 0.5 * decay;
  }

  if (memory.structuredRule) score += 0.15;

  return score;
}

function loadQualityScores(feedbackDir) {
  const fs = require('fs');
  const pathMod = require('path');
  const scores = new Map();
  try {
    const { resolveFeedbackDir } = require('./feedback-paths');
    const dir = feedbackDir || resolveFeedbackDir({});
    const logPath = pathMod.join(dir, 'quality-eval-log.jsonl');
    if (!fs.existsSync(logPath)) return scores;
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'lesson' && entry.item && entry.item.lesson) {
          // Index by lesson text since eval log stores the item, not the lesson ID
          scores.set(entry.item.lesson, entry.average);
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // non-fatal — return empty map
  }
  return scores;
}

function extractPaths(text) {
  return [...new Set((text || '').match(/(?:src\/|scripts\/|tests\/)[^\s,)'"<>]+/g) || [])];
}

function tokenize(text) {
  return (text || '').split(/[\s.,;:!?()\[\]{}"'`]+/).filter((t) => t.length > 3);
}

module.exports = {
  MIN_QUALITY_SCORE,
  retrieveRelevantLessons,
  scoreRelevance,
  buildActionSignature,
  textBigrams,
  bigramJaccard,
};
