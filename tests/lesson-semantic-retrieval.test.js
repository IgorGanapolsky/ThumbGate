'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  retrieveRelevantLessons,
  retrieveRelevantLessonsAsync,
  reciprocalRankFusion,
} = require('../scripts/lesson-retrieval');
const {
  cosineSimilarity,
  isEmbedderAvailable,
} = require('../scripts/lesson-embedding-index');

const savedFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-sem-'));
}

test.after(() => {
  if (savedFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
  else process.env.THUMBGATE_FEEDBACK_DIR = savedFeedbackDir;
});

// A deterministic concept-space embedder used ONLY in tests. It maps text to a
// 3-axis vector by concept so that paraphrases land near each other even with
// zero shared keywords — exactly the recall that lexical retrieval cannot give.
async function conceptEmbedder(text) {
  const t = String(text || '').toLowerCase();
  const destruction = /(delete|remove|\brm\b|wipe|erase|destroy|folder|directory|data|tree)/.test(t) ? 1 : 0;
  const git = /(git|push|force|commit|branch|rebase)/.test(t) ? 1 : 0;
  const network = /(curl|fetch|http|request|endpoint|api)/.test(t) ? 1 : 0;
  // Guarantee a non-zero vector so cosine is defined.
  return [destruction, git, network, 0.001];
}

// --- reciprocalRankFusion -------------------------------------------------

test('reciprocalRankFusion merges two ranked lists by rank, not score', () => {
  const fused = reciprocalRankFusion([
    ['a', 'b', 'c'],
    ['c', 'a', 'd'],
  ]);
  const order = fused.map((f) => f.id);
  // 'a' (ranks 1 & 2) and 'c' (ranks 3 & 1) appear in both → outrank singletons.
  assert.ok(order.indexOf('a') < order.indexOf('b'), 'a should beat b');
  assert.ok(order.indexOf('c') < order.indexOf('b'), 'c should beat b');
  assert.deepEqual(new Set(order), new Set(['a', 'b', 'c', 'd']));
});

test('reciprocalRankFusion tolerates empty/garbage input', () => {
  assert.deepEqual(reciprocalRankFusion([]), []);
  assert.deepEqual(reciprocalRankFusion([null, undefined, []]), []);
});

// --- cosineSimilarity -----------------------------------------------------

test('cosineSimilarity: identical vectors = 1, orthogonal = 0', () => {
  assert.equal(cosineSimilarity([1, 0, 0], [1, 0, 0]), 1);
  assert.equal(cosineSimilarity([1, 0, 0], [0, 1, 0]), 0);
  assert.equal(cosineSimilarity([1, 0], [2, 0]), 1); // scale-invariant
  assert.equal(cosineSimilarity([], [1]), 0); // shape mismatch is safe
});

// --- the core value: dense recall surfaces a lexical-miss -----------------

test('hybrid retrieval surfaces a paraphrased mistake that lexical retrieval misses', async () => {
  const tmp = mkTmp();
  const now = new Date().toISOString();

  // The dangerous lesson shares NO meaningful tokens with the query phrasing.
  const lessons = [
    {
      id: 'destroy',
      title: 'MISTAKE: rm -rf wiped the contents',
      content: 'How to avoid: never wipe without a backup snapshot',
      tags: ['negative'],
      timestamp: now,
    },
    {
      id: 'gitlesson',
      title: 'force push clobbered history',
      content: 'How to avoid: use --force-with-lease',
      tags: ['negative'],
      timestamp: now,
    },
    {
      id: 'netlesson',
      title: 'curl endpoint timed out',
      content: 'How to avoid: set a request timeout',
      tags: ['positive'],
      timestamp: now,
    },
  ];
  writeJsonl(path.join(tmp, 'memory-log.jsonl'), lessons);

  const query = 'permanently erase a directory tree';

  // Pure lexical retrieval does NOT surface the 'destroy' lesson (no shared tokens
  // above the 3-char tokenizer threshold besides concept-level meaning).
  const lexical = retrieveRelevantLessons('Bash', query, { maxResults: 5, feedbackDir: tmp });
  const lexicalIds = new Set(lexical.map((l) => l.id));
  assert.ok(!lexicalIds.has('destroy'),
    `lexical unexpectedly surfaced 'destroy' (${[...lexicalIds].join(',')}) — pick a stronger paraphrase`);

  // Hybrid retrieval WITH the concept embedder surfaces it via dense similarity.
  const hybrid = await retrieveRelevantLessonsAsync('Bash', query, {
    maxResults: 5,
    feedbackDir: tmp,
    embedder: conceptEmbedder,
  });
  const hybridIds = new Set(hybrid.map((l) => l.id));
  assert.ok(hybridIds.has('destroy'),
    `hybrid should surface the semantically-related 'destroy' lesson, got: ${[...hybridIds].join(',')}`);

  fs.rmSync(tmp, { recursive: true, force: true });
});

// --- honest degradation: errors and missing embedder fall back to lexical --

test('hybrid retrieval falls back to lexical when the embedder throws', async () => {
  const tmp = mkTmp();
  const now = new Date().toISOString();
  writeJsonl(path.join(tmp, 'memory-log.jsonl'), [
    { id: 'm1', title: 'bash git push', content: 'never force push to main', tags: ['negative'], timestamp: now },
    { id: 'm2', title: 'edit lesson', content: 'check file exists', tags: ['positive'], timestamp: now },
  ]);

  const throwingEmbedder = async () => { throw new Error('embedder offline'); };

  const hybrid = await retrieveRelevantLessonsAsync('Bash', 'git push to remote', {
    maxResults: 3,
    feedbackDir: tmp,
    embedder: throwingEmbedder,
  });
  const lexical = retrieveRelevantLessons('Bash', 'git push to remote', { maxResults: 3, feedbackDir: tmp });

  // Identical to lexical → no regression, no thrown error.
  assert.deepEqual(hybrid.map((l) => l.id), lexical.map((l) => l.id));

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('hybrid retrieval returns [] for an empty corpus', async () => {
  const tmp = mkTmp();
  const result = await retrieveRelevantLessonsAsync('Bash', 'git push', {
    feedbackDir: tmp,
    embedder: conceptEmbedder,
  });
  assert.deepEqual(result, []);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// --- embedding cache reuse ------------------------------------------------

test('document vectors are cached and reused across calls', async () => {
  const tmp = mkTmp();
  const now = new Date().toISOString();
  writeJsonl(path.join(tmp, 'memory-log.jsonl'), [
    { id: 'c1', title: 'rm -rf danger', content: 'never delete data', tags: ['negative'], timestamp: now },
  ]);

  let docEmbeds = 0;
  const countingEmbedder = async (text, opts = {}) => {
    if (opts.kind === 'document') docEmbeds += 1;
    return conceptEmbedder(text);
  };

  const opts = { feedbackDir: tmp, embedder: countingEmbedder, maxResults: 3 };
  await retrieveRelevantLessonsAsync('Bash', 'erase the folder', opts);
  const afterFirst = docEmbeds;
  await retrieveRelevantLessonsAsync('Bash', 'wipe the directory', opts);

  assert.equal(afterFirst, 1, 'first call embeds the one document');
  assert.equal(docEmbeds, 1, 'second call reuses the cached document vector (no re-embed)');
  assert.ok(fs.existsSync(path.join(tmp, 'lesson-embeddings.json')), 'cache file persisted');

  fs.rmSync(tmp, { recursive: true, force: true });
});

// --- availability check is callable and boolean ---------------------------

test('isEmbedderAvailable returns a boolean without loading a model', () => {
  assert.equal(typeof isEmbedderAvailable(), 'boolean');
});
