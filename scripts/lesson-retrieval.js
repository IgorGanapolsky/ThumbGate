#!/usr/bin/env node
'use strict';

/**
 * Per-action lesson retrieval.
 * v2: backward retrieval + bigram Jaccard fuzzy matching
 */

const RECENCY_DECAY_DAYS = 30;

function retrieveRelevantLessons(toolName, actionContext, options = {}) {
  const { maxResults = 5, feedbackDir } = options;
  const { getFeedbackPaths, readJSONL } = require('./feedback-loop');
  const pathMod = require('path');
  const paths = feedbackDir
    ? { MEMORY_LOG_PATH: pathMod.join(feedbackDir, 'memory-log.jsonl') }
    : getFeedbackPaths();

  const memories = readJSONL(paths.MEMORY_LOG_PATH, { maxLines: 200 });
  if (memories.length === 0) return [];

  const actionSig = buildActionSignature(toolName, actionContext);

  const scored = memories.map((mem) => ({
    ...mem,
    relevanceScore: scoreRelevance(mem, toolName, actionContext, actionSig),
  }));

  return scored
    .filter((m) => m.relevanceScore > 0.1)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, maxResults)
    .map((m) => ({
      id: m.id,
      title: m.title,
      content: m.content,
      signal: m.tags?.includes('negative') ? 'negative' : 'positive',
      rule: m.structuredRule || null,
      relevanceScore: m.relevanceScore,
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

function extractPaths(text) {
  return [...new Set((text || '').match(/(?:src\/|scripts\/|tests\/)[^\s,)'"<>]+/g) || [])];
}

function tokenize(text) {
  return (text || '').split(/[\s.,;:!?()\[\]{}"'`]+/).filter((t) => t.length > 3);
}

module.exports = {
  retrieveRelevantLessons,
  scoreRelevance,
  buildActionSignature,
  textBigrams,
  bigramJaccard,
};
