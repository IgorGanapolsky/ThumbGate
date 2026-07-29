#!/usr/bin/env node
'use strict';

/**
 * Backfill the dense lesson-embedding cache.
 *
 * The hybrid retrieval in scripts/lesson-retrieval.js has a dense arm powered
 * by <feedbackDir>/lesson-embeddings.json (see scripts/lesson-embedding-index.js),
 * but embeddings only accrue lazily on the hot path — most of the corpus never
 * gets a vector, so RRF fusion degrades to lexical-only. This CLI walks the
 * memory log, embeds every lesson missing a current vector with the SAME
 * provider the hot path uses (vector-store.embed), and persists the cache in
 * the exact format semanticRank reads.
 *
 * Usage:
 *   node scripts/backfill-lesson-embeddings.js [--dry-run] [--feedback-dir=DIR] [--batch-size=N]
 *
 * Exit codes: 0 ok, 2 embedding provider unavailable/failed.
 */

const fs = require('fs');
const path = require('path');

const {
  isEmbedderAvailable,
  lessonText,
  hashText,
  getCachePath,
} = require('./lesson-embedding-index');

const DEFAULT_BATCH_SIZE = 25;

function parseArgs(argv) {
  const args = { dryRun: false, feedbackDir: null, batchSize: DEFAULT_BATCH_SIZE };
  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg.startsWith('--feedback-dir=')) args.feedbackDir = arg.slice('--feedback-dir='.length);
    else if (arg.startsWith('--batch-size=')) {
      const n = Number(arg.slice('--batch-size='.length));
      if (Number.isFinite(n) && n > 0) args.batchSize = Math.floor(n);
    }
  }
  return args;
}

function resolveDir(explicit) {
  if (explicit) return explicit;
  const { resolveFeedbackDir } = require('./feedback-paths');
  return resolveFeedbackDir();
}

function readMemoryLog(feedbackDir) {
  const logPath = path.join(feedbackDir, 'memory-log.jsonl');
  if (!fs.existsSync(logPath)) return [];
  const lessons = [];
  for (const line of fs.readFileSync(logPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { lessons.push(JSON.parse(trimmed)); } catch { /* skip malformed */ }
  }
  return lessons;
}

function readCacheFile(cachePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function hasCurrentVector(cache, lesson) {
  const entry = cache[lesson.id];
  return Boolean(entry && Array.isArray(entry.vector) && entry.vector.length > 0
    && entry.hash === hashText(lessonText(lesson)));
}

/** Split the corpus into embeddable lessons, junk, and already-covered. */
function assessCoverage(lessons, cache) {
  const { isRawHookPayload } = require('./lesson-hygiene');
  const embeddable = [];
  const missing = [];
  let junk = 0;
  for (const lesson of lessons) {
    if (!lesson || !lesson.id) continue;
    const text = lessonText(lesson);
    if (!text) continue;
    if (isRawHookPayload(text)) {
      junk += 1;
      continue;
    }
    embeddable.push(lesson);
    if (!hasCurrentVector(cache, lesson)) missing.push(lesson);
  }
  return { embeddable, missing, junk };
}

async function backfill({ feedbackDir, batchSize, dryRun }) {
  const dir = resolveDir(feedbackDir);
  const cachePath = getCachePath(dir);
  const lessons = readMemoryLog(dir);
  const cache = readCacheFile(cachePath);
  const { embeddable, missing, junk } = assessCoverage(lessons, cache);
  const covered = embeddable.length - missing.length;

  console.log(`feedback dir: ${dir}`);
  console.log(`embedding coverage before: ${covered}/${embeddable.length} lessons (${junk} junk docs skipped)`);

  if (dryRun) {
    console.log(`gap: ${missing.length} lessons missing embeddings (dry run, nothing embedded)`);
    return 0;
  }
  if (missing.length === 0) {
    console.log('embedding coverage after: nothing to do');
    return 0;
  }
  if (!isEmbedderAvailable()) {
    console.error('backfill aborted: no embedding provider is available (set up Gemini embeddings or THUMBGATE_VECTOR_STUB_EMBED=true)');
    return 2;
  }

  let embed;
  try {
    ({ embed } = require('./vector-store'));
  } catch (err) {
    console.error(`backfill aborted: embedding provider failed to load (${err.message})`);
    return 2;
  }

  let done = 0;
  for (let i = 0; i < missing.length; i += batchSize) {
    const batch = missing.slice(i, i + batchSize);
    for (const lesson of batch) {
      const text = lessonText(lesson);
      let vector;
      try {
        vector = await embed(text, {
          kind: 'document',
          task: 'code retrieval',
          title: lesson.title || undefined,
        });
      } catch (err) {
        console.error(`backfill aborted after ${done} embeddings: provider error (${err.message})`);
        return 2;
      }
      if (!Array.isArray(vector) || vector.length === 0) {
        console.error(`backfill aborted after ${done} embeddings: provider returned no vector`);
        return 2;
      }
      cache[lesson.id] = { hash: hashText(text), vector };
      done += 1;
    }
    // Persist per batch so an interruption keeps completed work.
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(cache));
    console.log(`embedded ${done}/${missing.length}`);
  }

  const after = assessCoverage(readMemoryLog(dir), readCacheFile(cachePath));
  console.log(`embedding coverage after: ${after.embeddable.length - after.missing.length}/${after.embeddable.length} lessons`);
  return 0;
}

// SonarCloud S3403: require.main === module misfires under strict inference.
if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  backfill(parseArgs(process.argv.slice(2)))
    .then((code) => { process.exitCode = code; })
    .catch((err) => {
      console.error(`backfill failed: ${err.message}`);
      process.exitCode = 2;
    });
}

module.exports = { parseArgs, assessCoverage, hasCurrentVector, backfill };
