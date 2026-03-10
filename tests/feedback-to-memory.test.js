// tests/feedback-to-memory.test.js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { convertFeedbackToMemory } = require('../scripts/feedback-to-memory');

// -- Valid negative feedback --

test('valid negative feedback: ok=true, category=error, title starts with MISTAKE', () => {
  const result = convertFeedbackToMemory({
    signal: 'negative',
    context: 'Agent claimed fix without test evidence',
    whatWentWrong: 'No tests were run before claiming the bug was fixed',
    whatToChange: 'Always run tests and show output before claiming done',
    tags: ['verification', 'testing'],
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.memory.category, 'error');
  assert.ok(result.memory.title.startsWith('MISTAKE:'), `expected MISTAKE: prefix, got: ${result.memory.title}`);
});

// -- Valid positive feedback --

test('valid positive feedback: ok=true, category=learning, title starts with SUCCESS', () => {
  const result = convertFeedbackToMemory({
    signal: 'positive',
    whatWorked: 'Built schema-validated feedback system with prevention rules',
    tags: ['architecture', 'rlhf'],
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.memory.category, 'learning');
  assert.ok(result.memory.title.startsWith('SUCCESS:'), `expected SUCCESS: prefix, got: ${result.memory.title}`);
});

// -- Bare thumbs down (no context) --

test('bare thumbs down (no context): ok=false', () => {
  const result = convertFeedbackToMemory({ signal: 'negative' });
  assert.strictEqual(result.ok, false);
});

// -- Bare thumbs up (no context) --

test('bare thumbs up (no context): ok=false', () => {
  const result = convertFeedbackToMemory({ signal: 'positive' });
  assert.strictEqual(result.ok, false);
});

test('generic positive context requires clarification instead of promotion', () => {
  const result = convertFeedbackToMemory({
    signal: 'positive',
    context: 'thumbs up',
    tags: ['verification'],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.needsClarification, true);
  assert.match(result.prompt, /What specifically worked that should be repeated/i);
});

// -- Unknown signal --

test('unknown signal: ok=false', () => {
  const result = convertFeedbackToMemory({ signal: 'maybe', context: 'test' });
  assert.strictEqual(result.ok, false);
});

// -- Tags preserved in output --

test('tags preserved in output', () => {
  const result = convertFeedbackToMemory({
    signal: 'negative',
    context: 'Agent skipped validation',
    whatWentWrong: 'No input validation on API endpoint',
    whatToChange: 'Add schema validation to all endpoints',
    tags: ['security', 'api'],
  });
  assert.strictEqual(result.ok, true);
  assert.ok(result.memory.tags.includes('security'), 'should include "security" tag');
  assert.ok(result.memory.tags.includes('api'), 'should include "api" tag');
});
