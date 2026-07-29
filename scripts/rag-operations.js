#!/usr/bin/env node
'use strict';

const { listImportedDocuments } = require('./document-intake');
const {
  getRagOperationsSpec,
  summarizeRagHealth,
} = require('./rag-stage-contract');

const MAX_OPERATION_DOCUMENTS = 200;

function countBy(values, selector) {
  const counts = {};
  for (const value of values) {
    const key = String(selector(value) || 'unknown');
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function summarizeDocuments(documents) {
  const rows = Array.isArray(documents) ? documents : [];
  return {
    total: rows.length,
    current: rows.filter((document) => document.isCurrent !== false).length,
    stale: rows.filter((document) => document.isCurrent === false).length,
    byFormat: countBy(rows, (document) => document.sourceFormat),
    byDeduplicationStatus: countBy(
      rows,
      (document) => document.deduplication && document.deduplication.status,
    ),
    byIndexingStatus: countBy(
      rows,
      (document) => document.indexing && document.indexing.status || 'not_attempted',
    ),
    pendingRetry: rows.filter((document) => (
      document.indexing && document.indexing.status === 'pending_retry'
    )).length,
    quarantined: rows.filter((document) => (
      document.indexing && document.indexing.status === 'quarantined'
    )).length,
  };
}

function safeErrorType(error) {
  return String(error && error.name || 'Error').slice(0, 80);
}

async function getRagOperationsSnapshot(options = {}) {
  const feedbackDir = options.feedbackDir;
  const listed = listImportedDocuments({
    feedbackDir,
    includeStale: true,
    limit: MAX_OPERATION_DOCUMENTS,
  });
  const documentSummary = summarizeDocuments(listed.documents);
  if (listed.total > listed.returned) {
    documentSummary.truncated = true;
    documentSummary.catalogTotal = listed.total;
  } else {
    documentSummary.truncated = false;
    documentSummary.catalogTotal = listed.total;
  }

  let index;
  try {
    const getIndexStatus = options.getIndexStatus
      || require('./vector-store').getRagIndexStatus;
    index = {
      available: true,
      ...(await getIndexStatus({ feedbackDir })),
    };
  } catch (error) {
    index = {
      available: false,
      errorType: safeErrorType(error),
    };
  }

  return {
    ...getRagOperationsSpec(),
    generatedAt: new Date().toISOString(),
    health: summarizeRagHealth({
      feedbackDir,
      limit: options.telemetryLimit || 200,
    }),
    documents: documentSummary,
    index,
  };
}

module.exports = {
  MAX_OPERATION_DOCUMENTS,
  getRagOperationsSnapshot,
  summarizeDocuments,
};
