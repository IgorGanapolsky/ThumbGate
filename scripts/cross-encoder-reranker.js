#!/usr/bin/env node
'use strict';

/**
 * Cross-Encoder Reranker for ThumbGate lesson retrieval.
 *
 * Two-stage retrieval:
 *   Stage 1: Fast candidate retrieval (existing bigram Jaccard + keyword matching)
 *   Stage 2: Cross-encoder reranking scores query-document pairs jointly
 *
 * The cross-encoder evaluates the query AND each lesson together (not independently),
 * catching false positives that keyword/vector search misses.
 *
 * Architecture reference: "Advanced RAG Retrieval: Cross-Encoders & Reranking"
 * (Towards Data Science, April 2026)
 *
 * When LLM is available (ANTHROPIC_API_KEY), uses Claude as the cross-encoder.
 * Falls back to enhanced heuristic scoring when LLM is unavailable.
 */

const { retrieveRelevantLessons, scoreRelevance, buildActionSignature } = require('./lesson-retrieval');

/**
 * Heuristic cross-encoder: scores a (query, document) pair jointly.
 * Unlike bi-encoder (independent embeddings), this examines the pair together
 * to find semantic relationships that keyword matching misses.
 */
function heuristicCrossEncode(query, document) {
  const queryLower = (query || '').toLowerCase();
  const docLower = (document || '').toLowerCase();

  let score = 0;

  // 1. Exact substring containment (strongest signal)
  if (queryLower.length > 3 && docLower.length > 3 &&
      (docLower.includes(queryLower) || queryLower.includes(docLower))) {
    score += 0.9;
    return Math.min(score, 1.0);
  }

  // 2. Shared noun phrases (not just tokens — consecutive word pairs)
  const queryPhrases = extractPhrases(queryLower);
  const docPhrases = extractPhrases(docLower);
  const phraseOverlap = queryPhrases.filter((p) => docPhrases.includes(p));
  score += Math.min(phraseOverlap.length * 0.15, 0.5);

  // 3. Semantic category matching
  const categories = {
    destructive: ['delete', 'remove', 'drop', 'destroy', 'wipe', 'truncate', 'rm -rf', 'force-push', 'reset --hard'],
    git: ['git', 'push', 'pull', 'merge', 'rebase', 'branch', 'commit', 'checkout', 'stash'],
    database: ['sql', 'query', 'table', 'migration', 'schema', 'database', 'insert', 'update', 'select'],
    deploy: ['deploy', 'release', 'publish', 'railway', 'vercel', 'heroku', 'npm publish'],
    security: ['secret', 'token', 'api key', 'password', 'credential', 'env', '.env', 'pem'],
    file: ['edit', 'write', 'create', 'modify', 'config', 'package.json', 'readme'],
  };

  for (const [, terms] of Object.entries(categories)) {
    const queryHit = terms.some((t) => queryLower.includes(t));
    const docHit = terms.some((t) => docLower.includes(t));
    if (queryHit && docHit) {
      score += 0.25;
      break; // Only count strongest category match
    }
  }

  // 4. Action-target alignment (e.g., "git push" in query matches "push to main" in doc)
  const queryVerbs = extractVerbs(queryLower);
  const docVerbs = extractVerbs(docLower);
  const verbOverlap = queryVerbs.filter((v) => docVerbs.includes(v));
  score += Math.min(verbOverlap.length * 0.1, 0.3);

  // 5. Negation alignment (both about what NOT to do)
  const queryNegated = /\b(don'?t|never|avoid|block|prevent|stop)\b/.test(queryLower);
  const docNegated = /\b(don'?t|never|avoid|block|prevent|stop)\b/.test(docLower);
  if (queryNegated && docNegated) score += 0.1;

  return Math.min(score, 1.0);
}

/**
 * LLM cross-encoder: uses Claude to score relevance of query-document pairs.
 * More accurate but requires API key and costs tokens.
 */
async function llmCrossEncode(query, documents) {
  const { isAvailable, callClaude, MODELS } = require('./llm-client');
  if (!isAvailable()) return null;

  const docList = documents
    .map((d, i) => `[${i}] ${(d.title || '').slice(0, 100)} | ${(d.content || '').slice(0, 200)}`)
    .join('\n');

  const prompt = `You are a relevance scoring engine. Given a query and a list of documents, score each document's relevance to the query from 0.0 (irrelevant) to 1.0 (highly relevant).

Query: "${query.slice(0, 300)}"

Documents:
${docList}

Return ONLY a JSON array of scores, one per document. Example: [0.9, 0.2, 0.7, 0.1, 0.5]
No other text.`;

  try {
    const raw = await callClaude({
      systemPrompt: 'You are a relevance scoring engine. Return only JSON arrays of numbers.',
      userPrompt: prompt,
      model: MODELS.FAST,
      maxTokens: 256,
    });
    const scores = JSON.parse(raw);
    if (Array.isArray(scores) && scores.length === documents.length) {
      return scores.map((s) => Math.max(0, Math.min(1, Number(s) || 0)));
    }
  } catch { /* fall back to heuristic */ }
  return null;
}

/**
 * Two-stage retrieval with cross-encoder reranking.
 *
 * Stage 1: Retrieve top N candidates using existing keyword + bigram matching
 * Stage 2: Rerank candidates using cross-encoder (LLM or heuristic)
 * Return top K results by cross-encoder score
 */
async function retrieveWithReranking(toolName, actionContext, options = {}) {
  const {
    candidateCount = 20,
    maxResults = 5,
    useLLM = false,
    feedbackDir,
  } = options;

  // Stage 1: Fast candidate retrieval (existing system)
  const candidates = retrieveRelevantLessons(toolName, actionContext, {
    maxResults: candidateCount,
    feedbackDir,
  });

  if (candidates.length === 0) return [];
  if (candidates.length <= maxResults) return candidates;

  const query = `${toolName || ''} ${actionContext || ''}`.trim();

  // Stage 2: Cross-encoder reranking
  let rerankedScores;

  if (useLLM) {
    rerankedScores = await llmCrossEncode(query, candidates);
  }

  // Fall back to heuristic cross-encoder if LLM unavailable or failed
  if (!rerankedScores) {
    rerankedScores = candidates.map((c) => {
      const docText = `${c.title || ''} ${c.content || ''}`;
      return heuristicCrossEncode(query, docText);
    });
  }

  // Combine original relevance score with cross-encoder score
  // Weight: 40% original, 60% cross-encoder (cross-encoder is more precise)
  const reranked = candidates.map((c, i) => ({
    ...c,
    crossEncoderScore: rerankedScores[i],
    combinedScore: c.relevanceScore * 0.4 + rerankedScores[i] * 0.6,
  }));

  return reranked
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, maxResults);
}

/**
 * Synchronous version for use in PreToolUse hooks (cannot be async).
 */
function retrieveWithRerankingSync(toolName, actionContext, options = {}) {
  const {
    candidateCount = 20,
    maxResults = 5,
    feedbackDir,
  } = options;

  const candidates = retrieveRelevantLessons(toolName, actionContext, {
    maxResults: candidateCount,
    feedbackDir,
  });

  if (candidates.length === 0) return [];
  if (candidates.length <= maxResults) return candidates;

  const query = `${toolName || ''} ${actionContext || ''}`.trim();

  const rerankedScores = candidates.map((c) => {
    const docText = `${c.title || ''} ${c.content || ''}`;
    return heuristicCrossEncode(query, docText);
  });

  const reranked = candidates.map((c, i) => ({
    ...c,
    crossEncoderScore: rerankedScores[i],
    combinedScore: c.relevanceScore * 0.4 + rerankedScores[i] * 0.6,
  }));

  return reranked
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, maxResults);
}

// --- Utility functions ---

function extractPhrases(text) {
  const words = text.split(/\s+/).filter((w) => w.length > 2);
  const phrases = [];
  for (let i = 0; i < words.length - 1; i++) {
    phrases.push(`${words[i]} ${words[i + 1]}`);
  }
  return phrases;
}

function extractVerbs(text) {
  const verbPatterns = [
    'push', 'pull', 'merge', 'delete', 'create', 'edit', 'write', 'read',
    'deploy', 'install', 'remove', 'run', 'execute', 'build', 'test',
    'commit', 'rebase', 'reset', 'drop', 'truncate', 'migrate', 'publish',
    'block', 'allow', 'approve', 'deny', 'warn', 'log',
  ];
  return verbPatterns.filter((v) => text.includes(v));
}

module.exports = {
  heuristicCrossEncode,
  llmCrossEncode,
  retrieveWithReranking,
  retrieveWithRerankingSync,
  extractPhrases,
  extractVerbs,
};
