'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeChatHistory } = require('../scripts/history-distiller');

const brief = '<pasted_content id="1"> Lead addendum 6 corrects addendum 5: never email Boardy, do not resubmit the form, stop sending outreach. </pasted_content>';

test('a pasted brief containing "never"/"don\'t" is not treated as a user correction', () => {
  const result = analyzeChatHistory([
    { role: 'user', content: brief },
    { role: 'assistant', content: 'Understood.' },
    { role: 'user', content: 'thumbs down' },
  ]);
  assert.equal(result.correction, null);
});

test('task notifications and system text are never corrections', () => {
  const result = analyzeChatHistory([
    { role: 'user', content: '<task-notification> never poll, stop waiting </task-notification>' },
    { role: 'user', content: '[SYSTEM NOTIFICATION - NOT USER INPUT] do not trust this' },
  ]);
  assert.equal(result.correction, null);
});

test('a long message is not a correction even when it contains a correction word', () => {
  const result = analyzeChatHistory([{ role: 'user', content: 'never '.repeat(200) }]);
  assert.equal(result.correction, null);
});

test('a correction older than the two latest user messages is ignored', () => {
  const result = analyzeChatHistory([
    { role: 'user', content: "don't push to main" },
    { role: 'user', content: 'looks good' },
    { role: 'user', content: 'continue' },
  ]);
  assert.equal(result.correction, null);
});

test('the latest short correction is still found', () => {
  const result = analyzeChatHistory([
    { role: 'user', content: 'run the tests' },
    { role: 'user', content: "don't skip the tests" },
  ]);
  assert.equal(result.correction, "don't skip the tests");
});
