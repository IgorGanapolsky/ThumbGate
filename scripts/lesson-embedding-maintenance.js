#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  semanticRank,
  isEmbedderAvailable,
  lessonText,
  hashText,
  readCache,
} = require('./lesson-embedding-index');
const {
  selectRetrievalMemories,
  MAX_RETRIEVAL_MEMORY_LINES,
} = require('./lesson-retrieval');

function loadLessonCorpus(feedbackDir) {
  const { readJSONL, getFeedbackPaths } = require('./feedback-loop');
  const memoryPath = feedbackDir
    ? path.join(feedbackDir, 'memory-log.jsonl')
    : getFeedbackPaths().MEMORY_LOG_PATH;
  const lessons = selectRetrievalMemories(
    readJSONL(memoryPath, { maxLines: MAX_RETRIEVAL_MEMORY_LINES }),
  );
  return { lessons, memoryPath };
}

function evaluateEmbeddingIndexDrift(options = {}) {
  const feedbackDir = options.feedbackDir || process.env.THUMBGATE_FEEDBACK_DIR;
  const { lessons, memoryPath } = loadLessonCorpus(feedbackDir);
  const cachePath = path.join(
    feedbackDir || path.dirname(memoryPath),
    options.cacheFile || 'lesson-embeddings.json',
  );
  const cache = readCache(cachePath);
  let indexedCount = 0;
  const missingIds = [];
  const staleIds = [];
  const providers = {};
  const dimensions = {};
  const corpusIds = new Set(lessons.map((lesson) => lesson.id));

  for (const lesson of lessons) {
    const entry = cache[lesson.id];
    const valid = entry
      && entry.hash === hashText(lessonText(lesson))
      && Array.isArray(entry.vector)
      && entry.vector.length > 0
      && entry.dimension === entry.vector.length
      && typeof entry.provider === 'string';
    if (valid) {
      indexedCount += 1;
      providers[entry.provider] = (providers[entry.provider] || 0) + 1;
      dimensions[entry.dimension] = (dimensions[entry.dimension] || 0) + 1;
    } else if (entry) {
      staleIds.push(lesson.id);
    } else {
      missingIds.push(lesson.id);
    }
  }

  const orphanedIds = Object.keys(cache)
    .filter((id) => !corpusIds.has(id))
    .sort((left, right) => left.localeCompare(right));
  missingIds.sort((left, right) => left.localeCompare(right));
  staleIds.sort((left, right) => left.localeCompare(right));

  const corpusCount = lessons.length;
  const coverage = corpusCount ? indexedCount / corpusCount : 1;
  const semanticProviderAvailable = options.embedder
    ? true
    : isEmbedderAvailable();
  const minCoverage = Math.max(0, Math.min(1, Number(options.minCoverage) || 0.95));
  const requireExact = options.requireExact !== false;
  const enabled = semanticProviderAvailable || Object.keys(cache).length > 0;
  const exactIdSet = missingIds.length === 0
    && staleIds.length === 0
    && orphanedIds.length === 0;
  const status = !enabled
    ? 'not_configured'
    : coverage >= minCoverage
      && staleIds.length === 0
      && orphanedIds.length === 0
      && (!requireExact || exactIdSet)
      ? 'healthy'
      : 'unhealthy';
  return {
    ok: status !== 'unhealthy',
    status,
    semanticProviderAvailable,
    corpusCount,
    indexedCount,
    missingCount: missingIds.length,
    missingIds,
    staleCount: staleIds.length,
    staleIds,
    orphanedCount: orphanedIds.length,
    orphanedIds,
    exactIdSet,
    requireExact,
    coverage: Number(coverage.toFixed(4)),
    minCoverage,
    providers,
    dimensions,
    memoryPath,
    cachePath,
  };
}

async function backfillLessonEmbeddings(options = {}) {
  const feedbackDir = options.feedbackDir || process.env.THUMBGATE_FEEDBACK_DIR;
  if (!options.embedder && !isEmbedderAvailable()) {
    const error = new Error(
      'No semantic embedding provider configured. Set THUMBGATE_OLLAMA_EMBED_MODEL or configure another real provider.',
    );
    error.code = 'THUMBGATE_SEMANTIC_PROVIDER_UNAVAILABLE';
    throw error;
  }
  const { lessons } = loadLessonCorpus(feedbackDir);
  if (lessons.length > 0) {
    await semanticRank('ThumbGate lesson embedding backfill health query', lessons, {
      feedbackDir,
      embedder: options.embedder,
      embedderId: options.embedderId,
      cacheFile: options.cacheFile,
    });
  }
  return evaluateEmbeddingIndexDrift({
    ...options,
    feedbackDir,
    embedder: options.embedder,
  });
}

function parseArgs(argv) {
  const args = { json: false, backfill: false, requireSemantic: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') args.json = true;
    else if (arg === '--backfill') args.backfill = true;
    else if (arg === '--require-semantic') args.requireSemantic = true;
    else if (arg === '--feedback-dir') args.feedbackDir = argv[++index];
    else if (arg === '--min-coverage') args.minCoverage = Number(argv[++index]);
  }
  return args;
}

async function runCli() {
  const options = parseArgs(process.argv.slice(2));
  let report;
  try {
    report = options.backfill
      ? await backfillLessonEmbeddings(options)
      : evaluateEmbeddingIndexDrift(options);
  } catch (error) {
    report = { ok: false, status: 'error', error: error.message, code: error.code || 'ERROR' };
  }
  const output = options.json
    ? JSON.stringify(report, null, 2)
    : `Lesson embeddings: ${report.status}; ${report.indexedCount || 0}/${report.corpusCount || 0} indexed; coverage=${report.coverage || 0}`;
  process.stdout.write(`${output}\n`);
  if (!report.ok || (options.requireSemantic && !report.semanticProviderAvailable)) {
    process.exitCode = 1;
  }
}

if (!module.parent) {
  runCli();
}

module.exports = {
  loadLessonCorpus,
  evaluateEmbeddingIndexDrift,
  backfillLessonEmbeddings,
  parseArgs,
};
