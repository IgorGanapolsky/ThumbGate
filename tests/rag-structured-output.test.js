'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateStructuredAnswer,
  parseModelStructuredAnswer,
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

test('validateStructuredAnswer rejects bracket citations outside retrieved set', () => {
  const oneSource = [{ id: 'lesson-a', title: 'Idempotency' }];
  const r = validateStructuredAnswer({
    answer: 'Something invented.',
    citations: [{ id: '[999]' }],
    grounded: true,
    confidence: 0.9,
  }, oneSource);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => String(e).startsWith('citation_unknown')));
  assert.equal(r.value.citations.length, 0);
});

test('validateStructuredAnswer rejects missing confidence', () => {
  const r = validateStructuredAnswer({
    answer: 'Use idempotency keys.',
    citations: [{ id: 'lesson-a', index: 1 }],
    grounded: true,
  }, sources);
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('missing_confidence'));
});

test('grounded output fails closed when it has no valid citations', () => {
  const result = validateStructuredAnswer({
    answer: 'This sounds supported but cites nothing.',
    citations: [],
    grounded: true,
    confidence: 0.95,
  }, sources);

  assert.equal(result.value.grounded, false);
  assert.ok(result.errors.includes('grounded_forced_false_no_valid_citations'));
});

test('free text without citations is explicitly ungrounded even when sources exist', () => {
  const result = coerceFreeTextToStructured('Use idempotency keys.', sources);

  assert.equal(result.value.grounded, false);
  assert.equal(result.value.abstain_reason, 'model_output_missing_valid_citation');
});
