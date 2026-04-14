'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rerankLessons, fieldWeightedBM25, tokenize, expandTerms } = require('../scripts/lesson-reranker');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLessons(items) {
  return items.map((item, i) => ({
    id: `lesson-${i}`,
    title: item.title || '',
    content: item.content || '',
    signal: item.signal || 'positive',
    tags: item.tags || [],
    relevanceScore: item.relevanceScore ?? 0.5,
    lesson: {
      whatWentWrong: item.whatWentWrong || '',
      whatWorked: item.whatWorked || '',
      howToAvoid: item.howToAvoid || '',
      summary: item.summary || '',
    },
  }));
}

// ---------------------------------------------------------------------------
// tokenize
// ---------------------------------------------------------------------------

test('tokenize splits on whitespace and punctuation', () => {
  const tokens = tokenize('force-push to main branch');
  assert.ok(tokens.includes('force'));
  assert.ok(tokens.includes('push'));
  assert.ok(tokens.includes('main'));
  assert.ok(tokens.includes('branch'));
});

test('tokenize filters single-character tokens', () => {
  const tokens = tokenize('a b cc deploy');
  assert.ok(!tokens.includes('a'));
  assert.ok(!tokens.includes('b'));
  assert.ok(tokens.includes('cc'));
  assert.ok(tokens.includes('deploy'));
});

test('tokenize lowercases input', () => {
  const tokens = tokenize('Force-Push DEPLOY');
  assert.ok(tokens.includes('force'));
  assert.ok(tokens.includes('deploy'));
});

// ---------------------------------------------------------------------------
// expandTerms
// ---------------------------------------------------------------------------

test('expandTerms adds synonym group members', () => {
  const expanded = expandTerms(['deploy']);
  assert.ok(expanded.includes('deploy'));
  assert.ok(expanded.includes('deployment'));
  assert.ok(expanded.includes('release'));
  assert.ok(expanded.includes('publish'));
});

test('expandTerms expands force-push synonyms', () => {
  const expanded = expandTerms(['force']);
  // "force" appears in the force-push group
  assert.ok(expanded.includes('force'));
  assert.ok(expanded.includes('push'));
});

test('expandTerms keeps original terms when no synonym matches', () => {
  const expanded = expandTerms(['xylophone', 'quux']);
  assert.ok(expanded.includes('xylophone'));
  assert.ok(expanded.includes('quux'));
});

// ---------------------------------------------------------------------------
// rerankLessons — ordering
// ---------------------------------------------------------------------------

test('rerankLessons returns empty array for empty candidates', () => {
  assert.deepEqual(rerankLessons('deploy', [], {}), []);
});

test('rerankLessons returns single candidate unchanged', () => {
  const lessons = makeLessons([{ title: 'one', relevanceScore: 0.8 }]);
  const result = rerankLessons('deploy', lessons, { topK: 5 });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'lesson-0');
});

test('rerankLessons promotes lesson whose whatWentWrong matches query', () => {
  // lesson-0: vague title, no field match
  // lesson-1: whatWentWrong matches query exactly — should rank first
  const lessons = makeLessons([
    { title: 'some unrelated issue', relevanceScore: 0.9 },
    {
      title: 'env file exposed',
      whatWentWrong: 'agent edited the .env file directly exposing secrets',
      relevanceScore: 0.3,
    },
  ]);

  const result = rerankLessons('edited .env file exposing secrets', lessons, { topK: 2 });
  assert.equal(result[0].id, 'lesson-1', 'lesson with field match should rank first');
});

test('rerankLessons respects topK limit', () => {
  const lessons = makeLessons([
    { title: 'lesson A', relevanceScore: 0.9 },
    { title: 'lesson B', relevanceScore: 0.8 },
    { title: 'lesson C', relevanceScore: 0.7 },
    { title: 'lesson D', relevanceScore: 0.6 },
  ]);
  const result = rerankLessons('deploy', lessons, { topK: 2 });
  assert.equal(result.length, 2);
});

test('rerankLessons attaches rerankedScore to each result', () => {
  const lessons = makeLessons([
    { title: 'force push to main', whatWentWrong: 'used git push --force', relevanceScore: 0.6 },
    { title: 'broke tests', whatWentWrong: 'deleted test files', relevanceScore: 0.4 },
  ]);
  const result = rerankLessons('force push main', lessons, { topK: 5 });
  for (const r of result) {
    assert.ok(typeof r.rerankedScore === 'number', 'rerankedScore should be a number');
    assert.ok(r.rerankedScore >= 0, 'rerankedScore should be non-negative');
  }
});

// ---------------------------------------------------------------------------
// rerankLessons — signal coherence
// ---------------------------------------------------------------------------

test('rerankLessons boosts negative-signal lessons for failure queries', () => {
  const lessons = makeLessons([
    { title: 'successful deploy', signal: 'positive', whatWorked: 'used --dry-run flag', relevanceScore: 0.5 },
    { title: 'failed deploy', signal: 'negative', whatWentWrong: 'deploy broke production', relevanceScore: 0.4 },
  ]);

  const result = rerankLessons('deploy failed and broke production', lessons, { topK: 2 });
  // Negative-signal lesson should rank at least as high given the failure query
  const negIdx = result.findIndex((r) => r.signal === 'negative');
  const posIdx = result.findIndex((r) => r.signal === 'positive');
  assert.ok(negIdx <= posIdx, 'negative lesson should rank before positive for failure query');
});

// ---------------------------------------------------------------------------
// rerankLessons — tool name joint scoring
// ---------------------------------------------------------------------------

test('rerankLessons boosts lessons where toolName matches metadata toolsUsed', () => {
  const lessons = makeLessons([
    {
      title: 'edit conflict',
      whatWentWrong: 'wrote to wrong file',
      relevanceScore: 0.4,
      // No tool metadata
    },
    {
      title: 'bash command failed',
      whatWentWrong: 'ran dangerous rm command',
      relevanceScore: 0.3,
    },
  ]);
  // Inject toolsUsed metadata into second candidate
  lessons[1].metadata = { toolsUsed: ['Bash'] };

  const result = rerankLessons('dangerous rm command', lessons, { topK: 2, toolName: 'Bash' });
  assert.equal(result[0].id, 'lesson-1', 'lesson with matching toolName should rank first');
});

// ---------------------------------------------------------------------------
// fieldWeightedBM25 — field weighting
// ---------------------------------------------------------------------------

test('fieldWeightedBM25 scores lesson with query term in whatWentWrong higher than in tags', () => {
  const queryTerms = ['deploy'];
  const candidates = makeLessons([
    { tags: ['deploy'], relevanceScore: 0.5 },   // term only in low-weight field
    { whatWentWrong: 'deploy script failed', relevanceScore: 0.5 },  // term in high-weight field
  ]);

  const scores = fieldWeightedBM25(queryTerms, candidates);
  assert.ok(scores[1].bm25Score > scores[0].bm25Score,
    'whatWentWrong field should outweigh tags field');
});

test('fieldWeightedBM25 returns zero score for unrelated lesson', () => {
  const queryTerms = ['xyzzy'];
  const candidates = makeLessons([{ title: 'deploy to production' }]);
  const scores = fieldWeightedBM25(queryTerms, candidates);
  assert.equal(scores[0].bm25Score, 0);
});

// ---------------------------------------------------------------------------
// Integration: lesson-retrieval uses reranker
// ---------------------------------------------------------------------------

test('lesson-retrieval module exports unchanged public API after reranker integration', () => {
  const retrieval = require('../scripts/lesson-retrieval');
  assert.equal(typeof retrieval.retrieveRelevantLessons, 'function');
  assert.equal(typeof retrieval.scoreRelevance, 'function');
  assert.equal(typeof retrieval.buildActionSignature, 'function');
  assert.equal(typeof retrieval.textBigrams, 'function');
  assert.equal(typeof retrieval.bigramJaccard, 'function');
});

test('rerankLessons with synonym expansion: deploy matches deployment in lesson', () => {
  const lessons = makeLessons([
    { title: 'unrelated issue', whatWentWrong: 'database error', relevanceScore: 0.5 },
    { title: 'deployment failed', whatWentWrong: 'deployment script crashed', relevanceScore: 0.3 },
  ]);

  // Query uses "deploy" — should expand to "deployment" via synonym group
  const result = rerankLessons('deploy crashed', lessons, { topK: 2 });
  assert.equal(result[0].id, 'lesson-1', 'synonym expansion should surface the deployment lesson');
});
