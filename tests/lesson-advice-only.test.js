'use strict';

// friction-1.11: a lesson with no gate must say it is advice only, and search must show how often the same
// complaint came back after the lesson was saved.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-advice-only-'));
process.env.HOME = dir;
process.env.USERPROFILE = dir;
const feedbackDir = path.join(dir, 'feedback');
fs.mkdirSync(feedbackDir, { recursive: true });
process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;

const { searchLessons, formatLessonSearchResults } = require('../scripts/lesson-search');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const jsonl = (file, rows) => fs.writeFileSync(path.join(feedbackDir, file), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
const COMPLAINT = 'the weekly summary email used the wrong customer greeting';
const down = (id, day, context) => ({ id, signal: 'negative', context, timestamp: `2026-11-${day}T10:00:00.000Z` });

jsonl('feedback-log.jsonl', [
  down('fb_before', '01', COMPLAINT),
  down('fb_source', '10', COMPLAINT),
  down('fb_again', '12', `again: ${COMPLAINT}`),
  down('fb_other', '13', 'dashboard chart colors are unreadable'),
  { id: 'fb_up', signal: 'positive', context: COMPLAINT, timestamp: '2026-11-14T10:00:00.000Z' },
]);
jsonl('memory-log.jsonl', [{
  id: 'mem_greeting',
  title: 'MISTAKE: wrong greeting in the weekly summary email',
  content: `What went wrong: ${COMPLAINT}\nHow to avoid: read the greeting from the customer record`,
  category: 'error',
  tags: ['email'],
  sourceFeedbackId: 'fb_source',
  timestamp: '2026-11-10T10:00:01.000Z',
}]);

test('a lesson with no gate says it is advice only', () => {
  const [result] = searchLessons('weekly summary email greeting', { feedbackDir }).results;
  assert.equal(result.id, 'mem_greeting');
  const { lifecycle } = result.systemResponse;
  assert.equal(lifecycle.enforcementState, 'memory_only');
  assert.equal(lifecycle.adviceOnly, true);
  assert.match(lifecycle.adviceNote, /^Advice only: no gate is linked/);
});

test('repeats count only later thumbs-downs about the same thing', () => {
  const payload = searchLessons('weekly summary email greeting', { feedbackDir });
  const { repeats } = payload.results[0];
  assert.equal(repeats.count, 1);
  assert.equal(repeats.laterThumbsDown, 2);
  const text = formatLessonSearchResults(payload);
  assert.match(text, /Enforcement: Advice only/);
  assert.match(text, /Repeats since saved: 1 of 2 later thumbs-downs \(text match/);
});

const gates = (extra) => fs.writeFileSync(path.join(feedbackDir, 'auto-promoted-gates.json'), JSON.stringify({
  version: 1,
  gates: [{ id: 'auto-email', action: 'block', pattern: 'send_email', message: 'outbound email needs approval', ...extra }],
}));

test('a gate that only shares words with the lesson does not count as enforcing it', () => {
  gates({});
  const { lifecycle } = searchLessons('weekly summary email greeting', { feedbackDir }).results[0].systemResponse;
  assert.equal(lifecycle.adviceOnly, true);
  assert.match(lifecycle.adviceNote, /^Not proven enforced: 1 gate\(s\) share words/);
});

test('a gate recorded as built from the lesson counts', () => {
  gates({ sourceFeedbackId: 'fb_source' });
  const { lifecycle } = searchLessons('weekly summary email greeting', { feedbackDir }).results[0].systemResponse;
  assert.equal(lifecycle.adviceOnly, false);
  assert.match(lifecycle.adviceNote, /^A gate built from this lesson blocks/);
});
