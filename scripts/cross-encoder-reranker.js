#!/usr/bin/env node
'use strict';

/**
 * Cross-encoder style reranker for ThumbGate lesson retrieval.
 *
 * Honesty (2026-07-31 A+ stack):
 *   - Default production path uses the multi-stage pipeline in rerank-pipeline.js:
 *       BM25F → ColBERT-style MaxSim → heuristic joint pair scorer → optional LLM
 *   - `heuristicCrossEncode` is a *feature-based* pair scorer, not a neural CE
 *   - LLM listwise scoring is optional (`useLLM` or THUMBGATE_RERANK_LLM=1)
 *   - ColBERT-style MaxSim is hashed multi-vector late interaction unless a
 *     tokenEmbedder is injected
 *
 * PreToolUse uses the sync pipeline (no LLM) so the gate stays offline-capable.
 */

const {
  retrieveRelevantLessons,
  retrieveRelevantLessonsAsync,
} = require('./lesson-retrieval');

/**
 * Heuristic joint pair scorer (cross-encoder *style*, not a transformer CE).
 * Scores a (query, document) pair jointly.
 */
function heuristicCrossEncode(query, document) {
  const queryLower = (query || '').toLowerCase();
  const docLower = (document || '').toLowerCase();

  let score = 0;

  // 1. Exact substring containment (strongest signal)
  if (queryLower.length > 3 && docLower.length > 3 &&
      (docLower.includes(queryLower) || queryLower.includes(docLower))) {
    score += 0.9;
    return Math.min(score, 1);
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
      break;
    }
  }

  // 4. Action-target alignment
  const queryVerbs = extractVerbs(queryLower);
  const docVerbs = extractVerbs(docLower);
  const verbOverlap = queryVerbs.filter((v) => docVerbs.includes(v));
  score += Math.min(verbOverlap.length * 0.1, 0.3);

  // 5. Negation alignment
  const queryNegated = /\b(don'?t|never|avoid|block|prevent|stop)\b/.test(queryLower);
  const docNegated = /\b(don'?t|never|avoid|block|prevent|stop)\b/.test(docLower);
  if (queryNegated && docNegated) score += 0.1;

  // 6. Structural near-miss penalty: query asserts X, doc asserts NOT X (role/negation flip)
  if (queryNegated !== docNegated) {
    // Shared content tokens but polarity mismatch → soft demotion of raw phrase score
    // (still can rank high if phrases match; fusion stages rebalance)
    score *= 0.92;
  }

  return Math.min(score, 1);
}

/**
 * LLM listwise cross-encoder: Claude scores query-document pairs.
 * More accurate but requires API key and costs tokens.
 */
async function llmCrossEncode(query, documents) {
  const { isAvailable, callClaudeJson, MODELS } = require('./llm-client');
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
    const scores = await callClaudeJson({
      systemPrompt: 'You are a relevance scoring engine. Return only JSON arrays of numbers.',
      userPrompt: prompt,
      model: MODELS.FAST,
      maxTokens: 256,
      cache: true,
    });
    if (Array.isArray(scores) && scores.length === documents.length) {
      return scores.map((s) => Math.max(0, Math.min(1, Number(s) || 0)));
    }
  } catch { /* fall back to heuristic */ }
  return null;
}

/**
 * Two-stage retrieval with A+ multi-stage reranking.
 * Stage 1: Fast candidate retrieval
 * Stage 2: BM25F → MaxSim → heuristic CE → optional LLM
 */
async function retrieveWithReranking(toolName, actionContext, options = {}) {
  const {
    candidateCount = 20,
    maxResults = 5,
    useLLM = false,
    feedbackDir,
  } = options;

  const candidates = await retrieveRelevantLessonsAsync(toolName, actionContext, {
    maxResults: candidateCount,
    feedbackDir,
    scope: options.scope,
    requireScope: options.requireScope,
    includeShared: options.includeShared,
    metadataFilters: options.metadataFilters,
    queryRewrite: options.queryRewrite,
    includeRetrievalMeta: options.includeRetrievalMeta,
    embedder: options.embedder,
    embedderId: options.embedderId,
  });

  if (candidates.length === 0) return [];
  if (candidates.length <= maxResults && !options.forceRerank) {
    return candidates.map((c) => ({
      ...c,
      combinedScore: c.relevanceScore ?? c.score ?? 0,
      crossEncoderScore: c.relevanceScore ?? 0,
    }));
  }

  const query = `${toolName || ''} ${actionContext || ''}`.trim();
  // Lazy require avoids circular init with rerank-pipeline → this module
  const { rerankPipeline } = require('./rerank-pipeline');
  const { results, meta } = await rerankPipeline(query, candidates, {
    topK: maxResults,
    toolName,
    useLLM,
    useMaxSim: options.useMaxSim !== false,
    useHeuristicCe: options.useHeuristicCe !== false,
    tokenEmbedder: options.tokenEmbedder,
    dim: options.dim,
    ngram: options.ngram,
  });

  return results.map((c) => ({
    ...c,
    retrievalMeta: {
      ...(c.retrievalMeta || {}),
      rerank: meta,
    },
  }));
}

/**
 * Synchronous version for PreToolUse hooks (cannot be async).
 * Always runs BM25F + MaxSim + heuristic CE. Never calls LLM.
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
    scope: options.scope,
    requireScope: options.requireScope,
    includeShared: options.includeShared,
    metadataFilters: options.metadataFilters,
    queryRewrite: options.queryRewrite,
    includeRetrievalMeta: options.includeRetrievalMeta,
  });

  if (candidates.length === 0) return [];
  if (candidates.length <= maxResults && !options.forceRerank) {
    return candidates.map((c) => ({
      ...c,
      combinedScore: c.relevanceScore ?? c.score ?? 0,
      crossEncoderScore: c.relevanceScore ?? 0,
    }));
  }

  const query = `${toolName || ''} ${actionContext || ''}`.trim();
  const { rerankPipelineSync } = require('./rerank-pipeline');
  const { results, meta } = rerankPipelineSync(query, candidates, {
    topK: maxResults,
    toolName,
    useMaxSim: options.useMaxSim !== false,
    useHeuristicCe: options.useHeuristicCe !== false,
  });

  return results.map((c) => ({
    ...c,
    retrievalMeta: {
      ...(c.retrievalMeta || {}),
      rerank: meta,
    },
  }));
}

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
