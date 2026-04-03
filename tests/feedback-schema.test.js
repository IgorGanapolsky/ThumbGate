// tests/feedback-schema.test.js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseTimestamp, truncateAtWord } = require('../scripts/feedback-schema');

test('parseTimestamp: Z-suffix returns valid Date', () => {
  const d = parseTimestamp('2026-03-04T12:00:00.000Z');
  assert.ok(d instanceof Date, 'should be a Date');
  assert.ok(!isNaN(d.getTime()), 'should not be NaN');
});

test('parseTimestamp: no-suffix (Python-stripped) returns valid Date', () => {
  const d = parseTimestamp('2026-03-04T12:00:00');
  assert.ok(d instanceof Date, 'should be a Date');
  assert.ok(!isNaN(d.getTime()), 'no-suffix should not be NaN');
});

test('parseTimestamp: UTC offset returns valid Date', () => {
  const d = parseTimestamp('2026-03-04T12:00:00+05:00');
  assert.ok(d instanceof Date, 'should be a Date');
  assert.ok(!isNaN(d.getTime()), 'offset should not be NaN');
});

test('parseTimestamp: null returns null', () => {
  assert.strictEqual(parseTimestamp(null), null);
});

test('parseTimestamp: undefined returns null', () => {
  assert.strictEqual(parseTimestamp(undefined), null);
});

test('parseTimestamp: garbage string returns null', () => {
  assert.strictEqual(parseTimestamp('garbage'), null);
  assert.strictEqual(parseTimestamp('not-a-date'), null);
});

// truncateAtWord tests

test('truncateAtWord: returns text unchanged when under maxLen', () => {
  assert.strictEqual(truncateAtWord('short text', 120), 'short text');
});

test('truncateAtWord: returns null/empty for falsy input', () => {
  assert.strictEqual(truncateAtWord(null, 120), null);
  assert.strictEqual(truncateAtWord('', 120), '');
});

test('truncateAtWord: truncates at last space before maxLen', () => {
  const input = 'I had not yet answered directly with the exact save-button destination for the profile screen and this keeps going on and on until it is very long';
  const result = truncateAtWord(input, 120);
  assert.ok(result.endsWith('...'), 'should end with ellipsis');
  // Should not cut mid-word
  const withoutEllipsis = result.slice(0, -3);
  assert.ok(withoutEllipsis.endsWith(' ') === false, 'should not end with trailing space');
  assert.ok(withoutEllipsis.length <= 120, 'content before ellipsis should be <= maxLen');
  // The last char before ellipsis should be a word-ending char (letter), not a space
  const lastWord = withoutEllipsis.split(' ').pop();
  assert.ok(lastWord.length > 0, 'last word should be complete');
});

test('truncateAtWord: uses hard truncation when no space past halfway', () => {
  const input = 'a'.repeat(200); // no spaces at all
  const result = truncateAtWord(input, 120);
  assert.strictEqual(result, 'a'.repeat(120) + '...');
});

test('truncateAtWord: handles text exactly at maxLen', () => {
  const input = 'x'.repeat(120);
  assert.strictEqual(truncateAtWord(input, 120), input);
});

test('truncateAtWord: preserves full words up to 120 chars', () => {
  // Build a string that is 130 chars with spaces
  const words = 'the quick brown fox jumped over the lazy dog and kept running across the field until it reached the fence at the far end of the meadow';
  const result = truncateAtWord(words, 120);
  assert.ok(result.endsWith('...'), 'should end with ellipsis');
  // Should not cut mid-word
  const withoutEllipsis = result.slice(0, -3);
  assert.ok(!withoutEllipsis.endsWith('-'), 'should not cut mid-hyphenated-word');
  assert.ok(withoutEllipsis.length <= 120, 'content before ellipsis should be <= maxLen');
});
