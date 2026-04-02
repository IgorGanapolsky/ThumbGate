const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-lesson-'));
process.env.RLHF_FEEDBACK_DIR = tmpDir;

const li = require('../scripts/lesson-inference');

test.after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

// === Surrounding Message Inference ===
test('inferFromSurroundingMessages extracts edit action from prior messages', () => {
  const r = li.inferFromSurroundingMessages({
    priorMessages: [
      { role: 'assistant', content: 'I edited scripts/deploy.js to add the health check.' },
      { role: 'user', content: 'fix the deploy script' },
    ],
    signal: 'positive',
    feedbackContext: 'Health check works now',
  });
  assert.ok(r.inferredLesson.includes('Repeat'));
  assert.ok(r.inferredLesson.includes('edit'));
  assert.ok(r.inferredAction);
  assert.equal(r.inferredAction.type, 'edit');
  assert.ok(r.confidence > 0);
});

test('inferFromSurroundingMessages detects negative deploy action', () => {
  const r = li.inferFromSurroundingMessages({
    priorMessages: [{ role: 'assistant', content: 'I deployed to production without tests.' }],
    signal: 'negative',
  });
  assert.ok(r.inferredLesson.includes('Avoid'));
  assert.ok(r.inferredLesson.includes('deploy'));
});

test('inferFromSurroundingMessages uses feedbackContext when no action found', () => {
  const r = li.inferFromSurroundingMessages({
    priorMessages: [{ role: 'assistant', content: 'Here is the analysis.' }],
    signal: 'positive',
    feedbackContext: 'Great analysis, exactly what I needed',
  });
  assert.equal(r.inferredLesson, 'Great analysis, exactly what I needed');
});

test('inferFromSurroundingMessages handles empty input', () => {
  const r = li.inferFromSurroundingMessages({});
  assert.ok(r.inferredLesson.length > 0);
  assert.equal(r.confidence, 0);
});

test('inferFromSurroundingMessages builds prior summary', () => {
  const r = li.inferFromSurroundingMessages({
    priorMessages: [
      { role: 'assistant', content: 'Fixed the bug' },
      { role: 'user', content: 'Fix the bug in deploy.js' },
    ],
    signal: 'positive',
  });
  assert.ok(r.priorSummary.includes('[assistant]'));
  assert.ok(r.priorSummary.includes('[user]'));
});

test('inferFromSurroundingMessages detects create, command, fix, delete actions', () => {
  assert.equal(li.inferFromSurroundingMessages({ priorMessages: [{ role: 'assistant', content: 'I created a new test file.' }], signal: 'positive' }).inferredAction.type, 'create');
  assert.equal(li.inferFromSurroundingMessages({ priorMessages: [{ role: 'assistant', content: 'I ran npm test.' }], signal: 'positive' }).inferredAction.type, 'command');
  assert.equal(li.inferFromSurroundingMessages({ priorMessages: [{ role: 'assistant', content: 'I fixed the auth bug.' }], signal: 'positive' }).inferredAction.type, 'fix');
  assert.equal(li.inferFromSurroundingMessages({ priorMessages: [{ role: 'assistant', content: 'I deleted the old config.' }], signal: 'negative' }).inferredAction.type, 'delete');
});

// === Lesson Creation & Storage ===
test('createLesson stores lesson with stable link', () => {
  const l = li.createLesson({ feedbackId: 'fb_1', signal: 'negative', inferredLesson: 'Never deploy without tests', confidence: 75, tags: ['deploy'] });
  assert.ok(l.id.startsWith('lesson_'));
  assert.ok(l.link.includes(l.id));
  assert.ok(l.createdAt);
  assert.equal(l.signal, 'negative');
  assert.equal(l.confidence, 75);
});

test('createLesson updates recent lesson file', () => {
  li.createLesson({ signal: 'positive', inferredLesson: 'Health check pattern works' });
  const recent = li.getRecentLesson();
  assert.ok(recent);
  assert.ok(recent.lesson.includes('Health check'));
});

test('createLesson appends to lessons index', () => {
  const before = fs.readFileSync(li.getLessonsPath(), 'utf-8').trim().split('\n').length;
  li.createLesson({ signal: 'negative', inferredLesson: 'Test lesson 3' });
  const after = fs.readFileSync(li.getLessonsPath(), 'utf-8').trim().split('\n').length;
  assert.equal(after, before + 1);
});

// === Recent Lesson ===
test('getRecentLesson returns null when no lessons', () => {
  const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-empty-'));
  const origDir = process.env.RLHF_FEEDBACK_DIR;
  process.env.RLHF_FEEDBACK_DIR = tmpDir2;
  assert.equal(li.getRecentLesson(), null);
  process.env.RLHF_FEEDBACK_DIR = origDir;
  fs.rmSync(tmpDir2, { recursive: true, force: true });
});

test('getRecentLesson returns the latest lesson', () => {
  li.createLesson({ signal: 'positive', inferredLesson: 'Latest lesson here' });
  const recent = li.getRecentLesson();
  assert.ok(recent.lesson.includes('Latest'));
});

// === Search ===
test('searchLessons finds by query', () => {
  li.createLesson({ signal: 'negative', inferredLesson: 'Never force push to main', tags: ['git'] });
  const results = li.searchLessons({ query: 'force push' });
  assert.ok(results.length >= 1);
  assert.ok(results[0].lesson.includes('force push'));
});

test('searchLessons filters by signal', () => {
  const neg = li.searchLessons({ signal: 'negative' });
  neg.forEach((l) => assert.equal(l.signal, 'negative'));
});

test('searchLessons returns all when no query', () => {
  const all = li.searchLessons({});
  assert.ok(all.length >= 3);
});

test('searchLessons respects limit', () => {
  const limited = li.searchLessons({ limit: 2 });
  assert.ok(limited.length <= 2);
});

// === Stats ===
test('getLessonStats counts positive and negative', () => {
  const stats = li.getLessonStats();
  assert.ok(stats.total >= 3);
  assert.ok(stats.positive >= 1);
  assert.ok(stats.negative >= 1);
  assert.ok(typeof stats.avgConfidence === 'number');
});

// === Statusbar Data ===
test('getStatusbarLessonData returns lesson with link', () => {
  li.createLesson({ signal: 'negative', inferredLesson: 'Never skip CI before merging PR' });
  const sb = li.getStatusbarLessonData();
  assert.equal(sb.hasLesson, true);
  assert.ok(sb.text.includes('👎'));
  assert.ok(sb.text.includes('Never skip CI'));
  assert.ok(sb.link.includes('lesson_'));
  assert.ok(sb.lessonId);
});

test('getStatusbarLessonData shows thumbs up for positive', () => {
  li.createLesson({ signal: 'positive', inferredLesson: 'Health check pattern is solid' });
  const sb = li.getStatusbarLessonData();
  assert.ok(sb.text.includes('👍'));
});

test('getStatusbarLessonData truncates long lessons', () => {
  li.createLesson({ signal: 'negative', inferredLesson: 'A'.repeat(100) });
  const sb = li.getStatusbarLessonData();
  assert.ok(sb.text.length < 70);
  assert.ok(sb.text.includes('...'));
});

test('getStatusbarLessonData returns hasLesson false when empty', () => {
  const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-empty2-'));
  const origDir = process.env.RLHF_FEEDBACK_DIR;
  process.env.RLHF_FEEDBACK_DIR = tmpDir2;
  const sb = li.getStatusbarLessonData();
  assert.equal(sb.hasLesson, false);
  process.env.RLHF_FEEDBACK_DIR = origDir;
  fs.rmSync(tmpDir2, { recursive: true, force: true });
});

test('getRecentLessonPath returns correct path', () => {
  assert.ok(li.getRecentLessonPath().endsWith('recent-lesson.json'));
});
