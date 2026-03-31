'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyVisitor, shouldExcludeFromAnalytics, BOT_PATTERNS } = require('../scripts/bot-detector');

test('classifies Googlebot as bot', () => {
  const req = { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' } };
  const result = classifyVisitor(req);
  assert.equal(result.type, 'bot');
});

test('classifies GPTBot as bot', () => {
  const req = { headers: { 'user-agent': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.0)' } };
  const result = classifyVisitor(req);
  assert.equal(result.type, 'bot');
});

test('classifies Claude crawler as bot', () => {
  const req = { headers: { 'user-agent': 'Claude-SearchBot/1.0' } };
  const result = classifyVisitor(req);
  assert.equal(result.type, 'bot');
});

test('classifies curl as bot', () => {
  const req = { headers: { 'user-agent': 'curl/7.88.1' } };
  const result = classifyVisitor(req);
  assert.equal(result.type, 'bot');
});

test('classifies empty user-agent as bot', () => {
  const req = { headers: { 'user-agent': '' } };
  const result = classifyVisitor(req);
  assert.equal(result.type, 'bot');
});

test('classifies real Chrome browser as real_user', () => {
  const req = { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } };
  const result = classifyVisitor(req);
  assert.equal(result.type, 'real_user');
});

test('classifies Igor email as owner', () => {
  const req = { headers: { 'user-agent': 'Mozilla/5.0 Chrome/120' }, email: 'iganapolsky@gmail.com' };
  const result = classifyVisitor(req);
  assert.equal(result.type, 'owner');
});

test('shouldExcludeFromAnalytics returns true for bots', () => {
  const req = { headers: { 'user-agent': 'Googlebot/2.1' } };
  assert.equal(shouldExcludeFromAnalytics(req), true);
});

test('shouldExcludeFromAnalytics returns false for real users', () => {
  const req = { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' } };
  assert.equal(shouldExcludeFromAnalytics(req), false);
});

test('bot patterns list covers major crawlers and AI bots', () => {
  assert.ok(BOT_PATTERNS.length >= 20, 'Should have at least 20 bot patterns');
  // Verify key categories are covered
  const patternStr = BOT_PATTERNS.map(p => p.source).join(' ');
  assert.ok(patternStr.includes('GPTBot'), 'Should include GPTBot');
  assert.ok(patternStr.includes('Googlebot'), 'Should include Googlebot');
  assert.ok(patternStr.includes('curl'), 'Should include curl');
});
