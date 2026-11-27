'use strict';

// 27 Nov 2026: injected "lessons" were the user's whole message (profanity, <pasted_content> markup), and a lesson
// holding a personal address surfaced on unrelated work.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-lesson-text-'));
process.env.THUMBGATE_FEEDBACK_DIR = sandbox;
process.env.THUMBGATE_NO_TELEMETRY = '1';
const { formatNegativeLessonContext } = require('../scripts/gates-engine');
const { formatInjectableReminder, isRawTranscriptFragment, stripLessonMarkup } = require('../scripts/lesson-hook-relevance');

const lesson = (id, title, advice) => ({
  id, signal: 'negative', relevanceScore: 1, title: `MISTAKE: ${title}`, content: `How to avoid: ${advice}`,
});

test('a quoted user message is not shown as a lesson', () => {
  const rant = lesson('a', 'It ignored a prior instruction: stop doing that!!', 'Follow the earlier instruction instead of repeating the same pattern: stop doing that!!');
  assert.equal(formatNegativeLessonContext([rant]), null);
  assert.equal(formatInjectableReminder([{ id: 'a', whatToChange: 'Follow the earlier instruction: stop doing that!!' }]), '');
  assert.equal(isRawTranscriptFragment('It ignored a prior instruction: use it'), true);
});

test('distilled advice under a quoted title is shown without the quote', () => {
  const out = formatNegativeLessonContext([lesson('b', 'It ignored a prior instruction: why again', 'Run the tests before pushing')]);
  assert.match(out, /• Run the tests before pushing/);
  assert.doesNotMatch(out, /why again/);
});

test('pasted markup is stripped', () => {
  assert.equal(stripLessonMarkup('Check <pasted_content id="9">secret paste</pasted_content id="9"> the <b>branch</b>'), 'Check the branch');
  const out = formatNegativeLessonContext([lesson('c', 'Deploy skipped the health check <pasted_content id="1">log</pasted_content>', 'Curl /health after deploy')]);
  assert.doesNotMatch(out, /pasted_content|log</);
  assert.match(out, /Curl \/health after deploy/);
});

test('a personal contact is only shown when the call is about it', () => {
  const personal = lesson('d', 'Mail went from the wrong account', 'Sign in as someone@example.com for ads');
  assert.equal(formatNegativeLessonContext([personal]), null);
  assert.equal(formatNegativeLessonContext([lesson('e', 'Call failed', 'Dial 555-010-4477 first')]), null);
  assert.match(formatNegativeLessonContext([personal], { actionContext: '', toolName: 'x' }) || 'none', /none/);
  assert.match(formatNegativeLessonContext([personal], { actionContext: 'gws auth login someone@example.com mail account', toolName: 'Bash' }), /wrong account/);
});

test('a package version is not mistaken for an email address', () => {
  assert.match(formatNegativeLessonContext([lesson('f', 'Hooks lagged', 'Update with thumbgate@1.45.1 first')]), /Hooks lagged/);
});
