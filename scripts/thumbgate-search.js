#!/usr/bin/env node
'use strict';

const {
  searchFeedbackLog,
  searchContextFs,
  searchPreventionRulesSync,
} = require('./filesystem-search');
const {
  readImportedDocument,
  searchImportedDocuments,
} = require('./document-intake');
const {
  bm25Rank,
  expandSafetyQuery,
  reciprocalRankFusion,
  rerankCandidates,
  rewriteQuery,
} = require('./rag-ranking');
const { RagRunTelemetry } = require('./rag-stage-contract');

const VALID_SOURCES = ['all', 'feedback', 'context', 'rules', 'documents'];
const SIGNAL_ALIASES = {
  up: 'up',
  positive: 'up',
  down: 'down',
  negative: 'down',
};

function normalizeSource(source) {
  const normalized = String(source || 'all').trim().toLowerCase() || 'all';
  if (!VALID_SOURCES.includes(normalized)) {
    throw new Error(`source must be one of: ${VALID_SOURCES.join(', ')}`);
  }
  return normalized;
}

function normalizeSignal(signal) {
  if (signal === undefined || signal === null || signal === '') return null;
  const normalized = SIGNAL_ALIASES[String(signal).trim().toLowerCase()];
  if (!normalized) {
    throw new Error('signal must be one of: up, down, positive, negative');
  }
  return normalized;
}

function normalizeRecordSignal(signal) {
  return SIGNAL_ALIASES[String(signal || '').trim().toLowerCase()] || null;
}

function normalizeLimit(limit) {
  const parsed = Number(limit || 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 10;
  return Math.min(50, Math.floor(parsed));
}

function clampScore(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Number(numeric.toFixed(4));
}

function safeArray(values) {
  return Array.isArray(values) ? values : [];
}

function excerpt(value, maxLength = 280) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function extractFeedbackCorrectiveAction(record) {
  return record.whatToChange
    || record.what_to_change
    || record.whatWorked
    || record.what_worked
    || null;
}

function mapFeedbackResult(record) {
  return {
    id: record.id || null,
    source: 'feedback',
    score: clampScore(record._score),
    signal: normalizeRecordSignal(record.signal),
    tags: safeArray(record.tags),
    timestamp: record.timestamp || null,
    title: record.title || null,
    context: excerpt(record.context || record.message || ''),
    correctiveAction: extractFeedbackCorrectiveAction(record),
    whatWentWrong: record.whatWentWrong || record.what_went_wrong || null,
    whatWorked: record.whatWorked || record.what_worked || null,
    matchedTokens: safeArray(record._matchedTokens),
    scope: record.scope || {
      tenantId: record.tenantId || 'local',
      projectId: record.projectId || null,
      entityId: record.entityId || null,
      visibility: record.visibility || 'private',
    },
    isCurrent: record.isCurrent !== false,
    trustLevel: 'trusted',
  };
}

function mapContextResult(record) {
  return {
    id: record.id || null,
    source: 'contextfs',
    score: clampScore(record._score),
    signal: normalizeRecordSignal(record.signal),
    tags: safeArray(record.tags),
    timestamp: record.timestamp || record.createdAt || null,
    title: record.title || null,
    context: excerpt(record.context || record.content || record.title || ''),
    correctiveAction: record.metadata && record.metadata.whatToChange
      ? String(record.metadata.whatToChange)
      : null,
    matchedTokens: safeArray(record._matchedTokens),
    namespace: record._namespace || record.namespace || null,
    file: record._source || null,
    scope: record.scope || {
      tenantId: record.tenantId || 'local',
      projectId: record.projectId || null,
      entityId: record.entityId || null,
      visibility: record.visibility || 'private',
    },
    isCurrent: record.isCurrent !== false,
    trustLevel: record.trustLevel || 'trusted',
  };
}

function mapRuleResult(record) {
  return {
    id: record.title || null,
    source: 'prevention_rule',
    score: clampScore(record._score || record.score),
    signal: null,
    tags: ['prevention', 'rules'],
    timestamp: null,
    title: record.title || null,
    context: excerpt(record.body || ''),
    correctiveAction: excerpt(record.body || '', 500) || null,
    matchedTokens: [],
    scope: {
      tenantId: record.tenantId || 'local',
      projectId: record.projectId || null,
      entityId: record.entityId || null,
      visibility: record.visibility || 'shared',
    },
    isCurrent: true,
    trustLevel: 'trusted',
  };
}

function mapDocumentResult(record) {
  return {
    id: record.documentId || null,
    source: 'document',
    score: clampScore(record._score),
    signal: null,
    tags: safeArray(record.tags),
    timestamp: record.importedAt || null,
    title: record.title || null,
    context: excerpt(record.excerpt || record.content || ''),
    correctiveAction: safeArray(record.proposals)[0]
      ? safeArray(record.proposals)[0].title || safeArray(record.proposals)[0].evidence || null
      : null,
    matchedTokens: safeArray(record._matchedTokens),
    documentId: record.documentId || null,
    proposalCount: safeArray(record.proposals).length,
    matchedTemplateIds: safeArray(record.matchedTemplateIds),
    sourceFormat: record.sourceFormat || null,
    chunkId: record.chunkId || null,
    parentId: record.parentId || null,
    parentContext: record.parentContext || null,
    headingPath: safeArray(record.headingPath),
    startOffset: Number.isFinite(record.startOffset) ? record.startOffset : null,
    endOffset: Number.isFinite(record.endOffset) ? record.endOffset : null,
    scope: record.scope || {
      tenantId: 'local',
      projectId: null,
      entityId: null,
      visibility: 'private',
    },
    isCurrent: record.isCurrent !== false,
    trustLevel: record.trustLevel || 'untrusted',
    instructionRisk: record.instructionRisk || { detected: false },
    version: record.version || 1,
    sourceUrl: record.sourceUrl || null,
  };
}

function sortResults(results) {
  return [...results].sort((left, right) => {
    if ((right.score || 0) !== (left.score || 0)) {
      return (right.score || 0) - (left.score || 0);
    }
    return String(right.timestamp || '').localeCompare(String(left.timestamp || ''));
  });
}

function extractFeedbackId(str) {
  if (!str) return null;
  const match = str.match(/fb[_-]\d+[_-][a-z0-9]+/i);
  return match ? match[0].replace(/-/g, '_').toLowerCase() : null;
}

function deduplicateResults(results) {
  const bestByFeedbackId = new Map();

  for (const r of results) {
    const feedId = extractFeedbackId(r.id || r.title || r.file || '');
    if (feedId) {
      const existing = bestByFeedbackId.get(feedId);
      if (!existing) {
        bestByFeedbackId.set(feedId, r);
      } else {
        const sourceOrder = { feedback: 4, contextfs: 3, prevention_rule: 2, document: 1 };
        const existingOrder = sourceOrder[existing.source] || 0;
        const currentOrder = sourceOrder[r.source] || 0;
        if (currentOrder > existingOrder) {
          bestByFeedbackId.set(feedId, r);
        } else if (currentOrder === existingOrder && (r.score || 0) > (existing.score || 0)) {
          bestByFeedbackId.set(feedId, r);
        }
      }
    }
  }

  const finalResults = [];
  const seenContent = new Set();
  const seenIds = new Set();

  for (const r of results) {
    const feedId = extractFeedbackId(r.id || r.title || r.file || '');
    let recordToUse = r;
    if (feedId) {
      recordToUse = bestByFeedbackId.get(feedId);
      if (seenIds.has(recordToUse.id)) continue;
    } else {
      if (r.id && r.id !== 'null' && String(r.id).trim() !== '') {
        if (seenIds.has(r.id)) continue;
      }
    }

    const normTitle = String(recordToUse.title || '').trim().toLowerCase();
    const normContext = String(recordToUse.context || '').trim().toLowerCase();
    const contentKey = `${normTitle}|${normContext}`;
    if (seenContent.has(contentKey)) continue;

    if (recordToUse.id && recordToUse.id !== 'null' && String(recordToUse.id).trim() !== '') {
      seenIds.add(recordToUse.id);
    }
    seenContent.add(contentKey);
    finalResults.push(recordToUse);
  }

  return finalResults;
}

function getFeedbackResults(query, limit, signal, feedbackDir) {
  const results = searchFeedbackLog(query, Math.max(limit * 3, limit), { feedbackDir });
  const normalizedSignal = normalizeSignal(signal);
  const filtered = normalizedSignal
    ? results.filter((record) => normalizeRecordSignal(record.signal) === normalizedSignal)
    : results;
  return filtered.slice(0, limit).map(mapFeedbackResult);
}

function getContextResults(query, limit, feedbackDir) {
  return searchContextFs(query, limit, { feedbackDir }).map(mapContextResult);
}

function getRuleResults(query, limit, feedbackDir) {
  return searchPreventionRulesSync(query, limit, { feedbackDir }).map(mapRuleResult);
}

function getDocumentResults(query, limit, feedbackDir) {
  return searchImportedDocuments({ query, limit, feedbackDir }).map(mapDocumentResult);
}

function normalizeScopeFilters(options = {}) {
  return {
    tenantId: String(options.tenantId || 'local').trim() || 'local',
    projectId: options.projectId ? String(options.projectId).trim() : null,
    entityId: options.entityId ? String(options.entityId).trim() : null,
    visibility: options.visibility ? String(options.visibility).trim() : null,
  };
}

function matchesScope(result, filters) {
  const scope = result.scope || {};
  if ((scope.tenantId || 'local') !== filters.tenantId) return false;
  if (filters.projectId && scope.projectId !== filters.projectId) return false;
  if (filters.entityId && scope.entityId !== filters.entityId) return false;
  if (filters.visibility && scope.visibility !== filters.visibility) return false;
  return result.isCurrent !== false;
}

function collectCandidates({
  query,
  source,
  limit,
  signal,
  feedbackDir,
  scopeFilters,
}) {
  let results;
  if (source === 'feedback') {
    results = getFeedbackResults(query, limit, signal, feedbackDir);
  } else if (source === 'context') {
    results = getContextResults(query, limit, feedbackDir);
  } else if (source === 'rules') {
    results = getRuleResults(query, limit, feedbackDir);
  } else if (source === 'documents') {
    results = searchImportedDocuments({
      query,
      limit,
      feedbackDir,
      tenantId: scopeFilters.tenantId,
      projectId: scopeFilters.projectId,
      visibility: scopeFilters.visibility,
    }).map(mapDocumentResult);
  } else {
    results = [
      ...getFeedbackResults(query, limit, signal, feedbackDir),
      ...getContextResults(query, limit, feedbackDir),
      ...getRuleResults(query, limit, feedbackDir),
      ...searchImportedDocuments({
        query,
        limit,
        feedbackDir,
        tenantId: scopeFilters.tenantId,
        projectId: scopeFilters.projectId,
        visibility: scopeFilters.visibility,
      }).map(mapDocumentResult),
    ];
  }
  return deduplicateResults(results.filter((result) => matchesScope(result, scopeFilters)));
}

function mapVectorResult(row) {
  const vectorScore = Number.isFinite(row._distance)
    ? Number((1 / (1 + row._distance)).toFixed(6))
    : 0;
  return {
    id: row.id || null,
    chunkId: row.source === 'document' ? row.id : null,
    documentId: row.documentId || null,
    parentId: row.parentId || null,
    source: row.source === 'document' ? 'document' : row.source,
    score: vectorScore,
    vectorScore,
    signal: normalizeRecordSignal(row.signal),
    tags: String(row.tags || '').split(',').filter(Boolean),
    timestamp: row.timestamp || null,
    title: row.title || null,
    context: excerpt(row.context || row.text || ''),
    matchedTokens: [],
    scope: {
      tenantId: row.tenantId || 'local',
      projectId: row.projectId || null,
      entityId: row.entityId || null,
      visibility: row.visibility || 'private',
    },
    isCurrent: row.isCurrent !== false,
    trustLevel: row.trustLevel || 'untrusted',
    instructionRisk: { detected: row.instructionRisk === true },
    version: row.version || 1,
    startOffset: Number.isFinite(row.startOffset) ? row.startOffset : null,
    endOffset: Number.isFinite(row.endOffset) ? row.endOffset : null,
    vectorDistance: Number.isFinite(row._distance) ? row._distance : null,
  };
}

function expandDocumentParent(result, feedbackDir) {
  if (result.source !== 'document' || !result.documentId || !result.parentId) return result;
  const document = readImportedDocument(result.documentId, { feedbackDir });
  if (!document || document.isCurrent === false) return result;
  const parent = safeArray(document.sections).find((section) => section.sectionId === result.parentId);
  if (!parent) return result;
  return {
    ...result,
    parentContext: parent.content,
    headingPath: safeArray(parent.headingPath),
    citation: {
      documentId: document.documentId,
      chunkId: result.chunkId || result.id,
      parentId: parent.sectionId,
      title: document.title,
      sourceUrl: document.sourceUrl || null,
      startOffset: result.startOffset,
      endOffset: result.endOffset,
      version: document.version,
    },
  };
}

function searchThumbgate({
  query,
  source = 'all',
  limit = 10,
  signal = null,
  feedbackDir = null,
  tenantId = 'local',
  projectId = null,
  entityId = null,
  visibility = null,
} = {}) {
  const trimmedQuery = String(query || '').trim();
  if (!trimmedQuery) {
    throw new Error('query is required');
  }

  const normalizedSource = normalizeSource(source);
  const normalizedSignal = normalizeSignal(signal);
  const normalizedLimit = normalizeLimit(limit);

  const fetchLimit = Math.max(100, normalizedLimit * 10);
  const scopeFilters = normalizeScopeFilters({ tenantId, projectId, entityId, visibility });
  const candidates = collectCandidates({
    query: trimmedQuery,
    source: normalizedSource,
    limit: fetchLimit,
    signal: normalizedSignal,
    feedbackDir,
    scopeFilters,
  });
  const expanded = expandSafetyQuery(trimmedQuery);
  const lexical = bm25Rank(expanded.rewritten, candidates);
  const results = (lexical.length > 0 ? lexical : sortResults(candidates))
    .slice(0, normalizedLimit)
    .map((result) => expandDocumentParent(result, feedbackDir));

  return {
    query: trimmedQuery,
    source: normalizedSource,
    signal: normalizedSignal,
    limit: normalizedLimit,
    engine: 'bm25-scoped-safety-expanded-v2',
    scope: scopeFilters,
    returned: results.length,
    total: results.length,
    results,
  };
}

function denseSourceFilter(source) {
  if (source === 'documents') return 'document';
  if (source === 'feedback') return 'feedback';
  if (source === 'all') return null;
  return '__not_indexed__';
}

async function searchThumbgateAsync(options = {}) {
  const query = String(options.query || '').trim();
  if (!query) throw new Error('query is required');
  const normalizedSource = normalizeSource(options.source);
  const normalizedSignal = normalizeSignal(options.signal);
  const normalizedLimit = normalizeLimit(options.limit);
  const scopeFilters = normalizeScopeFilters(options);
  const telemetry = options.telemetry || new RagRunTelemetry({
    query,
    feedbackDir: options.feedbackDir,
    scope: scopeFilters,
  });
  const rewrite = rewriteQuery(query, options.conversationContext || '');
  const safetyExpansion = expandSafetyQuery(rewrite.rewritten);
  const queryPlan = {
    original: query,
    rewritten: safetyExpansion.rewritten,
    applied: rewrite.applied || safetyExpansion.applied,
    addedTerms: [...new Set([
      ...(rewrite.addedTerms || []),
      ...(safetyExpansion.addedTerms || []),
    ])],
    strategies: [
      ...(rewrite.applied ? ['conversation'] : []),
      ...(safetyExpansion.applied ? ['safety_lexicon'] : []),
    ],
  };
  const queries = [...new Set([query, rewrite.rewritten, safetyExpansion.rewritten])];
  const fetchLimit = Math.max(50, normalizedLimit * 10);

  telemetry.start('retrieval', {
    source: normalizedSource,
    requestedLimit: normalizedLimit,
    queryRewriteApplied: queryPlan.applied,
  });
  const lexicalLists = queries.map((variant) => {
    const candidates = collectCandidates({
      query: variant,
      source: normalizedSource,
      limit: fetchLimit,
      signal: normalizedSignal,
      feedbackDir: options.feedbackDir,
      scopeFilters,
    });
    return bm25Rank(variant, candidates).slice(0, fetchLimit);
  });

  let dense = [];
  let vectorDiagnostics = null;
  let vectorFallback = null;
  const vectorSource = denseSourceFilter(normalizedSource);
  if (vectorSource !== '__not_indexed__') {
    try {
      const searchRag = options.searchRag || require('./vector-store').searchRag;
      vectorDiagnostics = await searchRag(queryPlan.rewritten, {
        feedbackDir: options.feedbackDir,
        limit: fetchLimit,
        timeoutMs: options.vectorTimeoutMs,
        filters: {
          ...scopeFilters,
          source: vectorSource,
          signal: normalizedSignal,
          currentOnly: true,
        },
      });
      dense = vectorDiagnostics.results.map(mapVectorResult);
    } catch (error) {
      vectorFallback = error && error.name || 'Error';
      telemetry.fallback('retrieval', 'vector_unavailable', { errorType: vectorFallback });
    }
  }

  const fused = reciprocalRankFusion([...lexicalLists, dense], {
    weights: [...lexicalLists.map(() => 1), 1.1],
  });
  telemetry.success('retrieval', {
    lexicalCandidateCount: lexicalLists.reduce((sum, list) => sum + list.length, 0),
    denseCandidateCount: dense.length,
    fusedCandidateCount: fused.length,
    vectorFallback: Boolean(vectorFallback),
  });

  telemetry.start('reranking', { candidateCount: fused.length });
  const reranked = rerankCandidates(query, fused, {
    candidateLimit: Math.min(fetchLimit, 50),
  })
    .slice(0, normalizedLimit)
    .map((result) => expandDocumentParent(result, options.feedbackDir));
  telemetry.success('reranking', {
    returnedCount: reranked.length,
    topScore: reranked[0] ? reranked[0].rerankScore : 0,
  });
  const run = telemetry.finish({
    returnedCount: reranked.length,
    vectorFallback: Boolean(vectorFallback),
  });

  return {
    query,
    source: normalizedSource,
    signal: normalizedSignal,
    limit: normalizedLimit,
    engine: 'hybrid-bm25-vector-rrf-rerank-v1',
    scope: scopeFilters,
    returned: reranked.length,
    total: fused.length,
    results: reranked,
    retrieval: {
      queryPlan,
      lexicalLists: lexicalLists.length,
      denseCandidateCount: dense.length,
      vectorTable: vectorDiagnostics && vectorDiagnostics.tableName,
      vectorFallback,
      telemetryRunId: run.runId,
    },
  };
}

module.exports = {
  VALID_SOURCES,
  normalizeSearchSource: normalizeSource,
  normalizeSearchSignal: normalizeSignal,
  searchThumbgate,
  searchThumbgateAsync,
};
