#!/usr/bin/env node
'use strict';

const {
  searchFeedbackLog,
  searchContextFs,
  searchPreventionRulesSync,
} = require('./filesystem-search');
const {
  searchImportedDocuments,
  searchImportedDocumentsAsync,
} = require('./document-intake');

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
    matchedChunks: safeArray(record._matchedChunks),
    retrieval: record._retrieval || null,
  };
}

async function getDocumentResultsAsync(query, limit, feedbackDir, options = {}) {
  const documents = await searchImportedDocumentsAsync({
    query,
    limit,
    feedbackDir,
    metadataFilters: options.metadataFilters,
    queryRewrite: options.queryRewrite,
    embedder: options.embedder,
    embedderId: options.embedderId,
    accessContext: options.accessContext,
  });
  return documents.map(mapDocumentResult);
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
  return match ? match[0].replaceAll('-', '_').toLowerCase() : null;
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

function getDocumentResults(query, limit, feedbackDir, accessContext) {
  return searchImportedDocuments({
    query,
    limit,
    feedbackDir,
    accessContext,
  }).map(mapDocumentResult);
}

function searchThumbgate({
  query,
  source = 'all',
  limit = 10,
  signal = null,
  feedbackDir = null,
  accessContext = null,
} = {}) {
  const trimmedQuery = String(query || '').trim();
  if (!trimmedQuery) {
    throw new Error('query is required');
  }

  const normalizedSource = normalizeSource(source);
  const normalizedSignal = normalizeSignal(signal);
  const normalizedLimit = normalizeLimit(limit);

  const fetchLimit = Math.max(100, normalizedLimit * 5);

  let results = [];
  if (normalizedSource === 'feedback') {
    const raw = getFeedbackResults(trimmedQuery, fetchLimit, normalizedSignal, feedbackDir);
    results = deduplicateResults(raw).slice(0, normalizedLimit);
  } else if (normalizedSource === 'context') {
    const raw = getContextResults(trimmedQuery, fetchLimit, feedbackDir);
    results = deduplicateResults(raw).slice(0, normalizedLimit);
  } else if (normalizedSource === 'rules') {
    const raw = getRuleResults(trimmedQuery, fetchLimit, feedbackDir);
    results = deduplicateResults(raw).slice(0, normalizedLimit);
  } else if (normalizedSource === 'documents') {
    const raw = getDocumentResults(trimmedQuery, fetchLimit, feedbackDir, accessContext);
    results = deduplicateResults(raw).slice(0, normalizedLimit);
  } else {
    const combined = [
      ...getFeedbackResults(trimmedQuery, fetchLimit, normalizedSignal, feedbackDir),
      ...getContextResults(trimmedQuery, fetchLimit, feedbackDir),
      ...getRuleResults(trimmedQuery, fetchLimit, feedbackDir),
      ...getDocumentResults(trimmedQuery, fetchLimit, feedbackDir, accessContext),
    ];
    results = deduplicateResults(sortResults(combined)).slice(0, normalizedLimit);
  }

  return {
    query: trimmedQuery,
    source: normalizedSource,
    signal: normalizedSignal,
    limit: normalizedLimit,
    engine: 'filesystem-search',
    returned: results.length,
    total: results.length,
    results,
  };
}

async function searchThumbgateAsync({
  query,
  source = 'all',
  limit = 10,
  signal = null,
  feedbackDir = null,
  metadataFilters = null,
  queryRewrite = true,
  embedder,
  embedderId,
  accessContext = null,
} = {}) {
  const trimmedQuery = String(query || '').trim();
  if (!trimmedQuery) throw new Error('query is required');
  const normalizedSource = normalizeSource(source);
  const normalizedSignal = normalizeSignal(signal);
  const normalizedLimit = normalizeLimit(limit);
  const fetchLimit = Math.max(100, normalizedLimit * 5);
  const documentOptions = {
    metadataFilters,
    queryRewrite,
    embedder,
    embedderId,
    accessContext,
  };

  let results;
  if (normalizedSource === 'documents') {
    results = deduplicateResults(
      await getDocumentResultsAsync(trimmedQuery, fetchLimit, feedbackDir, documentOptions),
    ).slice(0, normalizedLimit);
  } else if (normalizedSource === 'all') {
    const combined = [
      ...getFeedbackResults(trimmedQuery, fetchLimit, normalizedSignal, feedbackDir),
      ...getContextResults(trimmedQuery, fetchLimit, feedbackDir),
      ...getRuleResults(trimmedQuery, fetchLimit, feedbackDir),
      ...await getDocumentResultsAsync(trimmedQuery, fetchLimit, feedbackDir, documentOptions),
    ];
    results = deduplicateResults(sortResults(combined)).slice(0, normalizedLimit);
  } else {
    return searchThumbgate({
      query: trimmedQuery,
      source: normalizedSource,
      limit: normalizedLimit,
      signal: normalizedSignal,
      feedbackDir,
      accessContext,
    });
  }

  return {
    query: trimmedQuery,
    source: normalizedSource,
    signal: normalizedSignal,
    limit: normalizedLimit,
    engine: 'hybrid-parent-child',
    returned: results.length,
    total: results.length,
    results,
  };
}

module.exports = {
  VALID_SOURCES,
  normalizeSearchSource: normalizeSource,
  normalizeSearchSignal: normalizeSignal,
  searchThumbgate,
  searchThumbgateAsync,
};
