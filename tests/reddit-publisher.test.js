'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildFollowUpComment,
  normalizeFollowUpComment,
} = require('../scripts/social-analytics/publishers/reddit');

test('buildFollowUpComment is disclosure-only and does not include CTA links', () => {
  const comment = buildFollowUpComment('ClaudeCode', 'claudecode_post');
  assert.match(comment, /Disclosure: I built ThumbGate/i);
  assert.doesNotMatch(comment, /https?:\/\//i);
  assert.doesNotMatch(comment, /Try free for 7 days/i);
  assert.doesNotMatch(comment, /npx thumbgate init/i);
});

test('normalizeFollowUpComment only allows explicit custom comment text', () => {
  assert.equal(normalizeFollowUpComment(true), null);
  assert.equal(normalizeFollowUpComment('   '), null);
  assert.equal(normalizeFollowUpComment('Custom follow-up'), 'Custom follow-up');
});
