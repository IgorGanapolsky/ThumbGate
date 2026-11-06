'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  verifyLesson,
  voteLesson,
  isLessonStale,
  lookupLessonByError,
  formatVerificationBadge,
  DEFAULT_E2E_BASE_URL_LESSON,
} = require('../scripts/verified-lessons');

const {
  captureFeedback,
  getFeedbackPaths,
} = require('../scripts/feedback-loop');

const { retrieveRelevantLessons } = require('../scripts/lesson-retrieval');
const { searchLessons } = require('../scripts/lesson-search');
const { recordTaskOutcome } = require('../scripts/task-outcomes');

function createTempDir(prefix = 'tg-verified-lessons-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(dir, 'gates'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  return dir;
}

test('Item 1: Verified lessons lifecycle and schema', (t) => {
  const dir = createTempDir();

  // Lesson initially starts unverified
  const lesson = {
    id: 'lesson-101',
    title: 'Always specify port for mock server',
    content: 'Ensure mock server uses explicit free port',
  };

  // Verify lesson when check passes
  const v1 = verifyLesson(lesson.id, 'npm test tests/mock.test.js', {
    feedbackDir: dir,
    now: '2026-11-05T10:00:00.000Z',
    initialLesson: lesson,
  });

  assert.equal(v1.verificationStatus, 'verified');
  assert.equal(v1.verificationCount, 1);
  assert.equal(v1.lastVerifiedAt, '2026-11-05T10:00:00.000Z');
  assert.equal(v1.verifications.length, 1);
  assert.equal(v1.verifications[0].check, 'npm test tests/mock.test.js');
  assert.equal(v1.verifications[0].date, '2026-11-05');
  assert.equal(formatVerificationBadge(v1), 'verified 1x, last 2026-11-05');

  // Verify again with second check
  const v2 = verifyLesson(lesson.id, 'bash scripts/verify.sh', {
    feedbackDir: dir,
    now: '2026-11-06T12:00:00.000Z',
  });

  assert.equal(v2.verificationCount, 2);
  assert.equal(v2.lastVerifiedAt, '2026-11-06T12:00:00.000Z');
  assert.equal(v2.verifications.length, 2);
  assert.equal(formatVerificationBadge(v2), 'verified 2x, last 2026-11-06');
});

test('Item 1: retrieve_lessons ranks by verificationCount desc and lastVerifiedAt newest', () => {
  const dir = createTempDir();

  const l1 = { id: 'l1', title: 'Lesson 1', content: 'test command help' };
  const l2 = { id: 'l2', title: 'Lesson 2', content: 'test command runner' };
  const l3 = { id: 'l3', title: 'Lesson 3', content: 'test command suite' };

  verifyLesson('l1', 'check-only', { feedbackDir: dir, initialLesson: l1 });
  // l2: 1 verification on 2026-11-01
  verifyLesson('l2', 'check 1', { feedbackDir: dir, now: '2026-11-01T10:00:00Z', initialLesson: l2 });
  // l3: 3 verifications on 2026-11-05
  verifyLesson('l3', 'check 1', { feedbackDir: dir, now: '2026-11-03T10:00:00Z', initialLesson: l3 });
  verifyLesson('l3', 'check 2', { feedbackDir: dir, now: '2026-11-04T10:00:00Z' });
  verifyLesson('l3', 'check 3', { feedbackDir: dir, now: '2026-11-05T10:00:00Z' });

  // Retrieve using verification ranking
  const results = retrieveRelevantLessons('bash', 'execute test command suite', {
    feedbackDir: dir,
    rankByVerifications: true,
  });

  assert.ok(results.length >= 2);
  const l3Index = results.findIndex(r => r.id === 'l3');
  const l2Index = results.findIndex(r => r.id === 'l2');
  assert.ok(l3Index !== -1);
  assert.ok(l2Index !== -1);
  assert.ok(l3Index < l2Index);
  assert.equal(results[l3Index].badge, 'verified 3x, last 2026-11-05');
  assert.equal(results[l2Index].badge, 'verified 1x, last 2026-11-01');
});

test('Item 1: record_task_outcome with passing verification verifies applied lessons', () => {
  const dir = createTempDir();

  const lesson = { id: 'outcome-lesson-1', title: 'Use timeouts', content: 'Add timeouts' };
  verifyLesson(lesson.id, 'setup', { feedbackDir: dir, initialLesson: lesson });

  recordTaskOutcome({
    taskId: 'task-test-42',
    goal: 'Test outcome verification integration',
    status: 'completed',
    appliedLessons: ['outcome-lesson-1'],
    verification: {
      passed: true,
      verifier: 'node --test tests/timeout.test.js',
    },
  }, { feedbackDir: dir });

  const record = verifyLesson('outcome-lesson-1', 'check-only', { feedbackDir: dir });
  assert.equal(record.verificationCount, 2);
  assert.equal(record.verifications[1].check, 'node --test tests/timeout.test.js');
});

test('Item 2: Lesson votes track upVotes, downVotes, netVotes and demote when downVotes > upVotes', () => {
  const dir = createTempDir();

  const lesson = { id: 'vote-lesson-1', title: 'Flaky retry advice', content: 'Retry 100 times' };
  verifyLesson(lesson.id, 'check 1', { feedbackDir: dir, initialLesson: lesson });

  // Up vote via voteLesson
  const vUp = voteLesson('vote-lesson-1', 'up', { feedbackDir: dir });
  assert.equal(vUp.upVotes, 1);
  assert.equal(vUp.downVotes, 0);
  assert.equal(vUp.netVotes, 1);
  assert.equal(vUp.demoted, false);

  // Two down votes
  voteLesson('vote-lesson-1', 'down', { feedbackDir: dir });
  const vDown = voteLesson('vote-lesson-1', 'down', { feedbackDir: dir });
  assert.equal(vDown.upVotes, 1);
  assert.equal(vDown.downVotes, 2);
  assert.equal(vDown.netVotes, -1);
  assert.equal(vDown.demoted, true);

  // Demoted lesson must be suppressed from retrieveRelevantLessons
  const retrieved = retrieveRelevantLessons('bash', 'retry advice', { feedbackDir: dir });
  assert.equal(retrieved.some(r => r.id === 'vote-lesson-1'), false);

  // Re-verification overrides / resets demotion
  verifyLesson('vote-lesson-1', 're-verified by new test run', { feedbackDir: dir });
  const retrievedAfterReverify = retrieveRelevantLessons('bash', 'retry advice', { feedbackDir: dir });
  assert.ok(retrievedAfterReverify.some(r => r.id === 'vote-lesson-1'));
});

test('Item 2: captureFeedback with lessonId records vote', () => {
  const dir = createTempDir();

  const lesson = { id: 'cf-lesson-1', title: 'Good caching', content: 'Cache aggressively' };
  verifyLesson(lesson.id, 'check 1', { feedbackDir: dir, initialLesson: lesson });

  const fbResult = captureFeedback({
    signal: 'up',
    reason: 'Helped avoid redundant network requests',
    lessonId: 'cf-lesson-1',
  }, { feedbackDir: dir });

  assert.equal(fbResult.success, true);
  assert.ok(fbResult.lessonVote);
  assert.equal(fbResult.lessonVote.upVotes, 1);
  assert.equal(fbResult.lessonVote.netVotes, 1);
});

test('Item 3: Stale lessons (> 30 days) marked stale: true and formatted with [STALE], never deleted', () => {
  const dir = createTempDir();

  const staleLesson = {
    id: 'stale-lesson-1',
    title: 'Node 16 deprecation warning',
    content: 'Ignore node 16 warning and legacy flags',
    lastVerifiedAt: '2026-09-01T00:00:00.000Z',
    verificationCount: 1,
    verificationStatus: 'verified',
  };

  const isStale = isLessonStale(staleLesson, '2026-11-05T00:00:00.000Z');
  assert.equal(isStale, true);

  const freshLesson = {
    ...staleLesson,
    lastVerifiedAt: '2026-11-01T00:00:00.000Z',
  };
  assert.equal(isLessonStale(freshLesson, '2026-11-05T00:00:00.000Z'), false);

  // Put stale lesson into feedbackDir
  verifyLesson(staleLesson.id, 'check ancient', {
    feedbackDir: dir,
    initialLesson: staleLesson,
    now: '2026-09-01T00:00:00.000Z',
  });

  const searchRes = searchLessons('Node 16 deprecation', { feedbackDir: dir, now: '2026-11-05T00:00:00.000Z' });
  const found = searchRes.results.find(r => r.id === staleLesson.id);
  assert.ok(found, 'Stale lesson is still preserved (never deleted)');
  assert.equal(found.stale, true);
  assert.ok(found.title.includes('[STALE]'));
});

test('Item 4: lookupLessonByError matches exact error line and returns verified fix immediately', () => {
  // Built-in seeded lesson for "E2E_BASE_URL is not set"
  const errorText = 'fatal: pre-push hook failed: E2E_BASE_URL is not set in worktree';
  const match = lookupLessonByError(errorText);

  assert.ok(match, 'Must find error fix');
  assert.equal(match.errorPattern, 'E2E_BASE_URL is not set');
  assert.ok(match.fix.includes('set E2E_BASE_URL to the STAGE URL and run the push under with-secrets'));
  assert.ok(match.fix.includes('never E2E_HOOK_SKIP'));
  assert.equal(match.verificationStatus, 'verified');
  assert.ok(match.verificationCount >= 1);
  assert.ok(match.badge.startsWith('verified'));

  // searchLessons with error text returns verified fix first
  const searchResult = searchLessons('E2E_BASE_URL is not set');
  assert.ok(searchResult.results.length > 0);
  const first = searchResult.results[0];
  assert.equal(first.id, DEFAULT_E2E_BASE_URL_LESSON.id);
  assert.ok(first.systemResponse.correctiveActions[0].fix.includes('with-secrets'));
});

test('Item 4: src/ adapter entrypoints export clean APIs', () => {
  const feedback = require('../src/feedback');
  const lessonSearch = require('../src/lesson-search');
  const taskOutcome = require('../src/task-outcome');

  assert.equal(typeof feedback.verifyLesson, 'function');
  assert.equal(typeof feedback.voteLesson, 'function');
  assert.equal(typeof feedback.lookupLessonByError, 'function');
  assert.equal(typeof feedback.retrieveLessons, 'function');
  assert.equal(typeof lessonSearch.searchLessons, 'function');
  assert.equal(typeof lessonSearch.lookupLessonByError, 'function');
  assert.equal(typeof taskOutcome.recordTaskOutcome, 'function');
});
