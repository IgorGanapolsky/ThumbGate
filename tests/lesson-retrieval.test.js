'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const savedFeedbackDir = process.env.RLHF_FEEDBACK_DIR;

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

test.after(() => {
  if (savedFeedbackDir === undefined) delete process.env.RLHF_FEEDBACK_DIR;
  else process.env.RLHF_FEEDBACK_DIR = savedFeedbackDir;
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
