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

test('parseLessonContent extracts corrective-action fields', () => {
  const { parseLessonContent } = require('../scripts/lesson-search');
  const parsed = parseLessonContent([
    'What went wrong: Claimed completion without verification.',
    'How to avoid: Run the full verification suite before closing the task.',
    'Reasoning: The task changed underneath the previous check.',
    'Rubric weighted score: 0.2',
  ].join('\n'));

  assert.equal(parsed.whatWentWrong, 'Claimed completion without verification.');
  assert.equal(parsed.howToAvoid, 'Run the full verification suite before closing the task.');
  assert.equal(parsed.reasoning, 'The task changed underneath the previous check.');
  assert.equal(parsed.rubric.length, 1);
});

test('searchLessons returns linked corrective actions, prevention rules, and gates', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-search-'));
  process.env.RLHF_FEEDBACK_DIR = tmpDir;

  try {
    writeJsonl(path.join(tmpDir, 'feedback-log.jsonl'), [
      {
        id: 'fb_publish',
        signal: 'negative',
        context: 'Published without verification proof',
        tags: ['verification', 'release'],
        timestamp: '2026-03-23T12:00:00.000Z',
      },
    ]);

    writeJsonl(path.join(tmpDir, 'memory-log.jsonl'), [
      {
        id: 'mem_publish',
        title: 'MISTAKE: Published without verification proof',
        content: [
          'What went wrong: Published without verification proof',
          'How to avoid: Run npm test and attach the output before publishing',
          'Reasoning: The release state changed during verification',
        ].join('\n'),
        category: 'error',
        importance: 'high',
        tags: ['feedback', 'negative', 'verification', 'release'],
        sourceFeedbackId: 'fb_publish',
        diagnosis: { rootCauseCategory: 'verification_failure', criticalFailureStep: 'release' },
        timestamp: '2026-03-23T12:00:01.000Z',
      },
    ]);

    fs.writeFileSync(
      path.join(tmpDir, 'prevention-rules.md'),
      '# Verify before publishing\nAlways run npm test and attach proof before publishing.\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, 'auto-promoted-gates.json'),
      JSON.stringify({
        version: 1,
        gates: [{
          id: 'auto-verification-release',
          action: 'block',
          pattern: 'verification+release',
          message: 'Block publish flows that skipped verification proof',
          occurrences: 5,
          promotedAt: '2026-03-23T12:10:00.000Z',
        }],
        promotionLog: [],
      }, null, 2)
    );

    delete require.cache[require.resolve('../scripts/lesson-search')];
    const { searchLessons } = require('../scripts/lesson-search');
    const result = searchLessons('verification publish', { limit: 5 });

    assert.equal(result.returned, 1);
    assert.equal(result.results[0].id, 'mem_publish');
    assert.equal(result.results[0].lesson.howToAvoid, 'Run npm test and attach the output before publishing');
    assert.equal(result.results[0].systemResponse.sourceFeedback.id, 'fb_publish');
    assert.equal(result.results[0].systemResponse.linkedPreventionRules[0].title, 'Verify before publishing');
    assert.equal(result.results[0].systemResponse.linkedAutoGates[0].id, 'auto-verification-release');
    assert.ok(result.results[0].systemResponse.correctiveActions.some((action) => action.type === 'avoid_repeat'));
    assert.ok(result.results[0].systemResponse.correctiveActions.some((action) => action.type === 'pre_action_block'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('searchLessons can list recent lessons and filter by category/tags', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-search-list-'));
  process.env.RLHF_FEEDBACK_DIR = tmpDir;

  try {
    writeJsonl(path.join(tmpDir, 'memory-log.jsonl'), [
      {
        id: 'mem_old',
        title: 'SUCCESS: Kept verification evidence tight',
        content: 'What worked: Attached proof before merging',
        category: 'learning',
        importance: 'normal',
        tags: ['feedback', 'positive', 'verification'],
        timestamp: '2026-03-21T10:00:00.000Z',
      },
      {
        id: 'mem_new',
        title: 'MISTAKE: Forgot the rollback plan',
        content: 'Action needed: add rollback notes before shipping',
        category: 'error',
        importance: 'high',
        tags: ['feedback', 'negative', 'release'],
        timestamp: '2026-03-23T10:00:00.000Z',
      },
    ]);

    delete require.cache[require.resolve('../scripts/lesson-search')];
    const { searchLessons, formatLessonSearchResults } = require('../scripts/lesson-search');
    const filtered = searchLessons('', { limit: 5, category: 'error', tags: ['release'] });

    assert.equal(filtered.returned, 1);
    assert.equal(filtered.results[0].id, 'mem_new');
    assert.match(formatLessonSearchResults(filtered), /Corrective actions/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
