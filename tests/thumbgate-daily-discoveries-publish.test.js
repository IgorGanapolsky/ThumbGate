'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  selectTopicForDay,
  generatePostContent,
  CURATED_TOPICS,
} = require('../scripts/thumbgate-daily-discoveries-publish');

test('selectTopicForDay selects deterministic topic from curated list', () => {
  const d1 = new Date('2026-09-23T09:00:00Z');
  const topic1 = selectTopicForDay(d1);
  assert.ok(topic1);
  assert.ok(CURATED_TOPICS.some((t) => t.slug === topic1.slug));

  const d2 = new Date('2026-09-23T15:00:00Z');
  const topic2 = selectTopicForDay(d2);
  assert.equal(topic1.slug, topic2.slug, 'same day produces same topic');
});

test('generatePostContent renders markdown with code snippet and canonical url', () => {
  const topic = CURATED_TOPICS[0];
  const dateStr = '2026-09-23';
  const commit = 'abc1234 - test commit';
  const content = generatePostContent(topic, dateStr, commit);

  assert.match(content, /^# /);
  assert.match(content, /ThumbGate Engineering Daily/);
  assert.match(content, /Canonical URL/);
  assert.match(content, /PreToolUse/);
  assert.match(content, /https:\/\/thumbgate\.ai/);
});
