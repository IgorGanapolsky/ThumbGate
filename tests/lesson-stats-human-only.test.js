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

test('getLessonStats excludes synthetic entries with no triggerMessage from the human-facing count', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-stats-'));
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

  try {
    writeJsonl(path.join(tmpDir, 'lessons-index.jsonl'), [
      // Genuine human feedback: has real triggerMessage content.
      {
        id: 'lesson_real_up',
        signal: 'positive',
        lesson: 'The fix worked as expected',
        triggerMessage: 'User said the dashboard now loads correctly',
        confidence: 80,
      },
      {
        id: 'lesson_real_down',
        signal: 'negative',
        lesson: 'Forgot to run tests before claiming done',
        triggerMessage: 'User pointed out the deploy broke checkout',
        confidence: 60,
      },
      // Synthetic entries: async-job-runner / proof-harness style — empty triggerMessage.
      {
        id: 'lesson_synthetic_1',
        signal: 'positive',
        lesson: 'SUCCESS: positive pattern 0',
        triggerMessage: '',
        confidence: 70,
      },
      {
        id: 'lesson_synthetic_2',
        signal: 'positive',
        lesson: 'SUCCESS: Verification loop accepted output',
        triggerMessage: '',
        confidence: 70,
      },
      {
        id: 'lesson_synthetic_3',
        signal: 'negative',
        lesson: 'FAILURE: automated check failed',
        confidence: 70,
        // triggerMessage entirely absent, not just empty string
      },
    ]);

    delete require.cache[require.resolve('../scripts/lesson-inference')];
    const { getLessonStats } = require('../scripts/lesson-inference');
    const stats = getLessonStats();

    assert.equal(stats.positive, 1, 'only the entry with real triggerMessage counts as positive');
    assert.equal(stats.negative, 1, 'only the entry with real triggerMessage counts as negative');
    assert.equal(stats.total, 2, 'total reflects only human-reviewable entries');
    assert.equal(stats.rawTotal, 5, 'rawTotal still reports everything on disk for transparency');
    assert.equal(stats.avgConfidence, 70, 'avg confidence computed from the reviewable subset only ((80+60)/2)');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
