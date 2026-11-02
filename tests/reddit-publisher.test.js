'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assessRedditCommentTarget,
  buildFollowUpComment,
  submitComment,
} = require('../scripts/social-analytics/publishers/reddit');

test('buildFollowUpComment is disclosure-only and does not include CTA links', () => {
  const comment = buildFollowUpComment('ClaudeCode', 'claudecode_post');
  assert.match(comment, /Disclosure: I built this/i);
  assert.match(comment, /Source code \(MIT\)/i);
  assert.doesNotMatch(comment, /Try free for 7 days/i);
  assert.doesNotMatch(comment, /npx thumbgate init/i);
});

test('a comment on someone else\'s thread is refused before any Reddit request', async () => {
  assert.deepEqual(
    assessRedditCommentTarget({ parentId: 't3_1uqwwus', relationship: 'invited-thread' }),
    { allowed: true, reason: 'invited-thread' },
  );
  assert.deepEqual(
    assessRedditCommentTarget({ parentId: 't3_just_created', relationship: 'own-post' }),
    { allowed: true, reason: 'own-post' },
  );
  assert.deepEqual(
    assessRedditCommentTarget({ parentId: 't3_someoneelse', relationship: 'invited-thread' }),
    { allowed: false, reason: 'foreign-thread' },
  );
  assert.deepEqual(
    assessRedditCommentTarget({ parentId: 't3_1uqwwus' }),
    { allowed: false, reason: 'foreign-thread' },
  );

  await assert.rejects(
    () => submitComment('token', 'thumbgate-test', {
      parentId: 't3_someoneelse',
      text: 'ThumbGate checks the tool call.',
      relationship: 'invited-thread',
    }),
    /Reddit comment refused: foreign-thread/,
  );
});
