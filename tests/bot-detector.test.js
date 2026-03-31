'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyVisitor, shouldExcludeFromAnalytics, BOT_PATTERNS } = require('../scripts/bot-detector');

test('classifies Googlebot as bot', () => {
  const result = classifyVisitor({ headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' } });
  assert.equal(result.type, 'bot');
});

test('classifies GPTBot as bot', () => {
  const result = classifyVisitor({ headers: { 'user-agent': 'GPTBot/1.0' } });
  assert.equal(result.type, 'bot');
});

test('classifies real Chrome as real_user', () => {
  const result = classifyVisitor({ headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } });
  assert.equal(result.type, 'real_user');
});

test('classifies Igor email as owner', () => {
  const result = classifyVisitor({ headers: { 'user-agent': 'Mozilla/5.0 Chrome/120' }, email: 'iganapolsky@gmail.com' });
  assert.equal(result.type, 'owner');
});

test('shouldExcludeFromAnalytics filters bots', () => {
  assert.equal(shouldExcludeFromAnalytics({ headers: { 'user-agent': 'Googlebot/2.1' } }), true);
  assert.equal(shouldExcludeFromAnalytics({ headers: { 'user-agent': 'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36' } }), false);
});

test('bot patterns list covers key categories', () => {
  assert.ok(BOT_PATTERNS.length >= 20);
});
