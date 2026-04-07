'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildFollowUpComment,
} = require('../scripts/social-analytics/publishers/reddit');

test('buildFollowUpComment is disclosure-only and does not include CTA links', () => {
  const comment = buildFollowUpComment('ClaudeCode', 'claudecode_post');
  assert.match(comment, /Disclosure: I built this/i);
  assert.match(comment, /Source code \(MIT\)/i);
  assert.doesNotMatch(comment, /Try free for 7 days/i);
  assert.doesNotMatch(comment, /npx thumbgate init/i);
});
