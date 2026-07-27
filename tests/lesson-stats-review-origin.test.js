'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  captureFeedback,
  analyzeFeedback,
} = require('../scripts/feedback-loop');
const {
  createLesson,
  getLessonStats,
  isHumanReviewedLesson,
} = require('../scripts/lesson-inference');

const savedFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
const savedTelemetryOptOut = process.env.THUMBGATE_DISABLE_TELEMETRY;

test.after(() => {
  if (savedFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
  else process.env.THUMBGATE_FEEDBACK_DIR = savedFeedbackDir;
  if (savedTelemetryOptOut === undefined) delete process.env.THUMBGATE_DISABLE_TELEMETRY;
  else process.env.THUMBGATE_DISABLE_TELEMETRY = savedTelemetryOptOut;
});

function useTemporaryFeedbackDir(t) {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-review-origin-'));
  process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
  process.env.THUMBGATE_DISABLE_TELEMETRY = '1';
  t.after(() => fs.rmSync(feedbackDir, { recursive: true, force: true }));
  return feedbackDir;
}

test('getLessonStats counts explicit human review once and excludes automation', async (t) => {
  useTemporaryFeedbackDir(t);

  const humanResult = captureFeedback({
    signal: 'up',
    context: 'The verified deployment evidence matched the production build.',
    whatWorked: 'The response included the exact merge and production SHAs.',
    tags: ['verification'],
    reviewOrigin: 'human',
  });
  const automatedResult = captureFeedback({
    signal: 'down',
    context: 'Synthetic proof fixture for an internal retry policy.',
    whatWentWrong: 'Fixture failure used to exercise automated evaluation.',
    whatToChange: 'Keep synthetic evaluations isolated from human feedback metrics.',
    tags: ['synthetic', 'test-suite'],
    reviewOrigin: 'automated',
  });

  assert.equal(humanResult.accepted, true);
  assert.equal(automatedResult.accepted, true);
  assert.equal(humanResult.feedbackEvent.reviewOrigin, 'human');
  assert.equal(automatedResult.feedbackEvent.reviewOrigin, 'automated');
  await new Promise((resolve) => setImmediate(resolve));

  const stats = getLessonStats();
  assert.deepEqual(stats, {
    total: 1,
    positive: 1,
    negative: 0,
    avgConfidence: 70,
    rawTotal: 2,
    excludedTotal: 1,
  });
  const humanStats = analyzeFeedback(undefined, { humanOnly: true });
  assert.equal(humanStats.totalPositive, 1);
  assert.equal(humanStats.totalNegative, 0);
  assert.equal(humanStats.total, 1);
  assert.equal(humanStats.approvalRate, 1);
  assert.equal(humanStats.rawTotal, 2);
  assert.equal(humanStats.excludedTotal, 1);
});

test('unverified legacy rows are excluded and explicit human reviews are deduplicated', (t) => {
  useTemporaryFeedbackDir(t);

  const legacyHuman = {
    feedbackId: 'fb_legacy_human',
    signal: 'negative',
    inferredLesson: 'Verify production before making a deployment claim.',
    triggerMessage: 'The CEO asked whether the release was really deployed.',
    confidence: 80,
    metadata: { reviewOrigin: 'human' },
  };
  createLesson(legacyHuman);
  createLesson(legacyHuman);
  createLesson({
    feedbackId: 'fb_legacy_unverified',
    signal: 'negative',
    inferredLesson: 'A legacy row without provenance.',
    triggerMessage: 'Concrete but unverified historical context',
    confidence: 90,
  });
  createLesson({
    feedbackId: 'fb_automated',
    signal: 'positive',
    inferredLesson: 'Synthetic evaluation passed.',
    triggerMessage: 'Automated evaluator result',
    confidence: 100,
    metadata: {
      source: 'session-analyzer',
    },
  });

  assert.equal(isHumanReviewedLesson({
    metadata: { reviewOrigin: 'human' },
  }), true);
  assert.equal(isHumanReviewedLesson({
    feedbackId: 'fb_legacy_unverified',
    triggerMessage: 'Concrete but unverified historical context',
  }), false);
  assert.equal(isHumanReviewedLesson({
    feedbackId: 'fb_automated',
    triggerMessage: 'Automated evaluator result',
    metadata: { source: 'session-analyzer' },
  }), false);

  assert.deepEqual(getLessonStats(), {
    total: 1,
    positive: 0,
    negative: 1,
    avgConfidence: 80,
    rawTotal: 4,
    excludedTotal: 3,
  });
});
