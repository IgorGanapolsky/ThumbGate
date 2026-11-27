'use strict';

// 27 Nov 2026: nearly every tool call got 2-3 unrelated "Past mistakes" lines (a Gmail search got an old insult and a
// Herdr paste). A lesson is shown only when it is about the call, once per session, and nothing when nothing matches.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const relevance = require('../scripts/lesson-hook-relevance');
const { formatNegativeLessonContext } = require('../scripts/gates-engine');

const lesson = (id, title, advice) => ({ id, signal: 'negative', relevanceScore: 0.9, title: `MISTAKE: ${title}`, content: `What went wrong: ${title}\nHow to avoid: ${advice}` });
const INSULT = lesson('l1', 'You are useless, I told you to stop doing that', 'Do what the user asked');
const HERDR = lesson('l2', 'Pasted a Herdr brief into the wrong pane', 'Read the Herdr pane before sending a brief');
const PUBLISH = lesson('l3', 'Ran npm publish from a dirty tree', 'Check the tree is clean before npm publish');
const GMAIL_SEARCH = { toolName: 'mcp__claude_ai_Gmail__search_threads', actionContext: 'mcp__claude_ai_Gmail__search_threads from:carly newer_than:2d' };
const PUBLISH_CALL = { toolName: 'Bash', actionContext: 'Bash npm publish --access public' };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tg-lesson-noise-'));

test('a Gmail search gets nothing from unrelated lessons', () => {
  assert.equal(formatNegativeLessonContext([INSULT, HERDR, PUBLISH], GMAIL_SEARCH), null);
});

test('a call gets only the lesson that is about it', () => {
  const text = formatNegativeLessonContext([INSULT, HERDR, PUBLISH], PUBLISH_CALL);
  assert.match(text, /npm publish from a dirty tree/);
  assert.doesNotMatch(text, /Herdr|useless/);
});

test('each lesson is shown once per session', () => {
  const dir = tmp();
  const options = { ...PUBLISH_CALL, sessionId: 'sess-1', seenDir: dir };
  assert.match(formatNegativeLessonContext([PUBLISH], options), /npm publish/);
  assert.equal(formatNegativeLessonContext([PUBLISH], options), null);
  assert.match(formatNegativeLessonContext([PUBLISH], { ...options, sessionId: 'sess-2' }), /npm publish/);
});

test('the second injector: a shared tool name alone is not a match, and a repeat stays quiet after hours', () => {
  const toolOnly = { id: 'l4', whatToChange: 'Answer in plain words', metadata: { toolsUsed: ['Bash'] } };
  assert.deepEqual(relevance.selectInjectableLessons([toolOnly], { toolName: 'Bash', actionContext: 'ls -la', record: false }), []);
  const dir = tmp();
  const options = { toolName: 'Bash', actionContext: 'git push origin main', sessionId: 's', seenDir: dir };
  const rule = { id: 'l5', whatToChange: 'Never force push to main' };
  assert.equal(relevance.selectInjectableLessons([rule], { ...options, now: 1000 }).length, 1);
  assert.equal(relevance.selectInjectableLessons([rule], { ...options, now: 1000 + 5 * 60 * 60 * 1000 }).length, 0);
});

test('pasted markup is never injected as a lesson', () => {
  const pasted = lesson('l6', 'It ignored a prior instruction: <pasted_content id="x"> npm publish everything', 'npm publish');
  assert.equal(formatNegativeLessonContext([pasted], PUBLISH_CALL), null);
});
