#!/usr/bin/env node
'use strict';

/**
 * Per-action lesson retrieval.
 * Given a tool name + context, returns the top-K most relevant lessons
 * using keyword matching + recency decay + signal weighting.
 */

const RECENCY_DECAY_DAYS = 30; // lessons older than this get down-weighted

function retrieveRelevantLessons(toolName, actionContext, options = {}) {
  const { maxResults = 5, feedbackDir } = options;
  const { getFeedbackPaths, readJSONL } = require('./feedback-loop');
  const pathMod = require('path');
  const paths = feedbackDir
    ? { MEMORY_LOG_PATH: pathMod.join(feedbackDir, 'memory-log.jsonl') }
    : getFeedbackPaths();

  const memories = readJSONL(paths.MEMORY_LOG_PATH, { maxLines: 200 });
  if (memories.length === 0) return [];

  // Score each memory against the current action
  const scored = memories.map((mem) => ({
    ...mem,
    relevanceScore: scoreRelevance(mem, toolName, actionContext),
  }));

  // Sort by relevance, return top-K
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

function scoreRelevance(memory, toolName, actionContext) {
  let score = 0;

  const memText = `${memory.title || ''} ${memory.content || ''} ${(memory.tags || []).join(' ')}`.toLowerCase();
  const contextLower = (actionContext || '').toLowerCase();
  const toolLower = (toolName || '').toLowerCase();

  // 1. Tool name match (high weight)
  if (memory.metadata?.toolsUsed?.some((t) => t.toLowerCase() === toolLower)) score += 0.4;
  if (memText.includes(toolLower)) score += 0.2;

  // 2. File path overlap
  const contextPaths = extractPaths(actionContext);
  const memPaths = memory.metadata?.filesInvolved || extractPaths(memText);
  const pathOverlap = contextPaths.filter((p) =>
    memPaths.some((mp) => mp.includes(p) || p.includes(mp)),
  );
  if (pathOverlap.length > 0) score += 0.3;

  // 3. Keyword overlap (TF-IDF-lite)
  const contextTokens = tokenize(contextLower);
  const memTokens = tokenize(memText);
  const overlap = contextTokens.filter((t) => memTokens.includes(t));
  score += Math.min(overlap.length * 0.05, 0.3);

  // 4. Signal weighting — negative lessons are more important to surface
  if (memory.tags?.includes('negative')) score += 0.1;

  // 5. Recency decay
  if (memory.timestamp) {
    const ageMs = Date.now() - new Date(memory.timestamp).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const decay = Math.max(0, 1 - ageDays / RECENCY_DECAY_DAYS);
    score *= 0.5 + 0.5 * decay; // 50% base + 50% recency
  }

  // 6. Structured rule bonus — IF/THEN rules are more actionable
  if (memory.structuredRule) score += 0.15;

  return score;
}

function extractPaths(text) {
  return [...new Set((text || '').match(/(?:src\/|scripts\/|tests\/)[^\s,)'"<>]+/g) || [])];
}

function tokenize(text) {
  return (text || '').split(/[\s.,;:!?()\[\]{}"'`]+/).filter((t) => t.length > 3);
}

module.exports = { retrieveRelevantLessons, scoreRelevance };
