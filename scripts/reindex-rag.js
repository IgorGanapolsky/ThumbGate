#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  getDocumentStorePaths,
  listImportedDocuments,
  MAX_SEARCH_SCAN,
  readImportedDocument,
  upgradeLegacyDocument,
} = require('./document-intake');
const vectorStore = require('./vector-store');

const REINDEX_STATE_FILENAME = 'reindex-state.json';
const REINDEX_LOCK_FILENAME = 'reindex.lock';

function resolveReindexPaths(options = {}) {
  const { feedbackDir } = getDocumentStorePaths(options);
  const ragDir = path.join(feedbackDir, 'rag');
  return {
    feedbackDir,
    ragDir,
    statePath: path.join(ragDir, REINDEX_STATE_FILENAME),
    lockPath: path.join(ragDir, REINDEX_LOCK_FILENAME),
  };
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'EPERM') return true;
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

function acquireLock(lockPath, staleRetry = false) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  try {
    const descriptor = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(descriptor, `${JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
    })}\n`);
    return descriptor;
  } catch (error) {
    if (error.code === 'EEXIST') {
      const lock = readJson(lockPath);
      if (!staleRetry && lock && !isProcessAlive(Number(lock.pid))) {
        fs.rmSync(lockPath, { force: true });
        return acquireLock(lockPath, true);
      }
      throw new Error(`RAG re-index already running${lock && lock.pid ? ` (pid ${lock.pid})` : ''}`);
    }
    throw error;
  }
}

function releaseLock(descriptor, lockPath) {
  try {
    fs.closeSync(descriptor);
  } finally {
    fs.rmSync(lockPath, { force: true });
  }
}

function loadDocuments(options = {}) {
  const summaries = [];
  let offset = 0;
  while (true) {
    const page = listImportedDocuments({
      ...options,
      includeStale: true,
      limit: MAX_SEARCH_SCAN,
      offset,
    });
    summaries.push(...page.documents);
    offset += page.documents.length;
    if (page.documents.length === 0 || offset >= page.total) break;
  }
  return summaries
    .map((summary) => {
      const document = readImportedDocument(summary.documentId, options);
      if (!document) return null;
      const currentDocument = { ...document, isCurrent: summary.isCurrent !== false };
      return upgradeLegacyDocument(currentDocument, {
        ...options,
        persist: false,
      }).document;
    })
    .filter(Boolean);
}

async function reindexRag(options = {}, dependencies = {}) {
  const paths = resolveReindexPaths(options);
  const documents = loadDocuments(options);
  const current = documents.filter((document) => (
    document.isCurrent !== false
    && (!document.deduplication || document.deduplication.status !== 'near_duplicate_review')
  ));
  const stale = documents.filter((document) => document.isCurrent === false);
  const legacyDocumentsToUpgrade = documents.filter((document) => (
    document._legacyMigrated === true
  )).length;
  const expectedChunks = current.reduce((sum, document) => sum + (document.chunks || []).length, 0);
  if (options.dryRun === true) {
    return {
      status: 'dry_run',
      currentDocuments: current.length,
      staleDocuments: stale.length,
      expectedChunks,
      legacyDocumentsToUpgrade,
    };
  }

  const lockDescriptor = acquireLock(paths.lockPath);
  const indexDocument = dependencies.indexDocument || vectorStore.indexDocument;
  const retireDocument = dependencies.retireDocument || vectorStore.retireDocument;
  const getIndexStatus = dependencies.getRagIndexStatus || vectorStore.getRagIndexStatus;
  const previousState = options.resume === false ? null : readJson(paths.statePath);
  const resumableStatuses = new Set(['in_progress', 'partial_failure']);
  const completed = new Set(previousState && resumableStatuses.has(previousState.status)
    ? previousState.completedDocumentIds || []
    : []);
  const state = {
    schemaVersion: 1,
    status: 'in_progress',
    startedAt: previousState && previousState.startedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expectedDocuments: current.length,
    expectedChunks,
    completedDocumentIds: [...completed],
    failures: [],
    embeddedCount: 0,
    reusedCount: 0,
    retiredDocuments: 0,
    migratedLegacyDocuments: 0,
  };
  writeJsonAtomic(paths.statePath, state);

  try {
    for (const document of stale) {
      const retired = await retireDocument(document.documentId, options);
      if (retired.retired) state.retiredDocuments += 1;
    }
    for (const document of current) {
      if (document._legacyMigrated === true) {
        upgradeLegacyDocument(document, {
          ...options,
          persist: true,
        });
        state.migratedLegacyDocuments += 1;
      }
      if (completed.has(document.documentId)) continue;
      try {
        const result = await indexDocument(document, options);
        state.embeddedCount += Number(result.embeddedCount || 0);
        state.reusedCount += Number(result.reusedCount || 0);
        completed.add(document.documentId);
        state.completedDocumentIds = [...completed];
      } catch (error) {
        state.failures.push({
          documentId: document.documentId,
          errorType: error && error.name || 'Error',
        });
      }
      state.updatedAt = new Date().toISOString();
      writeJsonAtomic(paths.statePath, state);
    }
    state.status = state.failures.length > 0 ? 'partial_failure' : 'complete';
    state.completedAt = new Date().toISOString();
    state.index = await getIndexStatus(options);
    state.reconciliation = {
      expectedDocuments: current.length,
      completedDocuments: completed.size,
      expectedChunks,
      documentCountMatches: completed.size === current.length,
      migratedLegacyDocuments: state.migratedLegacyDocuments,
    };
    writeJsonAtomic(paths.statePath, state);
    return state;
  } finally {
    releaseLock(lockDescriptor, paths.lockPath);
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--no-resume') options.resume = false;
    else if (arg === '--feedback-dir') options.feedbackDir = argv[++index];
  }
  return options;
}

if (require.main?.filename === __filename) {
  reindexRag(parseArgs(process.argv.slice(2)))
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (result.status === 'partial_failure') process.exitCode = 1;
    })
    .catch((error) => {
      process.stderr.write(`RAG re-index failed: ${error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  REINDEX_LOCK_FILENAME,
  REINDEX_STATE_FILENAME,
  reindexRag,
  resolveReindexPaths,
};
