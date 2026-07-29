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
  let cacheWarm;
  let recall;
  const vectorStore = require('./vector-store');

  if (options.warm === true) {
    try {
      const warmIndex = options.warmIndex || vectorStore.warmRagIndex;
      cacheWarm = await warmIndex({ feedbackDir });
    } catch (error) {
      cacheWarm = {
        status: 'failed',
        errorType: safeErrorType(error),
      };
    }
  }
  try {
    const getIndexStatus = options.getIndexStatus || vectorStore.getRagIndexStatus;
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
  if (options.evaluateRecall === true) {
    try {
      const evaluateRecall = options.evaluateRecallFn || vectorStore.evaluateRagRecall;
      recall = await evaluateRecall({
        feedbackDir,
        num: options.recallSamples,
        topK: options.recallTopK,
        threshold: options.recallThreshold,
        filters: options.filters,
      });
    } catch (error) {
      recall = {
        status: 'failed',
        errorType: safeErrorType(error),
      };
    }
  }

  const snapshot = {
    ...getRagOperationsSpec(),
    generatedAt: new Date().toISOString(),
    health: summarizeRagHealth({
      feedbackDir,
      limit: options.telemetryLimit || 200,
    }),
    documents: documentSummary,
    index,
  };
  if (options.warm === true) {
    snapshot.cacheWarm = cacheWarm;
  }
  if (options.evaluateRecall === true) {
    snapshot.recall = recall;
  }
  return snapshot;
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) continue;
    const [name, inlineValue] = argument.slice(2).split('=', 2);
    const nextValue = argv[index + 1] && !argv[index + 1].startsWith('--')
      ? argv[++index]
      : true;
    values.set(name, inlineValue === undefined ? nextValue : inlineValue);
  }
  return {
    feedbackDir: values.get('feedback-dir') || undefined,
    warm: values.has('warm'),
    evaluateRecall: values.has('recall'),
    recallSamples: Number(values.get('samples') || 25),
    recallTopK: Number(values.get('top-k') || 10),
    recallThreshold: Number(values.get('threshold') || 0.9),
  };
}

async function main() {
  const snapshot = await getRagOperationsSnapshot(parseCliArgs());
  process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
  if (snapshot.recall && snapshot.recall.status === 'fail') {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.name || 'Error'}: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  MAX_OPERATION_DOCUMENTS,
  getRagOperationsSnapshot,
  parseCliArgs,
  summarizeDocuments,
};
