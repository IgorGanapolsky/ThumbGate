#!/usr/bin/env node
'use strict';

const {
  searchFeedbackLog,
  searchContextFs,
  searchPreventionRulesSync,
} = require('./filesystem-search');
const {
  searchImportedDocuments,
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

function getFeedbackResults(query, limit, signal) {
  const results = searchFeedbackLog(query, Math.max(limit * 3, limit));
  const normalizedSignal = normalizeSignal(signal);
  const filtered = normalizedSignal
    ? results.filter((record) => normalizeRecordSignal(record.signal) === normalizedSignal)
    : results;
  return filtered.slice(0, limit).map(mapFeedbackResult);
}

function getContextResults(query, limit) {
  return searchContextFs(query, limit).map(mapContextResult);
}

function getRuleResults(query, limit) {
  return searchPreventionRulesSync(query, limit).map(mapRuleResult);
}

function getDocumentResults(query, limit) {
  return searchImportedDocuments({ query, limit }).map(mapDocumentResult);
}

function searchThumbgate({ query, source = 'all', limit = 10, signal = null } = {}) {
  const trimmedQuery = String(query || '').trim();
  if (!trimmedQuery) {
    throw new Error('query is required');
  }

  const normalizedSource = normalizeSource(source);
  const normalizedSignal = normalizeSignal(signal);
  const normalizedLimit = normalizeLimit(limit);

  let results = [];
  if (normalizedSource === 'feedback') {
    results = getFeedbackResults(trimmedQuery, normalizedLimit, normalizedSignal);
  } else if (normalizedSource === 'context') {
    results = getContextResults(trimmedQuery, normalizedLimit);
  } else if (normalizedSource === 'rules') {
    results = getRuleResults(trimmedQuery, normalizedLimit);
  } else if (normalizedSource === 'documents') {
    results = getDocumentResults(trimmedQuery, normalizedLimit);
  } else {
    results = sortResults([
      ...getFeedbackResults(trimmedQuery, normalizedLimit, normalizedSignal),
      ...getContextResults(trimmedQuery, normalizedLimit),
      ...getRuleResults(trimmedQuery, normalizedLimit),
      ...getDocumentResults(trimmedQuery, normalizedLimit),
    ]).slice(0, normalizedLimit);
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

module.exports = {
  VALID_SOURCES,
  normalizeSearchSource: normalizeSource,
  normalizeSearchSignal: normalizeSignal,
  searchThumbgate,
};
