'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const savedFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

test.after(() => {
  if (savedFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
  else process.env.THUMBGATE_FEEDBACK_DIR = savedFeedbackDir;
});

test('retrieveRelevantLessons returns empty array when no memories', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-ret-'));
  const { retrieveRelevantLessons } = require('../scripts/lesson-retrieval');
  const result = retrieveRelevantLessons('Bash', 'git push', { feedbackDir: tmpDir });
  assert.deepStrictEqual(result, []);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('retrieveRelevantLessons returns top-K by relevance score', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-ret-'));
  const now = new Date().toISOString();

  writeJsonl(path.join(tmpDir, 'memory-log.jsonl'), [
    { id: 'm1', title: 'bash lesson', content: 'always verify before push', tags: ['negative'], timestamp: now },
    { id: 'm2', title: 'edit lesson', content: 'check file exists', tags: ['positive'], timestamp: now },
    { id: 'm3', title: 'read lesson', content: 'read before editing', tags: ['negative'], timestamp: now },
    { id: 'm4', title: 'bash deploy', content: 'deploy to production carefully', tags: ['negative'], timestamp: now },
    { id: 'm5', title: 'git workflow', content: 'commit then push', tags: ['positive'], timestamp: now },
    { id: 'm6', title: 'bash git push', content: 'never force push to main', tags: ['negative'], timestamp: now },
  ]);

  const { retrieveRelevantLessons } = require('../scripts/lesson-retrieval');
  const result = retrieveRelevantLessons('Bash', 'git push to remote', {
    maxResults: 3,
    feedbackDir: tmpDir,
  });

  assert.ok(result.length <= 3, `Expected at most 3, got ${result.length}`);
  assert.ok(result.length > 0, 'Expected at least one result');

  // Results should be sorted by relevance (descending)
  for (let i = 1; i < result.length; i++) {
    assert.ok(result[i - 1].relevanceScore >= result[i].relevanceScore,
      `Results not sorted: ${result[i - 1].relevanceScore} < ${result[i].relevanceScore}`);
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('scoreRelevance boosts tool name matches', () => {
  const { scoreRelevance } = require('../scripts/lesson-retrieval');
  const now = new Date().toISOString();

  const memWithTool = {
    title: 'test',
    content: 'some content',
    tags: [],
    metadata: { toolsUsed: ['Bash'] },
    timestamp: now,
  };
  const memWithoutTool = {
    title: 'test',
    content: 'some content',
    tags: [],
    metadata: { toolsUsed: ['Edit'] },
    timestamp: now,
  };

  const scoreWith = scoreRelevance(memWithTool, 'Bash', 'run tests');
  const scoreWithout = scoreRelevance(memWithoutTool, 'Bash', 'run tests');
  assert.ok(scoreWith > scoreWithout, `Tool match should boost score: ${scoreWith} vs ${scoreWithout}`);
});

test('scoreRelevance boosts file path overlap', () => {
  const { scoreRelevance } = require('../scripts/lesson-retrieval');
  const now = new Date().toISOString();

  const memWithPath = {
    title: 'test',
    content: 'error in src/features/auth/login.ts',
    tags: [],
    timestamp: now,
  };
  const memWithoutPath = {
    title: 'test',
    content: 'generic error occurred',
    tags: [],
    timestamp: now,
  };

  const scoreWith = scoreRelevance(memWithPath, 'Edit', 'editing src/features/auth/login.ts');
  const scoreWithout = scoreRelevance(memWithoutPath, 'Edit', 'editing src/features/auth/login.ts');
  assert.ok(scoreWith > scoreWithout, `Path overlap should boost score: ${scoreWith} vs ${scoreWithout}`);
});

test('scoreRelevance applies recency decay', () => {
  const { scoreRelevance } = require('../scripts/lesson-retrieval');

  const recentMem = {
    title: 'bash lesson',
    content: 'verify before push',
    tags: ['negative'],
    timestamp: new Date().toISOString(),
  };
  const oldMem = {
    title: 'bash lesson',
    content: 'verify before push',
    tags: ['negative'],
    timestamp: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(), // 60 days ago
  };

  const recentScore = scoreRelevance(recentMem, 'Bash', 'push code');
  const oldScore = scoreRelevance(oldMem, 'Bash', 'push code');
  assert.ok(recentScore > oldScore, `Recent should score higher: ${recentScore} vs ${oldScore}`);
});

test('scoreRelevance boosts structured rules', () => {
  const { scoreRelevance } = require('../scripts/lesson-retrieval');
  const now = new Date().toISOString();

  const memWithRule = {
    title: 'test',
    content: 'some lesson',
    tags: [],
    structuredRule: { if: 'push', then: 'verify first' },
    timestamp: now,
  };
  const memWithoutRule = {
    title: 'test',
    content: 'some lesson',
    tags: [],
    timestamp: now,
  };

  const scoreWith = scoreRelevance(memWithRule, 'Bash', 'push');
  const scoreWithout = scoreRelevance(memWithoutRule, 'Bash', 'push');
  assert.ok(scoreWith > scoreWithout, `Structured rule should boost score: ${scoreWith} vs ${scoreWithout}`);
});

test('scoreRelevance boosts negative signal lessons', () => {
  const { scoreRelevance } = require('../scripts/lesson-retrieval');
  const now = new Date().toISOString();

  const negativeMem = {
    title: 'test',
    content: 'some content about bash',
    tags: ['negative'],
    timestamp: now,
  };
  const positiveMem = {
    title: 'test',
    content: 'some content about bash',
    tags: ['positive'],
    timestamp: now,
  };

  const negScore = scoreRelevance(negativeMem, 'Bash', 'run command');
  const posScore = scoreRelevance(positiveMem, 'Bash', 'run command');
  assert.ok(negScore > posScore, `Negative signal should boost score: ${negScore} vs ${posScore}`);
});

test('textBigrams extracts character bigrams', () => {
  const { textBigrams } = require('../scripts/lesson-retrieval');
  const result = textBigrams('hello');
  assert.ok(result instanceof Set);
  assert.ok(result.has('he'));
  assert.ok(result.has('el'));
  assert.ok(result.has('ll'));
  assert.ok(result.has('lo'));
});

test('bigramJaccard returns 1 for identical text', () => {
  const { textBigrams, bigramJaccard } = require('../scripts/lesson-retrieval');
  const a = textBigrams('force push to main');
  const b = textBigrams('force push to main');
  assert.strictEqual(bigramJaccard(a, b), 1);
});

test('bigramJaccard returns high score for paraphrases', () => {
  const { textBigrams, bigramJaccard } = require('../scripts/lesson-retrieval');
  const a = textBigrams('force pushed to main branch');
  const b = textBigrams('force push to the main branch');
  const score = bigramJaccard(a, b);
  assert.ok(score > 0.6, `Paraphrases should have high bigram overlap: ${score}`);
});

test('bigramJaccard returns low score for unrelated text', () => {
  const { textBigrams, bigramJaccard } = require('../scripts/lesson-retrieval');
  const a = textBigrams('force push to main');
  const b = textBigrams('testing authentication module');
  const score = bigramJaccard(a, b);
  assert.ok(score < 0.3, `Unrelated text should have low overlap: ${score}`);
});

test('buildActionSignature creates a complete signature', () => {
  const { buildActionSignature } = require('../scripts/lesson-retrieval');
  const sig = buildActionSignature('Bash', 'git push to src/features/auth.ts');
  assert.strictEqual(sig.toolLower, 'bash');
  assert.ok(sig.paths.length > 0, 'Should extract file paths');
  assert.ok(sig.tokens.length > 0, 'Should extract tokens');
  assert.ok(sig.ngramSet.size > 0, 'Should compute bigrams');
});

test('scoreRelevance boosts fuzzy matches via n-gram similarity', () => {
  const { scoreRelevance } = require('../scripts/lesson-retrieval');
  const now = new Date().toISOString();

  const similarMem = {
    title: 'deployment issue',
    content: 'force pushed to the main branch causing data loss',
    tags: ['negative'],
    timestamp: now,
  };
  const unrelatedMem = {
    title: 'testing note',
    content: 'authentication module needs integration tests',
    tags: ['negative'],
    timestamp: now,
  };

  const similarScore = scoreRelevance(similarMem, 'Bash', 'force push to main branch');
  const unrelatedScore = scoreRelevance(unrelatedMem, 'Bash', 'force push to main branch');
  assert.ok(similarScore > unrelatedScore,
    `Fuzzy match should boost similar content: ${similarScore} vs ${unrelatedScore}`);
});

// ---------------------------------------------------------------------------
// Nucleus (top-P) "decide when to stop" filtering — Memora-style retrieval.
// ---------------------------------------------------------------------------

test('filterTopP is a no-op at topP >= 1 (default behaviour unchanged)', () => {
  const { filterTopP } = require('../scripts/lesson-retrieval');
  const lessons = [
    { id: 'a', relevanceScore: 0.5 },
    { id: 'b', relevanceScore: 0.3 },
    { id: 'c', relevanceScore: 0.2 },
  ];
  assert.deepStrictEqual(filterTopP(lessons, 1.0).map((l) => l.id), ['a', 'b', 'c']);
  assert.deepStrictEqual(filterTopP(lessons, 2).map((l) => l.id), ['a', 'b', 'c']);
  // default arg is 1.0 → no-op
  assert.deepStrictEqual(filterTopP(lessons).map((l) => l.id), ['a', 'b', 'c']);
});

test('filterTopP keeps the smallest prefix covering the normalized mass', () => {
  const { filterTopP } = require('../scripts/lesson-retrieval');
  // normalized distribution: 0.60, 0.25, 0.15
  const lessons = [
    { id: 'a', relevanceScore: 0.6 },
    { id: 'b', relevanceScore: 0.25 },
    { id: 'c', relevanceScore: 0.15 },
  ];
  assert.deepStrictEqual(filterTopP(lessons, 0.5).map((l) => l.id), ['a']); // 0.60 >= 0.50
  assert.deepStrictEqual(filterTopP(lessons, 0.8).map((l) => l.id), ['a', 'b']); // 0.85 >= 0.80
  assert.deepStrictEqual(filterTopP(lessons, 0.99).map((l) => l.id), ['a', 'b', 'c']);
});

test('filterTopP normalizes, so raw score scale does not matter', () => {
  const { filterTopP } = require('../scripts/lesson-retrieval');
  // Same distribution as above but scaled 100x — must produce identical cuts.
  const lessons = [
    { id: 'a', relevanceScore: 60 },
    { id: 'b', relevanceScore: 25 },
    { id: 'c', relevanceScore: 15 },
  ];
  assert.deepStrictEqual(filterTopP(lessons, 0.5).map((l) => l.id), ['a']);
  assert.deepStrictEqual(filterTopP(lessons, 0.8).map((l) => l.id), ['a', 'b']);
});

test('filterTopP honors the minKeep floor', () => {
  const { filterTopP } = require('../scripts/lesson-retrieval');
  const lessons = [
    { id: 'a', relevanceScore: 0.9 },
    { id: 'b', relevanceScore: 0.07 },
    { id: 'c', relevanceScore: 0.03 },
  ];
  // topP 0.5 alone would keep only 'a'; minKeep 2 forces a second lesson.
  assert.deepStrictEqual(filterTopP(lessons, 0.5, { minKeep: 2 }).map((l) => l.id), ['a', 'b']);
});

test('filterTopP prefers rerankedScore over relevanceScore', () => {
  const { filterTopP } = require('../scripts/lesson-retrieval');
  const lessons = [
    { id: 'a', relevanceScore: 0.1, rerankedScore: 0.05 },
    { id: 'b', relevanceScore: 0.1, rerankedScore: 0.95 },
  ];
  assert.deepStrictEqual(filterTopP(lessons, 0.5).map((l) => l.id), ['b']);
});

test('filterTopP handles empty, null, and all-zero inputs safely', () => {
  const { filterTopP } = require('../scripts/lesson-retrieval');
  assert.deepStrictEqual(filterTopP([], 0.5), []);
  assert.deepStrictEqual(filterTopP(null, 0.5), []);
  // all-zero scores → no usable distribution → fall back to minKeep floor (never empty)
  const zero = [{ id: 'a', relevanceScore: 0 }, { id: 'b', relevanceScore: 0 }];
  assert.strictEqual(filterTopP(zero, 0.5).length, 1);
});

test('resolveTopP precedence: option > env > default(1.0)', () => {
  const { resolveTopP } = require('../scripts/lesson-retrieval');
  const saved = process.env.THUMBGATE_RETRIEVAL_TOP_P;
  try {
    delete process.env.THUMBGATE_RETRIEVAL_TOP_P;
    assert.strictEqual(resolveTopP({}), 1.0);
    assert.strictEqual(resolveTopP({ topP: 0.8 }), 0.8);
    assert.strictEqual(resolveTopP({ topP: 5 }), 1.0); // out-of-range option ignored

    process.env.THUMBGATE_RETRIEVAL_TOP_P = '0.7';
    assert.strictEqual(resolveTopP({}), 0.7); // env used
    assert.strictEqual(resolveTopP({ topP: 0.8 }), 0.8); // option still wins
    assert.strictEqual(resolveTopP({ topP: 9 }), 0.7); // bad option → env

    process.env.THUMBGATE_RETRIEVAL_TOP_P = 'nonsense';
    assert.strictEqual(resolveTopP({}), 1.0); // unparseable env → default
  } finally {
    if (saved === undefined) delete process.env.THUMBGATE_RETRIEVAL_TOP_P;
    else process.env.THUMBGATE_RETRIEVAL_TOP_P = saved;
  }
});

test('retrieveRelevantLessons: topP trims the tail, never empties, no-op at 1.0', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-ret-nucleus-'));
  const now = new Date().toISOString();
  writeJsonl(path.join(tmpDir, 'memory-log.jsonl'), [
    { id: 'm1', title: 'bash git push', content: 'never force push to main', tags: ['negative'], timestamp: now },
    { id: 'm2', title: 'bash push', content: 'verify before you push to remote', tags: ['negative'], timestamp: now },
    { id: 'm3', title: 'git workflow', content: 'commit then push to remote branch', tags: ['positive'], timestamp: now },
    { id: 'm4', title: 'bash deploy', content: 'deploy to production carefully after push', tags: ['negative'], timestamp: now },
    { id: 'm5', title: 'read lesson', content: 'read before editing files', tags: ['negative'], timestamp: now },
  ]);

  const { retrieveRelevantLessons } = require('../scripts/lesson-retrieval');
  const opts = { maxResults: 5, feedbackDir: tmpDir };

  const full = retrieveRelevantLessons('Bash', 'git push to remote', opts);
  const noop = retrieveRelevantLessons('Bash', 'git push to remote', { ...opts, topP: 1.0 });
  const trimmed = retrieveRelevantLessons('Bash', 'git push to remote', { ...opts, topP: 0.01 });

  assert.ok(full.length >= 1, 'baseline returns at least one lesson');
  assert.deepStrictEqual(noop.map((l) => l.id), full.map((l) => l.id), 'topP=1.0 is identical to default');
  assert.ok(trimmed.length >= 1, 'nucleus never empties the result');
  assert.ok(trimmed.length <= full.length, 'nucleus is purely subtractive');
  assert.strictEqual(trimmed.length, 1, 'a tiny topP keeps only the single top lesson');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
