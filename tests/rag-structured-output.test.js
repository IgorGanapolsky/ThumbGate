'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateStructuredAnswer,
  parseModelStructuredAnswer,
  parseStrictStructuredAnswer,
  buildStructuredRepairPrompt,
  coerceFreeTextToStructured,
  structuredOutputInstruction,
} = require('../scripts/rag-structured-output');

const sources = [
  { id: 'lesson-a', title: 'Idempotency' },
  { id: 'lesson-b', title: 'Health check' },
];

test('validateStructuredAnswer accepts a well-formed payload', () => {
  const r = validateStructuredAnswer({
    answer: 'Use idempotency keys.',
    citations: [{ id: 'lesson-a', index: 1 }],
    grounded: true,
    confidence: 0.9,
  }, sources);
  assert.equal(r.ok, true);
  assert.equal(r.value.grounded, true);
});

test('validateStructuredAnswer rejects missing answer', () => {
  const r = validateStructuredAnswer({
    answer: '',
    citations: [],
    grounded: false,
    confidence: 0.1,
  }, sources);
  assert.equal(r.ok, false);
});

test('parseModelStructuredAnswer reads fenced JSON', () => {
  const text = '```json\n{"answer":"Wait for Railway rebuild.","citations":[{"id":"lesson-b","index":2}],"grounded":true,"confidence":0.8}\n```';
  const r = parseModelStructuredAnswer(text, sources);
  assert.equal(r.mode, 'json');
  assert.equal(r.ok, true);
  assert.match(r.value.answer, /Railway/);
});

test('coerceFreeTextToStructured extracts [n] citations', () => {
  const r = coerceFreeTextToStructured('Always hit the health endpoint [2].', sources);
  assert.equal(r.ok, true);
  assert.ok(r.value.citations.some((c) => c.index === 2 || c.id === 'lesson-b'));
});

test('structuredOutputInstruction asks for JSON schema', () => {
  assert.match(structuredOutputInstruction(), /ONLY valid JSON/i);
  assert.match(structuredOutputInstruction(), /citations/);
});

test('strict structured parsing rejects free text instead of counting coercion as valid', () => {
  const result = parseStrictStructuredAnswer('Use the runbook [1].', [{ id: 'runbook' }]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ['invalid_json']);
});

test('structured repair prompt is bounded and restricts citations to retrieved sources', () => {
  const prompt = buildStructuredRepairPrompt(
    'not json',
    [{ id: 'runbook-1' }],
    ['invalid_json'],
  );
  assert.match(prompt, /runbook-1/);
  assert.match(prompt, /Do not add facts or citations/);
  assert.ok(prompt.length < 7000);
});
