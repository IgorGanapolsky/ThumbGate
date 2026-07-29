#!/usr/bin/env node
'use strict';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'do', 'for', 'from',
  'how', 'i', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this',
  'to', 'was', 'what', 'when', 'where', 'which', 'with', 'you',
]);
const EXACT_QUERY_PATTERN = /["'`]|(?:^|\s)(?:\/|\.\/|--)[^\s]+|\b[A-Z][A-Z0-9]+-\d+\b|\b[a-f0-9]{7,40}\b/i;
const AMBIGUOUS_QUERY_PATTERN = /\b(?:it|that|this|those|them|there|same|again|previous|above)\b/i;
const SAFETY_EXPANSIONS = Object.freeze([
  {
    when: /\b(?:drop|truncate|alter|migrat\w*|destructive)\b.*\b(?:table|column|schema|database|db)\b|\b(?:table|column|schema|database|db)\b.*\b(?:drop|truncate|alter|migrat\w*|destructive)\b/i,
    terms: ['backup', 'back', 'up', 'rollback', 'reversible', 'destructive', 'pending'],
  },
  {
    when: /\b(?:prisma|migration|migrate)\b.*\b(?:production|deploy|schema)\b|\b(?:production|deploy|schema)\b.*\b(?:prisma|migration|migrate)\b/i,
    terms: ['test', 'database', 'pending', 'migrations', 'backup', 'rollback'],
  },
  {
    when: /\b(?:update|delete)\b.*\b(?:all|every|rows?|records?|customers?|users?)\b/i,
    terms: ['restrictive', 'where', 'dry-run', 'explain'],
  },
  {
    when: /\b(?:grant|role|privilege|admin)\b.*\b(?:database|live|production|broad)\b|\b(?:database|live|production|broad)\b.*\b(?:grant|role|privilege|admin)\b/i,
    terms: ['human', 'approval', 'broad', 'privileges'],
  },
  {
    when: /\b(?:railway|deploy|deployment|release|live)\b/i,
    terms: ['health', 'endpoint', 'build', 'logs', 'warnings', 'version', 'wait'],
  },
  {
    when: /\b(?:persist|persistent|uploads?|files?|volume)\b.*\b(?:railway|deploy|deployment)\b|\b(?:railway|deploy|deployment)\b.*\b(?:persist|persistent|uploads?|files?|volume)\b/i,
    terms: ['railway_volume_mount_path', 'volume', 'mount', 'path'],
  },
  {
    when: /\b(?:stripe|paymentintent|payment|checkout|webhook|charge)\b/i,
    terms: ['idempotency', 'signature', 'failure'],
  },
]);

function tokenizeRagText(value) {
  const raw = String(value || '').toLowerCase().match(/[\p{L}\p{N}_./:#-]+/gu) || [];
  const tokens = [];
  for (const token of raw) {
    const normalized = token.replaceAll(/^[./:#-]+|[./:#-]+$/g, '');
    if (!normalized) continue;
    tokens.push(normalized);
    for (const part of normalized.split(/[./:#-]+/)) {
      if (part && part !== normalized) tokens.push(part);
    }
  }
  return tokens;
}

function candidateText(candidate) {
  return [
    candidate.title,
    candidate.context,
    candidate.correctiveAction,
    candidate.parentContext,
    Array.isArray(candidate.tags) ? candidate.tags.join(' ') : candidate.tags,
    Array.isArray(candidate.headingPath) ? candidate.headingPath.join(' ') : '',
  ].filter(Boolean).join('\n');
}

function countTerms(tokens) {
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
  return counts;
}

function bm25Rank(query, candidates = [], options = {}) {
  const queryTerms = [...new Set(tokenizeRagText(query).filter((token) => !STOP_WORDS.has(token)))];
  if (queryTerms.length === 0 || candidates.length === 0) return [];
  const k1 = Number(options.k1) || 1.2;
  const b = Number(options.b) || 0.75;
  const docs = candidates.map((candidate) => {
    const tokens = tokenizeRagText(candidateText(candidate));
    return { candidate, tokens, counts: countTerms(tokens) };
  });
  const averageLength = docs.reduce((sum, doc) => sum + doc.tokens.length, 0) / docs.length || 1;
  const documentFrequency = new Map();
  for (const term of queryTerms) {
    documentFrequency.set(
      term,
      docs.filter((doc) => doc.counts.has(term)).length,
    );
  }
  return docs
    .map((doc) => {
      let score = 0;
      for (const term of queryTerms) {
        const frequency = doc.counts.get(term) || 0;
        if (frequency === 0) continue;
        const df = documentFrequency.get(term) || 0;
        const idf = Math.log(1 + ((docs.length - df + 0.5) / (df + 0.5)));
        const denominator = frequency + k1 * (1 - b + (b * doc.tokens.length / averageLength));
        score += idf * ((frequency * (k1 + 1)) / denominator);
      }
      const phrase = queryTerms.join(' ');
      const normalizedText = candidateText(doc.candidate).toLowerCase();
      if (phrase && normalizedText.includes(phrase)) score += 1.25;
      return {
        ...doc.candidate,
        bm25Score: Number(score.toFixed(6)),
      };
    })
    .filter((candidate) => candidate.bm25Score > 0)
    .sort((left, right) => (
      right.bm25Score - left.bm25Score || candidateId(left).localeCompare(candidateId(right))
    ));
}

function candidateId(candidate) {
  return String(candidate && (
    candidate.chunkId
    || candidate.id
    || `${candidate.source || 'unknown'}:${candidate.title || ''}:${candidate.context || ''}`
  ));
}

function reciprocalRankFusion(rankedLists = [], options = {}) {
  const rankConstant = Math.max(1, Number(options.rankConstant) || 60);
  const byId = new Map();
  rankedLists.forEach((list, listIndex) => {
    const weight = Number(options.weights && options.weights[listIndex]) || 1;
    (list || []).forEach((candidate, index) => {
      const id = candidateId(candidate);
      const existing = byId.get(id) || { candidate, rrfScore: 0, ranks: [] };
      existing.rrfScore += weight / (rankConstant + index + 1);
      existing.ranks.push({ list: listIndex, rank: index + 1 });
      existing.candidate = mergeRetrievalSignals(existing.candidate, candidate);
      byId.set(id, existing);
    });
  });
  return [...byId.values()]
    .map((entry) => ({
      ...entry.candidate,
      rrfScore: Number(entry.rrfScore.toFixed(8)),
      retrievalRanks: entry.ranks,
    }))
    .sort((left, right) => (
      right.rrfScore - left.rrfScore || candidateId(left).localeCompare(candidateId(right))
    ));
}

function mergeRetrievalSignals(existing, incoming) {
  const merged = { ...existing };
  for (const key of ['bm25Score', 'vectorScore']) {
    const existingHasMetric = existing[key] !== null
      && existing[key] !== undefined
      && Number.isFinite(Number(existing[key]));
    const incomingHasMetric = incoming[key] !== null
      && incoming[key] !== undefined
      && Number.isFinite(Number(incoming[key]));
    if (!existingHasMetric && incomingHasMetric) {
      merged[key] = Number(incoming[key]);
    }
  }
  if (
    (existing.vectorDistance === null
      || existing.vectorDistance === undefined
      || !Number.isFinite(Number(existing.vectorDistance)))
    && incoming.vectorDistance !== null
    && incoming.vectorDistance !== undefined
    && Number.isFinite(Number(incoming.vectorDistance))
  ) {
    merged.vectorDistance = Number(incoming.vectorDistance);
  }
  for (const key of ['parentContext', 'headingPath', 'citation']) {
    const value = incoming[key];
    if (
      (merged[key] === undefined || merged[key] === null || merged[key] === '')
      &&
      value !== undefined
      && value !== null
      && value !== ''
      && (!Array.isArray(value) || value.length > 0)
    ) {
      merged[key] = value;
    }
  }
  if (!merged.context && incoming.context) merged.context = incoming.context;
  return merged;
}

function queryCoverage(queryTokens, textTokens) {
  if (queryTokens.length === 0) return 0;
  const textSet = new Set(textTokens);
  return queryTokens.filter((token) => textSet.has(token)).length / queryTokens.length;
}

function freshnessScore(timestamp, nowMs) {
  const parsed = Date.parse(timestamp || '');
  if (!Number.isFinite(parsed)) return 0;
  const ageDays = Math.max(0, (nowMs - parsed) / 86_400_000);
  return Math.exp(-ageDays / 365);
}

function rerankCandidates(query, candidates = [], options = {}) {
  const queryTokens = [...new Set(tokenizeRagText(query).filter((token) => !STOP_WORDS.has(token)))];
  const phrase = queryTokens.join(' ');
  const maxBm25 = Math.max(...candidates.map((candidate) => Number(candidate.bm25Score) || 0), 1);
  const maxVector = Math.max(...candidates.map((candidate) => Number(candidate.vectorScore) || 0), 0.000001);
  const maxRrf = Math.max(...candidates.map((candidate) => Number(candidate.rrfScore) || 0), 0.000001);
  const hasVectorSignals = candidates.some((candidate) => Number(candidate.vectorScore) > 0);
  const nowMs = Number(options.nowMs) || Date.now();
  return candidates
    .slice(0, Math.max(1, Number(options.candidateLimit) || 50))
    .map((candidate) => {
      const text = candidateText(candidate);
      const normalizedText = text.toLowerCase();
      const coverage = queryCoverage(queryTokens, tokenizeRagText(text));
      const exactPhrase = phrase && normalizedText.includes(phrase) ? 1 : 0;
      const current = candidate.isCurrent === false ? 0 : 1;
      const trust = candidate.trustLevel === 'trusted' ? 1 : 0;
      const freshness = freshnessScore(candidate.timestamp, nowMs);
      const normalizedBm25 = Number(candidate.bm25Score || 0) / maxBm25;
      const normalizedVector = Number(candidate.vectorScore || 0) / maxVector;
      const weights = hasVectorSignals
        ? {
          rrf: 0.30,
          bm25: 0.20,
          vector: 0.16,
          coverage: 0.20,
        }
        : {
          rrf: 0.38,
          bm25: 0.24,
          vector: 0,
          coverage: 0.24,
        };
      const score = (
        (Number(candidate.rrfScore || 0) / maxRrf) * weights.rrf
        + normalizedBm25 * weights.bm25
        + normalizedVector * weights.vector
        + coverage * weights.coverage
        + exactPhrase * 0.08
        + trust * 0.03
        + freshness * 0.03
      ) * current;
      return {
        ...candidate,
        rerankScore: Number(score.toFixed(6)),
        rerankFeatures: {
          coverage: Number(coverage.toFixed(4)),
          exactPhrase,
          trust,
          freshness: Number(freshness.toFixed(4)),
          current,
          normalizedBm25: Number(normalizedBm25.toFixed(4)),
          normalizedVector: Number(normalizedVector.toFixed(4)),
        },
      };
    })
    .sort((left, right) => (
      right.rerankScore - left.rerankScore || candidateId(left).localeCompare(candidateId(right))
    ));
}

function shouldRewriteQuery(query, conversationContext = '') {
  const normalized = String(query || '').trim();
  if (!normalized || !String(conversationContext || '').trim()) return false;
  if (EXACT_QUERY_PATTERN.test(normalized)) return false;
  const tokens = tokenizeRagText(normalized);
  return tokens.length <= 8 && (AMBIGUOUS_QUERY_PATTERN.test(normalized) || tokens.length <= 3);
}

function rewriteQuery(query, conversationContext = '') {
  const original = String(query || '').trim();
  if (!shouldRewriteQuery(original, conversationContext)) {
    return { original, rewritten: original, applied: false, addedTerms: [] };
  }
  const originalTerms = new Set(tokenizeRagText(original));
  const contextTerms = tokenizeRagText(conversationContext)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token) && !originalTerms.has(token));
  const counts = countTerms(contextTerms);
  const addedTerms = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length)
    .slice(0, 6)
    .map(([term]) => term);
  if (addedTerms.length === 0) {
    return { original, rewritten: original, applied: false, addedTerms: [] };
  }
  return {
    original,
    rewritten: `${original} ${addedTerms.join(' ')}`,
    applied: true,
    addedTerms,
  };
}

function expandSafetyQuery(query) {
  const original = String(query || '').trim();
  if (!original || EXACT_QUERY_PATTERN.test(original)) {
    return { original, rewritten: original, applied: false, addedTerms: [] };
  }
  const existing = new Set(tokenizeRagText(original));
  const additions = [];
  for (const expansion of SAFETY_EXPANSIONS) {
    if (!expansion.when.test(original)) continue;
    for (const term of expansion.terms) {
      if (!existing.has(term) && !additions.includes(term)) additions.push(term);
    }
  }
  return {
    original,
    rewritten: additions.length ? `${original} ${additions.join(' ')}` : original,
    applied: additions.length > 0,
    addedTerms: additions,
  };
}

module.exports = {
  bm25Rank,
  candidateId,
  candidateText,
  expandSafetyQuery,
  reciprocalRankFusion,
  rerankCandidates,
  rewriteQuery,
  shouldRewriteQuery,
  tokenizeRagText,
};
